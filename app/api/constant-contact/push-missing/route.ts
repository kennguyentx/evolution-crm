// POST /api/constant-contact/push-missing
// Pushes all Nexus contacts that don't exist in Constant Contact (matched by email).
// Runs server-side so it can handle large batches without browser timeouts.

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
  let url = `${CC_API}/contacts?include=email_addresses&status=all&limit=500`

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`CC API ${res.status}`)
    const data = await res.json()
    for (const c of data.contacts || []) {
      const addr = (c.email_addresses?.[0]?.address || '').toLowerCase()
      if (addr) emails.add(addr)
    }
    const nextHref = data._links?.next?.href
    url = nextHref ? `https://api.cc.email${nextHref}` : ''
  }
  return emails
}

async function pushContact(token: string, contact: any): Promise<boolean> {
  const body: Record<string, any> = {
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
  }
  if (contact.title) body.job_title = contact.title
  if (contact.firm) body.company_name = contact.firm
  if (contact.email) body.email_address = { address: contact.email, permission_to_send: 'implicit' }
  if (contact.phone) body.phone_numbers = [{ phone_number: contact.phone, kind: 'work' }]

  const res = await fetch(`${CC_API}/contacts?action=create_or_update`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  return res.ok
}

export async function POST() {
  let token: string
  try {
    token = await getValidCCToken()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 503 })
  }

  // 1. Get the set of emails already in CC
  let ccEmails: Set<string>
  try {
    ccEmails = await fetchAllCCEmails(token)
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to fetch CC contacts: ${err.message}` }, { status: 500 })
  }

  // 2. Fetch Nexus contacts not already in CC
  const supabase = serviceClient()
  const { data: nexusContacts } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email, firm, title, phone')

  const missing = (nexusContacts || []).filter(
    c => !c.email || !ccEmails.has(c.email.toLowerCase())
  )

  if (!missing.length) {
    return NextResponse.json({ synced: 0, failed: 0, message: 'All contacts already in CC' })
  }

  // 3. Push in batches of 5 to respect CC rate limits (~4 req/s)
  let synced = 0
  let failed = 0
  const errors: string[] = []

  for (let i = 0; i < missing.length; i += 5) {
    const batch = missing.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(c => pushContact(token, c))
    )
    for (let j = 0; j < results.length; j++) {
      const r = results[j]
      if (r.status === 'fulfilled' && r.value) {
        synced++
      } else {
        failed++
        const name = `${batch[j].first_name} ${batch[j].last_name}`.trim()
        errors.push(name)
      }
    }
    // Small delay between batches to stay within CC rate limits
    if (i + 5 < missing.length) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return NextResponse.json({ synced, failed, total_missing: missing.length, errors })
}
