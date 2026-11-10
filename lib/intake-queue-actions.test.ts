import { describe, it, expect } from 'vitest'
import { approveQueueItem, rejectQueueItem } from './intake-queue-actions'

// Minimal chainable fake of the Supabase surface approve/reject use:
// intake_queue claim-update + status reads + terminal updates, notes/deals
// inserts. Mirrors the claim semantics: an update guarded by
// status='pending' only lands while the row is still pending.
function makeFakeSupabase(queueRows: Record<string, any>) {
  const state = {
    queue: new Map<string, any>(Object.entries(queueRows)),
    notes: [] as any[],
    deals: [] as any[],
  }

  function builder(table: string) {
    const filters: Record<string, any> = {}
    let patch: any = null
    let insertRow: any = null

    const resolveSingle = () => {
      if (table === 'intake_queue') {
        const row = state.queue.get(filters.id)
        if (patch) {
          // Atomic claim: only a pending row can be claimed.
          if (!row || row.status !== 'pending') {
            return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
          }
          Object.assign(row, patch)
          return { data: { ...row }, error: null }
        }
        return row
          ? { data: { ...row }, error: null }
          : { data: null, error: { message: 'not found' } }
      }
      if (table === 'notes' && insertRow) {
        const r = { id: 'note-new', ...insertRow }
        state.notes.push(r)
        return { data: r, error: null }
      }
      if (table === 'deals' && insertRow) {
        const r = { id: 'deal-new', ...insertRow }
        state.deals.push(r)
        return { data: r, error: null }
      }
      return { data: null, error: null }
    }

    const resolveAwait = () => {
      if (table === 'intake_queue' && patch) {
        const row = state.queue.get(filters.id)
        if (row) Object.assign(row, patch)
      }
      return { data: null, error: null }
    }

    const b: any = {
      select: () => b,
      insert: (row: any) => { insertRow = row; return b },
      update: (p: any) => { patch = p; return b },
      eq: (k: string, v: any) => { filters[k] = v; return b },
      is: () => b,
      in: () => b,
      not: () => b,
      ilike: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      single: async () => resolveSingle(),
      maybeSingle: async () => resolveSingle(),
      then: (res: any, rej: any) => Promise.resolve(resolveAwait()).then(res, rej),
    }
    return b
  }

  return { supabase: { from: (t: string) => builder(t) } as any, state }
}

const dealRow = (over: Record<string, any> = {}) => ({
  id: 'q1',
  status: 'pending',
  deal_id: null,
  note: null,
  extracted: { company_name: 'Project Anchor', stage: 'Teaser', contacts: [] },
  ...over,
})

describe('approveQueueItem', () => {
  it('approves a pending deal item and creates the deal', async () => {
    const { supabase, state } = makeFakeSupabase({ q1: dealRow() })
    const res = await approveQueueItem(supabase, 'q1')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.deal_id).toBe('deal-new')
    expect(state.deals).toHaveLength(1)
    expect(state.deals[0].company_name).toBe('Project Anchor')
    expect(state.queue.get('q1').status).toBe('approved')
    expect(state.queue.get('q1').deal_id).toBe('deal-new')
  })

  it('honors an edited stage (reply "<n>: log as …")', async () => {
    const { supabase, state } = makeFakeSupabase({ q1: dealRow() })
    const res = await approveQueueItem(supabase, 'q1', { stage: 'LOI Submitted' })
    expect(res.ok).toBe(true)
    expect(state.deals[0].stage).toBe('LOI Submitted')
    expect(state.deals[0].status).toBe('Active')
  })

  it('derives Dead status from a Pass stage', async () => {
    const { supabase, state } = makeFakeSupabase({ q1: dealRow() })
    const res = await approveQueueItem(supabase, 'q1', { stage: 'Pass (Pre-LOI)' })
    expect(res.ok).toBe(true)
    expect(state.deals[0].status).toBe('Dead')
  })

  it('is idempotent for an already-approved item', async () => {
    const { supabase, state } = makeFakeSupabase({ q1: dealRow({ status: 'approved', deal_id: 'deal-9' }) })
    const res = await approveQueueItem(supabase, 'q1')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.skipped).toBe('already approved')
      expect(res.deal_id).toBe('deal-9')
    }
    expect(state.deals).toHaveLength(0)
  })

  it('refuses to approve a rejected item', async () => {
    const { supabase } = makeFakeSupabase({ q1: dealRow({ status: 'rejected' }) })
    const res = await approveQueueItem(supabase, 'q1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('files a note-append item under the chosen contact and creates no deal', async () => {
    const noteRow = dealRow({
      extracted: {
        _kind: 'note-append',
        _contact_name: 'Jane Doe',
        _note_text: 'Called her Tuesday.',
        _candidates: [{ id: 'c1', first_name: 'Jane', last_name: 'Doe', firm: null }],
      },
    })
    const { supabase, state } = makeFakeSupabase({ q1: noteRow })
    const res = await approveQueueItem(supabase, 'q1', { contact_id: 'c1' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.note_id).toBe('note-new')
    expect(state.notes).toHaveLength(1)
    expect(state.notes[0].contact_id).toBe('c1')
    expect(state.deals).toHaveLength(0)
    expect(state.queue.get('q1').status).toBe('approved')
  })

  it('requires a contact pick for note-append items', async () => {
    const noteRow = dealRow({
      extracted: { _kind: 'note-append', _contact_name: 'Jane Doe', _note_text: 'Hi', _candidates: [] },
    })
    const { supabase } = makeFakeSupabase({ q1: noteRow })
    const res = await approveQueueItem(supabase, 'q1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(400)
  })
})

describe('rejectQueueItem', () => {
  it('rejects a pending item and is idempotent', async () => {
    const { supabase, state } = makeFakeSupabase({ q1: dealRow() })
    const first = await rejectQueueItem(supabase, 'q1')
    expect(first.ok).toBe(true)
    expect(state.queue.get('q1').status).toBe('rejected')
    const second = await rejectQueueItem(supabase, 'q1')
    expect(second.ok).toBe(true)
  })

  // The lib mirrors the PATCH endpoint exactly: reject is unconditional by
  // id. The digest-reply executor adds its own guard on top — it refuses to
  // reject an already-approved item by email and records the failure —
  // because flipping an approved deal via a one-word reply is too easy to
  // do by accident.
  it('rejects unconditionally by id (mirrors the PATCH endpoint)', async () => {
    const { supabase, state } = makeFakeSupabase({ q1: dealRow({ status: 'approved', deal_id: 'deal-9' }) })
    const res = await rejectQueueItem(supabase, 'q1')
    expect(res.ok).toBe(true)
    expect(state.queue.get('q1').status).toBe('rejected')
  })
})
