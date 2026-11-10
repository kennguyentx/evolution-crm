import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendDealNotification } from '@/lib/deal-notify'
import { upsertContacts } from '@/lib/contacts'
import { IntakeQueueActionSchema } from '@/lib/schemas'
import { apiError, withErrorHandler } from '@/lib/api-response'
import { createLogger } from '@/lib/log'

const log = createLogger('intake/queue')

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const supabase = serviceClient()

  const parsed = IntakeQueueActionSchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
  const { action, edited } = parsed.data

  if (action === 'reject') {
    await supabase.from('intake_queue').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', params.id)
    return NextResponse.json({ success: true })
  }

  if (action === 'approve') {
    // Get queue item — atomically claim it by moving to 'processing' first.
    // If two users hit approve simultaneously, only one will see status='pending'.
    const { data: claimed, error: claimErr } = await supabase
      .from('intake_queue')
      .update({ status: 'processing', reviewed_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'pending')  // only update if still pending — atomic guard
      .select('*')
      .single()

    if (claimErr || !claimed) {
      // Either not found or already being processed by someone else
      const { data: existing } = await supabase.from('intake_queue').select('status, deal_id').eq('id', params.id).single()
      if (existing?.status === 'approved' && existing?.deal_id) {
        return NextResponse.json({ success: true, deal_id: existing.deal_id, skipped: 'already approved' })
      }
      return NextResponse.json({ error: 'Item not found or already being processed' }, { status: 409 })
    }

    const item = claimed

    const ext = { ...item.extracted, ...edited }

    // Note-append queue items: no deal is created. The reviewer picked the
    // contact (edited.contact_id) in the intake UI; file the note under it.
    if (ext._kind === 'note-append') {
      if (!edited?.contact_id) {
        await supabase.from('intake_queue').update({ status: 'pending', reviewed_at: null }).eq('id', params.id)
        return NextResponse.json({ error: 'Pick a contact to file this note under' }, { status: 400 })
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
        await supabase.from('intake_queue').update({ status: 'pending', reviewed_at: null }).eq('id', params.id)
        return NextResponse.json({ error: noteErr.message }, { status: 500 })
      }
      await supabase.from('intake_queue').update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
      }).eq('id', params.id)
      return NextResponse.json({ success: true, note_id: note?.id })
    }

    // Resolve stage and derive status
    const stage  = edited?.stage || 'Teaser'
    const status =
      stage.startsWith('Pass')   ? 'Dead'   :
      stage.startsWith('Closed') ? 'Closed' :
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
      await supabase.from('intake_queue').update({ status: 'pending', reviewed_at: null }).eq('id', params.id)
      return NextResponse.json({ error: dealErr.message }, { status: 500 })
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
    }).eq('id', params.id)

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

    return NextResponse.json({ success: true, deal_id: deal?.id })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
})
