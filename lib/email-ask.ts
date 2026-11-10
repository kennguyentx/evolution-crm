// "Ask:" email assistant helpers — extracted verbatim from
// app/api/notes/email/route.ts (review item 15, behavior-preserving split).
// Emails to intake@ whose subject starts with "Ask:" / "Q:" are routed to
// the Nexus assistant; replies are sent via Postmark. Also used by the
// route's add-contact path for its confirmation replies.

// ── "Ask:" email assistant ─────────────────────────────────────────────────────
// Emails to intake@ whose subject starts with "Ask:" / "Q:" are routed to the
// Nexus assistant (full CRM + Dropbox access) and answered by email. Restricted
// to internal @evolutionstrategy.com senders since email identity is weak and
// the assistant can read/modify data.

export function isAskEmail(subject: string): boolean {
  return /^\s*(ask|q)\s*[:\-]/i.test(subject || '')
}

export function stripAskPrefix(subject: string): string {
  return (subject || '').replace(/^\s*(ask|q)\s*[:\-]\s*/i, '').trim()
}

// Take only the sender's own text (before any forwarded/quoted thread)
export function topOfBody(text: string): string {
  return (text || '').split(/\n-{3,}|\r?\nFrom:|\r?\nOn .+wrote:|_{5,}/i)[0].trim()
}

export async function sendAssistantReply(opts: {
  to: string
  subject: string
  answer: string
  inReplyTo?: string
}): Promise<void> {
  const serverToken = process.env.POSTMARK_SERVER_TOKEN
  if (!serverToken) { console.error('[ask-email] POSTMARK_SERVER_TOKEN not set'); return }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;color:#1a1a2e;white-space:pre-wrap;">${esc(opts.answer)}</div>`

  const payload: any = {
    From: 'intake@evolutionstrategy.com',
    To: opts.to,
    Subject: opts.subject.toLowerCase().startsWith('re:') ? opts.subject : `Re: ${opts.subject}`,
    TextBody: opts.answer,
    HtmlBody: htmlBody,
    MessageStream: 'outbound',
  }
  if (opts.inReplyTo) payload.Headers = [{ Name: 'In-Reply-To', Value: opts.inReplyTo }]

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': serverToken },
    body: JSON.stringify(payload),
  })
  if (!res.ok) console.error('[ask-email] reply send failed:', await res.text())
}
