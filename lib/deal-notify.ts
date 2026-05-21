// lib/deal-notify.ts
// Shared deal notification email — called from both the intake approve route
// and the weekly pipeline email API.

const DEAL_NOTIFY_RECIPIENTS = ['ken@evolutionstrategy.com', 'sean@evolutionstrategy.com']
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://nexus.evolutionstrategy.com'

export interface DealNotifyPayload {
  companyName: string
  stage: string
  status?: string | null
  sector?: string | null
  geography?: string | null
  revenue?: number | null
  ebitda?: number | null
  askingPrice?: number | null
  askingMultiple?: number | null
  description?: string | null
  banker?: string | null
  dealId?: string | null
  isPending?: boolean
}

export async function sendDealNotification(payload: DealNotifyPayload): Promise<void> {
  const serverToken = process.env.POSTMARK_SERVER_TOKEN
  if (!serverToken) return

  const {
    companyName, stage, status, sector, geography,
    revenue, ebitda, askingPrice, askingMultiple,
    description, banker, dealId, isPending = false,
  } = payload

  const fmt = (n: number) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`

  const subject = isPending
    ? `New Deal (Pending Review): ${companyName}`
    : `New Deal: ${companyName} — ${stage}`

  const stageLabel = `${stage}${status && status !== 'Active' ? ` · ${status}` : ''}`
  const metaLine = [sector, geography].filter(Boolean).join(' · ')
  const finParts: string[] = []
  if (revenue)        finParts.push(`Rev: ${fmt(revenue)}`)
  if (ebitda)         finParts.push(`EBITDA: ${fmt(ebitda)}`)
  if (askingPrice)    finParts.push(`Asking: ${fmt(askingPrice)}`)
  if (askingMultiple) finParts.push(`${askingMultiple.toFixed(1)}x`)
  const finLine = finParts.join('&nbsp;&nbsp;·&nbsp;&nbsp;')
  const dealUrl = dealId ? `${APP_URL}/deals/${dealId}` : `${APP_URL}/intake`

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
          <td style="padding:28px 28px 8px;">
            ${isPending
              ? `<div style="display:inline-block;background:#fef9c3;color:#854d0e;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;margin-bottom:14px;letter-spacing:0.5px;">PENDING REVIEW</div>`
              : `<div style="display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;margin-bottom:14px;letter-spacing:0.5px;">${stageLabel.toUpperCase()}</div>`
            }
            <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#0f172a;">${companyName}</h1>
            ${metaLine ? `<p style="margin:0 0 16px;font-size:13px;color:#64748b;">${metaLine}</p>` : ''}

            ${finLine ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
              <tr><td style="font-size:13px;color:#334155;font-weight:500;">${finLine}</td></tr>
            </table>` : ''}

            ${banker ? `<p style="margin:0 0 16px;font-size:13px;color:#475569;"><strong style="color:#0f172a;">Banker:</strong> ${banker}</p>` : ''}

            ${description ? `<p style="margin:0 0 20px;font-size:13px;color:#475569;line-height:1.6;">${description.slice(0, 280)}${description.length > 280 ? '…' : ''}</p>` : ''}

            ${isPending ? `<p style="margin:0 0 20px;font-size:13px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;">Review and approve this deal in Document Intake before it appears in the pipeline.</p>` : ''}

            <a href="${dealUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;padding:10px 20px;border-radius:7px;text-decoration:none;margin-bottom:28px;">
              ${isPending ? 'Review in Intake →' : 'View Deal →'}
            </a>
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

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': serverToken,
    },
    body: JSON.stringify({
      From: 'intake@evolutionstrategy.com',
      To: DEAL_NOTIFY_RECIPIENTS.join(', '),
      Subject: subject,
      HtmlBody: html,
      MessageStream: 'outbound',
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[deal-notify] Postmark error:', err)
  }
}
