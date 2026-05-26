// POST /api/constant-contact/push-missing
// Submits all Nexus contacts (with email) to CC's bulk activity API in one shot.
// CC deduplicates by email — existing contacts are updated, new ones are created.
// No pre-fetching of CC contacts needed, so this completes in seconds.

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

  // Bulk API requires a list
  const listId = await getSyncListId()
  if (!listId) {
    return NextResponse.json({
      error: 'Please select a Constant Contact list first using the "Sync to list" dropdown.',
    }, { status: 400 })
  }

  // Fetch ALL Nexus contacts with email (paginate past Supabase's 1000-row limit)
  const supabase = serviceClient()
  const nexusContacts: any[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, firm, title, phone')
      .not('email', 'is', null)
      .range(from, from + PAGE - 1)
    if (!data?.length) break
    nexusContacts.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  if (!nexusContacts.length) {
    return NextResponse.json({ submitted: 0, message: 'No contacts with email addresses found' })
  }

  // Build import payload — CC deduplicates by email automatically
  const importData = nexusContacts.map(c => {
    const row: Record<string, string> = {
      email_address: c.email,
      first_name: c.first_name || '',
      last_name: c.last_name || '',
    }
    if (c.firm)  row.company_name = c.firm
    if (c.title) row.job_title = c.title
    if (c.phone) row.phone = c.phone
    return row
  })

  // Submit to CC bulk activity API — one request, CC processes async in background
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
    submitted: nexusContacts.length,
    activity_id: result.activity_id,
    message: `${nexusContacts.length} contacts submitted — CC is processing in the background`,
  })
}
