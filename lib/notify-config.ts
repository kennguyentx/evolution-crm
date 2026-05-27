// lib/notify-config.ts
// Reads notification recipient lists from the app_settings table so they can
// be managed from the UI without a code deploy.
//
// Keys stored in app_settings (value is a JSON string[]):
//   pipeline_email_recipients  — weekly pipeline digest
//   deal_notify_recipients     — new deal approvals + LOI alerts
//   portfolio_news_recipients  — daily portfolio news email

import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** Fallback recipients used if the DB key is missing or empty. */
const FALLBACKS: Record<string, string[]> = {
  deal_notify_recipients:    ['ken@evolutionstrategy.com', 'sean@evolutionstrategy.com'],
  portfolio_news_recipients: ['ken@evolutionstrategy.com', 'sean@evolutionstrategy.com'],
  pipeline_email_recipients: ['ken@evolutionstrategy.com', 'sean@evolutionstrategy.com'],
}

export async function getRecipients(key: string): Promise<string[]> {
  try {
    const supabase = serviceClient()
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .single()

    const value = data?.value
    if (Array.isArray(value) && value.length > 0) return value as string[]
  } catch (e) {
    console.error(`[notify-config] Failed to load ${key}:`, e)
  }
  return FALLBACKS[key] ?? []
}
