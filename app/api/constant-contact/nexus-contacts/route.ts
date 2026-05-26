// GET /api/constant-contact/nexus-contacts
// Returns Nexus contacts (bankers, lenders, LPs) that have an email address and have NOT
// yet been synced to Constant Contact (cc_synced_at IS NULL), newest first.
// Management and Other are excluded — they don't belong in Constant Contact.
// Falls back gracefully if cc_synced_at column hasn't been migrated yet.
// Fast — only hits Supabase, no CC API call.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function fetchPage(supabase: ReturnType<typeof serviceClient>, from: number, filterSynced: boolean) {
  const PAGE = 1000
  let q = supabase
    .from('contacts')
    .select('id, first_name, last_name, email, firm, title, contact_type, phone, created_at')
    .not('email', 'is', null)
    .in('contact_type', ['banker', 'lender', 'lp'])
    .order('created_at', { ascending: false, nullsFirst: false })
    .range(from, from + PAGE - 1)

  if (filterSynced) q = q.is('cc_synced_at', null)

  return q
}

export async function GET() {
  const supabase = serviceClient()
  const contacts: any[] = []
  let from = 0

  // First attempt: filter out already-synced contacts
  let filterSynced = true

  while (true) {
    const { data, error } = await fetchPage(supabase, from, filterSynced)

    // If the cc_synced_at column doesn't exist yet, fall back without it
    if (error) {
      if (filterSynced && error.message?.includes('cc_synced_at')) {
        filterSynced = false
        from = 0
        contacts.length = 0
        continue
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data?.length) break
    contacts.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  return NextResponse.json({ contacts, total: contacts.length, synced_filter_active: filterSynced })
}
