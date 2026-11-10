// ── Intake activity events ────────────────────────────────────────────────────
// Every email-intake outcome is recorded here (best-effort — intake must never
// break because this table is missing or slow) so the daily digest cron can
// summarize the day's activity. See app/api/intake/daily-digest/route.ts.
//
// Table: intake_events (supabase/migrations/add_intake_events.sql).
// event_date defaults in SQL to the America/Chicago calendar date, matching
// how note_date is stamped elsewhere in intake.

export type IntakeEventKind =
  | 'deal-logged'      // new deal created from a forwarded email
  | 'deal-updated'     // docs linked to an existing deal
  | 'deal-queued'      // forwarded deal needs review in the intake queue
  | 'contact-logged'   // contacts added via the add-contact path
  | 'note-appended'    // note filed under a contact (note-for-<name> command)
  | 'note-logged'      // plain note saved from a forwarded email (no deal)
  | 'ambiguous'        // could not resolve (name / parent portco) — queued with candidates
  | 'failed'           // extraction / processing error — forwarder should resend
  | 'skipped'          // duplicate or empty — nothing done

export interface IntakeEventInput {
  kind: IntakeEventKind
  summary: string
  detail?: Record<string, any>
  deal_id?: string | null
  contact_id?: string | null
  queue_id?: string | null
  message_id?: string | null
}

export interface IntakeEvent extends IntakeEventInput {
  id: string
  created_at: string
  event_date: string
  digest_sent_at: string | null
}

/** Today's date in America/Chicago, YYYY-MM-DD — the digest's "today". */
export function todayCentral(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

/**
 * Record one intake outcome. Best-effort by design: any failure (table not
 * migrated yet, transient DB error) is logged and swallowed so the intake
 * flow that called it is unaffected.
 */
export async function recordIntakeEvent(supabase: any, event: IntakeEventInput): Promise<void> {
  try {
    const { error } = await supabase.from('intake_events').insert({
      kind: event.kind,
      summary: event.summary,
      detail: event.detail ?? {},
      deal_id: event.deal_id ?? null,
      contact_id: event.contact_id ?? null,
      queue_id: event.queue_id ?? null,
      message_id: event.message_id ?? null,
    })
    if (error) console.warn('[intake-events] record failed:', error.message)
  } catch (e: any) {
    console.warn('[intake-events] record failed:', e?.message || e)
  }
}

/** All events not yet included in a sent digest, oldest first. */
export async function fetchUnsentEvents(supabase: any): Promise<IntakeEvent[]> {
  const { data, error } = await supabase.from('intake_events')
    .select('*')
    .is('digest_sent_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`intake_events query failed: ${error.message}`)
  return (data ?? []) as IntakeEvent[]
}

/** Mark events as included in the digest just sent. */
export async function markEventsSent(supabase: any, ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('intake_events')
    .update({ digest_sent_at: new Date().toISOString() })
    .in('id', ids)
  if (error) console.error('[intake-events] mark-sent failed:', error.message)
}
