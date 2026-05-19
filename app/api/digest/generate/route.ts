import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  try {
    const { deals } = await req.json()
    const activeDeals = deals.filter((d: any) => d.status === 'Active')
    const closedDeals = deals.filter((d: any) => d.status === 'Closed')
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recentlyUpdated = deals.filter((d: any) => new Date(d.updated_at) > weekAgo)

    const dealSummary = activeDeals.map((d: any) =>
      `- ${d.company_name} | ${d.stage} | ${d.sector || 'Unknown sector'} | EBITDA: ${d.ebitda ? '$' + (d.ebitda/1e6).toFixed(1)+'M' : 'unknown'}`
    ).join('\n')

    const prompt = `You are writing a weekly pipeline update for Evolution Strategy, an independent sponsor focused on infrastructure and industrial services (utilities contracting, electrical, civil, fiber, landscaping).

Here is the current deal data:

ACTIVE PIPELINE (${activeDeals.length} deals):
${dealSummary || 'No active deals'}

RECENTLY UPDATED (last 7 days): ${recentlyUpdated.length} deals
TOTAL CLOSED: ${closedDeals.length}

Write a concise, professional weekly digest in Discord-friendly markdown format. Include:
1. **📊 Week Summary** — 2-3 sentence overview of pipeline health
2. **🔥 Advanced Stage** — highlight any deals at LOI, Diligence, or Closing
3. **📥 New Sourcing** — deals added at Sourced/Reviewing
4. **📋 Pipeline Stats** — quick table of count by stage
5. **⚡ Action Items** — 2-3 suggested next steps based on deal positions

Keep it sharp, data-focused, and useful for a 3-person deal team. Use plain business language.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })

    const digest = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    return NextResponse.json({ digest })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
