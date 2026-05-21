import { NextRequest, NextResponse } from 'next/server'
import { sendDealNotification } from '@/lib/deal-notify'

export async function POST(req: NextRequest) {
  const body = await req.json()
  await sendDealNotification(body).catch(e => console.error('[deal-notify] API:', e?.message))
  return NextResponse.json({ ok: true })
}
