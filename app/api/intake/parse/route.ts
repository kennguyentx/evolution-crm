import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You extract factual deal data from teasers and CIMs. Return ONLY valid JSON, no markdown, no explanation, no opinions.

{
  "company_name": "string — exact company name as stated",
  "sector": "string — one of: Underground Utilities | Electrical Contracting | Civil / Public Works | Commercial Landscaping | Fiber Optics | HVAC | Plumbing | Industrial Services | Environmental Services | Construction & Engineering | Other",
  "geography": "string — primary state(s) or region of operations as stated in the document",
  "deal_type": "string — one of: platform | add-on | recap | growth",
  "revenue": "number in raw dollars or null — most recent annual revenue as stated",
  "ebitda": "number in raw dollars or null — most recent annual EBITDA (use adjusted/normalized if explicitly stated)",
  "cim_summary": "string — 3-5 factual sentences describing: what the company does, where it operates, its financial profile, and ownership/transaction context. State only facts from the document. No opinions, no qualitative assessments, no phrases like 'attractive', 'compelling', 'strong', 'impressive', or 'unique'.",
  "banker_name": "string or null — full name of the investment banker or broker as stated",
  "banker_firm": "string or null — name of the investment bank or advisory firm as stated"
}

Rules:
- Dollar values as raw numbers (4200000 for $4.2M)
- If a field is not stated in the document, return null
- Do not infer or estimate values not explicitly stated
- The summary must be purely factual — no adjectives that express quality or opinion`

export async function POST(req: NextRequest) {
  try {
    const { base64, fileName } = await req.json()
    if (!base64) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: `Extract deal data from this document (${fileName}). Return only valid JSON.` },
        ],
      }],
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
    return NextResponse.json({ error: err.message || 'Parse failed' }, { status: 500 })
  }
}
