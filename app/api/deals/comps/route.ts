// app/api/deals/comps/route.ts
// Pulls M&A transaction comps for a deal using web search + Claude

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { company_name, sector, geography, ebitda, revenue } = await req.json()
    if (!sector && !company_name) {
      return NextResponse.json({ error: 'Need at least sector or company name' }, { status: 400 })
    }

    const ebitdaStr = ebitda ? `$${(ebitda / 1e6).toFixed(1)}M EBITDA` : ''
    const revStr = revenue ? `$${(revenue / 1e6).toFixed(1)}M revenue` : ''
    const sizeContext = [ebitdaStr, revStr].filter(Boolean).join(', ')
    const geoContext = geography || 'United States'

    const searchQuery = [
      sector,
      'M&A acquisition transaction',
      geography || 'United States',
      sizeContext ? `similar size ${sizeContext}` : 'lower middle market',
      'EV EBITDA multiple',
    ].filter(Boolean).join(' ')

    // Use Claude with web search tool
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
      } as any],
      messages: [{
        role: 'user',
        content: `You are a private equity analyst at Evolution Strategy, a lower middle market PE firm focused on infrastructure services businesses.

Find M&A transaction comps for this target:
- Company: ${company_name || 'Unknown'}
- Sector: ${sector || 'infrastructure services'}
- Geography: ${geoContext}
- Size: ${sizeContext || 'lower middle market, $3-7M EBITDA'}

Search for publicly reported M&A transactions in the ${sector || 'infrastructure services'} sector. Look for:
1. Acquisitions of similar businesses (same sector, similar size)
2. PE platform and add-on acquisitions
3. Strategic acquirer deals
4. Transactions from the last 5 years preferred, older if relevant

For each comp found, extract:
- Target company name
- Acquirer name
- Financial sponsor / PE firm (if any)
- Transaction EV (enterprise value)
- Revenue at time of deal
- EBITDA at time of deal
- Implied EV/EBITDA multiple
- Implied EV/Revenue multiple
- Geography
- Transaction date (year)
- Source URL

Search multiple queries to find as many relevant comps as possible. Aim for 5-10 comps.

After searching, return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "comps": [
    {
      "target": "Company name",
      "acquirer": "Acquirer name",
      "sponsor": "PE firm or null",
      "ev": 45000000,
      "revenue": 30000000,
      "ebitda": 5000000,
      "ev_ebitda": 9.0,
      "ev_revenue": 1.5,
      "geography": "Texas, USA",
      "year": 2023,
      "source_url": "https://...",
      "source_name": "PE Hub"
    }
  ],
  "search_notes": "Brief note on search methodology and data quality"
}

Use null for any field not found. Only include comps where you found at least the target name and some financial data.`
      }]
    })

    // Extract the final text response (after tool use)
    const textBlocks = resp.content.filter((b: any) => b.type === 'text')
    if (!textBlocks.length) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    const raw = textBlocks[textBlocks.length - 1].text.trim()

    // Parse JSON — strip any markdown fences
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(clean)

    return NextResponse.json(parsed)
  } catch (err: any) {
    console.error('Comps error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
