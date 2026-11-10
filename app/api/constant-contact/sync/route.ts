import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidCCToken } from '@/lib/constant-contact'
import { apiError, withErrorHandler } from '@/lib/api-response'
import { ConstantContactSyncSchema } from '@/lib/schemas'
import { createLogger } from '@/lib/log'

const log = createLogger('cc-sync')

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
export const POST = withErrorHandler(async (req: NextRequest) => {
  let token: string
  try {
    token = await getValidCCToken()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 503 })
  }

  const parsed = ConstantContactSyncSchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
  const { id, first_name, last_name, email, phone, firm, title } = parsed.data

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

  const text = await res.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch {}

  if (!res.ok) {
    // CC returns a conflict when the email already exists in their system under
    // certain conditions even with create_or_update. Treat it as already-synced
    // rather than an error — the contact is in CC, just stamp and move on.
    const isAlreadyExists = res.status === 409 ||
      text.toLowerCase().includes('already exists') ||
      text.toLowerCase().includes('email_address') && res.status === 400
    if (!isAlreadyExists) {
      log.error('CC sync error', { status: res.status, responseBytes: text.length })
      return NextResponse.json({ error: text }, { status: res.status })
    }
  }

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

  return NextResponse.json({ synced: true, contact_id: data.contact_id, action: data.action ?? 'already_exists' })
})
