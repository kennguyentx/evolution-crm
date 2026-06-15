// app/api/debug/cron-secret/route.ts
// Temporary diagnostic — fingerprints the live CRON_SECRET and tests whether a
// given ?cron_secret= value would authorize via the SAME logic the cron routes
// use (isAuthorizedCron). Lets us confirm the query-param auth path works on the
// live deployment without actually triggering an email send. Delete after.
//
// Usage:
//   /api/debug/cron-secret?k=esp-pm-check
//   /api/debug/cron-secret?k=esp-pm-check&cron_secret=<value>   (tests authorize)

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { isAuthorizedCron } from '@/lib/cron-auth'

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
    // Would the cron routes authorize THIS request? Pass &cron_secret=<value> to test.
    wouldAuthorize: isAuthorizedCron(req),
  })
}
