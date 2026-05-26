// GET /api/constant-contact/oauth
// Redirects the browser to Constant Contact's authorization page.
// After the user approves, CC redirects to /api/constant-contact/oauth/callback.

import { NextResponse } from 'next/server'

const CC_AUTH_URL = 'https://authz.constantcontact.com/oauth2/default/v1/authorize'

export async function GET() {
  const clientId = process.env.CONSTANT_CONTACT_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'CONSTANT_CONTACT_CLIENT_ID not configured in environment variables' },
      { status: 503 }
    )
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://nexus.evolutionstrategy.com').replace(/\/$/, '')
  const redirectUri = `${appUrl}/api/constant-contact/oauth/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'contact_data offline_access',
    state: 'cc_connect',
  })

  return NextResponse.redirect(`${CC_AUTH_URL}?${params}`)
}
