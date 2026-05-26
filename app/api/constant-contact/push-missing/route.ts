// POST /api/constant-contact/push-missing
// Uses CC's bulk activity API (POST /v3/activities/contacts) which is fully async —
// we submit all missing contacts in one request and CC processes them in the background.
// This avoids Vercel timeouts regardless of how many contacts need syncing.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidCCToken } from '@/lib/constant-contact'

export const maxDuration = 60

const CC_API = 'https://api.cc.email/v3'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function fetchAllCCEmails(token: string): Promise<Set<string>> {
  const emails = new Set<string>()
  let url = `${CC_API}/contacts?status=all&limit=500`

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`CC API ${res.status}: ${await res.text()}`)
    const data = await res.json()
    for (const c of data.contacts || []) {
      const addr = (c.email_address?.address || '').toLowerCase()
      if (addr) emails.add(addr)
    }
    const nextHref = data._links?.next?.href
    url = nextHref ? `https://api.cc.email${nextHref}` : ''
  }
  return emails
}

async function getSyncListId(): Promise<string | null> {
  const supabase = serviceClient()
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'cc_sync_list_id')
    .single()
  return data?.value ?? null
}

export async function POST() {
  let token: string
  try {
    token = await getValidCCToken()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 503 })
  }

  // Require a list to be selected — bulk API needs at least one list_id
  const listId = await getSyncListId()
  if (!listId) {
    return NextResponse.json({
      error: 'Please select a Constant Contact list first using the "Sync to list" dropdown.',
    }, { status: 400 })
  }

  // 1. Get emails already in CC
  let ccEmails: Set<string>
  try {
    ccEmails = await fetchAllCCEmails(token)
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to fetch CC contacts: ${err.message}` }, { status: 500 })
  }

  // 2. Fetch ALL Nexus contacts (paginate past Supabase's 1000-row limit)
  const supabase = serviceClient()
  const nexusContacts: any[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, firm, title, phone')
      .range(from, from + PAGE - 1)
    if (!data?.length) break
    nexusContacts.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  // Only sync contacts with an email address (CC requires email for deduplication)
  const missing = nexusContacts.filter(
    c => c.email && !ccEmails.has(c.email.toLowerCase())
  )

  if (!missing.length) {
    return NextResponse.json({ synced: 0, message: 'All contacts (with email) are already in CC' })
  }

  // 3. Submit to CC bulk activity API — async, CC processes in background
  const importData = missing.map(c => {
    const row: Record<string, string> = {
      email_address: c.email,
      first_name: c.first_name || '',
      last_name: c.last_name || '',
    }
    if (c.firm) row.company_name = c.firm
    if (c.title) row.job_title = c.title
    if (c.phone) row.phone = c.phone
    return row
  })

  const res = await fetch(`${CC_API}/activities/contacts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      import_data: importData,
      list_ids: [listId],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[push-missing] CC bulk API error:', res.status, text)
    return NextResponse.json({ error: `CC API error (${res.status}): ${text}` }, { status: 500 })
  }

  const result = await res.json()
  return NextResponse.json({
    submitted: missing.length,
    activity_id: result.activity_id,
    message: `${missing.length} contacts submitted to CC — processing in background`,
  })
}
