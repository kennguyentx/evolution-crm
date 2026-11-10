// scripts/migrate.test.mjs
// Tests for the migration runner (scripts/migrate.mjs).
// No live database: the orchestration is exercised through a small fake
// pg-compatible client, plus real temporary migration directories on disk.
// What this proves: ordering, recording, baseline, dry-run, checksum-change
// refusal, and rollback on a failed migration. What it does NOT prove:
// that the SQL executes against a real Postgres — that needs DATABASE_URL
// and a Supabase project, which CI does not have (see the PR body).

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fileChecksum,
  listMigrationFiles,
  parseArgs,
  planMigrations,
  readMigrations,
  runMigrations,
} from './migrate.mjs'

// ── Fake pg client ────────────────────────────────────────────────────────────
// Implements just enough of the pg Client surface for the runner: the
// applied_migrations bookkeeping queries, transactions (snapshot/rollback),
// and "executing" migration SQL (recorded, optionally made to fail).

function createFakeClient({ failOn = null } = {}) {
  const state = {
    rows: [], // applied_migrations rows: { filename, checksum }
    executed: [], // migration SQL strings the runner asked to execute
    snapshot: null,
    queries: [],
  }
  return {
    state,
    async query(text, params) {
      state.queries.push(text)
      const sql = String(text)
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS applied_migrations')) {
        return { rows: [] }
      }
      if (sql === 'BEGIN') {
        state.snapshot = state.rows.map((r) => ({ ...r }))
        return { rows: [] }
      }
      if (sql === 'COMMIT') {
        state.snapshot = null
        return { rows: [] }
      }
      if (sql === 'ROLLBACK') {
        if (state.snapshot) state.rows = state.snapshot
        state.snapshot = null
        return { rows: [] }
      }
      if (sql.startsWith('SELECT filename, checksum FROM applied_migrations')) {
        return { rows: state.rows.map((r) => ({ ...r })) }
      }
      if (sql.startsWith('INSERT INTO applied_migrations')) {
        state.rows.push({ filename: params[0], checksum: params[1] })
        return { rows: [] }
      }
      // Anything else is migration SQL.
      if (failOn && sql.includes(failOn)) throw new Error(`fake execution failure on: ${failOn}`)
      state.executed.push(sql)
      return { rows: [] }
    },
  }
}

let dir
const quiet = () => {}

async function writeMigration(name, sql) {
  await writeFile(path.join(dir, name), sql, 'utf8')
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'migrate-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('fileChecksum', () => {
  it('is deterministic and content-sensitive', () => {
    expect(fileChecksum('select 1;')).toBe(fileChecksum('select 1;'))
    expect(fileChecksum('select 1;')).not.toBe(fileChecksum('select 2;'))
    expect(fileChecksum('select 1;')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('listMigrationFiles / readMigrations', () => {
  it('lists only .sql files, in alphabetical (apply) order', async () => {
    await writeMigration('b_second.sql', 'select 2;')
    await writeMigration('a_first.sql', 'select 1;')
    await writeMigration('notes.md', '# not a migration')
    await writeMigration('c_third.sql', 'select 3;')
    expect(await listMigrationFiles(dir)).toEqual(['a_first.sql', 'b_second.sql', 'c_third.sql'])
  })

  it('reads file contents with checksums, in apply order', async () => {
    await writeMigration('a.sql', 'select 1;')
    const migrations = await readMigrations(dir)
    expect(migrations).toHaveLength(1)
    expect(migrations[0].filename).toBe('a.sql')
    expect(migrations[0].sql).toBe('select 1;')
    expect(migrations[0].checksum).toBe(fileChecksum('select 1;'))
  })

  it('fails clearly when the directory does not exist', async () => {
    await expect(listMigrationFiles(path.join(dir, 'nope'))).rejects.toThrow('Cannot read migrations directory')
  })
})

describe('planMigrations', () => {
  const local = [
    { filename: 'a.sql', checksum: 'aaa' },
    { filename: 'b.sql', checksum: 'bbb' },
  ]

  it('marks everything pending when nothing is recorded', () => {
    const plan = planMigrations(local, [])
    expect(plan.toApply).toEqual(local)
    expect(plan.changed).toEqual([])
    expect(plan.alreadyApplied).toEqual([])
  })

  it('skips files whose recorded checksum matches', () => {
    const plan = planMigrations(local, [
      { filename: 'a.sql', checksum: 'aaa' },
      { filename: 'b.sql', checksum: 'bbb' },
    ])
    expect(plan.toApply).toEqual([])
    expect(plan.alreadyApplied).toEqual(local)
  })

  it('flags a recorded file whose contents changed', () => {
    const plan = planMigrations(local, [{ filename: 'a.sql', checksum: 'different' }])
    expect(plan.changed).toEqual([{ filename: 'a.sql', checksum: 'aaa' }])
    expect(plan.toApply).toEqual([{ filename: 'b.sql', checksum: 'bbb' }])
  })

  it('ignores recorded rows for files no longer on disk', () => {
    const plan = planMigrations(local, [
      { filename: 'a.sql', checksum: 'aaa' },
      { filename: 'deleted.sql', checksum: 'zzz' },
    ])
    expect(plan.toApply).toEqual([{ filename: 'b.sql', checksum: 'bbb' }])
    expect(plan.changed).toEqual([])
  })
})

describe('parseArgs', () => {
  it('parses --dry-run, --baseline, and --help', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, baseline: false })
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, baseline: false })
    expect(parseArgs(['--baseline'])).toEqual({ dryRun: false, baseline: true })
    expect(parseArgs(['--help'])).toEqual({ dryRun: false, baseline: false, help: true })
  })

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--force'])).toThrow('Unknown argument: --force')
  })
})

describe('runMigrations', () => {
  it('applies pending files in order and records them; a second run is a no-op', async () => {
    await writeMigration('b_second.sql', 'select 2;')
    await writeMigration('a_first.sql', 'select 1;')
    const client = createFakeClient()

    const first = await runMigrations({ client, migrationsDir: dir, log: quiet })
    expect(first.applied).toEqual(['a_first.sql', 'b_second.sql'])
    expect(first.recorded).toEqual(['a_first.sql', 'b_second.sql'])
    expect(first.skipped).toEqual([])
    expect(client.state.executed).toEqual(['select 1;', 'select 2;'])
    expect(client.state.rows.map((r) => r.filename)).toEqual(['a_first.sql', 'b_second.sql'])

    const second = await runMigrations({ client, migrationsDir: dir, log: quiet })
    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(['a_first.sql', 'b_second.sql'])
    expect(client.state.executed).toHaveLength(2) // nothing re-executed
  })

  it('baseline records files without executing their SQL', async () => {
    await writeMigration('a.sql', 'select 1;')
    await writeMigration('b.sql', 'select 2;')
    const client = createFakeClient()

    const result = await runMigrations({ client, migrationsDir: dir, baseline: true, log: quiet })
    expect(result.applied).toEqual([])
    expect(result.recorded).toEqual(['a.sql', 'b.sql'])
    expect(client.state.executed).toEqual([])
    expect(client.state.rows).toHaveLength(2)

    // A normal run afterwards finds nothing pending.
    const after = await runMigrations({ client, migrationsDir: dir, log: quiet })
    expect(after.applied).toEqual([])
  })

  it('dry-run changes nothing and reports what is pending', async () => {
    await writeMigration('a.sql', 'select 1;')
    const client = createFakeClient()

    const result = await runMigrations({ client, migrationsDir: dir, dryRun: true, log: quiet })
    expect(result.pending).toEqual(['a.sql'])
    expect(result.applied).toEqual([])
    expect(client.state.executed).toEqual([])
    expect(client.state.rows).toEqual([])
  })

  it('dry-run with baseline reports baseline intent, still changing nothing', async () => {
    await writeMigration('a.sql', 'select 1;')
    const client = createFakeClient()
    const result = await runMigrations({ client, migrationsDir: dir, dryRun: true, baseline: true, log: quiet })
    expect(result.pending).toEqual(['a.sql'])
    expect(client.state.rows).toEqual([])
  })

  it('refuses to run when an applied file changed on disk', async () => {
    await writeMigration('a.sql', 'select 1;')
    const client = createFakeClient()
    await runMigrations({ client, migrationsDir: dir, log: quiet })

    await writeMigration('a.sql', 'select 1; -- edited after applying')
    await expect(runMigrations({ client, migrationsDir: dir, log: quiet })).rejects.toThrow(
      'Refusing to run: 1 applied migration(s) changed on disk: a.sql',
    )
    expect(client.state.executed).toHaveLength(1) // nothing new executed
  })

  it('rolls back the failed file, records nothing for it, and stops', async () => {
    await writeMigration('a_ok.sql', 'select 1;')
    await writeMigration('b_bad.sql', 'select BOOM;')
    await writeMigration('c_never.sql', 'select 3;')
    const client = createFakeClient({ failOn: 'BOOM' })

    await expect(runMigrations({ client, migrationsDir: dir, log: quiet })).rejects.toThrow(
      'Migration b_bad.sql failed, rolled back',
    )
    expect(client.state.rows.map((r) => r.filename)).toEqual(['a_ok.sql'])
    expect(client.state.executed).toEqual(['select 1;']) // c_never.sql never attempted
  })

  it('applies only the newly added file on a later run', async () => {
    await writeMigration('a.sql', 'select 1;')
    const client = createFakeClient()
    await runMigrations({ client, migrationsDir: dir, log: quiet })

    await writeMigration('b.sql', 'select 2;')
    const result = await runMigrations({ client, migrationsDir: dir, log: quiet })
    expect(result.applied).toEqual(['b.sql'])
    expect(result.skipped).toEqual(['a.sql'])
  })

  it('requires a client', async () => {
    await expect(runMigrations({ client: null, migrationsDir: dir, log: quiet })).rejects.toThrow(
      'requires a connected database client',
    )
  })
})
