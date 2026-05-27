// app/api/deals/[id]/embed/route.ts
// POST — generate and store an embedding for a single deal.
// Called automatically after deal creation; can also be triggered manually.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { embed, vectorLiteral, dealTextBlob } from '@/lib/embeddings'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = serviceClient()

  const { data: deal, error } = await supabase
    .from('deals')
    .select('company_name, sector, geography, deal_type, description, financial_summary, revenue, ebitda')
    .eq('id', params.id)
    .single()

  if (error || !deal) {
    return NextResponse.json({ error: error?.message ?? 'Deal not found' }, { status: 404 })
  }

  const text = dealTextBlob(deal)
  if (!text.trim()) {
    return NextResponse.json({ error: 'Deal has no text to embed' }, { status: 400 })
  }

  const vector = await embed(text)

  const { error: updateErr } = await supabase
    .from('deals')
    .update({ embedding: vectorLiteral(vector) })
    .eq('id', params.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, dimensions: vector.length })
}
