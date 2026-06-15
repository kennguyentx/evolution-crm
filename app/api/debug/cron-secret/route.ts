// app/api/debug/cron-secret/route.ts
// Temporary diagnostic — reports a fingerprint + SHA256 prefix of the CRON_SECRET
// the LIVE deployment reads, WITHOUT exposing the full value. Lets us compare
// byte-for-byte against the GitHub Actions secret. Delete after.
//
// Usage: GET /api/debug/cron-secret?k=esp-pm-check

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

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
    sha256_16: s ? createHash('sha256').update(s).digest('hex').slice(0, 16) : null,
  })
}
