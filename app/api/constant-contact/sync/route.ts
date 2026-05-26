import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidCCToken } from '@/lib/constant-contact'

const CC_API = 'https://api.cc.email/v3'

async function getSyncListId(): Promise<string | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'cc_sync_list_id')
    .single()
  return data?.value ?? null
}

// POST — create or update a single contact in Constant Contact
// Uses action=create_or_update so edits also propagate (matched by email)
export async function POST(req: NextRequest) {
  let token: string
  try {
    token = await getValidCCToken()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 503 })
  }

  const { id, first_name, last_name, email, phone, firm, title } = await req.json()

  if (!email && !first_name) {
    return NextResponse.json({ error: 'email or first_name required' }, { status: 400 })
  }

  const listId = await getSyncListId()

  const body: Record<string, any> = {
    first_name: first_name || '',
    last_name: last_name || '',
    job_title: title || undefined,
    company_name: firm || undefined,
    email_address: email ? { address: email, permission_to_send: 'implicit' } : undefined,
    phone_numbers: phone ? [{ phone_number: phone, kind: 'work' }] : undefined,
    list_memberships: listId ? [listId] : undefined,
    create_source: 'Account',
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

  // Stamp cc_synced_at so this contact is excluded from future sync panel loads
  if (id) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase
      .from('contacts')
      .update({ cc_synced_at: new Date().toISOString() })
      .eq('id', id)
  }

  return NextResponse.json({ synced: true, contact_id: data.contact_id, action: data.action })
}
