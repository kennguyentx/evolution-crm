// ── Digest layout: sections, date grouping, and item numbering ──────────────
// Shared by the digest sender (app/api/intake/daily-digest) and the digest
// REPLY handler (app/api/notes/email) so the numbers printed next to digest
// items are exactly the numbers a reply can reference ("approve 2",
// "3: log as pre-loi"). One ordering function, two consumers — if the layout
// ever changes, both sides move together.
//
// Numbering rule: events are numbered 1..N across the WHOLE digest in
// display order — event_date ascending, then sections in DIGEST_SECTIONS
// order, then the order the events were fetched in (created_at ascending).
// Both the sender and the reply handler feed this function a created_at-
// ascending array, so the sequence is reproducible after the fact from the
// stored rows alone (see fetchDigestBatch in lib/intake-events.ts).

import type { IntakeEvent, IntakeEventKind } from './intake-events'

export interface DigestSection {
  kinds: IntakeEventKind[]
  title: string
  intro: string
}

// Order matters: action-needed first, then reply outcomes, then what
// happened, then failures.
export const DIGEST_SECTIONS: DigestSection[] = [
  { kinds: ['ambiguous'],     title: 'Needs your pick',    intro: 'Could not resolve — pick the right one in the intake queue:' },
  { kinds: ['reply-action', 'reply-failed'], title: 'Digest replies', intro: 'What your reply to the previous digest did:' },
  { kinds: ['deal-logged'],   title: 'Deals logged',       intro: '' },
  { kinds: ['deal-updated'],  title: 'Deals updated',      intro: '' },
  { kinds: ['deal-queued'],   title: 'Queued for review',  intro: 'Waiting in the intake queue:' },
  { kinds: ['contact-logged'], title: 'Contacts logged',   intro: '' },
  { kinds: ['note-appended', 'note-logged'], title: 'Notes filed', intro: '' },
  { kinds: ['failed'],        title: 'Failed — resend',    intro: 'These did not process. Forward them again:' },
  { kinds: ['skipped'],       title: 'Skipped',            intro: '' },
]

/** Group events by event_date, dates ascending, input order preserved. */
export function groupEventsByDate(events: IntakeEvent[]): { date: string; events: IntakeEvent[] }[] {
  const map = new Map<string, IntakeEvent[]>()
  for (const e of events) {
    const list = map.get(e.event_date) ?? []
    list.push(e)
    map.set(e.event_date, list)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, evts]) => ({ date, events: evts }))
}

/**
 * The digest's events in exact display order — the array index + 1 is the
 * item number a reply can reference. Events whose kind appears in no
 * section are not displayed and get no number.
 */
export function flattenDigestEvents(events: IntakeEvent[]): IntakeEvent[] {
  const ordered: IntakeEvent[] = []
  for (const { events: dayEvents } of groupEventsByDate(events)) {
    for (const section of DIGEST_SECTIONS) {
      for (const e of dayEvents) {
        if (section.kinds.includes(e.kind)) ordered.push(e)
      }
    }
  }
  return ordered
}

/** Map of event id → 1-based item number, as printed in the digest. */
export function digestItemNumbers(events: IntakeEvent[]): Map<string, number> {
  return new Map(flattenDigestEvents(events).map((e, i) => [e.id, i + 1]))
}
