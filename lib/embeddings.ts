// lib/embeddings.ts
// OpenAI text-embedding-3-small (1536d) — used for semantic "similar deals" search.
// Calls the REST API directly so no openai package is needed.

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings'
const MODEL = 'text-embedding-3-small'

export async function embed(text: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set')

  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: text.slice(0, 8000) }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI embeddings error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.data[0].embedding as number[]
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
