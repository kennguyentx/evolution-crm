import { describe, it, expect } from 'vitest'
import {
  digestMarker,
  findDigestBatch,
  isDigestReplySubject,
  extractReplyText,
  parseReplyInstructions,
  resolveByNumber,
  findByName,
} from './digest-reply'
import { flattenDigestEvents, digestItemNumbers } from './digest-format'
import type { IntakeEvent } from './intake-events'

const ev = (partial: Partial<IntakeEvent>): IntakeEvent => ({
  id: 'x',
  event_date: '2026-11-10',
  kind: 'deal-logged',
  summary: '',
  detail: {},
  deal_id: null,
  contact_id: null,
  queue_id: null,
  message_id: null,
  digest_sent_at: null,
  created_at: '2026-11-10T12:00:00Z',
  ...partial,
})

describe('digest marker', () => {
  it('round-trips through the body', () => {
    const ts = '2026-11-10T12:00:05.123Z'
    expect(digestMarker(ts)).toBe('[NEXUS-DIGEST 2026-11-10T12:00:05.123Z]')
    const body = `Some text\n\n${digestMarker(ts)}\n`
    expect(findDigestBatch(body)).toBe(ts)
  })

  it('is found inside a quoted reply', () => {
    const ts = '2026-11-09T12:00:00.000Z'
    const body = [
      'approve 1',
      '',
      'On Mon, Nov 9, 2026 at 7:01 AM Nexus <intake@evolutionstrategy.com> wrote:',
      `> ${digestMarker(ts)}`,
      '> 1. Logged Project X as Teaser',
    ].join('\n')
    expect(findDigestBatch(body)).toBe(ts)
  })

  it('returns null when there is no marker', () => {
    expect(findDigestBatch('Just a normal forward\nlog as teaser')).toBeNull()
  })
})

describe('isDigestReplySubject', () => {
  it('matches a reply to the digest subject', () => {
    expect(isDigestReplySubject('Re: Intake digest — Tue, Nov 10, 2026')).toBe(true)
    expect(isDigestReplySubject('RE: Intake digest')).toBe(true)
  })
  it('does not match the digest itself or other subjects', () => {
    expect(isDigestReplySubject('Intake digest — Tue, Nov 10, 2026')).toBe(false)
    expect(isDigestReplySubject('Re: Weekly pipeline')).toBe(false)
    expect(isDigestReplySubject('Fwd: Intake digest')).toBe(false)
  })
})

describe('extractReplyText', () => {
  it('keeps only the sender text above an "On … wrote:" quote', () => {
    const body = [
      'approve 2',
      '3: log as pre-loi',
      '',
      'On Tue, Nov 10, 2026 at 7:01 AM Nexus <intake@evolutionstrategy.com> wrote:',
      '',
      '> Intake digest — Tue, Nov 10, 2026',
      '> 1. Logged Project X as Teaser',
      '> 2. Teaser for Project Anchor needs your pick',
    ].join('\n')
    const out = extractReplyText(body)
    expect(out).toContain('approve 2')
    expect(out).toContain('3: log as pre-loi')
    expect(out).not.toContain('Project X')
    expect(out).not.toContain('Project Anchor')
  })

  it('cuts at the marker line even without a quote header', () => {
    const body = [
      'reject 1',
      digestMarker('2026-11-10T12:00:00.000Z'),
      'Intake digest — Tue, Nov 10, 2026',
      '1. Logged Project X as Teaser',
    ].join('\n')
    expect(extractReplyText(body)).toBe('reject 1')
  })

  it('cuts at quoted lines and original-message separators', () => {
    const a = extractReplyText('approve 1\n> quoted digest line\n> more')
    expect(a).toBe('approve 1')
    const b = extractReplyText('approve 1\n-----Original Message-----\nFrom: Nexus\n1. Logged Project X')
    expect(b).toBe('approve 1')
    expect(b).not.toContain('Project X')
  })

  it('leaves an ordinary forward untouched', () => {
    const body = 'log as teaser as add-on for DiPonio\n\nTeam — passing along the teaser.'
    expect(extractReplyText(body)).toBe(body)
  })
})

describe('parseReplyInstructions', () => {
  it('parses approve/reject by number', () => {
    expect(parseReplyInstructions('approve 2')).toEqual([
      { type: 'approve', ref: { kind: 'number', n: 2 }, raw: 'approve 2' },
    ])
    expect(parseReplyInstructions('reject 3')).toEqual([
      { type: 'reject', ref: { kind: 'number', n: 3 }, raw: 'reject 3' },
    ])
    expect(parseReplyInstructions('dismiss #4')).toEqual([
      { type: 'reject', ref: { kind: 'number', n: 4 }, raw: 'dismiss #4' },
    ])
  })

  it('parses approve/reject by name', () => {
    expect(parseReplyInstructions('approve Project Anchor')).toEqual([
      { type: 'approve', ref: { kind: 'name', name: 'Project Anchor' }, raw: 'approve Project Anchor' },
    ])
    expect(parseReplyInstructions('reject Project Zephyr please')).toEqual([
      { type: 'reject', ref: { kind: 'name', name: 'Project Zephyr' }, raw: 'reject Project Zephyr please' },
    ])
  })

  it('parses "<n>: log as <stage>" and fails a bad stage explicitly', () => {
    const [ok] = parseReplyInstructions('3: log as pre-loi')
    expect(ok.type).toBe('stage')
    if (ok.type === 'stage') {
      expect(ok.n).toBe(3)
      expect(ok.command.stage).toBe('Pre-LOI')
    }
    const [bad] = parseReplyInstructions('3: log as banana')
    expect(bad.type).toBe('invalid')
    if (bad.type === 'invalid') expect(bad.reason).toContain('banana')
  })

  it('flags a bare "log as …" (no item number) instead of guessing a target', () => {
    const [ins] = parseReplyInstructions('log as teaser')
    expect(ins.type).toBe('invalid')
    if (ins.type === 'invalid') expect(ins.reason).toContain('item number')
  })

  it('carries the standalone commands', () => {
    const note = parseReplyInstructions('note for Jane Doe: called her Tuesday')[0]
    expect(note.type).toBe('command')
    if (note.type === 'command') {
      expect(note.command.kind).toBe('note')
      expect(note.command.contactName).toBe('Jane Doe')
      expect(note.command.noteText).toContain('called her Tuesday')
    }

    const ask = parseReplyInstructions('ask: how many active deals do we have?')[0]
    expect(ask.type).toBe('command')
    if (ask.type === 'command') {
      expect(ask.command.kind).toBe('ask')
      expect(ask.command.noteText).toContain('how many active deals')
    }

    const contact = parseReplyInstructions('log new contact Jane Doe at Acme Corp')[0]
    expect(contact.type).toBe('command')
    if (contact.type === 'command') {
      expect(contact.command.kind).toBe('log-contact')
      expect(contact.command.contacts).toEqual([{ name: 'Jane Doe', company: 'Acme Corp' }])
    }
  })

  it('ignores prose and never turns digest content into instructions', () => {
    const reply = [
      'Thanks — a couple of actions:',
      'approve 1',
      'See below for the original.',
    ].join('\n')
    const ins = parseReplyInstructions(reply)
    expect(ins).toHaveLength(1)
    expect(ins[0].type).toBe('approve')

    // The quoted digest itself, if it ever reached the parser, must not
    // produce deal-creating instructions: its lines are listings, not
    // commands. (Extraction normally keeps it out entirely.)
    const digestText = [
      'Intake digest — Tue, Nov 10, 2026',
      '1. Logged Project X as Teaser',
      '2. Note filed under Jane Doe',
      '3. Teaser for Project Anchor needs your pick',
    ].join('\n')
    expect(parseReplyInstructions(digestText)).toEqual([])
  })

  it('parses a full multi-instruction reply', () => {
    const reply = [
      'approve 2',
      'reject 4',
      '1: log as loi',
      'note for Jane Doe: send her the NDA',
      'ask: what is our pipeline count?',
    ].join('\n')
    const ins = parseReplyInstructions(reply)
    expect(ins.map(i => i.type)).toEqual(['approve', 'reject', 'stage', 'command', 'command'])
  })
})

describe('numbering and batch reconstruction', () => {
  const batch: IntakeEvent[] = [
    ev({ id: 'a', event_date: '2026-11-09', kind: 'deal-logged', summary: 'Logged Project A as Teaser', created_at: '2026-11-09T10:00:00Z' }),
    ev({ id: 'b', event_date: '2026-11-10', kind: 'ambiguous', summary: 'Teaser for Project B needs your pick', queue_id: 'q-b', created_at: '2026-11-10T09:00:00Z' }),
    ev({ id: 'c', event_date: '2026-11-10', kind: 'deal-logged', summary: 'Logged Project C as IOI', created_at: '2026-11-10T08:00:00Z' }),
    ev({ id: 'd', event_date: '2026-11-09', kind: 'ambiguous', summary: 'Teaser for Project D needs your pick', queue_id: 'q-d', created_at: '2026-11-09T11:00:00Z' }),
  ]

  it('flattens in digest display order: date, then section, then arrival', () => {
    // 11-09 first: "Needs your pick" (d) precedes "Deals logged" (a);
    // then 11-10: ambiguous (b) precedes deal-logged (c).
    expect(flattenDigestEvents(batch).map(e => e.id)).toEqual(['d', 'a', 'b', 'c'])
    const numbers = digestItemNumbers(batch)
    expect(numbers.get('d')).toBe(1)
    expect(numbers.get('a')).toBe(2)
    expect(numbers.get('b')).toBe(3)
    expect(numbers.get('c')).toBe(4)
  })

  it('resolveByNumber maps numbers to events and rejects out-of-range', () => {
    const ordered = flattenDigestEvents(batch)
    expect(resolveByNumber(ordered, 1)?.id).toBe('d')
    expect(resolveByNumber(ordered, 4)?.id).toBe('c')
    expect(resolveByNumber(ordered, 0)).toBeNull()
    expect(resolveByNumber(ordered, 5)).toBeNull()
    expect(resolveByNumber(ordered, -1)).toBeNull()
  })

  it('findByName matches summaries case-insensitively', () => {
    const ordered = flattenDigestEvents(batch)
    expect(findByName(ordered, 'project b').map(e => e.id)).toEqual(['b'])
    expect(findByName(ordered, 'Project').length).toBe(4)
    expect(findByName(ordered, 'nonexistent')).toEqual([])
  })
})
