// GET /api/constant-contact/oauth/callback?code=xxx
// Exchanges the authorization code for access + refresh tokens,
// stores them in app_settings, then redirects back to the contacts page.

import { NextRequest, NextResponse } from 'next/server'
import { saveCCTokens } from '@/lib/constant-contact'

const CC_TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token'

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://nexus.evolutionstrategy.com'
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    const msg = error || 'No authorization code returned'
    return NextResponse.redirect(`${appUrl}/contacts?cc_error=${encodeURIComponent(msg)}`)
  }

  const clientId = process.env.CONSTANT_CONTACT_CLIENT_ID
  const clientSecret = process.env.CONSTANT_CONTACT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${appUrl}/contacts?cc_error=${encodeURIComponent('Client credentials not configured')}`
    )
  }

  const redirectUri = `${appUrl}/api/constant-contact/oauth/callback`

  const res = await fetch(CC_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[cc-oauth] token exchange failed:', res.status, text)
    return NextResponse.redirect(
      `${appUrl}/contacts?cc_error=${encodeURIComponent(`Token exchange failed: ${res.status}`)}`
    )
  }

  const json = await res.json()
  await saveCCTokens({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  })

  return NextResponse.redirect(`${appUrl}/contacts?cc_connected=1`)
}
