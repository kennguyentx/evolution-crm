// app/api/debug/cron-secret/route.ts
// Temporary diagnostic. Fingerprints CRON_SECRET and the Vercel automation
// bypass secret, and tests the cron auth path. Delete after debugging.
//
// Usage: /api/debug/cron-secret?k=esp-pm-check[&cron_secret=<value>]

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { isAuthorizedCron } from '@/lib/cron-auth'

function fp(v: string | undefined) {
  if (!v) return { set: false }
  return {
    set: true,
    length: v.length,
    first4: v.slice(0, 4),
    last4: v.slice(-4),
    sha256_16: createHash('sha256').update(v).digest('hex').slice(0, 16),
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('k') !== 'esp-pm-check') {
    return NextResponse.json({ error: 'Pass ?k=esp-pm-check' }, { status: 401 })
  }

  return NextResponse.json({
    cronSecret: fp(process.env.CRON_SECRET),
    vercelBypassSecret: fp(process.env.VERCEL_AUTOMATION_BYPASS_SECRET),
    wouldAuthorize: isAuthorizedCron(req),
  })
}
