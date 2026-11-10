// app/api/intake/daily-digest/route.ts
// Daily intake digest — fired by Vercel Cron every morning (13:00 UTC) and by
// the manual-backup GitHub workflow. Batches the previous day's email-intake
// outcomes (logged, queued, ambiguous, failed) into ONE email. If there was
// no intake activity since the last digest, NO email is sent at all.
//
// Events are recorded by the intake route into intake_events
// (lib/intake-events.ts) and marked sent here. Also accepts POST for manual
// sends from the UI and PUT to update the recipient list.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getRecipients } from '@/lib/notify-config'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { fetchUnsentEvents, markEventsSent, type IntakeEvent, type IntakeEventKind } from '@/lib/intake-events'
import { createLogger } from '@/lib/log'

const log = createLogger('intake/daily-digest')

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const maxDuration = 30

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://nexus.evolutionstrategy.com'

// ── GET — scheduled trigger (Vercel Cron / GitHub Actions) ───────────────────
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET not set' }, { status: 500 })
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    .upsert({ key: 'intake_digest_recipients', value: recipients, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// ── Core send logic ───────────────────────────────────────────────────────────
async function runSend() {
  const recipients = await getRecipients('intake_digest_recipients')
  if (!recipients.length) {
    return NextResponse.json({ error: 'No recipients configured' }, { status: 400 })
  }

  const serverToken = process.env.POSTMARK_SERVER_TOKEN
  if (!serverToken) {
    return NextResponse.json({ error: 'POSTMARK_SERVER_TOKEN not configured' }, { status: 500 })
  }

  let events: IntakeEvent[]
  try {
    events = await fetchUnsentEvents(supabaseAdmin)
  } catch (e: any) {
    // Most likely the intake_events migration hasn't been applied yet.
    log.error('events fetch failed:', e?.message)
    return NextResponse.json({ success: true, sent: false, reason: 'intake_events unavailable — apply supabase/migrations/add_intake_events.sql' })
  }

  // No activity since the last digest → send nothing (Ken's rule).
  if (!events.length) {
    return NextResponse.json({ success: true, sent: false, reason: 'No intake activity — no email sent' })
  }

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
  const html = buildHtml(events, dateLabel)
  const text = buildText(events, dateLabel)

  log.info('sending digest', { recipients: recipients.length, events: events.length })
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
      Subject: `Intake digest — ${dateLabel}`,
      HtmlBody: html,
      TextBody: text,
      MessageStream: 'outbound',
    }),
  })

  const result = await res.json()
  log.info('Postmark response', { status: res.status })

  if (!res.ok) {
    log.error('Postmark error', { status: res.status, errorCode: result?.ErrorCode })
    return NextResponse.json({
      error: result.Message || 'Send failed',
      postmark_code: result.ErrorCode,
      postmark_status: res.status,
    }, { status: 500 })
  }

  // Only mark sent after a confirmed send — a failed send retries tomorrow.
  await markEventsSent(supabaseAdmin, events.map(e => e.id))

  return NextResponse.json({
    success: true,
    sent: true,
    events: events.length,
    recipients,
    postmark_message_id: result.MessageID,
    postmark_submitted_at: result.SubmittedAt,
  })
}

// ── Grouping / formatting ────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Section {
  kinds: IntakeEventKind[]
  title: string
  intro: string
}

// Order matters: action-needed first, then what happened, then failures.
const SECTIONS: Section[] = [
  { kinds: ['ambiguous'],     title: 'Needs your pick',    intro: 'Could not resolve — pick the right one in the intake queue:' },
  { kinds: ['deal-logged'],   title: 'Deals logged',       intro: '' },
  { kinds: ['deal-updated'],  title: 'Deals updated',      intro: '' },
  { kinds: ['deal-queued'],   title: 'Queued for review',  intro: 'Waiting in the intake queue:' },
  { kinds: ['contact-logged'], title: 'Contacts logged',   intro: '' },
  { kinds: ['note-appended', 'note-logged'], title: 'Notes filed', intro: '' },
  { kinds: ['failed'],        title: 'Failed — resend',    intro: 'These did not process. Forward them again:' },
  { kinds: ['skipped'],       title: 'Skipped',            intro: '' },
]

function fmtEventDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })
}

function groupByDate(events: IntakeEvent[]): { date: string; events: IntakeEvent[] }[] {
  const map = new Map<string, IntakeEvent[]>()
  for (const e of events) {
    const list = map.get(e.event_date) ?? []
    list.push(e)
    map.set(e.event_date, list)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, evts]) => ({ date, events: evts }))
}

function eventLinks(e: IntakeEvent): { deal?: string; queue?: string } {
  return {
    deal: e.deal_id ? `${APP_URL}/deals/${e.deal_id}` : undefined,
    queue: e.queue_id ? `${APP_URL}/intake` : undefined,
  }
}

// One line per event, with links where they exist.
function eventLine(e: IntakeEvent): { html: string; text: string } {
  const { deal, queue } = eventLinks(e)
  const d = e.detail ?? {}
  const extra: string[] = []
  if (Array.isArray(d.candidates) && d.candidates.length) extra.push(`Candidates: ${d.candidates.join(', ')}`)
  if (d.reason) extra.push(d.reason)
  if (d.error) extra.push(d.error)
  if (d.file) extra.push(`File: ${d.file}`)
  if (d.from) extra.push(`From: ${d.from}`)
  const suffix = extra.length ? ` — ${extra.join(' · ')}` : ''

  let summaryHtml = esc(e.summary)
  let summaryText = e.summary
  if (deal) {
    summaryHtml = `<a href="${deal}" style="font-weight:600;color:#0f172a;text-decoration:none;">${esc(e.summary)}</a>`
    summaryText = `${e.summary} (${deal})`
  }
  if (queue) {
    summaryHtml += ` <a href="${queue}" style="font-size:12px;color:#2563eb;">Review in queue →</a>`
    summaryText += ` (review: ${queue})`
  }
  return {
    html: `<div style="font-size:13px;color:#334155;line-height:1.5;padding:6px 0;border-bottom:1px solid #f1f5f9;">• ${summaryHtml}${suffix ? `<span style="color:#64748b;">${esc(suffix)}</span>` : ''}</div>`,
    text: `  • ${summaryText}${suffix}\n`,
  }
}

function buildText(events: IntakeEvent[], dateLabel: string): string {
  const div = '─'.repeat(48)
  let out = `NEXUS — INTAKE DIGEST\n${dateLabel}\n\n`
  const dates = groupByDate(events)
  for (const { date, events: dayEvents } of dates) {
    if (dates.length > 1) out += `${div}\n${fmtEventDate(date).toUpperCase()}\n${div}\n`
    for (const section of SECTIONS) {
      const items = dayEvents.filter(e => section.kinds.includes(e.kind))
      if (!items.length) continue
      out += `\n${section.title.toUpperCase()} (${items.length})\n`
      if (section.intro) out += `${section.intro}\n`
      for (const e of items) out += eventLine(e).text
    }
    out += '\n'
  }
  out += `${div}\nReview the intake queue: ${APP_URL}/intake\n`
  return out
}

function buildHtml(events: IntakeEvent[], dateLabel: string): string {
  const dates = groupByDate(events)

  const dateBlock = ({ date, events: dayEvents }: { date: string; events: IntakeEvent[] }) => {
    const sections = SECTIONS.map(section => {
      const items = dayEvents.filter(e => section.kinds.includes(e.kind))
      if (!items.length) return ''
      return `
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">${section.title}</span>
          <span style="font-size:11px;color:#94a3b8;">${items.length}</span>
          <div style="flex:1;height:1px;background:#f1f5f9;"></div>
        </div>
        ${section.intro ? `<p style="margin:0 0 6px;font-size:12px;color:#64748b;">${esc(section.intro)}</p>` : ''}
        ${items.map(e => eventLine(e).html).join('')}
      </div>`
    }).join('')
    return `
    ${dates.length > 1 ? `<h2 style="margin:20px 0 12px;font-size:15px;font-weight:700;color:#0f172a;">${fmtEventDate(date)}</h2>` : ''}
    ${sections}`
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
            <h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f172a;">Intake Digest</h1>
            <p style="margin:0 0 20px;font-size:13px;color:#64748b;">${dateLabel} · ${events.length} event${events.length !== 1 ? 's' : ''}</p>
            ${dates.map(dateBlock).join('')}
            <a href="${APP_URL}/intake" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;padding:10px 20px;border-radius:7px;text-decoration:none;margin-bottom:28px;">Review Intake Queue →</a>
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
