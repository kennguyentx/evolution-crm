# Migrations

Migrations are applied with the runner (`scripts/migrate.mjs`), never by
hand in the Supabase SQL Editor. The runner records every applied file (with
a SHA-256 checksum) in the `applied_migrations` table, so a deploy can
neither silently skip a migration nor apply one twice.

## The single command

```bash
# DATABASE_URL from Supabase dashboard → Project Settings → Database → Connection string
DATABASE_URL="postgresql://postgres:<password>@<project-ref>.supabase.co:5432/postgres?sslmode=require" npm run migrate
```

Other modes:

```bash
npm run migrate -- --dry-run    # show what would be applied, change nothing
npm run migrate -- --baseline   # record current files as applied WITHOUT running their SQL
```

## First adoption: baseline, don't re-apply

All files in this directory were previously applied by hand, so the
production database should already match them. The first time the runner is
used against production:

1. Verify the database actually matches the files (spot-check the tables and
   columns each file creates — see the honest status in the Batch C PR body:
   this was **not** verified against production by the author, because no
   database credentials were available).
2. Run `npm run migrate -- --baseline` to record the current files as
   applied without executing them.
3. From then on, plain `npm run migrate` applies only new files.

## Naming new files

Files apply in **alphabetical filename order**. Name a new file so it sorts
after anything it depends on. The existing files are unprefixed, so a
`YYYYMMDD_…` prefix would sort *before* them — use a `zYYYYMMDD_…` prefix
when the new migration must run after all existing files, e.g.
`z20261110_add_deal_score.sql`.

## Rules

- Applied migrations are immutable. If a recorded file changes on disk, the
  runner refuses to run — write a new migration file instead.
- Each file runs in its own transaction: if it fails, it rolls back and the
  run stops (later files are not attempted).
- Keep files idempotent where cheap (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
  `DROP … IF EXISTS`) — a belt-and-braces measure on top of the tracking table.
