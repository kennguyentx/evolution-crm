import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { apiError, withErrorHandler } from '@/lib/api-response'
import { InteractionUpdateSchema, InteractionDeleteSchema } from '@/lib/schemas'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// PATCH /api/interactions  { id, ...fields }
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  try {
    const parsed = InteractionUpdateSchema.safeParse(await req.json())
    if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
    const { id, ...fields } = parsed.data

    const supabase = serviceClient()
    const { data, error } = await supabase
      .from('interactions')
      .update(fields)
      .eq('id', id)
      .select('*, contact:contacts(first_name, last_name)')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
})

// DELETE /api/interactions  { id }
export const DELETE = withErrorHandler(async (req: NextRequest) => {
  try {
    const parsed = InteractionDeleteSchema.safeParse(await req.json())
    if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
    const { id } = parsed.data

    const supabase = serviceClient()
    const { error } = await supabase.from('interactions').delete().eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
})
