// app/api/deals/share-cim/route.ts
// Generate a concise CIM deal summary via Claude and email it to the team via Postmark

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDropboxToken } from '@/lib/dropbox'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const DBX_CONTENT = 'https://content.dropboxapi.com/2'
const DBX_API    = 'https://api.dropboxapi.com/2'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body
    if (action === 'preview') return await generatePreview(body)
    if (action === 'send')    return await sendEmail(body)
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    console.error('[share-cim] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Preview: Claude generates the concise summary ─────────────────────────────
async function generatePreview(body: any) {
  const {
    company_name, sector, geography, revenue, ebitda,
    description, cim_summary, financial_summary,
    historical_financials, customer_concentration, employee_count,
    key_risks, growth_opportunities, management_team,
    banker_name, banker_firm, deal_type, asking_price, asking_multiple,
  } = body

  const revenueStr  = revenue       ? `$${(revenue       / 1e6).toFixed(1)}M` : null
  const ebitdaStr   = ebitda        ? `$${(ebitda        / 1e6).toFixed(1)}M` : null
  const marginStr   = revenue && ebitda ? `${((ebitda / revenue) * 100).toFixed(1)}%` : null
  const askingStr   = asking_price  ? `$${(asking_price  / 1e6).toFixed(1)}M` : null
  const multipleStr = asking_multiple ? `${asking_multiple.toFixed(1)}x EBITDA` : null

  // Format historical financials as a readable table for the prompt
  const histTable = (historical_financials as any[] | null | undefined)?.length
    ? (historical_financials as any[]).map((h: any) => {
        const rev  = h.revenue ? `$${(h.revenue / 1e6).toFixed(1)}M rev` : 'N/A rev'
        const ebit = h.ebitda  ? `$${(h.ebitda  / 1e6).toFixed(1)}M EBITDA` : 'N/A EBITDA'
        const mgn  = h.ebitda_margin != null
          ? `${(h.ebitda_margin * 100).toFixed(1)}% margin`
          : (h.revenue && h.ebitda ? `${((h.ebitda / h.revenue) * 100).toFixed(1)}% margin` : '')
        return `  ${h.year}: ${rev} / ${ebit}${mgn ? ` / ${mgn}` : ''}`
      }).join('\n')
    : null

  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `You are a private equity analyst at Evolution Strategy, a lower middle market PE firm focused on infrastructure services. Produce a structured internal deal overview to share with the investment team.

SOURCE DATA — use exactly what is provided; do not invent anything:
Company: ${company_name || 'Unknown'}
Type: ${deal_type || 'platform'}
Sector: ${sector || 'infrastructure services'}
Geography: ${geography || 'Not specified'}
LTM Revenue: ${revenueStr || 'Not disclosed'}
LTM EBITDA: ${ebitdaStr || 'Not disclosed'}
LTM Margin: ${marginStr || 'Not disclosed'}
Asking Price: ${askingStr || 'Not disclosed'}
Asking Multiple: ${multipleStr || 'Not disclosed'}
Historical Financials (structured):
${histTable || '  Not available — use Financial Summary text if helpful'}
Financial Summary (narrative): ${financial_summary || 'N/A'}
Customer Concentration: ${customer_concentration || 'Not specified — check CIM Summary'}
Employee Count: ${employee_count ?? 'Not specified — check CIM Summary'}
CIM Summary (full text — mine this for any data not in fields above): ${cim_summary || 'N/A'}
Description: ${description || 'N/A'}
Key Risks: ${key_risks?.join(' | ') || 'N/A'}
Growth Opportunities: ${growth_opportunities?.join(' | ') || 'N/A'}
Management Team: ${management_team?.map((m: any) => `${m.name}, ${m.title}`).join(' | ') || 'N/A'}
Banker: ${[banker_name, banker_firm].filter(Boolean).join(', ') || 'Not specified'}

OUTPUT FORMAT — plain text, exactly this structure, no markdown, no asterisks, no extra commentary:

BUSINESS
[2–3 sentences: what the company does, specific services or end markets, operating states/regions, years in business or founding if mentioned]

FINANCIALS
[Present as a labeled table using tabs/spacing, e.g.:
  Revenue:  $Xm (20XX) / $Xm (20XX) / $Xm (LTM)
  EBITDA:   $Xm / $Xm / $Xm
  Margin:   X% / X% / X%
  Asking:   $Xm at X.Xx EBITDA
Extract 2–3 years of data from financial_summary or cim_summary if available. If only one year is available, show it. Use "N/A" for fields with no data.]

OPERATIONS
[Labeled lines only — omit any line where data is not available:
  Geography:    [specific states or metros, not just "United States"]
  Customers:    [concentration data, e.g. "Top customer ~15% of revenue; no single customer >20%"]
  Employees:    [headcount or "N/A"]
  Fleet/Assets: [if mentioned]
  Services:     [key service lines, one line]
  End Markets:  [who they serve — municipal, commercial, industrial, etc.]]

CONSIDERATIONS
[3–5 short lines, each starting with + for a positive or - for a risk. Pull from key_risks, growth_opportunities, and any qualitative notes in cim_summary. Factual only — no adjectives like "strong" or "solid".]

PROCESS
[One line: banker/source, any process info such as deadline, LOI date, auction vs. proprietary. If unknown, write "Process details not provided."]

Rules: Only include data that appears in the source. Do not invent numbers or facts. If a section has no data, write "N/A" after the header. Keep each section tight.`,
    }],
  })

  const textBlock = resp.content.find((b: any) => b.type === 'text') as any
  const summary = textBlock?.text?.trim() || ''
  return NextResponse.json({ summary })
}

// ── Send: Postmark with optional Dropbox CIM attachment ───────────────────────
async function sendEmail(body: any) {
  const { summary, recipients, company_name, sector, dropbox_folder } = body

  if (!summary || !recipients?.length) {
    return NextResponse.json({ error: 'summary and recipients are required' }, { status: 400 })
  }

  const serverToken = process.env.POSTMARK_SERVER_TOKEN
  const fromEmail   = process.env.FROM_EMAIL || process.env.POSTMARK_FROM_EMAIL || 'deals@evolutionstrategy.com'

  if (!serverToken) {
    return NextResponse.json({ error: 'POSTMARK_SERVER_TOKEN not configured in environment' }, { status: 500 })
  }

  // Try to find and attach CIM PDF from Dropbox
  const attachments: any[] = []
  if (dropbox_folder) {
    try {
      const token = await getDropboxToken()

      const listRes = await fetch(`${DBX_API}/files/list_folder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dropbox_folder, recursive: false }),
      })

      if (listRes.ok) {
        const listData = await listRes.json()
        const files: any[] = listData.entries || []

        // Prefer a file named "CIM" or "Confidential"; fall back to any PDF
        const cimFile =
          files.find((f: any) =>
            f['.tag'] === 'file' &&
            f.name.toLowerCase().endsWith('.pdf') &&
            /cim|confidential information memorandum/i.test(f.name)
          ) ||
          files.find((f: any) => f['.tag'] === 'file' && f.name.toLowerCase().endsWith('.pdf'))

        if (cimFile) {
          console.log(`[share-cim] Attaching CIM: ${cimFile.name}`)
          const dlRes = await fetch(`${DBX_CONTENT}/files/download`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Dropbox-API-Arg': JSON.stringify({ path: cimFile.path_lower }),
            },
          })
          if (dlRes.ok) {
            const buf = await dlRes.arrayBuffer()
            attachments.push({
              Name: cimFile.name,
              Content: Buffer.from(buf).toString('base64'),
              ContentType: 'application/pdf',
            })
          } else {
            console.warn('[share-cim] Dropbox download failed:', await dlRes.text())
          }
        } else {
          console.warn('[share-cim] No PDF found in Dropbox folder:', dropbox_folder)
        }
      }
    } catch (e: any) {
      console.warn('[share-cim] Dropbox attachment failed:', e?.message)
      // Don't block the send — just send without attachment
    }
  }

  const subject = `Deal: ${company_name || 'New Deal'} — ${sector || 'Infrastructure Services'}`

  const postmarkPayload: any = {
    From: fromEmail,
    To: recipients.join(', '),
    Subject: subject,
    TextBody: summary,
    MessageStream: 'outbound',
  }
  if (attachments.length) postmarkPayload.Attachments = attachments

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': serverToken,
    },
    body: JSON.stringify(postmarkPayload),
  })

  const result = await res.json()
  if (!res.ok) {
    console.error('[share-cim] Postmark error:', result)
    return NextResponse.json({ error: result.Message || 'Postmark send failed' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message_id: result.MessageID,
    cim_attached: attachments.length > 0,
  })
}
