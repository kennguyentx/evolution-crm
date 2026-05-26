// GET /api/constant-contact/nexus-contacts
// Returns Nexus contacts (bankers, lenders, LPs) that have an email address and have NOT
// yet been synced to Constant Contact (cc_synced_at IS NULL), newest first.
// Management and Other are excluded — they don't belong in Constant Contact.
// Fast — only hits Supabase, no CC API call.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const supabase = serviceClient()
  const contacts: any[] = []
  const PAGE = 1000
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, firm, title, contact_type, phone, created_at')
      .not('email', 'is', null)
      .in('contact_type', ['banker', 'lender', 'lp'])
      .is('cc_synced_at', null)
      .order('created_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) break
    contacts.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  return NextResponse.json({ contacts, total: contacts.length })
}
