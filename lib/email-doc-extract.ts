// Document extraction for email intake — extracted verbatim from
// app/api/notes/email/route.ts (review item 15, behavior-preserving split).
// DOCX text extraction, the teaser/CIM extraction prompt, and the
// per-attachment Claude call live here; the route keeps orchestration.

import Anthropic from '@anthropic-ai/sdk'
import { parseAiJson, extractText } from '@/lib/ai-json'
import { AI_MODELS } from '@/lib/ai-config'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── DOCX text extraction ─────────────────────────────────────────────────────
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) return ''
  return xml
    .replace(/<w:br[^/]*/g, '\n')
    .replace(/<w:p[ >][^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Document extraction prompt ───────────────────────────────────────────────
export const DOC_SYSTEM_PROMPT = `You extract deal data from teasers and CIMs forwarded via email. Return ONLY valid JSON.

{
  "doc_type": "teaser | cim | nda | other",
  "company_name": "string or null",
  "sector": "string — closest match from: Underground Utilities | Electrical Contracting | Civil / Public Works | Commercial Landscaping | Fiber Optics | HVAC | Plumbing | Industrial Services | Environmental Services | Construction & Engineering. If none fit, short descriptive name.",
  "geography": "string or null — primary state(s) or region",
  "deal_type": "platform | add-on | recap | growth",
  "revenue": "number in raw dollars or null — use the most recent / LTM figure",
  "ebitda": "number in raw dollars or null — use the most recent / LTM figure",
  "description": "string — 2-4 factual sentences about the business. No opinions or qualitative assessments.",
  "financial_summary": "string or null — 2-3 sentence narrative on margins, growth trend, and any notable items (CIM only)",
  "historical_financials": [
    {
      "year": "string — e.g. '2022', '2023', 'LTM', 'TTM', 'Budget 2025', 'Forecast 2026', 'Proj. 2025'",
      "revenue": "number in raw dollars or null",
      "ebitda": "number in raw dollars or null",
      "ebitda_margin": "number as decimal (0.22 for 22%) or null",
      "is_forecast": "boolean — true if this row is a projection, budget, or forecast; false for actuals and LTM/TTM"
    }
  ],
  "customer_concentration": "string or null — describe top customer %, customer count, or 'no single customer >X%' (CIM only)",
  "employee_count": "integer or null — total headcount if stated",
  "key_risks": ["string array — 3-5 risks (CIM only, else [])"],
  "growth_opportunities": ["string array — 3-5 opportunities (CIM only, else [])"],
  "management_team": [{"name": "string", "title": "string"}],
  "banker_name": "string or null",
  "banker_firm": "string or null",
  "asking_price": "number or null",
  "asking_multiple": "number or null",
  "contacts": [
    {
      "name": "string",
      "firm": "string or null",
      "role": "Source / Banker | Management | Advisor | Lender | Other",
      "title": "string or null",
      "email": "string or null",
      "phone": "string or null"
    }
  ]
}

Rules:
- doc_type: "teaser" = short marketing summary, "cim" = detailed confidential memo, "nda" = non-disclosure agreement, "other" = anything else
- Dollar values as raw numbers (4200000 for $4.2M). If a range is given (e.g. "$4–6M revenue"), use the midpoint (5000000). If described as "approximately $5M" use 5000000.
- historical_financials: extract EVERY row shown in a financial table or summary — historical years, LTM/TTM, AND any projections, budgets, or forecasts. Order chronologically (actuals first, then LTM/TTM, then forecasts). Use [] if only one year is available or this is a teaser. Mark is_forecast=true for any projected/budget/forecast row.
- revenue/ebitda at the top level: always the most recent / LTM figure from historical_financials.
- Null ONLY if no numeric hint is given anywhere in the document — do not leave null if you can infer from context.
- description: purely factual, no adjectives expressing quality.`

// ── Process a single attachment through Claude ────────────────────────────────
export async function processAttachment(
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<any> {
  const isPDF  = contentType.includes('pdf')  || fileName.toLowerCase().endsWith('.pdf')
  const isDOCX = contentType.includes('word') || /\.docx?$/i.test(fileName)

  let messageContent: any[]

  if (isPDF) {
    messageContent = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
        title: fileName,
      },
      { type: 'text', text: `Extract deal data from this document (${fileName}). Return only valid JSON.` },
    ]
  } else if (isDOCX) {
    const text = await extractDocxText(buffer)
    messageContent = [
      { type: 'text', text: `DOCUMENT (${fileName}):\n${text}` },
      { type: 'text', text: 'Extract deal data from the document above. Return only valid JSON.' },
    ]
  } else {
    return null // unsupported type
  }

  const response = await anthropic.messages.create({
    model: AI_MODELS.powerful,
    max_tokens: 3000,
    system: DOC_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: messageContent }],
  })

  return parseAiJson(extractText(response.content as any))
}
