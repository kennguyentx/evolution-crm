import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendDealNotification } from '@/lib/deal-notify'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = serviceClient()
  const body = await req.json()
  const { action, edited } = body // action: 'approve' | 'reject', edited: partial deal fields

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
      stage:                  'Teaser',
      status:                 'Active',
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

    // Mark queue item approved
    await supabase.from('intake_queue').update({
      status: 'approved',
      deal_id: deal?.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', params.id)

    // Send deal notification email (non-blocking)
    sendDealNotification({
      companyName: ext.company_name || 'Unknown Company',
      stage:       'Teaser',
      status:      'Active',
      sector:      ext.sector      || null,
      geography:   ext.geography   || null,
      revenue:     ext.revenue     ?? null,
      ebitda:      ext.ebitda      ?? null,
      description: ext.description || null,
      dealId:      deal?.id        || null,
      isPending:   false,
    }).catch(e => console.error('[deal-notify] intake approve:', e?.message))

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
}
