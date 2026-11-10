import { NextRequest, NextResponse } from 'next/server'
import { apiError, withErrorHandler } from '@/lib/api-response'
import { DiscordSendSchema } from '@/lib/schemas'

export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    const parsed = DiscordSendSchema.safeParse(await req.json())
    if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
    const { content } = parsed.data
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
})
