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
    key_risks, growth_opportunities, management_team, banker_firm, deal_type,
  } = body

  const revenueStr = revenue ? `$${(revenue / 1e6).toFixed(1)}M` : null
  const ebitdaStr  = ebitda  ? `$${(ebitda  / 1e6).toFixed(1)}M` : null
  const marginStr  = revenue && ebitda ? `${((ebitda / revenue) * 100).toFixed(1)}%` : null

  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are a private equity analyst at Evolution Strategy, a lower middle market PE firm focused on infrastructure services. Write a concise deal summary email to share internally with the investment team.

Deal info:
- Company: ${company_name || 'Unknown'}
- Type: ${deal_type || 'platform'}
- Sector: ${sector || 'infrastructure services'}
- Geography: ${geography || 'United States'}
- Revenue: ${revenueStr || 'Not disclosed'}
- EBITDA: ${ebitdaStr || 'Not disclosed'}
- EBITDA Margin: ${marginStr || 'Not disclosed'}
- Description: ${description || 'Not available'}
- CIM Summary: ${cim_summary || 'Not available'}
- Financial Summary: ${financial_summary || 'Not available'}
- Key Risks: ${key_risks?.join('; ') || 'Not extracted'}
- Growth Opportunities: ${growth_opportunities?.join('; ') || 'Not extracted'}
- Management Team: ${management_team?.map((m: any) => `${m.name} (${m.title})`).join(', ') || 'Not extracted'}
- Banker/Source: ${banker_firm || 'Not specified'}

Write a short, professional email body — no subject line, no greeting, no sign-off. Structure:
1. One paragraph: what the business does, sector, geography
2. Financial snapshot: Revenue, EBITDA, margin (numbers only, concise)
3. 2–3 short bullets on key highlights or risks worth noting
4. One line on banker / process / source

Keep it under 200 words. Factual and direct. No fluff or adjectives. Plain text only — no markdown, no asterisks, no headers.`,
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
