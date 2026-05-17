import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You extract financial data from P&L statements, financial reports, and management accounts. Return ONLY valid JSON, no markdown, no explanation.

{
  "period_end": "YYYY-MM-DD — last day of the reporting period",
  "period_type": "monthly | quarterly | annual",
  "revenue": "number in raw dollars or null",
  "gross_profit": "number in raw dollars or null",
  "ebitda": "number in raw dollars or null",
  "ebit": "number in raw dollars or null",
  "net_income": "number in raw dollars or null",
  "revenue_budget": "number in raw dollars or null — budget/plan revenue if shown",
  "ebitda_budget": "number in raw dollars or null — budget/plan EBITDA if shown",
  "revenue_py": "number in raw dollars or null — prior year revenue if shown",
  "ebitda_py": "number in raw dollars or null — prior year EBITDA if shown",
  "backlog": "number in raw dollars or null — backlog or pipeline if shown",
  "ar_balance": "number in raw dollars or null — accounts receivable if shown",
  "debt_balance": "number in raw dollars or null — total debt if shown",
  "headcount": "integer or null — employee count if shown",
  "commentary": "string or null — any management commentary or notes found in the document"
}

Rules:
- All dollar values as raw numbers (4200000 for $4.2M)
- Return null for anything not explicitly stated
- For period_end, use the last day of the reporting month/quarter/year
- Do not infer or estimate — only extract what is explicitly stated`

export async function POST(req: NextRequest) {
  try {
    const { base64, mediaType, fileName, companyName, csvText } = await req.json()
    const isSpreadsheet = fileName?.match(/\.(xlsx|xls|csv)$/i)

    let messageContent: any[]

    if (isSpreadsheet && csvText) {
      // Excel/CSV — send as text
      messageContent = [{
        type: 'text',
        text: `Extract financial data from this ${companyName} spreadsheet (${fileName}). Return only valid JSON.\n\nSpreadsheet contents:\n${csvText.slice(0, 8000)}`
      }]
    } else {
      // PDF — send as document
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Extract financial data from this ${companyName} report (${fileName}). Return only valid JSON.` }
      ]
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }]
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
    console.error('Portfolio parse error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
