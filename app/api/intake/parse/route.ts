import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const SYSTEM_PROMPT = `You are a private equity deal analyst at an independent sponsor firm focused on infrastructure and industrial services businesses. You extract deal data from teasers and CIMs (Confidential Information Memoranda).

Extract the following and respond ONLY with valid JSON (no markdown, no explanation):
{
  "company_name": "string — company name",
  "sector": "string — most specific sector: Underground Utilities | Electrical Contracting | Civil / Public Works | Commercial Landscaping | Fiber Optics | HVAC | Plumbing | Industrial Services | Other",
  "geography": "string — primary state(s) or region of operations",
  "description": "string — 1-2 sentence description of the business",
  "revenue": "number in dollars or null — most recent annual revenue",
  "ebitda": "number in dollars or null — most recent annual EBITDA (use adjusted/normalized if available)",
  "asking_price": "number in dollars or null — stated asking price or EV",
  "ev_ebitda_multiple": "number or null — implied EV/EBITDA multiple",
  "deal_type": "platform | add-on | recap | growth",
  "source_notes": "string — investment bank or advisor name if mentioned",
  "cim_summary": "string — 3-4 sentence executive summary covering: what the company does, why it's attractive, key financial profile, and any notable risks or considerations"
}

For dollar values: always return as raw numbers (e.g. 4200000 for $4.2M).
If a field cannot be determined, return null.
Be conservative — only extract what is clearly stated.`

export async function POST(req: NextRequest) {
  try {
    const { base64, fileName } = await req.json()

    if (!base64) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            {
              type: 'text',
              text: `Extract deal data from this document (${fileName}). Return only valid JSON.`,
            },
          ],
        },
      ],
    })

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim()

    const parsed = JSON.parse(text)
    return NextResponse.json(parsed)
  } catch (err: any) {
    console.error('CIM parse error:', err)
    return NextResponse.json(
      { error: err.message || 'Parse failed' },
      { status: 500 }
    )
  }
}
