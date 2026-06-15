// app/api/debug/cron-secret/route.ts
// Temporary diagnostic — reports a fingerprint of the CRON_SECRET the LIVE
// deployment is reading, WITHOUT exposing the full value. Lets us confirm
// whether Vercel's value matches the GitHub Actions secret. Delete after.
//
// Usage: GET /api/debug/cron-secret?k=esp-pm-check

import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('k') !== 'esp-pm-check') {
    return NextResponse.json({ error: 'Pass ?k=esp-pm-check' }, { status: 401 })
  }

  const s = process.env.CRON_SECRET
  return NextResponse.json({
    set: !!s,
    length: s ? s.length : 0,
    first4: s ? s.slice(0, 4) : null,
    last4: s ? s.slice(-4) : null,
  })
}
