// GET /api/constant-contact/nexus-contacts
// Returns all Nexus contacts that have an email address, newest first.
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
