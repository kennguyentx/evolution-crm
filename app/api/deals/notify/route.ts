import { NextRequest, NextResponse } from 'next/server'
import { sendDealNotification } from '@/lib/deal-notify'
import { createLogger } from '@/lib/log'

const log = createLogger('deals/notify')

export async function POST(req: NextRequest) {
  const body = await req.json()
  await sendDealNotification(body).catch(e => log.error('[deal-notify] API:', e?.message))
  return NextResponse.json({ ok: true })
}
