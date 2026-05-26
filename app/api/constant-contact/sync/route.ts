import { NextRequest, NextResponse } from 'next/server'

const CC_API = 'https://api.cc.email/v3'

function getToken() {
  return process.env.CONSTANT_CONTACT_ACCESS_TOKEN
}

// POST — create or update a single contact in Constant Contact
// Uses action=create_or_update so edits also propagate (matched by email)
export async function POST(req: NextRequest) {
  const token = getToken()
  if (!token) {
    return NextResponse.json({ error: 'CONSTANT_CONTACT_ACCESS_TOKEN not configured' }, { status: 503 })
  }

  const { first_name, last_name, email, phone, firm, title } = await req.json()

  if (!email && !first_name) {
    return NextResponse.json({ error: 'email or first_name required' }, { status: 400 })
  }

  const body: Record<string, any> = {
    first_name: first_name || '',
    last_name: last_name || '',
    job_title: title || undefined,
    company_name: firm || undefined,
    email_address: email ? { address: email, permission_to_send: 'implicit' } : undefined,
    phone_numbers: phone ? [{ phone_number: phone, kind: 'work' }] : undefined,
  }

  // Remove undefined fields
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k])

  // create_or_update: CC matches on email — safe to call for both new and edited contacts
  const res = await fetch(`${CC_API}/contacts?action=create_or_update`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[cc-sync] error:', res.status, text)
    return NextResponse.json({ error: text }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({ synced: true, contact_id: data.contact_id, action: data.action })
}
