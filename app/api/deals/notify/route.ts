import { NextRequest, NextResponse } from 'next/server'
import { sendDealNotification } from '@/lib/deal-notify'
import { apiError, withErrorHandler } from '@/lib/api-response'
import { DealNotifySchema } from '@/lib/schemas'

export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = DealNotifySchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
  await sendDealNotification(parsed.data).catch(e => console.error('[deal-notify] API:', e?.message))
  return NextResponse.json({ ok: true })
})
