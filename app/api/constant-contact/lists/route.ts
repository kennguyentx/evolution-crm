// GET  /api/constant-contact/lists  — fetch all CC contact lists
// POST /api/constant-contact/lists  — save the chosen sync list ID to app_settings

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidCCToken } from '@/lib/constant-contact'

const CC_API = 'https://api.cc.email/v3'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  let token: string
  try {
    token = await getValidCCToken()
  } catch (err: any) {
    return NextResponse.json({ error: err.message, not_connected: true }, { status: 503 })
  }

  const res = await fetch(`${CC_API}/contact_lists?include_count=true&limit=50`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: text }, { status: res.status })
  }

  const data = await res.json()

  // Also return the currently saved sync list ID
  const supabase = serviceClient()
  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'cc_sync_list_id')
    .single()

  return NextResponse.json({
    lists: (data.lists || []).map((l: any) => ({
      id: l.list_id,
      name: l.name,
      count: l.membership_count ?? null,
    })),
    selected_list_id: setting?.value ?? null,
  })
}

export async function POST(req: NextRequest) {
  const { list_id } = await req.json()
  const supabase = serviceClient()
  await supabase.from('app_settings').upsert({
    key: 'cc_sync_list_id',
    value: list_id ?? null,
    updated_at: new Date().toISOString(),
  })
  return NextResponse.json({ saved: true })
}
