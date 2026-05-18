import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function fmt(n: number | null): string {
  if (!n) return '—'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K'
  return '$' + n
}

const ACTIVE_STAGES = ['Exclusivity', 'LOI Submitted', 'Pre-LOI', 'Reviewing', 'Teaser']

const STAGE_STYLES: Record<string, { bg: string; color: string }> = {
  'Exclusivity':   { bg: '#fff3e8', color: '#c05c00' },
  'LOI Submitted': { bg: '#fef9e7', color: '#b7860d' },
  'Pre-LOI':       { bg: '#f3eef8', color: '#4F284B' },
  'Reviewing':     { bg: '#eff6ff', color: '#1d4ed8' },
  'Teaser':        { bg: '#f3f4f6', color: '#374151' },
  'Hold':          { bg: '#e8f0fb', color: '#0F4E8C' },
}

function stageBadge(stage: string): string {
  const s = STAGE_STYLES[stage] || { bg: '#f3f4f6', color: '#374151' }
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${s.bg};color:${s.color};font-size:11px;font-weight:700;letter-spacing:0.04em;">${stage}</span>`
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Fetch active deals
    const { data: deals } = await supabase
      .from('deals')
      .select('*')
      .eq('status', 'Active')
      .in('stage', [...ACTIVE_STAGES, 'Hold'])
      .order('updated_at', { ascending: false })

    if (!deals?.length) {
      return NextResponse.json({ message: 'No active deals' })
    }

    // Fetch source contacts
    const dealIds = deals.map(d => d.id)
    const { data: links } = await supabase
      .from('contact_deal_links')
      .select('deal_id, contact:contacts(first_name, last_name, firm)')
      .in('deal_id', dealIds)
      .eq('role', 'Source / Banker')

    const contactsByDeal: Record<string, any[]> = {}
    ;(links || []).forEach((l: any) => {
      if (!contactsByDeal[l.deal_id]) contactsByDeal[l.deal_id] = []
      contactsByDeal[l.deal_id].push(l.contact)
    })

    // Fetch recent activity (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: activity } = await supabase
      .from('interactions')
      .select('deal_id, summary, interaction_type, interaction_date')
      .in('deal_id', dealIds)
      .gte('interaction_date', weekAgo)
      .order('interaction_date', { ascending: false })

    const activityByDeal: Record<string, any[]> = {}
    ;(activity || []).forEach((i: any) => {
      if (!activityByDeal[i.deal_id]) activityByDeal[i.deal_id] = []
      activityByDeal[i.deal_id].push(i)
    })

    // Group by stage
    const byStage: Record<string, any[]> = {}
    ;[...ACTIVE_STAGES, 'Hold'].forEach(s => { byStage[s] = [] })
    deals.forEach(d => { if (byStage[d.stage]) byStage[d.stage].push(d) })

    const totalDeals = deals.filter(d => ACTIVE_STAGES.includes(d.stage)).length
    const totalEbitda = deals.filter(d => ACTIVE_STAGES.includes(d.stage)).reduce((s: number, d: any) => s + (d.ebitda || 0), 0)
    const hotDeals = (byStage['Exclusivity'] || []).length + (byStage['LOI Submitted'] || []).length
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    // Build stage sections
    let stageSections = ''
    for (const stage of [...ACTIVE_STAGES, 'Hold']) {
      const stageDeals = byStage[stage]
      if (!stageDeals.length) continue
      const stageEbitda = stageDeals.reduce((s: number, d: any) => s + (d.ebitda || 0), 0)

      let dealRows = ''
      for (const deal of stageDeals) {
        const contacts = contactsByDeal[deal.id] || []
        const recentActivity = activityByDeal[deal.id]?.[0]
        const contactStr = contacts.length > 0
          ? contacts.map((c: any) => `${c.first_name} ${c.last_name}${c.firm ? ` · ${c.firm}` : ''}`).join(', ')
          : '—'

        dealRows += `
          <tr style="border-bottom:1px solid #f0eef2;">
            <td style="padding:11px 16px;font-size:13px;font-weight:600;color:#1a1a1a;">${deal.company_name}</td>
            <td style="padding:11px 16px;font-size:12px;color:#666;">${deal.sector || '—'}</td>
            <td style="padding:11px 16px;font-size:12px;color:#666;">${deal.geography || '—'}</td>
            <td style="padding:11px 16px;font-size:12px;font-family:monospace;color:#555;text-align:right;">${fmt(deal.revenue)}</td>
            <td style="padding:11px 16px;font-size:12px;font-family:monospace;color:#4F284B;font-weight:700;text-align:right;">${fmt(deal.ebitda)}</td>
            <td style="padding:11px 16px;font-size:12px;color:#666;">${contactStr}</td>
            <td style="padding:11px 16px;font-size:11px;color:#999;font-style:italic;max-width:180px;">${recentActivity ? recentActivity.summary.slice(0, 80) + (recentActivity.summary.length > 80 ? '…' : '') : ''}</td>
          </tr>`
      }

      stageSections += `
        <tr>
          <td colspan="7" style="padding:14px 16px 8px;background:#faf9fb;border-top:2px solid #f0eef2;">
            <span style="display:inline-flex;align-items:center;gap:10px;">
              ${stageBadge(stage)}
              <span style="font-size:11px;color:#999;white-space:nowrap;">${stageDeals.length} deal${stageDeals.length !== 1 ? 's' : ''}${stageEbitda > 0 ? ' · ' + fmt(stageEbitda) + ' EBITDA' : ''}</span>
            </span>
          </td>
        </tr>
        ${dealRows}`
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evolution Strategy — Weekly Pipeline Digest</title>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:880px;margin:32px auto;padding:0 16px;">

  <!-- Header -->
  <div style="background:#4F284B;border-radius:10px 10px 0 0;padding:28px 32px;">
    <div style="color:rgba(255,255,255,0.6);font-size:10px;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;">Evolution Strategy Partners</div>
    <div style="color:#ffffff;font-size:24px;font-weight:700;margin-bottom:4px;">Weekly Pipeline Digest</div>
    <div style="color:rgba(255,255,255,0.6);font-size:13px;">${today}</div>
  </div>

  <!-- Stats bar -->
  <div style="background:#ffffff;border-left:1px solid #e8e3ec;border-right:1px solid #e8e3ec;padding:20px 32px;">
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      <tr>
        <td style="width:25%;padding-right:24px;border-right:1px solid #f0eef2;">
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Active Deals</div>
          <div style="font-size:28px;font-weight:700;color:#1a1a1a;">${totalDeals}</div>
        </td>
        <td style="width:25%;padding:0 24px;border-right:1px solid #f0eef2;">
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Total EBITDA</div>
          <div style="font-size:28px;font-weight:700;color:#4F284B;">${fmt(totalEbitda)}</div>
        </td>
        <td style="width:25%;padding:0 24px;border-right:1px solid #f0eef2;">
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Exclusivity / LOI</div>
          <div style="font-size:28px;font-weight:700;color:#ED7520;">${hotDeals}</div>
        </td>
        <td style="width:25%;padding-left:24px;">
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Activity This Week</div>
          <div style="font-size:28px;font-weight:700;color:#1a1a1a;">${(activity || []).length}</div>
        </td>
      </tr>
    </table>
  </div>

  <!-- Pipeline table -->
  <div style="background:#ffffff;border:1px solid #e8e3ec;border-radius:0 0 10px 10px;overflow:hidden;margin-bottom:24px;">
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#faf9fb;border-bottom:2px solid #e8e3ec;">
          <th style="padding:9px 16px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:left;font-weight:600;">Company</th>
          <th style="padding:9px 16px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:left;font-weight:600;">Sector</th>
          <th style="padding:9px 16px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:left;font-weight:600;">Geography</th>
          <th style="padding:9px 16px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;font-weight:600;">Revenue</th>
          <th style="padding:9px 16px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;font-weight:600;">EBITDA</th>
          <th style="padding:9px 16px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:left;font-weight:600;">Source</th>
          <th style="padding:9px 16px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:left;font-weight:600;">Recent Activity</th>
        </tr>
      </thead>
      <tbody>
        ${stageSections}
      </tbody>
    </table>
  </div>

  <!-- Footer -->
  <div style="text-align:center;font-size:11px;color:#aaa;padding:8px 0 32px;">
    Nexus &nbsp;·&nbsp; Sent every Monday at 7am CT
  </div>
</div>
</body>
</html>`

    // Send via Resend
    const resendKey = process.env.RESEND_API_KEY
    const emailTo = process.env.WEEKLY_EMAIL_TO
    const emailFrom = process.env.WEEKLY_EMAIL_FROM || 'digest@evolutionstrategy.com'

    if (!resendKey || !emailTo) {
      // Return HTML preview if no email config
      return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: emailTo.split(',').map((e: string) => e.trim()),
        subject: `Pipeline Digest — ${today}`,
        html,
      }),
    })

    const result = await res.json()
    if (!res.ok) throw new Error(result.message || 'Resend error')

    return NextResponse.json({ success: true, email_id: result.id, deals: totalDeals })
  } catch (err: any) {
    console.error('Digest error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
