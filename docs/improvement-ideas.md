# Evolution CRM — Improvement Ideas

Scanned Nov 7, 2026 from `kennguyentx/evolution-crm` at commit `5e22def`
(`feat: email-forwarded deals send New Deal notification for active-pipeline stages`).
~22,000 lines of TypeScript/JS, 34 API routes, Next.js 14 (App Router) + Supabase +
Claude + Dropbox + Postmark, deployed on Vercel (app) + Render (email relay).

How to use this file: paste the whole thing to Claude Code, or pick items one at a
time. Every item is self-contained: what to change, the file(s), and why.
Suggested order at the bottom.

**Update Nov 10, 2026:** items 1, 5, 11, 20, and 43 were already done (see
the Status lines on those items). Item 2 is moot — Ken decided Nov 8, 2026
he does not want the portfolio-news email scheduled. **Scope for this round:
everything except items 31–42 (PE lens), which Ken deferred Nov 10, 2026.**
All 34 in-scope items are now **Done — merged to `main` Nov 10, 2026** (Ken
authorized Vesper to merge them): Batch A (items 3, 7, 12, 17, 18) in PR #2,
Batch B (4, 8, 9, 21) in PR #3, Batch C (19, 10) in PR #4, Batch D (44–52) in
PR #5 — merged via replacement PR #14, Batch E (22–30) in PR #7, and Batch F
one PR per item — item 15 in PR #9, item 6 in PR #10 (via replacement
PR #26), item 14 in PR #11 (via replacement PR #25), item 16 in PR #12,
item 13 in PR #13 (via replacement PR #15). Final `main` was verified after
the last merge: typecheck, lint, and 110/110 tests green, plus a clean
production build. Items 31–42 remain deferred. See the Status line on each
item.

## What's already good (don't "fix" these)

- TypeScript compiles clean — `tsc --noEmit` reports 0 errors.
- No hardcoded secrets in the repo (grep for keys/tokens/passwords found nothing).
- The email-intake webhook is properly gated: `app/api/notes/email/route.ts`
  accepts only a Postmark webhook token or the relay's internal secret.
- Middleware enforces login on all pages and all `/api/*` routes, plus MFA
  (TOTP) gating for enrolled users.
- RLS is enabled on the tables; `assistant_threads` is user-scoped.
- The three GitHub Actions cron workflows are explicitly marked manual-backup
  only, so nothing double-fires against Vercel Cron.
- The cron secret is accepted three ways (query, header, Bearer) with a
  documented reason: Vercel's Deployment Protection strips `Authorization`.

---

## Priority 1 — fix first

### 1. Replace SheetJS `xlsx` — two unpatched High CVEs, and it parses uploaded files

- **Files:** `package.json`, `app/deals/[id]/page.tsx:544-548`,
  `app/portfolio/[id]/page.tsx:107-112`
- **Problem:** the app pins `xlsx@0.18.5`, which carries two High CVEs with no
  fix on npm — CVE-2023-30533 / GHSA-4r6h-8v6p-xvw6 (prototype pollution,
  CVSS 7.8) and CVE-2024-22363 / GHSA-5pgg-2g8v-p4x9 (ReDoS, CVSS 7.5).
  SheetJS stopped publishing to npm after 0.18.5. Worse, both call sites feed
  it user-uploaded spreadsheets via `XLSX.read()` (deal financials upload and
  portfolio financials upload), so a poisoned `.xlsx` from a forwarded
  teaser/CIM reaches the vulnerable parser.
- **Change:** swap to `exceljs` (actively maintained, no equivalent advisory),
  or pin the official SheetJS CDN tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
  Note: exceljs cannot read legacy `.xls` — either drop `.xls` from the upload
  `accept` lists in those two pages or use the CDN tarball, which keeps `.xls`.
- **Status (Nov 8, 2026): Done** — pinned the SheetJS CDN tarball 0.20.3 in
  `package.json` (commit `f2f5ac6` on `main`); no code changes, same API,
  `.xls` still works. Skip this item.

### 2. The daily portfolio-news email has no schedule — it probably never sends

- **Files:** `vercel.json`, `.github/workflows/cron-portfolio-news.yml`,
  `app/api/portfolio-news/daily-email/route.ts`, `app/dashboard/page.tsx:114`
- **Problem:** `vercel.json` schedules `/api/digest`, `/api/pipeline/weekly-email`
  and `/api/deals/loi-alerts`, but there is no cron for
  `/api/portfolio-news/daily-email`. The GitHub workflow for it is manual-only
  (`workflow_dispatch`) and its comment claims "real scheduler is Vercel native
  crons (vercel.json)" — but it's not in `vercel.json`. The only trigger today
  is the manual send button on the dashboard. The route and the cron-secret
  middleware entry for it exist, so this looks like a missed line, not a
  deliberate choice.
- **Change:** add a `vercel.json` cron for `/api/portfolio-news/daily-email`
  (e.g. weekday mornings), fix the workflow comment, and keep exactly one
  scheduler. Verify the next morning that the email actually arrives.
- **Status (Nov 10, 2026): Moot** — Ken decided Nov 8, 2026 he does not want
  the portfolio-news email scheduled. Skip this item; do not add the cron.

### 3. README setup is broken — `.env.example` doesn't exist at the repo root

- **Files:** `README.md`, repo root
- **Problem:** the README's Local Development section says
  `cp .env.example .env.local`, but there is no `.env.example` in the repo
  root (only `email-server/.env.example`). A new dev can't follow the setup.
- **Change:** add a root `.env.example` listing the Vercel variables from the
  README (Supabase URL/anon/service-role keys, Anthropic, Postmark, Dropbox,
  `CRON_SECRET`, `INTERNAL_WEBHOOK_SECRET`, team email, app URL) with empty
  values. Also document `CRON_SECRET` and `INTERNAL_WEBHOOK_SECRET` in the
  README's env-var table — they exist in the code but aren't listed there.
- **Status (Nov 10, 2026): Implemented in PR #2** (`batch-a-quick-wins`,
  commit `0170d3b`) — root `.env.example` added, README env-var table updated.
  Done — merged Nov 10, 2026.

---

## Security & auth hardening

### 4. Middleware uses `getSession()` — switch to `getUser()`

- **File:** `middleware.ts:33`
- **Problem:** the session check that gates every page and API route uses
  `supabase.auth.getSession()`, which trusts the session cookie without
  revalidating the JWT against the Auth server. Supabase's guidance is to use
  `getUser()` for server-side auth decisions. (One page already does:
  `app/assistant/page.tsx` uses `getUser()`.)
- **Change:** replace the `getSession()` call in `middleware.ts` with
  `getUser()` and treat a missing/error user as unauthenticated.
- **Status (Nov 10, 2026): Implemented in PR #3** (`batch-b-auth-validation`,
  commit `2098a84`) — Batch B (auth hardening + validation); CI green.
  Done — merged Nov 10, 2026.

### 5. Stop putting `CRON_SECRET` in the URL query string

- **Files:** `.github/workflows/cron-weekly.yml`,
  `.github/workflows/cron-loi-alerts.yml`,
  `.github/workflows/cron-portfolio-news.yml`
- **Problem:** all three workflows call the endpoints with
  `?cron_secret=$SECRET`. Secrets in URLs land in Vercel/CDN/proxy logs. The
  code already accepts the secret as the `x-cron-secret` header and as a
  Bearer token (`middleware.ts`, `lib/cron-auth.ts`).
- **Change:** send it as `-H "x-cron-secret: $SECRET"` in the three workflows
  and drop the query param.
- **Status (Nov 8, 2026): Done** — the three cron workflows now send
  `CRON_SECRET` as the `x-cron-secret` header instead of a URL query param
  (commit `f2f5ac6` on `main`). Skip this item.

### 6. Migrate off deprecated `@supabase/auth-helpers-nextjs` to `@supabase/ssr`

- **Files:** `package.json`, `middleware.ts`, `lib/supabase.ts`, every page
  using the client
- **Problem:** `@supabase/auth-helpers-nextjs@^0.8.7` is deprecated; Supabase
  replaced it with `@supabase/ssr` (`createBrowserClient` /
  `createServerClient`, new middleware pattern). Staying on the deprecated
  package means no security fixes.
- **Change:** install `@supabase/ssr`, rewrite `lib/supabase.ts` (currently a
  one-liner) with `createBrowserClient`, rewrite `middleware.ts` with the
  `@supabase/ssr` middleware client, and update the call sites. Do this in its
  own branch and verify login + MFA + the cron routes still work.
- **Status (Nov 10, 2026): Implemented in PR #10** (merged via replacement PR #26) (`batch-f6-ssr`, commit
  `a355389`) — Batch F; CI green. The live-auth preview test was waived by Ken. Done — merged Nov 10, 2026.

### 7. Document the trust model: RLS is advisory, the middleware is the real gate

- **Files:** `README.md`, `supabase/migrations/rls_policies.sql`
- **Problem:** RLS policies are `authenticated_all` (any authenticated user
  can read/write every row), and most API routes use the service-role key,
  which bypasses RLS entirely. So the only real access control is the
  middleware session check. That's a reasonable design for a small internal
  team, but it's implicit — a future public route or a new table without a
  policy would silently inherit it.
- **Change:** add a short "Security model" section to the README stating that
  all access control lives in `middleware.ts`, that API routes use the
  service-role key by design, and that any new table needs an RLS policy and
  any new public route needs an explicit middleware exemption.
- **Status (Nov 10, 2026): Implemented in PR #2** (`batch-a-quick-wins`,
  commit `0170d3b`) — "Security model" section added to the README. Done — merged Nov 10, 2026.

---

## Reliability

### 8. `withErrorHandler` exists but 0 of 34 routes use it

- **Files:** `lib/api-response.ts`, all files under `app/api/`
- **Problem:** the helper is documented with usage examples, but no route
  wraps its handler in it. An unhandled throw in any of the 34 routes returns
  Next.js's default HTML error page instead of a structured JSON error.
- **Change:** wrap every route handler with `withErrorHandler` (or delete the
  helper if the team prefers per-route try/catch — pick one and be consistent).
- **Status (Nov 10, 2026): Implemented in PR #3** (`batch-b-auth-validation`,
  commit `2098a84`) — Batch B (auth hardening + validation); CI green.
  Done — merged Nov 10, 2026.

### 9. Zod schemas exist but only 1 of 34 routes validates its request body

- **Files:** `lib/schemas.ts`, `app/api/interactions/route.ts`,
  deal/note routes under `app/api/`
- **Problem:** `lib/schemas.ts` defines `InteractionCreateSchema`,
  `InteractionUpdateSchema`, `IntakeQueueActionSchema` and `DealUpdateSchema`,
  but only `app/api/intake/queue/[id]/route.ts` uses any of them. Every other
  POST/PATCH endpoint accepts unvalidated JSON, so bad payloads surface as
  database errors or partial writes.
- **Change:** wire the existing schemas into `app/api/interactions/route.ts`,
  the deal update routes, and the notes routes; return 400 with the first
  issue message (the pattern already in the schemas file's header comment).
  Add schemas for the remaining POST endpoints that lack one.
- **Status (Nov 10, 2026): Implemented in PR #3** (`batch-b-auth-validation`,
  commit `2098a84`) — Batch B (auth hardening + validation); CI green.
  Done — merged Nov 10, 2026.

### 10. Migrations are applied by hand — add a runner

- **Files:** `supabase/migrations/`, `README.md`
- **Problem:** the README says to run new migration files "through the
  Supabase SQL Editor". There is no tracking of which migrations have been
  applied, so a deploy can silently skip one (or apply one twice).
- **Change:** adopt the Supabase CLI (`supabase db push`) or a small
  applied-migrations table, and document the single command in the README.
  Confirm the current production database matches the files in
  `supabase/migrations/` first.
- **Status (Nov 10, 2026): Implemented in PR #4** (`batch-c-guardrails`,
  commit `84cc544`) — Batch C (tests + migration runner); CI green. Before the
  runner's first real use: verify against the production DB and run `npm run
  migrate -- --baseline`. Done — merged Nov 10, 2026.

### 11. Deduplicate the cron-secret check

- **Files:** `middleware.ts` (own `hasValidCronSecret`),
  `lib/cron-auth.ts` (`isAuthorizedCron`)
- **Problem:** the same three-way secret check is implemented twice and can
  drift (they already differ slightly in structure).
- **Change:** have `middleware.ts` import `isAuthorizedCron` from
  `lib/cron-auth.ts` and delete its local copy.
- **Status (Nov 8, 2026): Done** — `middleware.ts` now imports
  `isAuthorizedCron` from `lib/cron-auth.ts`; the duplicate
  `hasValidCronSecret` was removed (commit `f2f5ac6` on `main`). Skip this
  item.

### 12. Email relay checks env vars after it starts listening

- **File:** `email-server/server.js`
- **Problem:** the required-env-var check runs inside the `app.listen`
  callback, so the server briefly accepts traffic and then exits if a variable
  is missing.
- **Change:** move the missing-var check above `app.listen` so it fails fast
  before binding the port.
- **Status (Nov 10, 2026): Implemented in PR #2** (`batch-a-quick-wins`,
  commit `0170d3b`) — env-var check moved above `app.listen` in
  `email-server/server.js`. Done — merged Nov 10, 2026.

---

## Code quality

### 13. 748 uses of `any` — TypeScript is clean but the types aren't doing work

- **Files:** across `app/`, `lib/`, `components/` (748 occurrences)
- **Problem:** `tsc --noEmit` passes with 0 errors, but `any` is everywhere,
  so the compiler can't catch real mistakes — especially in the API layer and
  the AI tool-call code.
- **Change:** chip away at the hot spots first: `lib/api-response.ts`
  (`RouteHandler` types `ctx` as `any`), the Supabase row shapes, and
  `lib/assistant-core.ts` tool-call payloads. Consider enabling
  `noImplicitAny` follow-ups per-file rather than a big-bang rewrite.
- **Status (Nov 10, 2026): Implemented in PR #13** (merged via replacement PR #15) (`batch-f13-types`, commit
  `3f6578b`) — Batch F; CI green. Done — merged Nov 10, 2026.

### 14. 111 `console.log/warn/error` calls, including logging user content

- **Files:** across `app/`, `lib/`, `components/`; worst offender
  `app/api/notes/email/route.ts:486` logs the text of emailed questions
- **Problem:** ad-hoc logging with no levels and no redaction — email question
  text, attachment names and sizes go to stdout, and errors are mixed in with
  routine info.
- **Change:** add a tiny structured logger (level + timestamp + tag) and route
  the calls through it; stop logging user content (questions, bodies) and keep
  metadata only (message IDs, counts, sizes).
- **Status (Nov 10, 2026): Implemented in PR #11** (merged via replacement PR #25) (`batch-f14-logger`, commit
  `e4e7699`) — Batch F; CI green — structured logger `lib/log.ts` replaced all
  111 console calls in app/lib/components and stopped logging user content.
  Left: `email-server/server.js` still has 8 console calls (separate JS
  service; a JS twin is the follow-up). Done — merged Nov 10, 2026.

### 15. Split the biggest files

- **Files:** `app/deals/[id]/page.tsx` (1,854 lines),
  `app/intake/page.tsx` (1,540), `app/api/notes/email/route.ts` (1,212),
  `app/raises/page.tsx` (1,172), `lib/assistant-core.ts` (901)
- **Problem:** the deal detail page, intake page, and the email-intake route
  each mix several concerns, which makes them hard to review and test.
- **Change:** start with the email-intake route — extract the "Ask:" email
  assistant and the DOCX/spreadsheet extraction into `lib/` modules. Then
  split the deal detail page by tab (documents, NDA, Dropbox) into components.
- **Status (Nov 10, 2026): Implemented in PR #9** (`batch-f15-splits`, commit
  `55f3367`) — Batch F; CI green. Done — merged Nov 10, 2026.

---

## Dependencies

### 16. Enable Dependabot (or Renovate) — dependencies drift silently

- **Files:** `.github/` (contains only `workflows/`)
- **Problem:** no automated dependency updates. Current drift: ESLint 8 is
  end-of-life; Next.js is pinned at 14.1.0 (behind 14.2); `@anthropic-ai/sdk`
  is `^0.96.0` in the app but `^0.52.0` in `email-server`; `@supabase/supabase-js`
  is `^2.39.0` in the app but `^2.49.4` in `email-server`.
- **Change:** enable Dependabot for npm and GitHub Actions, then work through
  the resulting PRs — major bumps (Next, ESLint 9) in their own branches.
- **Status (Nov 10, 2026): Implemented in PR #12** (`batch-f16-dependabot`,
  commit `07c528b`) — Batch F; CI green. Done — merged Nov 10, 2026.

### 17. Remove unused dependencies from the main app

- **Files:** `package.json`, `next.config.js`
- **Problem:** `pdf-parse` and `formidable` are in `dependencies` but imported
  nowhere in `app/`, `lib/`, or `components/` (verified by grep). `pdf-parse`
  is also listed in `next.config.js` `serverComponentsExternalPackages`.
  Dead dependencies still get installed, audited, and bundled.
- **Change:** verify with a repo-wide grep, then remove both from
  `package.json` and drop `pdf-parse` from `next.config.js`. If PDF parsing is
  needed later, re-add a maintained library then.
- **Status (Nov 10, 2026): Implemented in PR #2** (`batch-a-quick-wins`,
  commit `0170d3b`) — `pdf-parse` and `formidable` removed from
  `package.json`, `pdf-parse` dropped from `next.config.js`. Done — merged Nov 10, 2026.

### 18. Clean up `email-server`

- **Files:** `email-server/package.json`, `email-server/server.js`
- **Problem:** `@anthropic-ai/sdk` and `jszip` are in `dependencies` but never
  imported in `server.js`. The server is plain JS while the rest of the repo
  is TypeScript, and it has no lint or test config.
- **Change:** remove the two unused deps, consider converting to TypeScript to
  match the main app, and add a lint script. (Also see item 12 for the env-var
  ordering fix in the same file.)
- **Status (Nov 10, 2026): Implemented in PR #2** (`batch-a-quick-wins`,
  commit `0170d3b`) — unused `@anthropic-ai/sdk` and `jszip` removed from
  `email-server/package.json`, `lint` script (`node --check server.js`)
  added. TypeScript conversion deliberately not done (bigger job). Done — merged Nov 10, 2026.

---

## Testing & CI

### 19. Zero tests — add Vitest, starting with the logic-heavy spots

- **Files:** repo root (no test files, no test script, no test framework)
- **Problem:** nothing verifies behavior. The regression-prone logic is the
  zod schemas, the cron-auth three-way check, the intake stage mapping
  (email subject/body note → deal stage), and the portfolio-news curation.
- **Change:** add Vitest, then write the first tests for those four areas.
  They are pure functions or thin handlers, so they don't need a database or
  a running app.
- **Status (Nov 10, 2026): Implemented in PR #4** (`batch-c-guardrails`,
  commit `84cc544`) — Batch C (tests + migration runner); CI green. Note: CI
  does not run the test suite until the updated `ci.yml` lands (needs the
  GitHub App Workflows permission or a hand-push). Done — merged Nov 10, 2026.

### 20. No CI — nothing runs lint or typecheck on push/PR

- **Files:** `.github/workflows/` (only manual cron backups), `package.json`
- **Problem:** the only workflows are the three manual cron backups. A broken
  build or a lint failure is discovered at deploy time, not at PR time.
  Worse, lint has effectively never run: there is **no ESLint config file
  anywhere in the repo** (no `.eslintrc.*`, no `eslintConfig` in
  `package.json`; `email-server/` has none either), and `npm run lint` is
  just `next lint`, which with no config does not lint — it opens an
  interactive "How would you like to configure ESLint? Strict / Base /
  Cancel" prompt and waits for input forever. Verified Nov 7–8, 2026: two
  `npx next lint` runs produced zero output over hours (killed by runtime
  restarts while still waiting at the prompt); running it with stdin closed
  shows the prompt and exits without creating a config. A CI job calling
  `npm run lint` as-is would hang the same way.
- **Change:** first create the config — run `next lint` once interactively
  and pick Strict, or add an `.eslintrc.json` extending
  `eslint-config-next` directly — and commit it. *Then* add a CI workflow
  that runs `npm ci`, `npm run lint` and
  `tsc --noEmit` on every push/PR, plus the Vitest suite once item 19 exists.
  Also add a `"typecheck": "tsc --noEmit"` script to `package.json` so there
  is a canonical command for it.
- **Status (Nov 10, 2026): Done** — `.eslintrc.json` (extends
  `next/core-web-vitals`) added in commit `4b18492` (Nov 8, 2026); lint now
  runs for real in CI. The first run found 25 errors, fixed in commit
  `1722dbf` (Nov 9, 2026): the dangling `@typescript-eslint/no-explicit-any`
  disable in `lib/assistant-core.ts:19` was removed,
  `react/no-unescaped-entities` was turned off in `.eslintrc.json` (cosmetic
  rule), and `next.config.js` got `eslint.ignoreDuringBuilds: true` so lint
  lives in CI, not the deploy. CI run #5 green (typecheck + lint both pass).
  Optional follow-up: run `npx eslint . --fix` locally and flip
  `react/no-unescaped-entities` back to error. Skip this item otherwise.

### 21. (Nice-to-have) Rate-limit the unauthenticated and AI-cost endpoints

- **Files:** `app/api/notes/email/route.ts`, `app/api/assistant/route.ts`,
  `app/api/cim-analyze/route.ts`, `app/api/nda-analyze/route.ts`
- **Problem:** the public webhook and the Claude-powered endpoints have no
  rate limiting. The webhook is token-gated, but a leaked token or a loop
  could burn Anthropic spend.
- **Change:** add a small per-IP/per-key rate limit (e.g. Upstash Ratelimit
  or a simple in-memory limiter) on those four routes. Low priority — do it
  after the items above.
- **Status (Nov 10, 2026): Implemented in PR #3** (`batch-b-auth-validation`,
  commit `2098a84`) — Batch B (auth hardening + validation); CI green.
  Done — merged Nov 10, 2026.

---

## Suggested order

1. Items 1–3 — real bugs / broken setup, all small.
2. Items 4, 5, 8, 9 — auth and input-validation hardening.
3. Items 19, 20 — guardrails (tests + CI) before the bigger refactors.
4. Items 6, 13, 15 — the refactors (Supabase SSR migration, typing, file splits).
5. Items 16–18, 21 — dependency hygiene and nice-to-haves.
6. Items 22–30 (UI & linking) and 31–42 (PE lens) slot in after the guardrails;
   if the goal is PE workflow depth, do 31–33 first.
7. Items 43–52 (Dropbox & file saving): do 43 (upload cap) and 44 (silent
   moves) first — they're user-facing.

---

## UI & linking

### 22. Deep-link the deal detail tabs

- **File:** `app/deals/[id]/page.tsx:72`
- **Problem:** the deal page has 7 tabs (overview, diligence, contacts, capital,
  activity, documents, NDA) held in `useState` only. You can't send someone a
  link to "the NDA tab of the Amped deal", and the browser back button doesn't
  move between tabs.
- **Change:** sync `activeTab` to a `?tab=` search param (the pattern already
  exists in this codebase: contacts uses `?open=`, raises/contacts uses
  `?firm=`). Read the param on load, update it with `router.replace` on tab
  change.
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

### 23. Deep-link list filters too

- **Files:** `app/deals/page.tsx`, `app/pipeline/page.tsx`,
  `app/intake/page.tsx`, `app/notes/page.tsx`
- **Problem:** only 2 of ~13 pages use search params. Filters on the deals
  list, pipeline, intake queue and notes all live in component state, so a
  filtered view can't be bookmarked or shared, and a refresh loses it.
- **Change:** put filter state in the URL (same `router.replace` pattern as
  item 22) on the four pages above, starting with deals and intake.
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

### 24. Kanban drag-and-drop doesn't work on mobile

- **File:** `app/pipeline/page.tsx:302-349`
- **Problem:** stage moves use native HTML5 drag-and-drop (`dataTransfer`),
  which never fires on touch devices. On a phone there is no way to move a
  deal between stages. The card is also a `<Link>` wrapping draggable content,
  with the click-vs-drag split handled by `draggable={false}` on the link —
  fragile.
- **Change:** add a touch fallback — a stage menu / action sheet on each card —
  or switch to a pointer-based library (dnd-kit). Keep the click-vs-drag
  handling explicit and test it on a phone.
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

### 25. No `loading.tsx` and no per-page titles

- **Files:** `app/` (0 `loading.tsx` files), `app/layout.tsx`
- **Problem:** pages fetch client-side in `useEffect`, so navigation shows a
  blank/spinner flash with no instant feedback. And every browser tab reads
  "Nexus" — the only metadata is the root title — so tabs and history entries
  are indistinguishable.
- **Change:** add `loading.tsx` skeletons for the heavy pages (deals/[id],
  dashboard, pipeline) and set `document.title` per page (deal company name
  on detail pages, e.g. "Amped — Nexus").
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

### 26. Styling is 2,070 inline `style={{}}` blocks vs 816 classNames

- **Files:** across `app/`, `components/`; tokens in `app/globals.css`
- **Problem:** Tailwind is configured and a token system exists in
  `globals.css` (`--surface`, `--accent`, `--text-primary`...), but most
  components re-declare the same button/card/input/badge styles inline —
  including hover states via `onMouseEnter`/`onMouseLeave` handlers and
  duplicated mobile padding logic. A one-line visual change means editing
  dozens of files.
- **Change:** extend the shared classes that already exist in `globals.css`
  (`.btn`, `.btn-ghost`, `.card-2`, `.select`, `.label`) to cover the repeated
  patterns, and migrate the most-used pages to them first (deals/[id],
  intake, raises). No visual redesign — just dedupe.
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

### 27. Sidebar: 13 flat items, no grouping; duplicated mobile detection

- **File:** `components/layout/Sidebar.tsx`
- **Problem:** Dashboard, Pipeline, Deals, Intake, Contacts, Raises, Capital
  Contacts, Investors, Portfolio, Calendar, Notes, Best Practices, Assistant —
  one flat list, with two "Contacts" entries and overlapping Deals/Pipeline.
  The hand-rolled `isActive` disambiguation for nested paths is also easy to
  break. And Sidebar re-implements mobile detection with its own `useEffect`
  width check while a `useIsMobile` hook already exists
  (`components/layout/LayoutClient.tsx` uses it).
- **Change:** group the nav into sections with labels (Deals: Pipeline/Deals/
  Intake; People: Contacts/Capital Contacts/Investors; Portfolio: Portfolio/
  Raises/Calendar; Tools: Notes/Best Practices/Assistant/Digest), and use the
  `useIsMobile` hook in Sidebar.
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

### 28. Command Palette gaps

- **File:** `components/layout/CommandPalette.tsx`
- **Problem:** ⌘K searches deals, contacts, capital contacts, portfolio
  companies and notes — but not investors, raises, or calendar events. Note
  results link to `/notes` (the list) instead of the specific note, and the
  quick-navigate shortcuts omit Portfolio, Calendar, Investors, Assistant and
  Digest.
- **Change:** add investors, raises and calendar events to the search; give
  the notes page a `?open=` deep link like contacts has, and link note results
  to it; add the missing shortcuts.
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

### 29. Small linking & navigation fixes

- **Files:** `app/page.tsx`, detail pages, `components/layout/Sidebar.tsx`
- **Problem:** (a) no breadcrumbs on detail pages — deal/investor/portfolio/
  raise detail all rely on the sidebar to get back; (b) the root page renders
  `null` while it checks the session, so every cold load flashes blank before
  redirecting; (c) the mobile drawer has no Escape-to-close (the palette does).
- **Change:** add a breadcrumb row on detail pages (`Deals / Amped`);
  make the root page a server-component redirect; add Escape handling to the
  mobile drawer.
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

### 30. Make cross-links bidirectional — contacts don't link back to deals

- **Files:** `app/contacts/page.tsx`, `app/deals/[id]/page.tsx`
- **Problem:** the graph is one-directional in places. The deal page has a
  contacts tab and `contact_deal_links` exists, and investor detail shows
  linked deals and portfolio detail shows add-on deals — but the contacts
  page contains no reference to deals at all, so from a banker or management
  contact you can't see which deals they're attached to.
- **Change:** add a "Deals" section to the contact detail panel listing
  linked deals with links, using the existing `contact_deal_links` table.
  Audit the other entities the same way (raise → LPs is covered; calendar
  event → deal is not — link events to deals where one exists).
- **Status (Nov 10, 2026): Implemented in PR #7** (`batch-e-ui-linking`,
  commit `8f66847`) — Batch E (UI & linking); CI green. Done — merged Nov 10, 2026.

---

## Private equity lens

What the CRM already does well for a PE firm: LOI deadline tracking (dashboard
widget + daily alerts), NDA analysis, CIM sharing, a diligence checklist with
categories and Excel import, add-on deal linking for buy-and-build, historical
financials on portfolio companies, an LP prospect pipeline per raise (outreach
→ diligence → invested), email intake that extracts banker/financials, and the
weekly pipeline email. The gaps below are what a PE team would notice next.

Note: Evolution is an independent (fundless) sponsor — a lean team that raises
capital deal by deal, without many formal processes. So the items below are
scoped for that reality: no fund-level machinery, no formal IC. Where a
traditional fund would build a process, the lighter version is given instead.

### 31. Track returns on closed deals — the CRM ends at "Closed"

- **Files:** deal model, `app/deals/[id]/page.tsx`, dashboard
- **Problem:** there is no IRR, MOIC, or exit-economics field anywhere in the
  codebase (zero matches). A deal goes to "Closed (Platform)" or "Closed
  (Add-On)" and the story stops — no entry equity, entry multiple, exit
  proceeds, buyer, hold period, or return. For a PE firm, the pipeline is
  only half the system; the other half is what deals returned.
- **Change:** add a closed-deal record: entry equity, entry EBITDA and
  multiple, exit date / proceeds / buyer, hold period; compute gross IRR and
  MOIC; roll up to a firm-level returns view. This is the single biggest
  PE gap in the app. For an independent sponsor it matters more, not less:
  carry is earned deal by deal, so the return on each closed deal is the
  firm's track record.

### 32. A lightweight decision log, not a formal IC

- **Files:** `app/deals/[id]/page.tsx`, dashboard
- **Problem:** there's no record of the actual go/no-go decision between
  "Pre-LOI" and "LOI Submitted" — who said yes, and on what conditions. For a
  lean independent sponsor there's no formal IC, so this shouldn't be a
  workflow — just a record.
- **Change:** add a simple decision entry on the deal: date, decision
  (go / conditional / pass), conditions, and who decided. A one-line Claude
  summary of the deal (same pattern as CIM share) can sit next to it as the
  memo. Show the latest decisions on the dashboard.

### 33. Add a deal owner

- **Files:** deal model, `app/pipeline/page.tsx`, weekly email route
- **Problem:** no owner/lead/`assigned_to` field on deals. For a team, nobody
  can tell at a glance who is driving a deal, and the weekly pipeline email
  can't say "Ken: 3 deals in Pre-LOI".
- **Change:** add an owner field (team member), a filter by owner, show the
  owner on pipeline cards, and group the weekly email by owner.

### 34. Sourcing + funnel analytics

- **Files:** deal model, `app/dashboard/page.tsx`
- **Problem:** no source field (which banker, proprietary vs intermediated),
  no time-in-stage, no structured pass reason, no funnel metrics. The
  dashboard has no charts at all (recharts is a dependency but is only used
  in the digest and portfolio detail pages). A PE firm lives on its funnel:
  how many teasers become LOIs, where deals die, and how long each stage
  takes.
- **Change:** add source (link to the banker contact + a proprietary flag)
  and a structured pass reason; build a dashboard funnel (teasers → LOI →
  exclusivity → closed) with conversion rates and median days per stage.
  Stage-change interactions are already logged (see item 41), so time-in-stage
  can be computed from them.

### 35. Per-deal close tracking, not fund operations

- **Files:** `app/raises/page.tsx`, investor model
- **Problem:** `lp_commitments` exist but there is no funded/remaining amount
  per LP per raise, and no record of what actually closed. As a fundless
  sponsor there's no fund-level capital-call machinery to build — but each
  deal's raise still needs to reconcile: who committed, who funded, what's
  outstanding at close.
- **Change:** add funded vs committed per LP per raise, and a close checklist
  (funds received, docs signed) per raise. Skip fund-level calls/
  distributions entirely — that machinery belongs to funds, not to an
  independent sponsor.

### 36. Portfolio valuations / marks

- **Files:** `app/portfolio/[id]/page.tsx`
- **Problem:** portfolio companies carry financials but no quarterly
  valuation or mark — the only "valuation" hit in the code is a prompt
  instruction about multiples. Ken's marks (e.g. the portfolio marked at
  ~3.13x cost) live in the budget sheet.
- **Change:** add a quarterly mark per portfolio company (value, method, date)
  with history, and chart it — recharts is already in the repo and used on
  this very page.

### 37. Diligence items need owners + due dates

- **File:** `app/deals/[id]/page.tsx` (diligence tab)
- **Problem:** the checklist itself is good (categories, progress bar, Excel
  import, "Load default checklist"), but items carry a status and nothing
  else — no owner, no due date. On a live deal, nobody knows who owes what
  by when.
- **Change:** add owner + due date to `diligence_items`, and surface overdue
  items on the dashboard.

### 38. Deal expenses / broken-deal costs

- **Files:** deal model
- **Problem:** no expense tracking per deal. QoE, legal, and travel spend on
  diligence — including on deals that die — is invisible, and finance has no
  broken-deal cost total at year-end.
- **Change:** add a simple expense log per deal (category, amount, date) with
  a fund-level rollup of broken-deal costs.

### 39. Debt & covenants on portfolio companies

- **Files:** portfolio model
- **Problem:** no leverage or covenant tracking for portfolio companies. For
  a firm whose portfolio is levered, a covenant breach is the thing you most
  want an alert for — and the LOI-alerts pattern already exists to copy.
- **Change:** add a debt schedule + covenant tests per portfolio company,
  with breach alerts in the same style as the LOI alerts.

### 40. Conflicts / restricted list

- **Files:** intake flow (`app/api/notes/email/route.ts`, `app/intake/page.tsx`)
- **Problem:** no restricted-names list. The intake parser already extracts
  company names from forwarded teasers, but nothing flags a name that
  matches a portfolio company or a restricted name before a deal is created.
- **Change:** add a restricted-names list; flag intake matches against
  portfolio companies and restricted names in the intake queue.

### 41. Roles, and finish the audit trail

- **Files:** `supabase/migrations/rls_policies.sql`, `middleware.ts`,
  `app/pipeline/page.tsx`, `app/deals/[id]/page.tsx:252`
- **Problem:** RLS is `authenticated_all` — anyone with a login sees
  everything, including LP economics. For a lean team that's fine as long as
  the tool stays internal-only; a formal role system would be overkill. The
  audit trail is also half-built: stage changes made on the deal page are
  logged as `stage-change` interactions and shown in the activity tab, but
  verify the Kanban drag path logs them too, and there is no field-level
  history (price, EBITDA edits).
- **Change:** document that the tool is internal-only and skip roles for now
  (a read-only role is a someday item if an operating partner or deal LP ever
  needs access); confirm Kanban drags write the same `stage-change`
  interaction; consider a field-history table for price/EBITDA.

### 42. Per-deal investor updates, not quarterly LP letters

- **Files:** `app/api/digest/route.ts`, portfolio pages
- **Problem:** the digest and weekly pipeline email are internal. Deal LPs —
  who invested in a specific deal, not a fund — still want updates on their
  deal, and right now there's no way to generate one.
- **Change:** add a per-deal investor update generator (Claude-written, same
  pattern as the digest) pulling that deal's portfolio financials, recent
  activity, and marks (item 36), emailable to that deal's LPs. Skip formal
  quarterly fund reporting — there's no fund to report on.

---

## Dropbox & file saving

What's already good: one shared module (`lib/dropbox.ts`) with a refresh-token
flow and cached access token; a path allow-list plus audit logging in
`app/api/dropbox/route.ts`; uploads use `mode: 'add'` + autorename so nothing
is ever overwritten; stage-based folders (`Deals/` → `!Passed Deals/` /
`!Hold/` / `Portfolio Co's/`) with unique-folder handling for same-named
companies; and the email intake already routes large files around Vercel's
size limit via Supabase Storage.

### 43. The UI upload cap is fake: 20 MB in code, ~3 MB in reality

- **Files:** `app/api/dropbox/route.ts` (POST), `components/deals/DropboxFilesTab.tsx`
- **Problem:** the upload route caps base64 payloads at 20 MB binary, but
  Vercel serverless functions reject request bodies over ~4.5 MB before the
  handler ever runs. So a 10 MB CIM uploaded from a deal page fails with a
  platform error, not the route's friendly 413. The intake flow already
  solved this exact problem with signed Supabase uploads
  (`app/api/intake/upload-url/route.ts`).
- **Change:** route deal-page uploads the same way — signed upload to the
  `intake-temp` bucket, then a server-side move into Dropbox — or use
  Dropbox upload sessions (chunked) from the browser. Either way, delete the
  misleading 20 MB cap or make it match what the platform actually allows.
- **Status (Nov 8, 2026): Done** — deal-page uploads over 4 MB now go via
  signed upload to the `intake-temp` bucket, then a server-side move into
  Dropbox (commit `f2f5ac6` on `main`); follow-up commit `007858d` fixed the
  `Uint8Array` body for the Dropbox upload fetch. Skip this item.

### 44. Folder-move failures are silent — stage and folder can disagree

- **Files:** `app/deals/[id]/page.tsx` (updateStage), `app/pipeline/page.tsx:150`,
  `lib/dropbox-stage-move.ts`
- **Problem:** a stage change saves to Supabase first, then the folder move
  runs. On failure the error is only `console.error`'d — the deal page does
  this deliberately ("benign errors like to/conflict/folder are common") and
  the pipeline drag is fire-and-forget (`.catch(console.error)`). Result: a
  deal can sit in "Passed" while its folder stays under `/Deals/`, and nobody
  is told. The `to/conflict/folder` case (destination already exists) is
  swallowed rather than handled.
- **Change:** show a non-blocking notice when a move fails ("Dropbox folder
  couldn't be moved — files are still at the old location"); handle the
  conflict case explicitly (merge or rename with ` (2)`); and add a nightly
  reconcile job that checks each deal's `dropbox_path` against its expected
  folder and reports drift.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. After merge: apply
  `add_dropbox_move_jobs.sql` in the Supabase SQL editor, then POST once to
  `/api/dropbox/migrate-folders` with the cron secret. Done — merged Nov 10, 2026.

### 45. Renaming a company leaves a stale folder name

- **Files:** `app/deals/[id]/page.tsx` (updateField), `lib/dropbox.ts`
  (`expectedDropboxFolder`)
- **Problem:** folder paths are derived from the mutable company name, but
  renaming a company only updates the database — the Dropbox folder keeps the
  old name until the next stage move (which self-heals by moving from the
  stored path to the new-name path). Until then the folder name is wrong, and
  the stored path and the derived path disagree.
- **Change:** rename the folder when the company is renamed (reuse the move
  helper). The durable fix is to stop deriving folder names from mutable
  data: name folders by deal ID (or a slug fixed at creation) and keep the
  company name as a display label only.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. Done — merged Nov 10, 2026.

### 46. The manual folder-linking flow suggests invalid paths

- **File:** `components/deals/DropboxFilesTab.tsx`
- **Problem:** when no folder is linked, the path input defaults to
  `/<CompanyName>` and the example shown is `/Deals/DiPonio Holdings` — both
  outside the API's allow-list root (`/Evolution Strategy Partners`). Saving
  one succeeds in Supabase, and every subsequent list call then 403s, so the
  user only discovers the mistake after the fact.
- **Change:** default the input to `expectedDropboxFolder(companyName, stage)`
  and validate client-side against the allow-list before saving; fix the
  example to a path under the root.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. Done — merged Nov 10, 2026.

### 47. The `read` action has no size cap

- **File:** `app/api/dropbox/route.ts` (GET `?action=read`)
- **Problem:** reading a file downloads the whole thing into memory and
  returns it base64'd in a JSON response. A 200 MB CIM would OOM the function
  or blow Vercel's response limit. The upload path has a cap; the read path
  doesn't.
- **Change:** refuse files over a threshold (e.g. 20 MB) with a clear error,
  or return the first pages / extracted text only.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. Done — merged Nov 10, 2026.

### 48. List pagination is dropped

- **Files:** `app/api/dropbox/route.ts` (GET `?action=list`),
  `components/deals/DropboxFilesTab.tsx`
- **Problem:** `list_folder` returns `has_more`, and the route passes it
  through, but the UI never follows the cursor — folders with more than ~2,000
  entries silently truncate.
- **Change:** follow `list_folder/continue` when `has_more` is true, or cap
  the UI at a page with a "show more" that fetches the next cursor.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. Done — merged Nov 10, 2026.

### 49. `dropboxFolderExists` swallows all errors

- **File:** `lib/dropbox.ts`
- **Problem:** any API failure — bad token, rate limit, network error —
  returns `false`, i.e. "folder doesn't exist". `uniqueDropboxFolder` can
  then conclude a folder is free when the API is actually down, and an upload
  lands in a colliding path (autorename saves it from overwriting, but you
  get duplicate folders).
- **Change:** return `false` only on `path/not_found`; throw on anything
  else, and let callers handle the failure explicitly.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. Done — merged Nov 10, 2026.

### 50. No retry on Dropbox rate limits

- **Files:** `lib/dropbox.ts`, `app/api/dropbox/route.ts`
- **Problem:** every Dropbox call throws on the first non-OK response.
  Dropbox rate-limits aggressively on bulk work (a CIM intake with many
  attachments, a batch of stage moves), so transient 429s become failed
  intakes and failed moves.
- **Change:** retry with backoff on 429/5xx, honoring the `Retry-After`
  header. While here, add an in-flight lock to the token refresh in
  `getDropboxToken` so concurrent requests after expiry don't each refresh.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. Done — merged Nov 10, 2026.

### 51. No delete

- **File:** `app/api/dropbox/route.ts`
- **Problem:** the route has GET/POST/PATCH but no DELETE — files can only be
  deleted in Dropbox itself, so the CRM's file list can show files the team
  already removed, and there's no way to clean up a bad upload from the deal
  page.
- **Change:** add a DELETE action (path allow-list + audit log, which already
  exist) with a confirm dialog in `DropboxFilesTab`.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. Done — merged Nov 10, 2026.

### 52. Temp files in `intake-temp` can linger forever

- **Files:** `app/api/intake/upload-url/route.ts`,
  `app/api/intake/parse/route.ts`, `app/api/notes/email/route.ts`
- **Problem:** the email route and intake parse delete temp files after
  processing, but if processing fails first — or a user uploads a file and
  never submits it — the file stays in Supabase Storage indefinitely.
- **Change:** add a Supabase storage lifecycle rule, or a weekly cleanup of
  `intake-temp` files older than ~7 days.
- **Status (Nov 10, 2026): Implemented in PR #5** (merged via replacement PR #14) (`batch-d-dropbox`, commit
  `d062b27`) — Batch D (Dropbox robustness); CI green. Done — merged Nov 10, 2026.
