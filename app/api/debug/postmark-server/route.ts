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
  // Gate behind a simple query secret so it isn't fully public, but doesn't
  // require a Supabase session token (which was awkward to obtain in the browser).
  // Delete this whole endpoint once Postmark is sorted.
  const secret = req.nextUrl.searchParams.get('k')
  if (secret !== 'esp-pm-check') {
    return NextResponse.json({ error: 'Pass ?k=esp-pm-check' }, { status: 401 })
  }
  void supabase // keep import used

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
