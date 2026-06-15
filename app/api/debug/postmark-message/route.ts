// app/api/debug/postmark-message/route.ts
// Temporary diagnostic — pulls Postmark's recent outbound activity, delivery
// stats, bounces, and suppressions for the current server token. This is the
// real "why didn't my email arrive" view. Delete once Postmark is sorted.
//
// Usage: GET /api/debug/postmark-message?k=esp-pm-check[&email=ken@evolutionstrategy.com]

import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('k')
  if (secret !== 'esp-pm-check') {
    return NextResponse.json({ error: 'Pass ?k=esp-pm-check' }, { status: 401 })
  }

  const pmToken = process.env.POSTMARK_SERVER_TOKEN
  if (!pmToken) return NextResponse.json({ error: 'POSTMARK_SERVER_TOKEN not set' }, { status: 500 })

  const email = req.nextUrl.searchParams.get('email') || 'ken@evolutionstrategy.com'
  const h = { Accept: 'application/json', 'X-Postmark-Server-Token': pmToken }

  const [recentRes, statsRes, bouncesRes, sigRes] = await Promise.all([
    // Last 20 outbound messages (the Activity feed)
    fetch('https://api.postmarkapp.com/messages/outbound?count=20&offset=0', { headers: h }),
    // Aggregate delivery stats (sent / bounced / etc.)
    fetch('https://api.postmarkapp.com/deliverystats', { headers: h }),
    // Bounces for this recipient
    fetch(`https://api.postmarkapp.com/bounces?count=20&offset=0&emailFilter=${encodeURIComponent(email)}`, { headers: h }),
    // Sender signatures (account-level — needs account token, may 401; that's fine)
    fetch('https://api.postmarkapp.com/senders?count=20&offset=0', { headers: h }).catch(() => null),
  ])

  const recent = await recentRes.json().catch(() => ({}))
  const stats  = await statsRes.json().catch(() => ({}))
  const bounces = await bouncesRes.json().catch(() => ({}))
  const sigs   = sigRes ? await sigRes.json().catch(() => ({})) : null

  return NextResponse.json({
    recentMessages: {
      total: recent.TotalCount,
      messages: (recent.Messages || []).map((m: any) => ({
        MessageID: m.MessageID,
        To: m.Recipients,
        Subject: m.Subject,
        Status: m.Status,
        ReceivedAt: m.ReceivedAt,
      })),
    },
    deliveryStats: stats,
    bouncesForRecipient: {
      total: bounces.TotalCount,
      bounces: (bounces.Bounces || []).map((b: any) => ({
        Email: b.Email,
        Type: b.Type,
        Inactive: b.Inactive,
        BouncedAt: b.BouncedAt,
        Details: b.Details,
        Subject: b.Subject,
      })),
    },
    senderSignatures: sigs?.SenderSignatures
      ? sigs.SenderSignatures.map((s: any) => ({
          Domain: s.Domain,
          EmailAddress: s.EmailAddress,
          Confirmed: s.Confirmed,
        }))
      : 'unavailable (needs account token)',
  })
}
