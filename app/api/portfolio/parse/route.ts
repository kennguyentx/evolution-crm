import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You extract financial data from P&L statements and management accounts.

Return a JSON array — one object per time period found. If multiple months/quarters are columns, extract each one separately.

IMPORTANT: Return ONLY raw valid JSON. No markdown, no explanation, no trailing commas.

Each period object:
{
  "period_end": "YYYY-MM-DD",
  "period_type": "monthly",
  "revenue": 4200000,
  "gross_profit": null,
  "ebitda": 800000,
  "ebit": null,
  "net_income": null,
  "revenue_budget": null,
  "ebitda_budget": null,
  "revenue_py": null,
  "ebitda_py": null,
  "backlog": null,
  "ar_balance": null,
  "debt_balance": null,
  "headcount": null,
  "commentary": null
}

Rules:
- All numeric values in raw dollars (4200000 not 4.2M)
- Use null for missing values, never omit keys
- period_end = last day of the month/quarter (e.g. 2024-01-31 for January 2024)
- Skip YTD/Total columns — only individual periods
- Do not estimate — only extract what is explicitly stated`

function repairJson(str: string): string {
  // Remove trailing commas before ] or }
  return str
    .replace(/,(\s*[\]\}])/g, '$1')
    .replace(/:\s*undefined/g, ': null')
    .replace(/:\s*NaN/g, ': null')
    .replace(/:\s*Infinity/g, ': null')
}

export async function POST(req: NextRequest) {
  try {
    const { base64, fileName, companyName, csvText } = await req.json()
    const isSpreadsheet = fileName?.match(/\.(xlsx|xls|csv)$/i)

    let messageContent: any[]

    if (isSpreadsheet && csvText) {
      messageContent = [{
        type: 'text',
        text: `Extract all monthly/quarterly financial periods from this ${companyName} spreadsheet. Months are likely columns, line items are rows. Return one JSON object per time period column. Skip any totals or YTD columns.\n\nData:\n${csvText.slice(0, 12000)}`
      }]
    } else {
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Extract all financial periods from this ${companyName} report. Return a JSON array.` }
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
      .replace(/```json|```/g, '')
      .trim()

    // Find JSON array or object
    const arrayMatch = raw.match(/\[[\s\S]*\]/)
    const objectMatch = raw.match(/\{[\s\S]*\}/)
    let jsonStr = arrayMatch ? arrayMatch[0] : objectMatch ? objectMatch[0] : null

    if (!jsonStr) throw new Error('No JSON found in response')

    // Repair common JSON issues
    jsonStr = repairJson(jsonStr)

    let parsed: any
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      // Last resort: try to extract just valid objects
      const objects = Array.from(jsonStr.matchAll(/\{[^{}]*\}/g)).map(m => {
        try { return JSON.parse(repairJson(m[0])) } catch { return null }
      }).filter(Boolean)
      if (!objects.length) throw new Error('Could not parse financial data from document')
      parsed = objects
    }

    const result = Array.isArray(parsed) ? parsed : [parsed]
    return NextResponse.json({ periods: result, count: result.length })
  } catch (err: any) {
    console.error('Portfolio parse error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
