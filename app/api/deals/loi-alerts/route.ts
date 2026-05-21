import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const NOTIFY = ['ken@evolutionstrategy.com', 'sean@evolutionstrategy.com']
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://nexus.evolutionstrategy.com'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET — Vercel Cron (daily 9am ET = 14:00 UTC)
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return sendAlerts()
}

// POST — manual trigger from UI
export async function POST() {
  return sendAlerts()
}

async function sendAlerts() {
  const supabase = serviceClient()
  const serverToken = process.env.POSTMARK_SERVER_TOKEN
  if (!serverToken) return NextResponse.json({ error: 'No Postmark token' }, { status: 500 })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const in2  = new Date(today); in2.setDate(today.getDate() + 2)
  const in7  = new Date(today); in7.setDate(today.getDate() + 7)
  const in8  = new Date(today); in8.setDate(today.getDate() + 8)

  // Deals with LOI date in the next 7 days (not yet passed)
  const { data: deals } = await supabase
    .from('deals')
    .select('id, company_name, stage, sector, geography, loi_date, revenue, ebitda')
    .not('loi_date', 'is', null)
    .gte('loi_date', today.toISOString().split('T')[0])
    .lte('loi_date', in8.toISOString().split('T')[0])
    .in('stage', ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity'])
    .order('loi_date', { ascending: true })

  if (!deals?.length) return NextResponse.json({ sent: 0 })

  const fmt = (n: number) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`

  const fmtDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const daysUntil = (d: string) => {
    const diff = new Date(d + 'T12:00:00').getTime() - today.getTime()
    return Math.round(diff / 86400000)
  }

  const urgent  = deals.filter(d => daysUntil(d.loi_date!) <= 2)
  const upcoming = deals.filter(d => daysUntil(d.loi_date!) > 2)

  const dealRow = (d: any) => {
    const days = daysUntil(d.loi_date!)
    const urgentColor = days <= 2 ? '#dc2626' : '#d97706'
    const fins = [d.revenue && `Rev: ${fmt(d.revenue)}`, d.ebitda && `EBITDA: ${fmt(d.ebitda)}`].filter(Boolean).join('  ·  ')
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <a href="${APP_URL}/deals/${d.id}" style="font-size:13px;font-weight:600;color:#0f172a;text-decoration:none;">${d.company_name}</a>
          ${d.sector || d.geography ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${[d.sector, d.geography].filter(Boolean).join(' · ')}</div>` : ''}
          ${fins ? `<div style="font-size:11px;color:#64748b;margin-top:1px;">${fins}</div>` : ''}
        </td>
        <td style="padding:10px 0 10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;">
          <div style="font-size:12px;font-weight:700;color:${urgentColor};">${days === 0 ? 'TODAY' : days === 1 ? 'Tomorrow' : `${days} days`}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:1px;">${fmtDate(d.loi_date!)}</div>
        </td>
      </tr>`
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <tr>
          <td style="background:#0f172a;padding:20px 28px;">
            <span style="color:#94a3b8;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Evolution Strategy Partners</span>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 28px 0;">
            <h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f172a;">LOI Deadline Alert</h1>
            <p style="margin:0 0 20px;font-size:13px;color:#64748b;">${deals.length} deal${deals.length !== 1 ? 's' : ''} with upcoming LOI dates</p>

            ${urgent.length ? `
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
              <div style="font-size:11px;font-weight:700;color:#dc2626;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px;">⚠️ Due within 2 days</div>
              <table width="100%" cellpadding="0" cellspacing="0">${urgent.map(dealRow).join('')}</table>
            </div>` : ''}

            ${upcoming.length ? `
            <div style="margin-bottom:24px;">
              <div style="font-size:11px;font-weight:700;color:#d97706;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px;">Coming up this week</div>
              <table width="100%" cellpadding="0" cellspacing="0">${upcoming.map(dealRow).join('')}</table>
            </div>` : ''}

            <a href="${APP_URL}/pipeline" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;padding:10px 20px;border-radius:7px;text-decoration:none;margin-bottom:28px;">View Pipeline →</a>
          </td>
        </tr>

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

  const subject = urgent.length
    ? `⚠️ LOI Due Soon: ${urgent.map(d => d.company_name).join(', ')}`
    : `LOI Deadlines This Week: ${deals.map(d => d.company_name).join(', ')}`

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': serverToken,
    },
    body: JSON.stringify({
      From: 'intake@evolutionstrategy.com',
      To: NOTIFY.join(', '),
      Subject: subject,
      HtmlBody: html,
      MessageStream: 'outbound',
    }),
  })

  const result = await res.json().catch(() => ({}))
  if (!res.ok) console.error('[loi-alerts] Postmark error:', result)

  return NextResponse.json({ sent: deals.length, deals: deals.map(d => d.company_name) })
}
