import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { content } = await req.json()
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL

    if (!webhookUrl) {
      return NextResponse.json({ error: 'DISCORD_WEBHOOK_URL not configured' }, { status: 400 })
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        username: 'Nexus',
        avatar_url: 'https://api.dicebear.com/7.x/initials/svg?seed=ES&backgroundColor=c9a96e',
      }),
    })

    if (!res.ok) throw new Error(`Discord error: ${res.status}`)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
