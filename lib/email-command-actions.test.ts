import { describe, it, expect, vi } from 'vitest'
import { executeActionCommand, type ActionCommandContext } from './email-command-actions'
import type { ActionCommand } from './email-action-commands'

// ── Table-backed fake Supabase ────────────────────────────────────────────────
// Supports the surface the executor + recordIntakeEvent use: select with
// eq/ilike/order/limit + single/maybeSingle, insert (awaited or .single()),
// update (awaited or .single()).

type Row = Record<string, any>

export function makeFakeSupabase(seed: {
  deals?: Row[]
  contacts?: Row[]
  portfolio_companies?: Row[]
  intake_queue?: Row[]
} = {}) {
  const state = {
    deals: (seed.deals ?? []).map(r => ({ ...r })),
    contacts: (seed.contacts ?? []).map(r => ({ ...r })),
    portfolio_companies: (seed.portfolio_companies ?? []).map(r => ({ ...r })),
    intake_queue: (seed.intake_queue ?? []).map(r => ({ ...r })),
    intake_events: [] as Row[],
    notes: [] as Row[],
  }
  let seq = 0

  function builder(table: string) {
    const eqs: [string, any][] = []
    const ilikes: [string, string][] = []
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: any = null
    let orderSpec: { col: string; asc: boolean } | null = null
    let limitN: number | null = null
    const rows = () => (state as any)[table] as Row[]
    const matchRow = (r: Row) =>
      eqs.every(([k, v]) => r[k] === v) &&
      ilikes.every(([k, pat]) => {
        const val = String(r[k] ?? '').toLowerCase()
        const p = pat.toLowerCase()
        if (p.startsWith('%') && p.endsWith('%')) return val.includes(p.slice(1, -1))
        if (p.startsWith('%')) return val.endsWith(p.slice(1))
        if (p.endsWith('%')) return val.startsWith(p.slice(0, -1))
        return val === p
      })
    const applyQuery = () => {
      let out = rows().filter(matchRow)
      if (orderSpec) {
        const os = orderSpec
        out = [...out].sort((a, b) =>
          String(a[os.col] ?? '').localeCompare(String(b[os.col] ?? '')) * (os.asc ? 1 : -1))
      }
      if (limitN != null) out = out.slice(0, limitN)
      return out
    }
    const doInsert = () => {
      const row = { id: `${table}-${++seq}`, created_at: new Date().toISOString(), ...payload }
      rows().push(row)
      return row
    }
    const doUpdate = () => {
      const matched = rows().filter(matchRow)
      for (const r of matched) Object.assign(r, payload)
      return matched
    }
    const b: any = {
      select: () => b,
      insert: (row: any) => { mode = 'insert'; payload = row; return b },
      update: (p: any) => { mode = 'update'; payload = p; return b },
      upsert: () => b,
      eq: (k: string, v: any) => { eqs.push([k, v]); return b },
      is: () => b,
      in: () => b,
      not: () => b,
      or: () => b,
      ilike: (k: string, v: string) => { ilikes.push([k, v]); return b },
      order: (col: string, o?: any) => { orderSpec = { col, asc: o?.ascending !== false }; return b },
      limit: (n: number) => { limitN = n; return b },
      single: async () => {
        if (mode === 'insert') return { data: doInsert(), error: null }
        if (mode === 'update') {
          const m = doUpdate()
          return m.length ? { data: m[0], error: null } : { data: null, error: { message: 'no rows' } }
        }
        const out = applyQuery()
        return out.length ? { data: out[0], error: null } : { data: null, error: { message: 'not found' } }
      },
      maybeSingle: async () => {
        const out = applyQuery()
        return { data: out[0] ?? null, error: null }
      },
      then: (res: any, rej: any) => {
        let out: any
        if (mode === 'insert') { doInsert(); out = { data: null, error: null } }
        else if (mode === 'update') { doUpdate(); out = { data: null, error: null } }
        else out = { data: applyQuery(), error: null }
        return Promise.resolve(out).then(res, rej)
      },
    }
    return b
  }

  return { supabase: { from: (t: string) => builder(t) } as any, state }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEAL = {
  id: 'deal-1',
  company_name: 'Project Anchor',
  stage: 'Teaser',
  status: 'Active',
  dropbox_path: '/Evolution Strategy Partners/Deals/Project Anchor',
  deal_type: 'platform',
  parent_portco: null,
  sector: null,
  geography: null,
  created_at: '2026-11-01T00:00:00Z',
}
const CTX: ActionCommandContext = {
  from: 'ken@evolutionstrategy.com',
  subject: 'cmd',
  messageId: 'msg-1',
  surface: 'forward',
  record: 'command',
}
const NO_DBX = { dropboxReady: () => false }

describe('change-stage', () => {
  it('moves the stage, derives status, moves the folder, records old → new', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const movePath = vi.fn(async (_f: string, t: string) => t)
    const cmd: ActionCommand = { type: 'change-stage', dealName: 'Project Anchor', stage: 'Pre-LOI', dealType: null, raw: 'change Project Anchor to pre-loi' }
    const outcome = await executeActionCommand(supabase, cmd, CTX, { dropboxReady: () => true, movePath })
    expect(outcome.status).toBe('done')
    expect(outcome.summary).toContain('stage Teaser → Pre-LOI')
    const deal = state.deals[0]
    expect(deal.stage).toBe('Pre-LOI')
    expect(deal.status).toBe('Active')
    expect(movePath).toHaveBeenCalledWith(
      '/Evolution Strategy Partners/Deals/Project Anchor',
      '/Evolution Strategy Partners/Deals/deal-1',
    )
    expect(deal.dropbox_path).toBe('/Evolution Strategy Partners/Deals/deal-1')
    const ev = state.intake_events.find(e => e.kind === 'command-action')
    expect(ev?.summary).toBe(outcome.summary)
    expect(ev?.deal_id).toBe('deal-1')
  })

  it('moving to Pass derives Dead status and states the previous stage', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [{ ...DEAL, stage: 'LOI Submitted' }] })
    const cmd: ActionCommand = { type: 'change-stage', dealName: 'Anchor', stage: 'Pass (Pre-LOI)', dealType: null, raw: 'move Anchor to pass pre-loi' }
    const outcome = await executeActionCommand(supabase, cmd, CTX, NO_DBX)
    expect(outcome.status).toBe('done')
    expect(outcome.summary).toContain('stage LOI Submitted → Pass (Pre-LOI)')
    expect(state.deals[0].status).toBe('Dead')
    expect(state.deals[0].stage).toBe('Pass (Pre-LOI)')
  })

  it('ambiguous name queues with candidates and changes nothing', async () => {
    const other = { ...DEAL, id: 'deal-2', company_name: 'Anchor Bay', created_at: '2026-11-02T00:00:00Z' }
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL, other] })
    const cmd: ActionCommand = { type: 'change-stage', dealName: 'Anchor', stage: 'Hold', dealType: null, raw: 'change Anchor to hold' }
    const outcome = await executeActionCommand(supabase, cmd, CTX, NO_DBX)
    expect(outcome.status).toBe('queued')
    expect(state.deals.every(d => d.stage === 'Teaser')).toBe(true)
    expect(state.intake_queue).toHaveLength(1)
    expect(state.intake_queue[0].extracted._kind).toBe('email-command')
    expect(state.intake_queue[0].extracted._candidates).toEqual(expect.arrayContaining(['Project Anchor', 'Anchor Bay']))
    expect(state.intake_events.some(e => e.kind === 'ambiguous')).toBe(true)
  })

  it('unknown deal records a failure and changes nothing', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const cmd: ActionCommand = { type: 'change-stage', dealName: 'Nonexistent', stage: 'Hold', dealType: null, raw: 'change Nonexistent to hold' }
    const outcome = await executeActionCommand(supabase, cmd, CTX, NO_DBX)
    expect(outcome.status).toBe('failed')
    expect(state.deals[0].stage).toBe('Teaser')
    expect(state.intake_events.some(e => e.kind === 'command-failed')).toBe(true)
  })
})

describe('update-deal', () => {
  it('applies type/portco/sector with old → new in the summary', async () => {
    const { supabase, state } = makeFakeSupabase({
      deals: [DEAL],
      portfolio_companies: [{ name: 'DiPonio', status: 'Active' }],
    })
    const cmd: ActionCommand = {
      type: 'update-deal', dealName: 'Project Anchor',
      fields: { deal_type: 'add-on', parent_portco: 'DiPonio', sector: 'Landscaping' },
      raw: 'update Project Anchor: type add-on, portco DiPonio, sector Landscaping',
    }
    const outcome = await executeActionCommand(supabase, cmd, CTX, NO_DBX)
    expect(outcome.status).toBe('done')
    expect(outcome.summary).toContain('type platform → add-on')
    expect(outcome.summary).toContain('portco (none) → DiPonio')
    expect(state.deals[0]).toMatchObject({ deal_type: 'add-on', parent_portco: 'DiPonio', sector: 'Landscaping' })
  })

  it('a portco that is not in Nexus fails the whole command — nothing applied', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL], portfolio_companies: [] })
    const cmd: ActionCommand = {
      type: 'update-deal', dealName: 'Project Anchor',
      fields: { deal_type: 'add-on', parent_portco: 'Nowhere' },
      raw: 'update Project Anchor: type add-on, portco Nowhere',
    }
    const outcome = await executeActionCommand(supabase, cmd, CTX, NO_DBX)
    expect(outcome.status).toBe('failed')
    expect(state.deals[0].deal_type).toBe('platform')
  })
})

describe('update-contact', () => {
  const JANE = { id: 'c1', first_name: 'Jane', last_name: 'Doe', firm: 'Old Co', title: null, phone: null, email: null, created_at: '2026-11-01T00:00:00Z' }

  it('applies only the given fields (partial update), company → firm', async () => {
    const { supabase, state } = makeFakeSupabase({ contacts: [JANE] })
    const cmd: ActionCommand = {
      type: 'update-contact', contactName: 'Jane Doe',
      fields: { phone: '214-555-0100', firm: 'Acme Corp' },
      raw: 'update contact Jane Doe: phone 214-555-0100, company Acme Corp',
    }
    const outcome = await executeActionCommand(supabase, cmd, CTX, NO_DBX)
    expect(outcome.status).toBe('done')
    expect(outcome.summary).toContain('phone (none) → 214-555-0100')
    expect(outcome.summary).toContain('company Old Co → Acme Corp')
    expect(state.contacts[0]).toMatchObject({ phone: '214-555-0100', firm: 'Acme Corp', title: null })
  })

  it('two contacts with the same name queue as ambiguous', async () => {
    const jane2 = { ...JANE, id: 'c2', firm: 'Beta', created_at: '2026-11-02T00:00:00Z' }
    const { supabase, state } = makeFakeSupabase({ contacts: [JANE, jane2] })
    const cmd: ActionCommand = {
      type: 'update-contact', contactName: 'Jane Doe', fields: { phone: '214-555-0100' },
      raw: 'update contact Jane Doe: phone 214-555-0100',
    }
    const outcome = await executeActionCommand(supabase, cmd, CTX, NO_DBX)
    expect(outcome.status).toBe('queued')
    expect(state.contacts.every(c => c.phone === null)).toBe(true)
    expect(state.intake_queue[0].extracted._candidates).toHaveLength(2)
  })
})

describe('file-under', () => {
  it('uploads every attachment to the deal folder and logs a linked note', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const uploadFile = vi.fn(async (folder: string, name: string) => `${folder}/${name}`)
    const cmd: ActionCommand = { type: 'file-under', dealName: 'Project Anchor', raw: 'file under Project Anchor' }
    const outcome = await executeActionCommand(supabase, cmd, {
      ...CTX,
      attachments: [
        { name: 'teaser.pdf', buffer: Buffer.from('a') },
        { name: 'model.xlsx', buffer: Buffer.from('b') },
      ],
    }, { dropboxReady: () => true, uploadFile })
    expect(outcome.status).toBe('done')
    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(uploadFile).toHaveBeenCalledWith('/Evolution Strategy Partners/Deals/Project Anchor', 'teaser.pdf', expect.anything())
    expect(state.notes).toHaveLength(1)
    expect(state.notes[0].deal_id).toBe('deal-1')
  })

  it('with no attachments it fails and uploads nothing', async () => {
    const { supabase } = makeFakeSupabase({ deals: [DEAL] })
    const uploadFile = vi.fn(async () => 'x')
    const cmd: ActionCommand = { type: 'file-under', dealName: 'Project Anchor', raw: 'file under Project Anchor' }
    const outcome = await executeActionCommand(supabase, cmd, CTX, { dropboxReady: () => true, uploadFile })
    expect(outcome.status).toBe('failed')
    expect(uploadFile).not.toHaveBeenCalled()
  })
})

describe('move-file', () => {
  const cmd: ActionCommand = { type: 'move-file', fileName: 'cim.pdf', dealName: 'Project Anchor', raw: 'move file cim.pdf to Project Anchor' }

  it('moves the one matching file into the deal folder', async () => {
    const { supabase } = makeFakeSupabase({ deals: [DEAL] })
    const movePath = vi.fn(async (_f: string, t: string) => t)
    const outcome = await executeActionCommand(supabase, cmd, CTX, {
      dropboxReady: () => true,
      movePath,
      findFiles: async () => [{ name: 'cim.pdf', path: '/Evolution Strategy Partners/Deals/Inbox/cim.pdf' }],
    })
    expect(outcome.status).toBe('done')
    expect(movePath).toHaveBeenCalledWith(
      '/Evolution Strategy Partners/Deals/Inbox/cim.pdf',
      '/Evolution Strategy Partners/Deals/Project Anchor/cim.pdf',
    )
  })

  it('a file already in the target folder is a no-op success', async () => {
    const { supabase } = makeFakeSupabase({ deals: [DEAL] })
    const movePath = vi.fn(async (_f: string, t: string) => t)
    const outcome = await executeActionCommand(supabase, cmd, CTX, {
      dropboxReady: () => true,
      movePath,
      findFiles: async () => [{ name: 'cim.pdf', path: '/Evolution Strategy Partners/Deals/Project Anchor/cim.pdf' }],
    })
    expect(outcome.status).toBe('done')
    expect(outcome.summary).toMatch(/already/)
    expect(movePath).not.toHaveBeenCalled()
  })

  it('several same-name files queue with their paths — never a guess', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const movePath = vi.fn(async (_f: string, t: string) => t)
    const outcome = await executeActionCommand(supabase, cmd, CTX, {
      dropboxReady: () => true,
      movePath,
      findFiles: async () => [
        { name: 'cim.pdf', path: '/a/cim.pdf' },
        { name: 'cim.pdf', path: '/b/cim.pdf' },
      ],
    })
    expect(outcome.status).toBe('queued')
    expect(movePath).not.toHaveBeenCalled()
    expect(state.intake_queue[0].extracted._candidates).toEqual(['/a/cim.pdf', '/b/cim.pdf'])
  })

  it('no matching file records a failure', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const outcome = await executeActionCommand(supabase, cmd, CTX, {
      dropboxReady: () => true,
      findFiles: async () => [],
    })
    expect(outcome.status).toBe('failed')
    expect(state.intake_events.some(e => e.kind === 'command-failed')).toBe(true)
  })
})
