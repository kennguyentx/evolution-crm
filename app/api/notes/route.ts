import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { apiError, withErrorHandler } from '@/lib/api-response'
import { NoteUpdateSchema } from '@/lib/schemas'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// PATCH /api/notes  { id, ...fields }
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  try {
    const parsed = NoteUpdateSchema.safeParse(await req.json())
    if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
    const { id, ...fields } = parsed.data

    const supabase = serviceClient()
    const { data, error } = await supabase
      .from('notes')
      .update(fields)
      .eq('id', id)
      .select(`
        *,
        deal:deals(company_name),
        contact:contacts(first_name, last_name, firm),
        raise:capital_raises(name),
        capital_contact:capital_contacts(firm, contact_name)
      `)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
})
