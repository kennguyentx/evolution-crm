#!/usr/bin/env node
// scripts/migrate.mjs
// Migration runner for supabase/migrations/.
//
// Problem it solves: migrations used to be applied by hand through the
// Supabase SQL Editor, with no record of which files had been applied —
// so a deploy could silently skip one (or apply one twice).
//
// How it works:
//   - An `applied_migrations` table in the database records every file
//     that has been applied, with a SHA-256 checksum of its contents.
//   - Each run applies the pending files in alphabetical filename order,
//     each in its own transaction, and records it. Re-running is a no-op.
//   - If a file that was already applied changes on disk, the run REFUSES
//     to continue (edit applied migrations by writing a new file instead).
//   - `--baseline` records all current files as applied WITHOUT executing
//     them. Use once, when first adopting the runner, after verifying the
//     database already matches the files (they were all applied by hand).
//   - `--dry-run` prints what would happen without changing anything.
//
// It deliberately does NOT use `supabase db push`: that needs a linked
// Supabase project and CLI credentials. This script only needs a Postgres
// connection string:
//
//   DATABASE_URL="postgresql://postgres:<db-password>@<project-ref>.supabase.co:5432/postgres?sslmode=require" npm run migrate
//
// Get the connection string from the Supabase dashboard → Project Settings
// → Database → Connection string (use the pooler URI for reliability).
// The script never touches the database unless DATABASE_URL is set, and it
// never runs against anything but the database that URL points to.
//
// Usage:
//   npm run migrate                 apply pending migrations
//   npm run migrate -- --dry-run    show pending migrations, change nothing
//   npm run migrate -- --baseline   record current files as applied, run no SQL
//
// NOTE: `runMigrations` takes its client as a parameter so the orchestration
// (ordering, recording, baseline, rollback) is unit-testable without a live
// database — see scripts/migrate.test.mjs. The SQL the runner itself issues
// is plain Postgres; the migration files are the same SQL that was previously
// run by hand in the SQL Editor.

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export const APPLIED_TABLE = 'applied_migrations'
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'supabase',
  'migrations',
)

/** SHA-256 hex checksum of a migration file's contents. */
export function fileChecksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

/** Migration filenames in a directory, in the order they will be applied. */
export async function listMigrationFiles(dir = MIGRATIONS_DIR) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    throw new Error(`Cannot read migrations directory ${dir}: ${err.message}`)
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort()
}

/** Read every migration file: [{ filename, checksum, sql }], in apply order. */
export async function readMigrations(dir = MIGRATIONS_DIR) {
  const filenames = await listMigrationFiles(dir)
  const migrations = []
  for (const filename of filenames) {
    const sql = await readFile(path.join(dir, filename), 'utf8')
    migrations.push({ filename, checksum: fileChecksum(sql), sql })
  }
  return migrations
}

/**
 * Work out what a run needs to do.
 * @param local   [{ filename, checksum }] — files on disk
 * @param applied [{ filename, checksum }] — rows in applied_migrations
 * @returns { toApply, changed, alreadyApplied } where `changed` holds local
 *   files whose recorded checksum no longer matches disk (must be fixed by
 *   hand — never silently re-applied or skipped).
 */
export function planMigrations(local, applied) {
  const appliedByName = new Map(applied.map((r) => [r.filename, r.checksum]))
  const toApply = []
  const changed = []
  const alreadyApplied = []
  for (const file of local) {
    const recorded = appliedByName.get(file.filename)
    if (recorded === undefined) toApply.push(file)
    else if (recorded !== file.checksum) changed.push(file)
    else alreadyApplied.push(file)
  }
  return { toApply, changed, alreadyApplied }
}

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${APPLIED_TABLE} (
  filename   TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`

/**
 * Apply pending migrations using an already-connected pg-compatible client
 * (an object with an async `query(text, params?)` method).
 *
 * @param opts.client        pg Client (or a test double)
 * @param opts.migrationsDir directory holding the .sql files
 * @param opts.baseline      record pending files without executing their SQL
 * @param opts.dryRun        report only; execute and record nothing
 * @param opts.log           logging function (defaults to console.log)
 * @returns { applied, recorded, skipped, pending }
 *   applied: filenames whose SQL was executed; recorded: filenames newly
 *   recorded (== applied, or == pending when baselining); skipped:
 *   filenames already applied; pending: filenames that would be applied
 *   (dry-run only).
 */
export async function runMigrations({
  client,
  migrationsDir = MIGRATIONS_DIR,
  baseline = false,
  dryRun = false,
  log = console.log,
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('runMigrations requires a connected database client')
  }

  const local = await readMigrations(migrationsDir)

  await client.query(CREATE_TABLE_SQL)
  const { rows: appliedRows } = await client.query(
    `SELECT filename, checksum FROM ${APPLIED_TABLE} ORDER BY filename`,
  )

  const { toApply, changed, alreadyApplied } = planMigrations(local, appliedRows)

  if (changed.length > 0) {
    throw new Error(
      `Refusing to run: ${changed.length} applied migration(s) changed on disk: ` +
        changed.map((f) => f.filename).join(', ') +
        '. Applied migrations are immutable — write a new migration file instead.',
    )
  }

  const skipped = alreadyApplied.map((f) => f.filename)

  if (dryRun) {
    for (const f of toApply) log(`[dry-run] would ${baseline ? 'record (baseline)' : 'apply'}: ${f.filename}`)
    for (const name of skipped) log(`[dry-run] already applied: ${name}`)
    if (toApply.length === 0) log('[dry-run] nothing pending — database is up to date.')
    return { applied: [], recorded: [], skipped, pending: toApply.map((f) => f.filename) }
  }

  if (baseline) {
    if (toApply.length === 0) {
      log('Nothing to baseline — database is up to date.')
      return { applied: [], recorded: [], skipped, pending: [] }
    }
    await client.query('BEGIN')
    try {
      for (const f of toApply) {
        await client.query(
          `INSERT INTO ${APPLIED_TABLE} (filename, checksum) VALUES ($1, $2)`,
          [f.filename, f.checksum],
        )
        log(`[baseline] recorded (no SQL executed): ${f.filename}`)
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
    return {
      applied: [],
      recorded: toApply.map((f) => f.filename),
      skipped,
      pending: [],
    }
  }

  const applied = []
  for (const f of toApply) {
    await client.query('BEGIN')
    try {
      // One query call: node-postgres sends the whole file as a single
      // simple-protocol query, so multi-statement files and $$-quoted
      // DO blocks execute as written.
      await client.query(f.sql)
      await client.query(
        `INSERT INTO ${APPLIED_TABLE} (filename, checksum) VALUES ($1, $2)`,
        [f.filename, f.checksum],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${f.filename} failed, rolled back: ${err.message}`)
    }
    log(`[migrate] applied: ${f.filename}`)
    applied.push(f.filename)
  }

  if (applied.length === 0) log('Database is up to date — no pending migrations.')
  else log(`Done — applied ${applied.length} migration(s).`)
  return { applied, recorded: applied, skipped, pending: [] }
}

/** Parse `node scripts/migrate.mjs [--dry-run] [--baseline]`. */
export function parseArgs(argv) {
  const opts = { dryRun: false, baseline: false }
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--baseline') opts.baseline = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else throw new Error(`Unknown argument: ${arg} (expected --dry-run, --baseline, or --help)`)
  }
  return opts
}

const USAGE = `Usage: DATABASE_URL=<postgres connection string> npm run migrate [--dry-run|--baseline]

  (no flags)   apply pending migrations from supabase/migrations/ in order
  --dry-run    show what would be applied, change nothing
  --baseline   record current files as applied WITHOUT executing their SQL
               (one-time adoption step, after verifying the DB already
               matches the files — they were previously applied by hand)
  --help       show this message

DATABASE_URL comes from the Supabase dashboard → Project Settings →
Database → Connection string.`

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  if (opts.help) {
    console.log(USAGE)
    return
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error(
      'DATABASE_URL is not set.\n' +
        'Get it from the Supabase dashboard → Project Settings → Database →\n' +
        'Connection string, then run:\n' +
        '  DATABASE_URL="postgresql://postgres:<password>@<ref>.supabase.co:5432/postgres?sslmode=require" npm run migrate',
    )
    process.exitCode = 1
    return
  }

  const client = new pg.Client({ connectionString })
  try {
    await client.connect()
    await runMigrations({
      client,
      baseline: opts.baseline,
      dryRun: opts.dryRun,
    })
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  } finally {
    await client.end().catch(() => {})
  }
}

// Only run the CLI when executed directly — importing this module (e.g. from
// the test suite) must not connect to a database.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
