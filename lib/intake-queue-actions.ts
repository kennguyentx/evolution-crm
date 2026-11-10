// ── Intake queue approve / reject ───────────────────────────────────────────
// The single implementation behind BOTH the review UI's PATCH endpoint
// (app/api/intake/queue/[id]) and digest-reply instructions ("approve 2") in
// the email route — one code path, so an approval means the same thing
// however it was given. Extracted verbatim from the PATCH handler (review
// item: digest replies); the route now only maps results to HTTP responses.
//
// Result shapes mirror the endpoint's responses:
//   ok + deal_id            — a deal was created (or already had been)
//   ok + note_id            — a note-append item was filed under a contact
//   ok + skipped            — idempotent no-op (e.g. 'already approved')
//   !ok + status + error    — the endpoint returned this status/error pair

import { sendDealNotification } from '@/lib/deal-notify'
import { upsertContacts } from '@/lib/contacts'
import { createLogger } from '@/lib/log'

const log = createLogger('intake/queue')

export interface QueueActionEdited {
  company_name?: string
  sector?: string | null
  geography?: string | null
  deal_type?: string | null
  parent_portco?: string | null
  stage?: string
  revenue?: number | null
  ebitda?: number | null
  description?: string | null
  contact_id?: string
  [key: string]: any
}

export type QueueActionResult =
  | { ok: true; deal_id?: string; note_id?: string; skipped?: string }
  | { ok: false; status: number; error: string }

/** Reject a queue item. Mirrors the PATCH endpoint: unconditional by id. */
export async function rejectQueueItem(supabase: any, id: string): Promise<{ ok: true }> {
  await supabase.from('intake_queue').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', id)
  return { ok: true }
}

/** Approve a queue item: create the deal (or file the note) and mark it approved. */
export async function approveQueueItem(supabase: any, id: string, edited?: QueueActionEdited): Promise<QueueActionResult> {
  // Get queue item — atomically claim it by moving to 'processing' first.
  // If two users hit approve simultaneously, only one will see status='pending'.
  const { data: claimed, error: claimErr } = await supabase
    .from('intake_queue')
    .update({ status: 'processing', reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')  // only update if still pending — atomic guard
    .select('*')
    .single()

  if (claimErr || !claimed) {
    // Either not found or already being processed by someone else
    const { data: existing } = await supabase.from('intake_queue').select('status, deal_id').eq('id', id).single()
    if (existing?.status === 'approved' && existing?.deal_id) {
      return { ok: true, deal_id: existing.deal_id, skipped: 'already approved' }
    }
    return { ok: false, status: 409, error: 'Item not found or already being processed' }
  }

  const item = claimed

  const ext = { ...item.extracted, ...edited }

  // Note-append queue items: no deal is created. The reviewer picked the
  // contact (edited.contact_id) in the intake UI; file the note under it.
  if (ext._kind === 'note-append') {
    if (!edited?.contact_id) {
      await supabase.from('intake_queue').update({ status: 'pending', reviewed_at: null }).eq('id', id)
      return { ok: false, status: 400, error: 'Pick a contact to file this note under' }
    }
    const noteText = (ext._note_text as string) || ''
    const { data: note, error: noteErr } = await supabase.from('notes').insert({
      raw_text: noteText,
      summary: noteText.slice(0, 300),
      logged_by: item.from_email ? item.from_email.split('@')[0] : 'Email',
      source: 'email',
      note_date: new Date().toISOString().split('T')[0],
      contact_id: edited.contact_id,
    }).select('id').single()
    if (noteErr) {
      await supabase.from('intake_queue').update({ status: 'pending', reviewed_at: null }).eq('id', id)
      return { ok: false, status: 500, error: noteErr.message }
    }
    await supabase.from('intake_queue').update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    }).eq('id', id)
    return { ok: true, note_id: note?.id }
  }

  // Resolve stage and derive status
  const stage  = edited?.stage || 'Teaser'
  const status =
    stage === 'Dead' || stage.startsWith('Pass') ? 'Dead'   :
    stage.startsWith('Closed')                   ? 'Closed' :
    'Active'

  // Create deal
  const { data: deal, error: dealErr } = await supabase.from('deals').insert({
    company_name:           ext.company_name || 'Unknown Company',
    sector:                 ext.sector       || null,
    geography:              ext.geography    || null,
    deal_type:              edited?.deal_type || ext.deal_type || 'platform',
    parent_portco:          edited?.parent_portco || null,
    revenue:                ext.revenue      ?? null,
    ebitda:                 ext.ebitda       ?? null,
    description:            ext.description  || null,
    financial_summary:      ext.financial_summary     || null,
    historical_financials:  ext.historical_financials?.length ? ext.historical_financials : null,
    customer_concentration: ext.customer_concentration || null,
    employee_count:         ext.employee_count         ?? null,
    stage,
    status,
    cim_parsed:             item.doc_type === 'cim',
    dropbox_path:           item.dropbox_path || null,
    expected_close:         new Date().toISOString().split('T')[0],
  }).select().single()

  if (dealErr) {
    // Revert status so it can be retried
    await supabase.from('intake_queue').update({ status: 'pending', reviewed_at: null }).eq('id', id)
    return { ok: false, status: 500, error: dealErr.message }
  }

  // If CIM, save to deal_cims
  if (item.doc_type === 'cim' && deal) {
    await supabase.from('deal_cims').insert({
      deal_id:      deal.id,
      file_name:    item.file_name,
      dropbox_path: item.dropbox_path,
      extracted:    item.extracted,
    })
  }

  // Link the contacts the email extractor found. Previously they were
  // captured in extracted.contacts but never created/linked on approve —
  // approving a deal silently dropped its people.
  if (deal?.id && Array.isArray(ext.contacts) && ext.contacts.length) {
    try {
      await upsertContacts(supabase, ext.contacts, deal.id)
    } catch (e: any) {
      // Non-fatal: the deal exists; contacts can be added from the deal page.
      log.error('[intake-approve] contact linking failed:', e?.message)
    }
  }

  // Mark queue item approved
  await supabase.from('intake_queue').update({
    status: 'approved',
    deal_id: deal?.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id)

  // Send deal notification email. MUST be awaited — on Vercel serverless an
  // un-awaited promise is dropped when the function returns, so the email never
  // actually sends. A failure here shouldn't fail the approval, hence try/catch.
  try {
    await sendDealNotification({
      companyName: ext.company_name || 'Unknown Company',
      stage,
      status,
      sector:      ext.sector      || null,
      geography:   ext.geography   || null,
      revenue:     ext.revenue     ?? null,
      ebitda:      ext.ebitda      ?? null,
      description: ext.description || null,
      dealId:      deal?.id        || null,
      isPending:   false,
    })
  } catch (e: any) {
    log.error('[deal-notify] intake approve:', e?.message)
  }

  // Link any orphaned email-intake notes that were logged before the deal existed
  if (deal?.id && ext.company_name) {
    await supabase.from('notes')
      .update({ deal_id: deal.id })
      .eq('source', 'email')
      .is('deal_id', null)
      .ilike('summary', `%${ext.company_name}%`)
  }

  return { ok: true, deal_id: deal?.id }
}
