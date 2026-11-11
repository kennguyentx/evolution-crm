// ── File a "note for <name>" under a contact ─────────────────────────────────
// Shared by the forward flow (app/api/notes/email), digest replies, and
// stored-interpretation approvals (lib/email-command-fallback.ts) — one
// implementation, extracted from the email route for the command-set build
// (the same reason lib/intake-queue-actions.ts exists).
//
// Resolves the contact by exact name, then fuzzy; ambiguous (0 or 2+
// matches) goes to the intake queue with candidates — the daily digest
// flags it and Ken picks in the queue. Never auto-creates a contact from a
// note command. Records the intake event either way (note-appended /
// ambiguous).

import { findContactCandidates } from './contacts'
import { recordIntakeEvent } from './intake-events'

export async function fileNoteForContact(
  supabase: any,
  args: { name: string; noteBody: string; from: string; subject: string; messageId: string; noteDate: string },
): Promise<
  | { outcome: 'filed'; contactId: string; noteId?: string }
  | { outcome: 'queued'; queueId?: string; ambiguity: string }
> {
  const { name, noteBody, from, subject, messageId, noteDate } = args
  const candidates = await findContactCandidates(supabase, name)
  const display = (c: any) => `${c.first_name} ${c.last_name}${c.firm ? ` · ${c.firm}` : ''}`
  if (candidates.length === 1 && noteBody.trim()) {
    const { data: filedNote } = await supabase.from('notes').insert({
      note_date: noteDate,
      raw_text: noteBody.slice(0, 4000),
      summary: noteBody.slice(0, 300),
      logged_by: from.split('@')[0] ?? 'email',
      source: 'email',
      contact_id: candidates[0].id,
    }).select('id').single()
    await recordIntakeEvent(supabase, {
      kind: 'note-appended',
      summary: `Note filed under ${display(candidates[0])}`,
      detail: { contact_name: display(candidates[0]), note_preview: noteBody.slice(0, 200), from },
      contact_id: candidates[0].id,
      message_id: messageId || null,
    })
    return { outcome: 'filed', contactId: candidates[0].id, noteId: filedNote?.id }
  }
  // 0 or 2+ candidates, or an empty note → queue with candidates.
  const ambiguity = !noteBody.trim()
    ? `Note for "${name}" had no note text`
    : candidates.length === 0
      ? `No contact matched "${name}"`
      : `${candidates.length} contacts matched "${name}"`
  const { data: queued } = await supabase.from('intake_queue').insert({
    source: 'email',
    doc_type: 'note',
    file_name: subject.slice(0, 200),
    from_email: from,
    extracted: {
      _kind: 'note-append',
      _contact_name: name,
      _note_text: noteBody.slice(0, 4000),
      _candidates: candidates,
      _ambiguity: ambiguity,
      _command: `note for ${name}`,
      _command_source: 'deterministic',
    },
    status: 'pending',
  }).select('id').single()
  await recordIntakeEvent(supabase, {
    kind: 'ambiguous',
    summary: `Note for "${name}" needs a contact pick`,
    detail: { reason: ambiguity, candidates: candidates.map(display), note_preview: noteBody.slice(0, 200), from },
    queue_id: queued?.id ?? null,
    message_id: messageId || null,
  })
  return { outcome: 'queued', queueId: queued?.id, ambiguity }
}
