/**
 * Digest-reply parsing — the pure half of two-way intake digests.
 *
 * The daily digest (app/api/intake/daily-digest) is addressed so replies come
 * back to the intake inbox, and its body carries a machine marker:
 *
 *   [NEXUS-DIGEST 2026-11-10T13:00:00.000Z]
 *
 * The timestamp in the marker is the batch key — every event in that digest
 * shares it as digest_sent_at, so the reply handler can rebuild the exact
 * numbered item list (lib/digest-format.ts) and resolve "approve 2" /
 * "3: log as pre-loi" against it.
 *
 * Everything here is deterministic and side-effect free: detection, reply
 * text extraction (the quoted digest is NEVER part of the instructions), and
 * line-by-line instruction parsing. Execution lives in the email route.
 */

import { parseEmailCommand, type ParsedEmailCommand } from './email-commands'
import { parseActionCommands, type ActionCommand } from './email-action-commands'
import type { IntakeEvent } from './intake-events'

// ── Marker ────────────────────────────────────────────────────────────────────

const MARKER_RE = /\[NEXUS-DIGEST\s+([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z)\]/

/** The marker line embedded in a digest body; carries its batch timestamp. */
export function digestMarker(batchTs: string): string {
  return `[NEXUS-DIGEST ${batchTs}]`
}

/** Find a digest batch timestamp anywhere in an email body (quoted text included). */
export function findDigestBatch(text: string | null | undefined): string | null {
  const m = MARKER_RE.exec(text ?? '')
  return m ? m[1] : null
}

/** Secondary detection signal: a reply to the digest's subject line. */
export function isDigestReplySubject(subject: string | null | undefined): boolean {
  const s = subject ?? ''
  return /^\s*re\s*:/i.test(s) && /intake\s+digest/i.test(s)
}

// ── Reply text extraction ─────────────────────────────────────────────────────

/**
 * Ken's own words from a reply: everything above the quote boundary.
 * The quoted digest below the boundary is dropped entirely — it must never
 * be re-classified as new intake. Handles the common client conventions:
 * "On … wrote:", a forwarded "From:" block, dash/underscore separators,
 * "-----Original Message-----", and leading-'>' quoted lines.
 */
export function extractReplyText(text: string | null | undefined): string {
  const raw = text ?? ''
  const top = raw.split(/\n-{3,}|\r?\nFrom:|\r?\nOn .+wrote:|_{5,}|\r?\n-{2,}\s*Original Message/i)[0]
  const kept: string[] = []
  for (const line of top.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) break              // quoted block starts
    if (MARKER_RE.test(line)) break            // digest footer reached inline
    if (/^NEXUS\s+—\s+INTAKE DIGEST/i.test(line.trim())) break
    kept.push(line)
  }
  return kept.join('\n').trim()
}

// ── Instruction grammar ───────────────────────────────────────────────────────

export type ReplyRef = { kind: 'number'; n: number } | { kind: 'name'; name: string }

export type ReplyInstruction =
  | { type: 'approve'; ref: ReplyRef; raw: string }
  | { type: 'reject'; ref: ReplyRef; raw: string }
  /** "<n>: log as <stage> …" — command is the parsed log-deal remainder. */
  | { type: 'stage'; n: number; command: ParsedEmailCommand; raw: string }
  /** An action command (lib/email-action-commands): change/update/file/move by name. */
  | { type: 'action'; command: ActionCommand; raw: string }
  /** A reply line that tried to be an instruction but can't be honored as-is. */
  | { type: 'invalid'; raw: string; reason: string }
  /** A standalone existing command: note-for / ask / log-contact. */
  | { type: 'command'; command: ParsedEmailCommand; raw: string }

const NUMBERED_RE = /^(\d{1,3})\s*[:.]\s*(.+)$/
const DECIDE_RE = /^(approve|reject|dismiss)\s+(.+)$/i
const NUMBER_REF_RE = /^#?(\d{1,3})\.?$/

/**
 * Parse reply text line by line. Lines that aren't instructions (greetings,
 * prose, signatures) are ignored — a reply with NO recognizable lines yields
 * an empty array and the caller records that fact instead of guessing.
 */
export function parseReplyInstructions(replyText: string): ReplyInstruction[] {
  const out: ReplyInstruction[] = []
  for (const rawLine of (replyText ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    // "<n>: log as …" — the only numbered-command form.
    const numbered = NUMBERED_RE.exec(line)
    if (numbered && /^log\b/i.test(numbered[2])) {
      const n = parseInt(numbered[1], 10)
      const cmd = parseEmailCommand(numbered[2])
      if (cmd.kind === 'log-deal' && cmd.stage) {
        out.push({ type: 'stage', n, command: cmd, raw: line })
      } else {
        out.push({
          type: 'invalid',
          raw: line,
          reason: `Item ${n}: could not parse a stage in "${numbered[2]}" — use e.g. "${n}: log as pre-loi"`,
        })
      }
      continue
    }

    // approve / reject / dismiss <number|name>
    const decide = DECIDE_RE.exec(line)
    if (decide) {
      const verb = decide[1].toLowerCase()
      const arg = decide[2].trim()
        .replace(/[!?.…,;:]+$/, '')
        .replace(/\b(please|thanks|thank you)$/i, '')
        .trim()
      const numRef = NUMBER_REF_RE.exec(arg)
      const ref: ReplyRef = numRef
        ? { kind: 'number', n: parseInt(numRef[1], 10) }
        : { kind: 'name', name: arg }
      out.push({ type: verb === 'approve' ? 'approve' : 'reject', ref, raw: line })
      continue
    }

    // Action commands: change/update a deal or contact by name, file
    // attachments under a deal, move a Dropbox file. A near-miss (started
    // like one, didn't parse) is an invalid instruction, not prose.
    const acts = parseActionCommands(line)
    if (acts.commands.length > 0) {
      out.push({ type: 'action', command: acts.commands[0], raw: line })
      continue
    }
    if (acts.invalid.length > 0) {
      out.push({ type: 'invalid', raw: line, reason: acts.invalid[0].reason })
      continue
    }

    // Standalone existing commands.
    const cmd = parseEmailCommand(line)
    if (cmd.kind === 'note' || cmd.kind === 'ask' || cmd.kind === 'log-contact') {
      out.push({ type: 'command', command: cmd, raw: line })
      continue
    }
    if (cmd.kind === 'log-deal') {
      out.push({
        type: 'invalid',
        raw: line,
        reason: 'A stage change in a reply needs the digest item number — e.g. "3: log as teaser"',
      })
      continue
    }
    // Anything else is prose — not an instruction.
  }
  return out
}

// ── Reference resolution ──────────────────────────────────────────────────────

/** Item #n of the numbered digest (1-based), or null when out of range. */
export function resolveByNumber(ordered: IntakeEvent[], n: number): IntakeEvent | null {
  return n >= 1 && n <= ordered.length ? ordered[n - 1] : null
}

/** Lowercased text a name reference can match against (summary + key detail fields). */
export function eventMatchText(e: IntakeEvent): string {
  const d = e.detail ?? {}
  return [e.summary, d.company, d.contact_name, d.deal_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** All events whose match text contains the name (case-insensitive). */
export function findByName(ordered: IntakeEvent[], name: string): IntakeEvent[] {
  const needle = name.toLowerCase().trim()
  if (!needle) return []
  return ordered.filter(e => eventMatchText(e).includes(needle))
}
