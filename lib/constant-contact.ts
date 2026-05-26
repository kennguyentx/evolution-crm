/**
 * lib/constant-contact.ts
 *
 * Shared helper for Constant Contact OAuth token management.
 * Tokens are stored in the `app_settings` Supabase table under the key
 * `cc_tokens` as { access_token, refresh_token, expires_at }.
 *
 * getValidCCToken() returns a ready-to-use access token, refreshing
 * automatically if it expires within the next 5 minutes.
 */

import { createClient } from '@supabase/supabase-js'

const CC_TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token'
const SETTINGS_KEY = 'cc_tokens'
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min before expiry

interface CCTokens {
  access_token: string
  refresh_token: string
  expires_at: string // ISO string
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Read stored tokens from app_settings */
export async function getCCTokens(): Promise<CCTokens | null> {
  const supabase = serviceClient()
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .single()
  return (data?.value as CCTokens) ?? null
}

/** Write tokens back to app_settings */
export async function saveCCTokens(tokens: CCTokens): Promise<void> {
  const supabase = serviceClient()
  await supabase.from('app_settings').upsert({
    key: SETTINGS_KEY,
    value: tokens,
    updated_at: new Date().toISOString(),
  })
}

/**
 * Returns a valid CC access token, refreshing automatically if needed.
 * Throws if not connected or refresh fails.
 */
export async function getValidCCToken(): Promise<string> {
  const tokens = await getCCTokens()
  if (!tokens?.access_token) {
    throw new Error('Constant Contact not connected. Visit /contacts and click "CC Sync" to connect.')
  }

  const expiresAt = new Date(tokens.expires_at).getTime()
  const now = Date.now()

  // Token still fresh — return as-is
  if (expiresAt - now > REFRESH_BUFFER_MS) {
    return tokens.access_token
  }

  // Refresh
  const clientId = process.env.CONSTANT_CONTACT_CLIENT_ID
  const clientSecret = process.env.CONSTANT_CONTACT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('CONSTANT_CONTACT_CLIENT_ID / CLIENT_SECRET not set in env')
  }

  const res = await fetch(CC_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CC token refresh failed (${res.status}): ${text}`)
  }

  const json = await res.json()
  const newTokens: CCTokens = {
    access_token: json.access_token,
    // CC may or may not return a new refresh token; keep the old one if not
    refresh_token: json.refresh_token || tokens.refresh_token,
    expires_at: new Date(now + json.expires_in * 1000).toISOString(),
  }

  await saveCCTokens(newTokens)
  return newTokens.access_token
}
