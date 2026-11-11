import { describe, it, expect, vi } from 'vitest'
import {
  runSmartFallback,
  looksLikeInstruction,
  isPassOrDeadInterpretation,
  type FallbackContext,
} from './email-command-fallback'
import { normalizeClassification, type ClassifyFn } from './email-command-classifier'
import { approveQueueItem } from './intake-queue-actions'

// ── Table-backed fake Supabase (same shape as email-command-actions.test.ts) ──
type Row = Record<string, any>

function makeFakeSupabase(seed: { deals?: Row[]; contacts?: Row[]; intake_queue?: Row[] } = {}) {
  const state = {
    deals: (seed.deals ?? []).map(r => ({ ...r })),
    contacts: (seed.contacts ?? []).map(r => ({ ...r })),
    portfolio_companies: [] as Row[],
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
        out = [...out].sort((a, b) => String(a[os.col] ?? '').localeCompare(String(b[os.col] ?? '')) * (os.asc ? 1 : -1))
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
      is: () => b, in: () => b, not: () => b, or: () => b,
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

const DEAL = {
  id: 'deal-1', company_name: 'Project Anchor', stage: 'Teaser', status: 'Active',
  dropbox_path: null, deal_type: 'platform', parent_portco: null, sector: null, geography: null,
  created_at: '2026-11-01T00:00:00Z',
}

function makeCtx(records: Row[]): FallbackContext {
  return {
    from: 'ken@evolutionstrategy.com',
    fromName: 'Ken',
    subject: 'Re: Intake digest',
    messageId: 'msg-9',
    noteDate: '2026-11-10',
    surface: 'forward',
    record: async (ok, summary, extra) => {
      records.push({ ok, summary, ...(extra ?? {}) })
    },
  }
}

const changeStage = (stage: string, confidence: number): ClassifyFn =>
  async () => ({
    confidence,
    command: { type: 'action', command: { type: 'change-stage', dealName: 'Project Anchor', stage: stage as any, dealType: null, raw: 'x' } },
  })

describe('looksLikeInstruction', () => {
  it('accepts instruction-shaped lines and polite forms', () => {
    expect(looksLikeInstruction('kill the Anchor deal')).toBe(true)
    expect(looksLikeInstruction('can you move Project Anchor along')).toBe(true)
    expect(looksLikeInstruction("Jane's new number is 214-555-0100")).toBe(true)
  })
  it('rejects greetings, signatures and prose', () => {
    expect(looksLikeInstruction('Thanks!')).toBe(false)
    expect(looksLikeInstruction('Ken')).toBe(false)
    expect(looksLikeInstruction('The seller called twice about the timeline and seems eager.')).toBe(false)
    expect(looksLikeInstruction('See the attached deck for the full picture of the business.')).toBe(false)
  })
})

describe('runSmartFallback', () => {
  it('high-confidence interpretation executes and is logged as interpreted', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const records: Row[] = []
    const res = await runSmartFallback(supabase, ['move Project Anchor along to reviewing'], makeCtx(records), {
      classify: changeStage('Reviewing', 0.95),
      actionDeps: { dropboxReady: () => false },
    })
    expect(res.handled).toBe(true)
    expect(res.outcomes[0].status).toBe('done')
    expect(state.deals[0].stage).toBe('Reviewing')
    expect(records).toHaveLength(1)
    expect(records[0].ok).toBe(true)
    expect(records[0].detail.interpreted).toBe(true)
    expect(records[0].detail.original_line).toBe('move Project Anchor along to reviewing')
    expect(records[0].detail.interpreted_as).toContain('change "Project Anchor" to Reviewing')
    expect(records[0].detail.confidence).toBe(0.95)
  })

  it('low-confidence interpretation queues with the exact interpretation stored', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const records: Row[] = []
    const res = await runSmartFallback(supabase, ['move Anchor along a little'], makeCtx(records), {
      classify: changeStage('Reviewing', 0.4),
      actionDeps: { dropboxReady: () => false },
    })
    expect(res.outcomes[0].status).toBe('queued')
    expect(state.deals[0].stage).toBe('Teaser') // untouched
    expect(state.intake_queue).toHaveLength(1)
    const item = state.intake_queue[0]
    expect(item.extracted._kind).toBe('email-command')
    expect(item.extracted._interpretation).toEqual({
      type: 'action',
      command: { type: 'change-stage', dealName: 'Project Anchor', stage: 'Reviewing', dealType: null, raw: 'x' },
    })
    expect(item.extracted._original_line).toBe('move Anchor along a little')
    const ev = state.intake_events.find(e => e.kind === 'ambiguous')
    expect(ev?.summary).toMatch(/^I think you meant: change "Project Anchor" to Reviewing — approve\?/)
    expect(ev?.queue_id).toBe(item.id)
    expect(records).toHaveLength(0) // the ambiguous event is the record
  })

  it('a Pass interpretation queues even at high confidence — never auto-executes', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const records: Row[] = []
    const res = await runSmartFallback(supabase, ['kill the Anchor deal'], makeCtx(records), {
      classify: changeStage('Pass (DOA)', 0.99),
      actionDeps: { dropboxReady: () => false },
    })
    expect(res.outcomes[0].status).toBe('queued')
    expect(state.deals[0].stage).toBe('Teaser')
    expect(state.intake_queue[0].extracted._queue_reason).toBe('pass-dead')
    const ev = state.intake_events.find(e => e.kind === 'ambiguous')
    expect(ev?.summary).toMatch(/Pass\/Dead changes always need approval/)
  })

  it('unclassifiable instruction-like line records a failure and does nothing', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const records: Row[] = []
    const res = await runSmartFallback(supabase, ['move the thing to the place'], makeCtx(records), {
      classify: async () => null,
    })
    expect(res.handled).toBe(true)
    expect(res.outcomes[0].status).toBe('failed')
    expect(records).toHaveLength(1)
    expect(records[0].ok).toBe(false)
    expect(records[0].summary).toMatch(/^Could not interpret:/)
    expect(state.deals[0].stage).toBe('Teaser')
    expect(state.intake_queue).toHaveLength(0)
  })

  it('prose lines are never classified (forwarded-body safety)', async () => {
    const { supabase } = makeFakeSupabase({ deals: [DEAL] })
    const records: Row[] = []
    const classify = vi.fn(async () => ({ confidence: 1, command: { type: 'ask', question: 'x' } as any }))
    const prose = [
      'The seller founded the company in 2009 and grew it steadily.',
      'Revenue was up 12% last year according to the broker.',
      'Thanks!',
      'Ken',
    ]
    const res = await runSmartFallback(supabase, prose, makeCtx(records), { classify })
    expect(classify).not.toHaveBeenCalled()
    expect(res.handled).toBe(false)
    expect(records).toHaveLength(0)
  })

  it('a low-confidence decide is failed, never queued', async () => {
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL] })
    const records: Row[] = []
    const classify: ClassifyFn = async () => ({ confidence: 0.3, command: { type: 'decide', verb: 'approve', ref: '2' } })
    const res = await runSmartFallback(supabase, ['yeah the second one is fine'], makeCtx(records), { classify })
    // "yeah the second one is fine" is not instruction-shaped, so craft via a shaped line:
    expect(res.handled).toBe(false)
    const res2 = await runSmartFallback(supabase, ['approve the second one'], makeCtx(records), { classify })
    expect(res2.outcomes[0].status).toBe('failed')
    expect(state.intake_queue).toHaveLength(0)
  })
})

describe('isPassOrDeadInterpretation', () => {
  it('flags Pass variants and Dead only', () => {
    const mk = (stage: string) => ({ type: 'action', command: { type: 'change-stage', dealName: 'X', stage, dealType: null, raw: '' } }) as any
    expect(isPassOrDeadInterpretation(mk('Pass (DOA)'))).toBe(true)
    expect(isPassOrDeadInterpretation(mk('Pass (Post-LOI)'))).toBe(true)
    expect(isPassOrDeadInterpretation(mk('Dead'))).toBe(true)
    expect(isPassOrDeadInterpretation(mk('Reviewing'))).toBe(false)
    expect(isPassOrDeadInterpretation(mk('Closed (Platform)'))).toBe(false)
  })
})

describe('normalizeClassification', () => {
  it('maps a valid payload and clamps confidence', () => {
    const cls = normalizeClassification(
      { confidence: 1.4, command: { type: 'change-stage', deal_name: 'Project Anchor', stage: 'Pre-LOI', deal_type: null } },
      'line',
    )
    expect(cls?.confidence).toBe(1)
    expect(cls?.command).toMatchObject({ type: 'action' })
  })
  it('rejects stages outside the vocabulary', () => {
    expect(normalizeClassification(
      { confidence: 0.9, command: { type: 'change-stage', deal_name: 'X', stage: 'Banana' } }, 'line',
    )).toBeNull()
  })
  it('rejects unknown command types and empty payloads', () => {
    expect(normalizeClassification({ confidence: 0.9, command: { type: 'teleport' } }, 'line')).toBeNull()
    expect(normalizeClassification(null, 'line')).toBeNull()
    expect(normalizeClassification({ command: null }, 'line')).toBeNull()
  })
})

describe('approving a queued interpretation (approveQueueItem)', () => {
  it('executes the stored interpretation with no re-classification', async () => {
    const item = {
      id: 'q1', status: 'pending', deal_id: null, from_email: 'ken@evolutionstrategy.com',
      extracted: {
        _kind: 'email-command',
        _interpretation: { type: 'action', command: { type: 'change-stage', dealName: 'Project Anchor', stage: 'Reviewing', dealType: null, raw: 'bump Anchor' } },
        _interpretation_text: 'change "Project Anchor" to Reviewing',
        _original_line: 'bump Anchor',
        _confidence: 0.4,
        _from: 'ken@evolutionstrategy.com', _subject: 'digest', _message_id: 'm1', _note_date: '2026-11-10',
      },
    }
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL], intake_queue: [item] })
    const res = await approveQueueItem(supabase, 'q1')
    expect(res.ok).toBe(true)
    expect(state.deals[0].stage).toBe('Reviewing')
    expect(state.intake_queue[0].status).toBe('approved')
    const ev = state.intake_events.find(e => e.kind === 'command-action')
    expect(ev?.summary).toMatch(/approved interpretation/)
  })

  it('a candidates-only item cannot be approved into a garbage deal', async () => {
    const item = {
      id: 'q2', status: 'pending', deal_id: null, from_email: 'ken@evolutionstrategy.com',
      extracted: {
        _kind: 'email-command',
        _command: { type: 'change-stage', dealName: 'Anchor', stage: 'Hold', dealType: null, raw: 'change Anchor to hold' },
        _candidates: ['Project Anchor', 'Anchor Bay'],
        _ambiguity: '2 deals matched',
      },
    }
    const { supabase, state } = makeFakeSupabase({ deals: [DEAL], intake_queue: [item] })
    const res = await approveQueueItem(supabase, 'q2')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/exact name/)
    expect(state.intake_queue[0].status).toBe('pending') // bounced back, not consumed
    expect(state.deals).toHaveLength(1) // no new deal created
    expect(state.deals[0].stage).toBe('Teaser')
  })
})
