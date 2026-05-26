// GET /api/constant-contact/compare
// Compares all Nexus contacts vs all Constant Contact contacts (by email).
// Returns: matched, nexus_only (not in CC), cc_only (not in Nexus)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidCCToken } from '@/lib/constant-contact'

const CC_API = 'https://api.cc.email/v3'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function fetchAllCCContacts(token: string): Promise<any[]> {
  const all: any[] = []
  // email_address is returned by default on every contact — no include param needed
  let url = `${CC_API}/contacts?status=all&limit=500`

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`CC API ${res.status}: ${text}`)
    }
    const data = await res.json()
    all.push(...(data.contacts || []))

    // CC returns relative paths like /v3/contacts?cursor=xxx
    const nextHref = data._links?.next?.href
    url = nextHref ? `https://api.cc.email${nextHref}` : ''
  }

  return all
}

export async function GET() {
  let token: string
  try {
    token = await getValidCCToken()
  } catch (err: any) {
    return NextResponse.json({ error: err.message, not_connected: true }, { status: 503 })
  }

  // Fetch CC contacts
  let ccContacts: any[]
  try {
    ccContacts = await fetchAllCCContacts(token)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  // Fetch ALL Nexus contacts (paginate past Supabase's 1000-row default limit)
  const supabase = serviceClient()
  const nexusContacts: any[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error: dbErr } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, firm, title, contact_type, phone')
      .order('last_name', { ascending: true, nullsFirst: false })
      .range(from, from + PAGE - 1)
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
    if (!data?.length) break
    nexusContacts.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  // Build email → CC contact map
  // CC v3 returns email_address (singular object) by default on each contact
  const ccByEmail = new Map<string, any>()
  for (const c of ccContacts) {
    const addr = (c.email_address?.address || '').toLowerCase()
    if (addr) ccByEmail.set(addr, c)
  }

  // Build email → Nexus contact map
  const nexusByEmail = new Map<string, any>()
  for (const c of nexusContacts || []) {
    if (c.email) nexusByEmail.set(c.email.toLowerCase(), c)
  }

  // Only contacts WITH an email can be meaningfully synced/matched (CC deduplicates by email)
  const nexusOnly = (nexusContacts || []).filter(
    c => c.email && !ccByEmail.has(c.email.toLowerCase())
  )
  const matched = (nexusContacts || []).filter(
    c => c.email && ccByEmail.has(c.email.toLowerCase())
  )
  const ccOnly = ccContacts
    .filter(c => {
      const addr = (c.email_address?.address || '').toLowerCase()
      return !addr || !nexusByEmail.has(addr)
    })
    .map(c => ({
      cc_id: c.contact_id,
      first_name: c.first_name || '',
      last_name: c.last_name || '',
      email: c.email_address?.address || '',
      firm: c.company_name || '',
      title: c.job_title || '',
    }))

  return NextResponse.json({
    nexus_total: nexusContacts?.length ?? 0,
    cc_total: ccContacts.length,
    matched_count: matched.length,
    nexus_only_count: nexusOnly.length,
    cc_only_count: ccOnly.length,
    nexus_only: nexusOnly,
    cc_only: ccOnly,
    matched: matched,
  })
}
