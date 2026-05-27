// app/api/deals/[id]/similar/route.ts
// GET — return deals semantically similar to the given deal.
// Uses stored embedding if present; generates one via the `embed` Edge Function if not.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { embed, vectorLiteral, dealTextBlob } from '@/lib/embeddings'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = serviceClient()

  const { data: deal, error } = await supabase
    .from('deals')
    .select('company_name, sector, geography, deal_type, description, financial_summary, revenue, ebitda, embedding')
    .eq('id', params.id)
    .single()

  if (error || !deal) {
    return NextResponse.json({ error: error?.message ?? 'Deal not found' }, { status: 404 })
  }

  let queryEmbedding: string

  if (deal.embedding) {
    // Use stored embedding — fastest path
    queryEmbedding = deal.embedding
  } else {
    // Generate on the fly via Edge Function
    const text = dealTextBlob(deal)
    if (!text.trim()) {
      return NextResponse.json({ error: 'Deal has no text to embed' }, { status: 400 })
    }
    const vector = await embed(text, supabase)
    queryEmbedding = vectorLiteral(vector)
  }

  const { data: similar, error: rpcErr } = await supabase.rpc('match_deals', {
    query_embedding: queryEmbedding,
    exclude_id: params.id,
    match_count: 8,
  })

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 })
  }

  return NextResponse.json({ results: similar ?? [] })
}
