// app/api/pipeline/weekly-email/route.ts
// Weekly deal pipeline email — fired by Vercel Cron every Monday 8am ET
// Also accepts POST for manual sends from the UI

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const maxDuration = 30

const STAGES = ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity']

// ── GET — Vercel Cron ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  return runSend()
}

// ── POST — manual trigger from UI ────────────────────────────────────────────
export async function POST() {
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
  // 1. Recipients from app_settings
  const { data: setting } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', 'pipeline_email_recipients')
    .single()

  const recipients: string[] = setting?.value || []
  if (!recipients.length) {
    return NextResponse.json({ error: 'No recipients configured' }, { status: 400 })
  }

  // 2. Fetch active pipeline deals
  const { data: deals, error: dealsErr } = await supabaseAdmin
    .from('deals')
    .select('id, company_name, stage, sector, geography, revenue, ebitda, asking_price, asking_multiple, deal_type, description, updated_at')
    .in('stage', STAGES)
    .order('stage')
    .order('updated_at', { ascending: false })

  if (dealsErr || !deals) {
    return NextResponse.json({ error: 'Failed to fetch deals' }, { status: 500 })
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

  // 4. Build email body
  const body = formatEmail(deals, contactsByDeal)
  const weekOf = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

  // 5. Send via Postmark
  const serverToken = process.env.POSTMARK_SERVER_TOKEN
  const fromEmail   = process.env.FROM_EMAIL || 'deals@evolutionstrategy.com'

  if (!serverToken) {
    return NextResponse.json({ error: 'POSTMARK_SERVER_TOKEN not configured' }, { status: 500 })
  }

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': serverToken,
    },
    body: JSON.stringify({
      From: fromEmail,
      To: recipients.join(', '),
      Subject: `Deal Pipeline — Week of ${weekOf}`,
      TextBody: body,
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

// ── Email formatter ───────────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}

function formatEmail(deals: any[], contactsByDeal: Record<string, any[]>): string {
  const weekOf  = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  const div     = '─'.repeat(50)
  const totalEbitda  = deals.reduce((s, d) => s + (d.ebitda       || 0), 0)
  const totalAsking  = deals.reduce((s, d) => s + (d.asking_price || 0), 0)

  let out = `EVOLUTION STRATEGY — DEAL PIPELINE\n`
  out    += `Week of ${weekOf}\n\n`
  out    += `${div}\n`
  out    += `SUMMARY\n`
  out    += `Active Deals: ${deals.length}`
  if (totalEbitda > 0) out += `   Total EBITDA: ${fmt(totalEbitda)}`
  if (totalAsking > 0) out += `   Total Asking: ${fmt(totalAsking)}`
  out    += '\n'

  for (const stage of STAGES) {
    const stageDeals = deals.filter(d => d.stage === stage)
    if (!stageDeals.length) continue

    out += `\n${div}\n`
    out += `${stage.toUpperCase()} — ${stageDeals.length} deal${stageDeals.length !== 1 ? 's' : ''}\n`
    out += `${div}\n`

    for (const deal of stageDeals) {
      out += `\n• ${deal.company_name}`
      if (deal.deal_type) out += ` [${deal.deal_type}]`
      out += '\n'

      const meta = [deal.sector, deal.geography].filter(Boolean).join(' · ')
      if (meta) out += `  ${meta}\n`

      const fins: string[] = []
      if (deal.revenue)        fins.push(`Rev: ${fmt(deal.revenue)}`)
      if (deal.ebitda)         fins.push(`EBITDA: ${fmt(deal.ebitda)}`)
      if (deal.asking_price)   fins.push(`Asking: ${fmt(deal.asking_price)}`)
      if (deal.asking_multiple) fins.push(`${deal.asking_multiple.toFixed(1)}x EBITDA`)
      if (fins.length) out += `  ${fins.join('   ')}\n`

      const contacts = contactsByDeal[deal.id] || []
      for (const c of contacts) {
        out += `  Banker: ${c.first_name} ${c.last_name}${c.firm ? ` · ${c.firm}` : ''}\n`
      }

      if (deal.description) {
        const desc = deal.description.length > 140
          ? deal.description.slice(0, 140) + '...'
          : deal.description
        out += `  ${desc}\n`
      }
    }
  }

  out += `\n${div}\n`
  out += `Sent from Evolution CRM\n`
  return out
}
