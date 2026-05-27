// lib/embeddings.ts
// Embedding utilities for semantic "similar deals" search.
// Uses the Supabase Edge Function `embed` which runs gte-small (384-dim)
// locally on Supabase's infrastructure — no external API key needed.

import { SupabaseClient } from '@supabase/supabase-js'

/** Call the `embed` Edge Function to get a 384-dim vector for the given text. */
export async function embed(text: string, supabase: SupabaseClient): Promise<number[]> {
  const { data, error } = await supabase.functions.invoke('embed', {
    body: { text },
  })
  if (error) throw new Error(`embed edge function error: ${error.message}`)
  if (!Array.isArray(data?.embedding)) throw new Error('embed edge function returned no embedding')
  return data.embedding as number[]
}

/** Format a number[] for Postgres pgvector literal: '[0.1,0.2,...]' */
export function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

/** Build the text blob that represents a deal for embedding. */
export function dealTextBlob(deal: {
  company_name?: string | null
  sector?: string | null
  geography?: string | null
  deal_type?: string | null
  description?: string | null
  financial_summary?: string | null
  revenue?: number | null
  ebitda?: number | null
}): string {
  const parts: string[] = []

  const header = [deal.company_name, deal.deal_type, deal.sector, deal.geography]
    .filter(Boolean).join(' · ')
  if (header) parts.push(header)

  if (deal.description)       parts.push(deal.description)
  if (deal.financial_summary) parts.push(deal.financial_summary)

  const fins: string[] = []
  if (deal.revenue) fins.push(`Revenue $${(deal.revenue / 1e6).toFixed(1)}M`)
  if (deal.ebitda)  fins.push(`EBITDA $${(deal.ebitda  / 1e6).toFixed(1)}M`)
  if (fins.length)  parts.push(fins.join(', '))

  return parts.join('\n')
}
