# Nexus — Evolution Strategy CRM

Internal deal and investor management platform for Evolution Strategy Partners. Built to replace spreadsheets with a single system for tracking deals, investors, portfolio companies, and capital raises — with AI-powered document intake wired directly into email.

---

## What It Does

**Deal Pipeline** — Kanban board across Teaser → Reviewing → Pre-LOI → LOI Submitted → Exclusivity. Drag to move stages. Dropbox folders auto-organize as deals progress.

**Email Intake** — Forward any deal email (teaser, CIM, LOI) to the intake address. Claude extracts company name, financials, geography, sector, banker, and files the documents in Dropbox automatically. Supports PDFs, Word docs, images, and body-only emails with no attachments.

**Investors** — Track LPs by committed and deployed capital across investment entities. Link to specific deals and raises.

**Contacts** — Bankers, advisors, management teams, lenders. Auto-detected and linked from incoming emails.

**Notes** — Activity log across deals and contacts. Email-sourced notes land here automatically.

**Portfolio** — Active platform and add-on companies with Dropbox-linked folders.

**Capital Raises** — Track LP commitments and funding status per raise.

**Weekly Pipeline Email** — Auto-sends every Monday 8am ET to the team. Manage recipients from the Pipeline page.

**CIM Share** — Generate a Claude-written deal summary from any deal page and email it to the team with the CIM PDF attached from Dropbox.

**Digest** — Weekly AI summary of pipeline activity.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript |
| Database | Supabase (PostgreSQL + Auth) |
| AI | Anthropic Claude (document extraction, CIM summaries, digest) |
| Email sending | Postmark |
| File storage | Dropbox API |
| Hosting | Vercel (app) + Render (email intake server) |

---

## Services & Environment Variables

### Vercel (Next.js app)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
POSTMARK_SERVER_TOKEN
FROM_EMAIL
DROPBOX_APP_KEY
DROPBOX_APP_SECRET
DROPBOX_REFRESH_TOKEN
NEXT_PUBLIC_TEAM_EMAIL
NEXT_PUBLIC_APP_URL
```

### Render (email intake server — `email-server/server.js`)
Same variables above, plus:
```
POSTMARK_WEBHOOK_TOKEN
```

---

## Email Intake

Forward any deal email to the Postmark inbound address. Add a note in the subject or body to control how it's logged:

| Note | Result |
|---|---|
| *(nothing)* | Queued for review in Document Intake |
| `Log as pass` | Auto-logged as Pass (DOA) |
| `Log as teaser` | Auto-logged as Teaser |
| `Log as reviewing` | Auto-logged as Reviewing |
| `parent_portco: Amped` | Filed as add-on under Amped |

The server runs on Render and handles files up to 50MB — above Vercel's limit for large CIMs.

---

## Local Development

```bash
git clone https://github.com/kennguyentx/evolution-crm
cd evolution-crm
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

Email intake server (separate):
```bash
cd email-server
npm install
node server.js
```

Tests (Vitest — pure functions only, no database or running app needed):
```bash
npm test
```
Covers the Zod schemas (`lib/schemas.ts`), the cron-auth three-way check
(`lib/cron-auth.ts`), the intake stage mapping (`lib/intake-stage.ts`), the
portfolio-news curation helpers (`lib/portfolio-news.ts`), and the migration
runner (`scripts/migrate.mjs`). CI runs the suite on every push/PR.

---

## Database

Supabase project hosts all tables. Migrations live in `supabase/migrations/`
and are applied with the migration runner — never by hand in the SQL Editor
anymore (hand-applying leaves no record of what ran):

```bash
# DATABASE_URL from Supabase dashboard → Project Settings → Database → Connection string
DATABASE_URL="postgresql://postgres:<password>@<project-ref>.supabase.co:5432/postgres?sslmode=require" npm run migrate
```

The runner applies pending files in alphabetical order, each in its own
transaction, and records them (with a SHA-256 checksum) in the
`applied_migrations` table, so re-running is a no-op and a silently skipped
or double-applied migration can't happen. See `supabase/migrations/README.md`
for the one-time `--baseline` step (first adoption, after verifying the
database already matches the files), `--dry-run`, and the naming rule for
new files.

Key tables: `deals`, `contacts`, `investors`, `notes`, `portfolio_companies`, `lp_investments`, `lp_commitments`, `investment_entities`, `intake_queue`, `app_settings`

---

## Deployment

Push to `main` → Vercel and Render auto-deploy.

Scheduled jobs (Vercel Cron, Mondays 8am ET):
- `/api/digest` — weekly AI digest
- `/api/pipeline/weekly-email` — pipeline email to team
