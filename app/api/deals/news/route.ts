// app/api/deals/news/route.ts
// Pulls recent news, industry research, and market intel for a deal
// using Claude with web search — mirrors the M&A comps pattern.

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { AI_MODELS } from '@/lib/ai-config'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  try {
    const { company_name, sector, geography, deal_type, parent_portco } = await req.json()
    if (!sector && !company_name) {
      return NextResponse.json({ error: 'Need at least sector or company name' }, { status: 400 })
    }

    const geoContext  = geography || 'United States'
    const isAddon     = deal_type === 'add-on'
    const portcoCtx   = isAddon && parent_portco ? ` (potential add-on for ${parent_portco})` : ''

    return NextResponse.json(await fetchNews({ company_name, sector, geoContext, portcoCtx }))
  } catch (err: any) {
    console.error('[news] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function fetchNews({ company_name, sector, geoContext, portcoCtx }: {
  company_name?: string
  sector?: string
  geoContext: string
  portcoCtx: string
}) {
  const resp = await anthropic.messages.create({
    model: AI_MODELS.balanced,
    max_tokens: 4000,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search',
    } as any],
    messages: [{
      role: 'user',
      content: `You are a research analyst at Evolution Strategy, a lower middle market PE firm focused on infrastructure services.

Gather recent news and market intelligence for this deal target:
- Company: ${company_name || 'Unknown'}
- Sector: ${sector || 'infrastructure services'}
- Geography: ${geoContext}${portcoCtx}

Search for the following (run multiple searches):
1. **Company news** (if company name is real/specific): recent news about ${company_name || 'the company'} — growth, contracts, leadership, issues
2. **Sector news**: recent trends, consolidation, regulatory changes, labor market, pricing dynamics in ${sector || 'infrastructure services'} in ${geoContext}
3. **PE activity**: recent private equity investments, platform builds, add-on acquisitions in the ${sector || 'infrastructure services'} sector
4. **Market research**: industry reports, market size, growth forecasts for ${sector || 'infrastructure services'}

Focus on the last 18 months. Prefer primary sources (trade publications, press releases, industry associations) over generic aggregators.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "articles": [
    {
      "title": "Article title",
      "source": "Publication name",
      "date": "Month YYYY or YYYY-MM-DD",
      "url": "https://...",
      "summary": "1-2 sentence factual summary of what this says and why it's relevant",
      "category": "company | sector_news | pe_activity | market_research",
      "sentiment": "positive | negative | neutral"
    }
  ],
  "market_notes": "2-3 sentence synthesis: what the research tells you about this sector right now, key tailwinds/headwinds, and PE appetite"
}

Include 6-12 articles total. Skip articles older than 3 years. If company name is generic or unknown, skip company-specific search and focus on sector/PE/market items.
Only include articles where you found an actual URL.`,
    }],
  })

  const textBlocks = resp.content.filter((b: any) => b.type === 'text')
  if (!textBlocks.length) throw new Error('No response from AI')

  const raw = (textBlocks[textBlocks.length - 1] as any).text.trim()

  // Claude sometimes wraps in markdown or adds prose before/after the JSON.
  // Extract the outermost { ... } block to be safe.
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON object found in AI response')
  return JSON.parse(jsonMatch[0])
}
