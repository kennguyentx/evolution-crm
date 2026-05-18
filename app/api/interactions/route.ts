import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// PATCH /api/interactions  { id, ...fields }
export async function PATCH(req: NextRequest) {
  try {
    const { id, ...fields } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

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
}

// DELETE /api/interactions  { id }
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const supabase = serviceClient()
    const { error } = await supabase.from('interactions').delete().eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
