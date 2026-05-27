// app/api/pipeline/weekly-email/route.ts
// Weekly deal pipeline email — fired by Vercel Cron every Monday 8am ET
// Also accepts POST for manual sends from the UI

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getRecipients } from '@/lib/notify-config'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const maxDuration = 30

const STAGES = ['Exclusivity', 'LOI Submitted', 'Pre-LOI', 'Reviewing', 'Teaser']
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://nexus.evolutionstrategy.com'
const STALE_DAYS = 14

// ── GET — Vercel Cron ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET not set' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runSend()
}

// ── POST — manual trigger from UI (requires valid Supabase session) ───────────
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return runSend()
}

// ── PUT — update recipients list ─────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const { recipients } = await req.json()
  if (!Array.isArray(recipients)) {
    return NextResponse.json({ error: 'recipients must be an array' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: 'pipeline_email_recipients', value: recipients, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// ── Core send logic ───────────────────────────────────────────────────────────
async function runSend() {
  // 1. Recipients
  const recipients = await getRecipients('pipeline_email_recipients')
  if (!recipients.length) {
    return NextResponse.json({ error: 'No recipients configured' }, { status: 400 })
  }

  const serverToken = process.env.POSTMARK_SERVER_TOKEN
  if (!serverToken) {
    return NextResponse.json({ error: 'POSTMARK_SERVER_TOKEN not configured' }, { status: 500 })
  }

  // 2. Fetch active pipeline deals
  // Strip unknown columns one at a time until the query succeeds.
  // This handles schema lag where new columns haven't been migrated yet.
  const OPTIONAL_COLS = ['loi_date', 'asking_multiple', 'asking_price']
  const REQUIRED_COLS = 'id, company_name, stage, sector, geography, revenue, ebitda, deal_type, description, updated_at'

  let deals: any[] | null = null
  let dealsErr: any = null
  let activeCols = [...OPTIONAL_COLS]

  for (let attempt = 0; attempt <= OPTIONAL_COLS.length; attempt++) {
    const select = activeCols.length
      ? `${REQUIRED_COLS}, ${activeCols.join(', ')}`
      : REQUIRED_COLS
    const { data, error } = await supabaseAdmin
      .from('deals')
      .select(select)
      .in('stage', STAGES)
      .order('stage')
      .order('updated_at', { ascending: false })

    if (!error) { deals = data; break }

    // If it's a missing-column error, drop the offending column and retry
    if (error.code === '42703') {
      const match = error.message?.match(/column deals\.(\w+) does not exist/i)
        ?? error.message?.match(/column "(\w+)" does not exist/i)
      const bad = match?.[1]
      if (bad && activeCols.includes(bad)) {
        console.warn(`[pipeline-email] Column "${bad}" missing — retrying without it`)
        activeCols = activeCols.filter(c => c !== bad)
        continue
      }
    }
    dealsErr = error
    break
  }

  if (dealsErr || !deals) {
    console.error('[pipeline-email] deals fetch error:', dealsErr?.message)
    return NextResponse.json({ error: `Failed to fetch deals: ${dealsErr?.message || 'unknown'}` }, { status: 500 })
  }

  // 3. Source contacts per deal
  const contactsByDeal: Record<string, any[]> = {}
  if (deals.length > 0) {
    const { data: links } = await supabaseAdmin
      .from('contact_deal_links')
      .select('deal_id, contact:contacts(first_name, last_name, firm)')
      .in('deal_id', deals.map(d => d.id))
      .eq('role', 'Source / Banker')
    ;(links || []).forEach((l: any) => {
      if (!contactsByDeal[l.deal_id]) contactsByDeal[l.deal_id] = []
      contactsByDeal[l.deal_id].push(l.contact)
    })
  }

  // 4. Compute sections
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const in14 = new Date(today); in14.setDate(today.getDate() + 14)
  const staleThreshold = new Date(today); staleThreshold.setDate(today.getDate() - STALE_DAYS)

  const daysUntilLoi = (d: string) =>
    Math.floor((new Date(d + 'T12:00:00').getTime() - today.getTime()) / 86400000)

  const loiDeals = deals
    .filter(d => d.loi_date && daysUntilLoi(d.loi_date) >= 0 && new Date(d.loi_date + 'T12:00:00') <= in14)
    .sort((a, b) => a.loi_date!.localeCompare(b.loi_date!))

  const staleDeals = deals.filter(d => new Date(d.updated_at) < staleThreshold)

  // 5. Build HTML + plain text
  const weekOf = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  const html = buildHtml({ deals, contactsByDeal, loiDeals, staleDeals, weekOf })
  const text = buildText({ deals, contactsByDeal, loiDeals, staleDeals, weekOf })

  // 6. Send via Postmark
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': serverToken,
    },
    body: JSON.stringify({
      From: 'intake@evolutionstrategy.com',
      ReplyTo: 'ken@evolutionstrategy.com',
      To: recipients.join(', '),
      Subject: `Deal Pipeline — Week of ${weekOf}`,
      HtmlBody: html,
      TextBody: text,
      MessageStream: 'outbound',
    }),
  })

  const result = await res.json()
  if (!res.ok) {
    console.error('[pipeline-email] Postmark error:', result)
    return NextResponse.json({ error: result.Message || 'Send failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, deals: deals.length, recipients: recipients.length })
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

// ── Plain text builder (for deliverability) ───────────────────────────────────
function buildText({ deals, contactsByDeal, loiDeals, staleDeals, weekOf }: {
  deals: any[]
  contactsByDeal: Record<string, any[]>
  loiDeals: any[]
  staleDeals: any[]
  weekOf: string
}): string {
  const STAGES = ['Exclusivity', 'LOI Submitted', 'Pre-LOI', 'Reviewing', 'Teaser']
  const div = '─'.repeat(48)
  const totalEbitda = deals.reduce((s, d) => s + (d.ebitda || 0), 0)
  const totalAsking = deals.reduce((s, d) => s + (d.asking_price || 0), 0)

  let out = `EVOLUTION STRATEGY PARTNERS — DEAL PIPELINE\n`
  out    += `Week of ${weekOf}\n\n`
  out    += `${div}\n`
  out    += `${deals.length} active deal${deals.length !== 1 ? 's' : ''}`
  if (totalEbitda > 0) out += `   Total EBITDA: ${fmt(totalEbitda)}`
  if (totalAsking > 0) out += `   Total Asking: ${fmt(totalAsking)}`
  out    += '\n'

  if (loiDeals.length) {
    out += `\n${div}\nLOI DEADLINES — NEXT 14 DAYS\n${div}\n`
    for (const d of loiDeals) {
      const days = Math.floor((new Date(d.loi_date + 'T12:00:00').getTime() - Date.now()) / 86400000)
      const label = days === 0 ? 'TODAY' : days === 1 ? 'Tomorrow' : `${days} days`
      out += `  • ${d.company_name} — ${label} (${fmtDate(d.loi_date)})\n`
    }
  }

  if (staleDeals.length) {
    out += `\n${div}\nNO ACTIVITY IN ${STALE_DAYS}+ DAYS\n${div}\n`
    for (const d of staleDeals) {
      out += `  • ${d.company_name} (${d.stage}) — ${daysSince(d.updated_at)}d quiet\n`
    }
  }

  for (const stage of STAGES) {
    const stageDeals = deals.filter(d => d.stage === stage)
    if (!stageDeals.length) continue
    out += `\n${div}\n${stage.toUpperCase()} — ${stageDeals.length} deal${stageDeals.length !== 1 ? 's' : ''}\n${div}\n`
    for (const deal of stageDeals) {
      out += `\n• ${deal.company_name}${deal.deal_type ? ` [${deal.deal_type}]` : ''}\n`
      const meta = [deal.sector, deal.geography].filter(Boolean).join(' · ')
      if (meta) out += `  ${meta}\n`
      const fins: string[] = []
      if (deal.revenue)        fins.push(`Rev: ${fmt(deal.revenue)}`)
      if (deal.ebitda)         fins.push(`EBITDA: ${fmt(deal.ebitda)}`)
      if (deal.asking_price)   fins.push(`Asking: ${fmt(deal.asking_price)}`)
      if (deal.asking_multiple) fins.push(`${deal.asking_multiple.toFixed(1)}x`)
      if (fins.length) out += `  ${fins.join('   ')}\n`
      for (const c of (contactsByDeal[deal.id] || [])) {
        out += `  Banker: ${c.first_name} ${c.last_name}${c.firm ? ` · ${c.firm}` : ''}\n`
      }
      if (deal.description) {
        const desc = deal.description.length > 160 ? deal.description.slice(0, 160) + '...' : deal.description
        out += `  ${desc}\n`
      }
    }
  }

  out += `\n${div}\nView pipeline: ${process.env.NEXT_PUBLIC_APP_URL || 'https://nexus.evolutionstrategy.com'}/pipeline\n`
  return out
}

// ── HTML builder ──────────────────────────────────────────────────────────────
function buildHtml({ deals, contactsByDeal, loiDeals, staleDeals, weekOf }: {
  deals: any[]
  contactsByDeal: Record<string, any[]>
  loiDeals: any[]
  staleDeals: any[]
  weekOf: string
}): string {
  const STAGES = ['Exclusivity', 'LOI Submitted', 'Pre-LOI', 'Reviewing', 'Teaser']
  const totalEbitda = deals.reduce((s, d) => s + (d.ebitda || 0), 0)
  const totalAsking = deals.reduce((s, d) => s + (d.asking_price || 0), 0)

  const dealRow = (deal: any) => {
    const contacts = contactsByDeal[deal.id] || []
    const fins = [
      deal.revenue      && `Rev: ${fmt(deal.revenue)}`,
      deal.ebitda       && `EBITDA: ${fmt(deal.ebitda)}`,
      deal.asking_price && `Asking: ${fmt(deal.asking_price)}`,
      deal.asking_multiple && `${deal.asking_multiple.toFixed(1)}x`,
    ].filter(Boolean).join('&nbsp;&nbsp;·&nbsp;&nbsp;')
    const meta = [deal.sector, deal.geography].filter(Boolean).join(' · ')
    const banker = contacts.map((c: any) => `${c.first_name} ${c.last_name}${c.firm ? ` · ${c.firm}` : ''}`).join(', ')
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
          <a href="${APP_URL}/deals/${deal.id}" style="font-size:13px;font-weight:600;color:#0f172a;text-decoration:none;">${deal.company_name}</a>
          ${deal.deal_type ? `<span style="font-size:11px;color:#94a3b8;margin-left:8px;">${deal.deal_type}</span>` : ''}
          ${meta ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">${meta}</div>` : ''}
          ${fins ? `<div style="font-size:11px;color:#475569;margin-top:2px;font-weight:500;">${fins}</div>` : ''}
          ${banker ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Banker: ${banker}</div>` : ''}
          ${deal.description ? `<div style="font-size:11px;color:#64748b;margin-top:3px;line-height:1.5;">${deal.description.slice(0, 160)}${deal.description.length > 160 ? '…' : ''}</div>` : ''}
        </td>
      </tr>`
  }

  const loiRow = (d: any) => {
    const days = Math.floor((new Date(d.loi_date + 'T12:00:00').getTime() - Date.now()) / 86400000)
    const color = days <= 2 ? '#dc2626' : '#d97706'
    return `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #fef3c7;">
          <a href="${APP_URL}/deals/${d.id}" style="font-size:13px;font-weight:600;color:#0f172a;text-decoration:none;">${d.company_name}</a>
          ${d.sector ? `<span style="font-size:11px;color:#64748b;margin-left:6px;">${d.sector}</span>` : ''}
        </td>
        <td style="padding:8px 0 8px 16px;border-bottom:1px solid #fef3c7;text-align:right;white-space:nowrap;">
          <span style="font-size:12px;font-weight:700;color:${color};">${days === 0 ? 'TODAY' : days === 1 ? 'Tomorrow' : `${days} days`}</span>
          <div style="font-size:10px;color:#94a3b8;">${fmtDate(d.loi_date)}</div>
        </td>
      </tr>`
  }

  const staleRow = (d: any) => {
    const days = daysSince(d.updated_at)
    return `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
          <a href="${APP_URL}/deals/${d.id}" style="font-size:13px;font-weight:600;color:#0f172a;text-decoration:none;">${d.company_name}</a>
          ${d.sector ? `<span style="font-size:11px;color:#64748b;margin-left:6px;">${d.sector}</span>` : ''}
          <div style="font-size:11px;color:#94a3b8;margin-top:1px;">${d.stage}</div>
        </td>
        <td style="padding:8px 0 8px 16px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;">
          <span style="font-size:12px;font-weight:600;color:#94a3b8;">${days}d quiet</span>
        </td>
      </tr>`
  }

  const stageSection = (stage: string) => {
    const stageDeals = deals.filter(d => d.stage === stage)
    if (!stageDeals.length) return ''
    return `
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">${stage}</span>
          <span style="font-size:11px;color:#94a3b8;">${stageDeals.length} deal${stageDeals.length !== 1 ? 's' : ''}</span>
          <div style="flex:1;height:1px;background:#f1f5f9;"></div>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">${stageDeals.map(dealRow).join('')}</table>
      </div>`
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0f172a;padding:20px 28px;">
            <span style="color:#94a3b8;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Evolution Strategy Partners</span>
          </td>
        </tr>

        <!-- Title -->
        <tr>
          <td style="padding:24px 28px 0;">
            <h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f172a;">Deal Pipeline</h1>
            <p style="margin:0 0 20px;font-size:13px;color:#64748b;">Week of ${weekOf}</p>

            <!-- Summary strip -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;margin-bottom:24px;">
              <tr>
                <td style="padding:14px 18px;">
                  <span style="font-size:13px;color:#334155;font-weight:500;">
                    ${deals.length} active deal${deals.length !== 1 ? 's' : ''}
                    ${totalEbitda > 0 ? `&nbsp;&nbsp;·&nbsp;&nbsp;Total EBITDA: <strong>${fmt(totalEbitda)}</strong>` : ''}
                    ${totalAsking > 0 ? `&nbsp;&nbsp;·&nbsp;&nbsp;Total Asking: <strong>${fmt(totalAsking)}</strong>` : ''}
                  </span>
                </td>
              </tr>
            </table>

            <!-- LOI Deadlines (if any) -->
            ${loiDeals.length ? `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
              <div style="font-size:11px;font-weight:700;color:#d97706;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px;">📅 LOI Deadlines — Next 14 Days</div>
              <table width="100%" cellpadding="0" cellspacing="0">${loiDeals.map(loiRow).join('')}</table>
            </div>` : ''}

            <!-- Stale Deals (if any) -->
            ${staleDeals.length ? `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
              <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px;">🔕 No Activity in ${STALE_DAYS}+ Days</div>
              <table width="100%" cellpadding="0" cellspacing="0">${staleDeals.map(staleRow).join('')}</table>
            </div>` : ''}

            <!-- Deals by stage -->
            ${STAGES.map(stageSection).join('')}

            <a href="${APP_URL}/pipeline" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;padding:10px 20px;border-radius:7px;text-decoration:none;margin-bottom:28px;">View Pipeline →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:11px;color:#94a3b8;">Nexus · Evolution Strategy Partners · <a href="${APP_URL}" style="color:#94a3b8;">nexus.evolutionstrategy.com</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}
