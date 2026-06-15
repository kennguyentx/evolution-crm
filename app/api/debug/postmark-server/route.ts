// app/api/debug/postmark-server/route.ts
// Temporary diagnostic — verifies the Postmark token in Vercel by asking
// Postmark which server it belongs to. Safe to delete after debugging.
// Requires a valid Supabase session to call.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  // Require Supabase auth so this can't be hit anonymously
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  } else {
    return NextResponse.json({ error: 'Unauthorized — pass Supabase session token' }, { status: 401 })
  }

  const pmToken = process.env.POSTMARK_SERVER_TOKEN
  if (!pmToken) {
    return NextResponse.json({
      ok: false,
      reason: 'POSTMARK_SERVER_TOKEN env var is NOT set in this deployment',
    })
  }

  // Postmark /server endpoint returns metadata about the server the token belongs to
  const res = await fetch('https://api.postmarkapp.com/server', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Postmark-Server-Token': pmToken,
    },
  })
  const body = await res.json().catch(() => ({}))

  return NextResponse.json({
    ok: res.ok,
    httpStatus: res.status,
    tokenPrefix: pmToken.slice(0, 8) + '…',
    tokenLength: pmToken.length,
    server: res.ok ? {
      ID: body.ID,
      Name: body.Name,
      Color: body.Color,
      ServerLink: body.ServerLink,
      DeliveryType: body.DeliveryType,
      InboundAddress: body.InboundAddress,
      SmtpApiActivated: body.SmtpApiActivated,
      DeliveryHookUrl: body.DeliveryHookUrl,
      BounceHookUrl: body.BounceHookUrl,
    } : null,
    rawError: !res.ok ? body : null,
  })
}
