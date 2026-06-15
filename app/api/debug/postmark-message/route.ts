// app/api/debug/postmark-message/route.ts
// Temporary diagnostic — looks up a specific Postmark MessageID using the
// current server token. Tells you exactly what status Postmark sees for that send.
//
// Usage:
//   GET /api/debug/postmark-message?id=<MessageID>
//   Authorization: Bearer <supabase session token>

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Pass ?id=<messageId>' }, { status: 400 })

  const pmToken = process.env.POSTMARK_SERVER_TOKEN
  if (!pmToken) return NextResponse.json({ error: 'POSTMARK_SERVER_TOKEN not set' }, { status: 500 })

  // Look up the message details + delivery events
  const [detailRes, eventsRes] = await Promise.all([
    fetch(`https://api.postmarkapp.com/messages/outbound/${id}/details`, {
      headers: { Accept: 'application/json', 'X-Postmark-Server-Token': pmToken },
    }),
    fetch(`https://api.postmarkapp.com/messages/outbound/${id}/dump`, {
      headers: { Accept: 'application/json', 'X-Postmark-Server-Token': pmToken },
    }).catch(() => null),
  ])

  const detail = await detailRes.json().catch(() => ({}))

  return NextResponse.json({
    found: detailRes.ok,
    httpStatus: detailRes.status,
    detail,
  })
}
