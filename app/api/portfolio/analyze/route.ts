import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { AI_MODELS } from '@/lib/ai-config'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  try {
    const { company, sector, financials } = await req.json()

    const response = await anthropic.messages.create({
      model: AI_MODELS.balanced,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are a private equity analyst reviewing portfolio company performance. Analyze the following financial data for ${company} (${sector}) and provide a concise, factual analysis.

Financial data (most recent periods):
${JSON.stringify(financials, null, 2)}

Provide:
1. **Revenue Trend** — direction and magnitude, any acceleration or deceleration
2. **EBITDA & Margin Trend** — expansion or compression, key drivers if commentary available
3. **Budget Performance** — tracking above/below, consistency
4. **Year-over-Year** — growth or decline vs prior year
5. **Backlog / Pipeline** — if data available, what it signals
6. **Key Risks or Watch Items** — based on the data patterns
7. **Overall Assessment** — 2-3 sentences on company health and trajectory

Be direct and specific. Use numbers. Flag any concerning trends clearly. No filler language.`,
      }],
    })

    const analysis = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    return NextResponse.json({ analysis })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
