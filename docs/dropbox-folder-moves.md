# Dropbox folder moves by stage — implementation spec

## 0. Context

- Repo: `kennguyentx/evolution-crm`, branch `main`.
- This spec implements review-doc items **44** (silent folder-move failures), **45**
  (company rename orphans the folder), **46** (manual folder-linking accepts
  invalid paths), and **50** (no retry on Dropbox 429/5xx; no in-flight lock on
  token refresh) from `docs/improvement-ideas.md`. Mark those items done in the
  review doc when this lands.
- Related work already on main, do not redo: item **43** (large-file uploads via
  signed upload), item **5** (cron secret via `x-cron-secret` header), item **11**
  (single cron-auth helper `lib/cron-auth.ts`).
- Read the files listed in §6 before changing anything. Do not guess at call
  sites — verify each one in the current code.

## 1. Goal

When a deal's stage changes in Nexus, its Dropbox folder must move to the
folder that stage maps to — reliably. A move that fails must be **visible** to
the user (not just a console log), **retryable** from the deal page, and
**self-healing**: a nightly reconciler must find and fix any folder that is out
of place, so the Dropbox tree can never silently drift from the deal stages.

## 2. Current behavior (verified on main, Nov 8, 2026)

- Stage → folder mapping, `lib/dropbox.ts` `expectedDropboxFolder`
  (line ~108): Pass stages (`Pass (DOA)`, `Pass (Pre-LOI)`, `Pass (Post-LOI)`)
  → `/Evolution Strategy Partners/Deals/!Passed Deals/<name>`; Closed stages
  (`Closed (Platform)`, `Closed (Add-On)`) →
  `/Evolution Strategy Partners/Portfolio Co's/<name>`; `Hold` →
  `/Evolution Strategy Partners/Deals/!Hold/<name>`; anything else →
  `/Evolution Strategy Partners/Deals/<name>`. Company names are sanitized
  (`[<>:\"/\\|?*]` → `_`). `uniqueDropboxFolder` appends ` (2)`, ` (3)`…
  when a same-named folder already exists; it is for **new** deals only.
- Client helper `lib/dropbox-stage-move.ts` `moveDropboxOnStageChange`:
  no-ops when `currentDropboxPath` is empty or already equals the target
  (case-insensitive); otherwise `PATCH /api/dropbox` with
  `{ from_path, to_path }`; on success updates `deals.dropbox_path` in
  Supabase. **On failure it only `console.error`s and returns
  `{ path: current, error: msg }` — nothing in the UI shows the failure, and
  the stage save has already succeeded, so the deal reads "Passed" while its
  folder is still under `/Deals/`.** That is the bug this spec fixes.
- Server `lib/dropbox.ts` `dropboxMove` (line ~70): creates the destination
  parent folder first (ignoring 409), then calls `files/move_v2` with
  `autorename: true`, and throws with the raw error text on non-OK. There is
  **no retry** on 429/5xx, and no in-flight lock on token refresh.
- Server `lib/dropbox.ts` `dropboxFolderExists` (line ~29): returns `false`
  on **any** error, not just `path/not_found` — so a rate limit or auth
  failure is misread as "folder doesn't exist".
- API route `app/api/dropbox/route.ts` `PATCH` (lines ~303–325): allow-list
  check (`isAllowedPath`), `dropboxMove`, `audit('move', …)`, and on failure
  returns 500 with `err.message`. No structured error code.
- The deal-page stage save (see `app/deals/[id]/page.tsx`, stage-change
  handler) calls the move helper after saving the stage. Whether the Kanban
  drag path also triggers the move was **not verified** — check both paths and
  wire the move into each one that changes stage.
- Cron pattern: Vercel crons in `vercel.json`; cron auth uses the
  `x-cron-secret` header, validated by `isAuthorizedCron` from
  `lib/cron-auth.ts`. Follow that exact pattern for the new reconciler.
- Migrations: there is **no migration runner** (review-doc item 10) —
  migrations are applied by hand via the Supabase SQL Editor. Include the SQL
  for the new table in this spec (§4) and apply it that way; do not invent a
  runner.

## 3. The four mechanisms

### 3a. Record the move before attempting it; surface failure in the UI

- New Supabase table `dropbox_move_jobs` (SQL in §4). One row per move
  attempt, including reconciler and migration moves (`source` column:
  `stage-change` | `retry` | `reconcile` | `migration`).
- Flow in `moveDropboxOnStageChange`:
  1. Insert a row with `status = 'pending'` (from_path, to_path, deal_id)
     **before** calling `PATCH /api/dropbox`.
  2. On success: mark the row `succeeded`, store the final path returned by
     the server, update `deals.dropbox_path`.
  3. On failure: mark the row `failed`, store the error text and the
     machine-readable code from the server (§3b), return the error.
- Deal page (`app/deals/[id]/page.tsx`): when the move helper returns an
  error, show a **non-blocking warning banner** on the deal page, e.g.
  "Dropbox folder could not be moved to !Passed Deals — [Retry] [Dismiss]".
  The banner must not block the stage save (the stage change itself already
  succeeded). Retry re-invokes the move for the latest failed job of that
  deal and clears the banner on success. The banner state must survive a page
  reload — derive it from the latest failed `dropbox_move_jobs` row for the
  deal, not from in-memory state alone.
- Do not delete or overwrite failed rows; they are the audit trail. A later
  successful move for the same deal does not erase the earlier failure row.

### 3b. Idempotent move with explicit error handling

- **Check actual location first.** Before calling `files/move_v2`, resolve
  where the folder really is with `files/get_metadata` on both `from_path`
  and `to_path`:
  - Folder already at `to_path` → no move; mark the job `succeeded`,
    update `deals.dropbox_path` to `to_path`. (Covers the case where a
    previous move succeeded but its response was lost.)
  - `from_path` missing (`path/not_found`) but `to_path` exists → same
    treatment as above.
  - `from_path` missing and `to_path` missing → fail with code `not_found`
    and a clear message; do not create an empty folder to paper over it.
- **Conflict is explicit, never silent autorename.** Attempt the move with
  `autorename: false`. On `to/conflict`, do not let Dropbox silently rename
  the folder: compute a free name with the existing `uniqueDropboxFolder`
  logic, move there instead, and record the **actual final path** in the job
  row and in `deals.dropbox_path`. The user must be able to see where the
  folder ended up.
- **Classify errors, don't lump them.** Parse `error_summary` from Dropbox
  and return a machine-readable `code` from the `PATCH` handler alongside the
  message. Codes: `not_found` (`path/not_found`), `conflict`
  (`to/conflict`, `from/write/...` conflicts), `rate_limited` (HTTP 429 or
  `rate_limit`), `auth` (401/403, `invalid_access_token`,
  `expired_access_token`), `unknown` (everything else). The client uses the
  code to decide: `rate_limited`/`auth` → auto-retry (§3c); `not_found` /
  `conflict` → show the banner and let the user retry or fix the path.
- **`dropboxFolderExists` must stop lying.** Return `true` / `false` only for
  the `path/not_found` case. On any other error (rate limit, auth, 5xx,
  network failure) **throw** so callers cannot misread a transient failure as
  "doesn't exist". Update all callers (`uniqueDropboxFolder`, the move
  pre-check, the reconciler) to handle the throw.

### 3c. Retry transient failures; lock the token refresh

- Add a small retry helper in `lib/dropbox.ts` (e.g. `withDropboxRetry`) and
  use it for every Dropbox API call in `dropboxMove`, `dropboxUpload`, and
  the metadata checks: retry **only** on HTTP 429 and 5xx, up to 3 attempts,
  exponential backoff (1s, 2s, 4s) with a small jitter. Do not retry 4xx
  errors other than 429. After the final failure, throw the classified error
  from §3b.
- **Token refresh in-flight lock.** `getDropboxToken` must coalesce
  concurrent refreshes: keep a module-level `refreshPromise`; if a refresh
  is already in flight, await that promise instead of starting a second one.
  Clear it on settle. This is the second half of review-doc item 50.
- If a refresh fails with an auth error, do not loop: fail fast with code
  `auth`.

### 3d. Nightly reconciler (the backstop)

- New route `app/api/dropbox/reconcile/route.ts`, `GET`, protected exactly
  like the other crons: `isAuthorizedCron` from `lib/cron-auth.ts` against
  the `x-cron-secret` header. No other auth path.
- New Vercel cron entry in `vercel.json`, following the existing entries'
  format: nightly (03:00 UTC is a reasonable default; match whatever time
  zone/format the existing crons use). One run per night.
- What one run does, in order:
  1. Load every deal with a non-null `dropbox_path` (plus `id`, `stage`,
     `company_name`) from Supabase. Page through the list if needed.
  2. For each deal, compute the expected folder from its stage (§5 — after
     the deal-ID migration, the expected path is deal-ID based).
  3. Compare with reality via `files/get_metadata` on the stored path and
     on the expected path:
     - Stored path exists and equals expected → OK, nothing to do.
     - Stored path exists but differs from expected → move it (via the
       same `dropboxMove` + job-row machinery), update `deals.dropbox_path`,
       count as `moved`.
     - Stored path missing but expected path exists → update
       `deals.dropbox_path` to the expected path, count as `fixed_path`
       (no move needed).
     - Neither exists → count as `missing`; log a warning, do **not**
       create an empty folder, do not change the deal row.
     - Any move that fails → leave the deal row alone, record a failed job
       row with `source = 'reconcile'`, count as `failed`, continue with
       the next deal (one bad deal must not abort the run).
  4. Return a JSON summary `{ checked, moved, fixed_path, missing, failed,
     failures: [{ deal_id, error }] }` and log it. Also `audit()` the run
     summary the way the existing route audits moves.
- The reconciler must be **idempotent and safe to re-run** (running it twice
  in a row must be a no-op the second time). Process deals sequentially or
  with small bounded concurrency, and respect rate limits (the retry helper
  from §3c applies here too).
- The reconciler is the backstop, not the primary path: stage changes must
  still move the folder immediately (§3a). The reconciler only catches what
  slipped through.

## 4. Related fixes in the same pass

### 4a. Folder identity by deal ID (review-doc item 45)

- **Problem:** folders are named by company name, so renaming a company in
  Nexus leaves a stale folder name; the DB path is updated but the folder is
  not moved (or vice versa).
- **Change:** `expectedDropboxFolder` takes the deal ID and returns a path
  keyed by it, e.g. `/Evolution Strategy Partners/Deals/<dealId>` (and the
  corresponding `!Passed Deals`, `!Hold`, and `Portfolio Co's` parents by
  stage). The company name must **not** appear in the path. The Dropbox
  files tab and deal page keep showing the company name from the deal record,
  so readability in the UI is unchanged; only the on-disk name is an ID.
- **Why ID-only, not `id_name`:** any name-derived component reintroduces
  the rename problem. ID-only is the durable fix the review doc calls for.
- **One-time migration** (do this before enabling the reconciler, §3d):
  1. Script or one-off admin route that lists every deal with a
     `dropbox_path`, computes its new deal-ID path from its stage, and for
     each: moves the folder with `dropboxMove`, updates `deals.dropbox_path`,
     and writes a job row with `source = 'migration'`.
  2. If the target ID-path already exists (e.g. a previous partial
     migration), apply the §3b conflict rule instead of failing.
  3. Run it once, verify the counts (moved / already-correct / failed),
     and keep the job rows as the migration record. Do not delete the old
     folder names from anywhere else until the run is verified.
  4. After the migration, `expectedDropboxFolder(companyName, stage)` is
     replaced by the deal-ID version everywhere it is called; update the
     new-deal creation flow (`uniqueDropboxFolder` callers) to use the deal
     ID as well — a deal ID is unique by definition, so the ` (2)` suffix
     logic becomes unnecessary for deal folders (keep the helper for any
     other caller that still needs it, or remove it if it has none).

### 4b. Validate a manually entered folder path at save time (review-doc item 46)

- **Problem:** the Dropbox files tab defaults a manual path input to
  `/<CompanyName>`, which is outside the allow-list; saving succeeds in
  Supabase and every later list call 403s.
- **Change in `components/deals/DropboxFilesTab.tsx`:** before saving a
  manually entered path, validate it client-side against the same rule the
  server enforces (must be under `/Evolution Strategy Partners`,
  case-insensitive). Refuse to save an invalid path and show an inline error
  explaining the required prefix. Additionally, verify the folder exists via
  `files/get_metadata` before linking; if it doesn't exist, warn and ask
  for confirmation rather than silently storing a dead link.
- Fix the default value of the path input: prefill it with the deal's
  expected folder (or leave it blank), never with a bare `/<CompanyName>`.

## 5. New database table

Apply by hand via the Supabase SQL Editor (no migration runner exists —
review-doc item 10). Name the migration file after the repo's existing
convention if one exists, otherwise save the SQL as
`supabase/migrations/<date>_dropbox_move_jobs.sql` and apply it manually.

```sql
create table if not exists public.dropbox_move_jobs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  from_path text not null,
  to_path text not null,
  final_path text,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  source text not null check (source in ('stage-change', 'retry', 'reconcile', 'migration')),
  code text,
  error text,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dropbox_move_jobs_deal_id_idx
  on public.dropbox_move_jobs (deal_id, created_at desc);
```

(If the `deals` table uses a different key type, match it — verify against
the live schema before applying.)

## 6. File-by-file change list

| File | Change |
|---|---|
| `lib/dropbox.ts` | Add `withDropboxRetry` (429/5xx only, 3 attempts, exp backoff + jitter); use it in `dropboxMove`, `dropboxUpload`, metadata checks. Add in-flight lock to `getDropboxToken` refresh. Fix `dropboxFolderExists` to throw on non-`not_found` errors. `dropboxMove`: pre-check actual locations (§3b), `autorename: false` first attempt, explicit conflict fallback via `uniqueDropboxFolder` logic, return the actual final path. `expectedDropboxFolder`: re-key by deal ID (§4a); update its signature and all callers. |
| `lib/dropbox-stage-move.ts` | Insert a pending `dropbox_move_jobs` row before the PATCH call; mark succeeded/failed with code + error; update `deals.dropbox_path` to the server-returned final path; return the error (with code) so the caller can show the banner. Add a `retryDropboxMove(dealId)` helper used by the Retry button. |
| `app/api/dropbox/route.ts` | `PATCH`: return structured errors `{ error, code }` (§3b codes). Keep the allow-list check and `audit('move', …)` exactly as-is. Do not change the GET/upload handlers except to use the retry helper where they call Dropbox. |
| `app/deals/[id]/page.tsx` | Stage-change handler: on move error, show the non-blocking warning banner with Retry/Dismiss; derive banner state from the latest failed job row so it survives reload. Check the Kanban drag path too — if it changes stage without calling the move helper, wire it in. |
| `components/deals/DropboxFilesTab.tsx` | Validate a manually entered path against the allow-list before saving; fix the default input value; verify the folder exists before linking (§4b). |
| `app/api/dropbox/reconcile/route.ts` | **New.** `GET`, cron-authenticated (`isAuthorizedCron`, `x-cron-secret`). Implements the run in §3d; returns the JSON summary; audits the summary. |
| `vercel.json` | Add the nightly cron entry for `/api/dropbox/reconcile`, following the existing entries' format. |
| New migration SQL | `dropbox_move_jobs` table (§5). Apply by hand via Supabase SQL Editor. |
| `docs/improvement-ideas.md` | Mark items 44, 45, 46, 50 done (with the commit) when this lands. |

## 7. Acceptance criteria and test plan

Acceptance criteria (all must hold before merging):

1. Changing a deal's stage in Nexus moves its Dropbox folder to the
   stage-mapped folder, and `deals.dropbox_path` matches the folder's actual
   location afterwards.
2. A forced move failure (e.g. temporarily rename the target parent in
   Dropbox, or point the move at a path the allow-list rejects) shows the
   warning banner on the deal page; Retry succeeds once the cause is fixed.
3. The reconciler fixes a deliberately misplaced folder: move a deal's folder
   by hand in Dropbox, run the reconcile route, confirm the folder is back
   where its stage says it should be and the summary counts it as `moved`.
4. Renaming a company does not orphan its folder: the folder stays put (its
   name is the deal ID) and `deals.dropbox_path` is unchanged.
5. A 429 / 5xx from Dropbox is retried, not failed outright (verify by
   unit-testing `withDropboxRetry` with a mocked fetch that fails twice then
   succeeds; a live 429 is hard to force on demand).
6. `npm run typecheck` and `npm run lint` pass; the existing CI workflow
   goes green on the PR.

Test plan (run in order):

- **Unit:** retry helper (mocked fetch: 429 then 200; 500 then 200; 400
  never retried); error-code classification from `error_summary` samples;
  `expectedDropboxFolder` for each stage, including a rename (same ID, new
  name → same path).
- **Manual, staging or a test deal:** stage change end-to-end (each stage
  bucket); forced failure → banner → Retry; rename the company; save an
  invalid manual path (expect refusal) and a valid one (expect success).
- **Reconciler:** misplace one folder by hand, run the route with a valid
  cron secret, check the summary and the folder; run it again immediately
  and confirm the second run is a no-op; run it with a missing/invalid
  cron secret and confirm it is rejected.
- **Migration:** run the one-time migration on a copy or a small subset
  first; verify moved / already-correct / failed counts before running it
  for all deals.

## 8. What NOT to change

- **The signed-upload flow from item 43** (Supabase `storagePath` →
  server-side move to Dropbox, bypassing the Vercel body limit). It works;
  don't touch it except to route its Dropbox calls through the retry helper
  if that is a one-line change — otherwise leave it alone.
- **The path allow-list** (`ALLOWED_ROOT = '/Evolution Strategy Partners'`,
  case-insensitive). The reconciler, the migration, and the manual-path
  validation must all respect it, not weaken it.
- **Audit logging.** Keep the existing `audit('move', …)` calls. Add audit
  entries for reconcile runs and migrations; do not remove any existing
  audit call.
- Do not change the stage names, the stage buckets (Pass / Closed / Hold /
  active), or the `!Passed Deals` / `!Hold` / `Portfolio Co's` parent
  folders. Only the leaf folder naming changes (§4a).
- Do not add a migration runner, a queue service, or any new infrastructure.
  The move-jobs table, the existing Vercel cron pattern, and the existing
  cron-auth helper are the whole footprint.
