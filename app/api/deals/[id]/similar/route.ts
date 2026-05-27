// app/api/deals/[id]/similar/route.ts
// GET — return deals similar to the given deal using structured field scoring.
// Scores by sector (40%), geography (20%), deal_type (20%), EBITDA range (20%).
// No external API needed.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = serviceClient()

  const { data: deal, error } = await supabase
    .from('deals')
    .select('sector, geography, deal_type, ebitda')
    .eq('id', params.id)
    .single()

  if (error || !deal) {
    return NextResponse.json({ error: error?.message ?? 'Deal not found' }, { status: 404 })
  }

  // Fetch all other active deals (exclude passes and closed)
  const { data: candidates, error: listErr } = await supabase
    .from('deals')
    .select('id, company_name, sector, geography, deal_type, stage, status, ebitda, revenue, description')
    .neq('id', params.id)
    .not('status', 'in', '("Dead","Pass")')
    .limit(200)

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 })
  }

  const scored = (candidates ?? [])
    .map(d => {
      let score = 0
      if (deal.sector    && d.sector    === deal.sector)    score += 0.4
      if (deal.geography && d.geography === deal.geography) score += 0.2
      if (deal.deal_type && d.deal_type === deal.deal_type) score += 0.2
      if (deal.ebitda && d.ebitda) {
        const ratio = d.ebitda / deal.ebitda
        if (ratio >= 0.25 && ratio <= 4) score += 0.2
      }
      return { ...d, similarity: score }
    })
    .filter(d => d.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 8)

  return NextResponse.json({ results: scored })
}
