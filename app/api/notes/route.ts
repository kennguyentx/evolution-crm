import { NoteCreateSchema } from '@/lib/schemas'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const NOTE_SELECT = `
  *,
  deal:deals(company_name),
  contact:contacts(first_name, last_name, firm),
  raise:capital_raises(name),
  capital_contact:capital_contacts(firm, contact_name)
`

// POST /api/notes  { raw_text, ...optional links }
// Creates a note — used by the contacts page "add note" affordance and any
// other caller that needs to file a note under a deal/contact/raise. Defaults
// mirror the notes page's manual add: source 'manual', summary = first 300
// chars of the text, note_date = today.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = NoteCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid note' }, { status: 400 })
    }
    const v = parsed.data

    const supabase = serviceClient()
    const { data, error } = await supabase
      .from('notes')
      .insert({
        raw_text: v.raw_text,
        summary: v.summary ?? v.raw_text.slice(0, 300),
        next_steps: v.next_steps ?? null,
        logged_by: v.logged_by ?? 'Manual',
        source: v.source ?? 'manual',
        note_date: v.note_date ?? new Date().toISOString().split('T')[0],
        deal_id: v.deal_id ?? null,
        contact_id: v.contact_id ?? null,
        portfolio_company_id: v.portfolio_company_id ?? null,
        raise_id: v.raise_id ?? null,
        capital_contact_id: v.capital_contact_id ?? null,
      })
      .select(NOTE_SELECT)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/notes  { id, ...fields }
export async function PATCH(req: NextRequest) {
  try {
    const { id, ...fields } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

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
}
