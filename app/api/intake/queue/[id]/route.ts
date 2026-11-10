import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { IntakeQueueActionSchema } from '@/lib/schemas'
import { approveQueueItem, rejectQueueItem } from '@/lib/intake-queue-actions'
import { apiError, withErrorHandler } from '@/lib/api-response'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// The approve/reject implementation lives in lib/intake-queue-actions.ts so
// digest replies ("approve 2" by email) run the exact same code path. This
// handler only validates input and maps the result to HTTP responses.
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const supabase = serviceClient()

  const parsed = IntakeQueueActionSchema.safeParse(await req.json())
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
  const { action, edited } = parsed.data

  if (action === 'reject') {
    await rejectQueueItem(supabase, params.id)
    return NextResponse.json({ success: true })
  }

  if (action === 'approve') {
    const res = await approveQueueItem(supabase, params.id, edited)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({
      success: true,
      ...(res.deal_id ? { deal_id: res.deal_id } : {}),
      ...(res.note_id ? { note_id: res.note_id } : {}),
      ...(res.skipped ? { skipped: res.skipped } : {}),
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
})
