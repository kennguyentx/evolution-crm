import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You extract financial data from P&L statements and management accounts. 

If the document has multiple time periods (months/quarters as columns), extract ALL of them and return an array.
If it's a single period, return an array with one object.

CRITICAL: Your entire response must be ONLY the JSON array. Start your response with [ and end with ]. No other text, no explanation, no preamble:

[
  {
    "period_end": "YYYY-MM-DD — last day of that month/quarter",
    "period_type": "monthly | quarterly | annual",
    "revenue": "number in raw dollars or null — total revenue/sales for that period",
    "gross_profit": "number in raw dollars or null — gross profit for that period",
    "ebitda": "number in raw dollars or null — EBITDA for that period (calculate if not explicit: gross profit minus SG&A/overhead if shown)",
    "ebit": "number in raw dollars or null",
    "net_income": "number in raw dollars or null",
    "revenue_budget": "number in raw dollars or null — budget/plan revenue if shown for that period",
    "ebitda_budget": "number in raw dollars or null — budget/plan EBITDA if shown",
    "revenue_py": "number in raw dollars or null — prior year revenue if shown",
    "ebitda_py": "number in raw dollars or null — prior year EBITDA if shown",
    "backlog": "number in raw dollars or null",
    "ar_balance": "number in raw dollars or null",
    "debt_balance": "number in raw dollars or null",
    "headcount": "integer or null",
    "commentary": "string or null — any notes for this period"
  }
]

Rules:
- Return ALL periods found in the document, not just the most recent
- Dollar values as raw numbers (4200000 for $4.2M)
- If columns are months, each month = one object in the array
- Return null for anything not explicitly stated
- Do NOT include YTD totals as a period — only include actual time periods
- Do not infer or estimate`

export async function POST(req: NextRequest) {
  try {
    const { base64, mediaType, fileName, companyName, csvText } = await req.json()
    const isSpreadsheet = fileName?.match(/\.(xlsx|xls|csv)$/i)

    let messageContent: any[]

    if (isSpreadsheet && csvText) {
      messageContent = [{
        type: 'text',
        text: `Extract ALL monthly/quarterly financial periods from this ${companyName} spreadsheet (${fileName}). The spreadsheet likely has months as columns and line items as rows. Extract every column that represents a time period. Return a JSON array with one object per period.\n\nSpreadsheet contents:\n${csvText.slice(0, 12000)}`
      }]
    } else {
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Extract ALL financial periods from this ${companyName} report (${fileName}). Return a JSON array with one object per period.` }
      ]
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }]
    })

    const raw = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    // Extract JSON from response — handle array or object, and extra text
    const clean = raw.replace(/```json|```/g, '').trim()
    const arrayMatch = clean.match(/\[[\s\S]*\]/)
    const objectMatch = clean.match(/\{[\s\S]*\}/)
    const jsonStr = arrayMatch ? arrayMatch[0] : objectMatch ? objectMatch[0] : null
    if (!jsonStr) throw new Error('No JSON found in response')
    const parsed = JSON.parse(jsonStr)
    // Normalize — always return array
    const result = Array.isArray(parsed) ? parsed : [parsed]
    return NextResponse.json({ periods: result, count: result.length })
  } catch (err: any) {
    console.error('Portfolio parse error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
