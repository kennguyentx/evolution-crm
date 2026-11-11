// ── Deterministic parser for email ACTION commands ──────────────────────────
// The second deterministic grammar next to lib/email-commands.ts (which
// parses LOG commands for new intake: log as / log new contact / note for /
// ask). This one parses commands that CHANGE things that already exist in
// Nexus or move files in Dropbox:
//
//   change <Deal Name> to <stage>            (also: move … to …)
//   move <Deal Name> to <stage>
//   update <Deal Name>: type add-on, portco DiPonio, sector Landscaping, geography Texas
//   update contact <Name>: phone 214-555-0100, title Partner, company Acme, email a@b.com
//   file under <Deal Name>                   (attachments go to that deal's folder)
//   move file <filename> to <Deal Name>
//
// Case-insensitive, tolerant of extra whitespace and polite prefixes
// ("please change …"). Parsing is LINE-based: each line of the command text
// is tried independently and every matching line yields a command (Ken may
// stack several commands in one email). A line that starts like one of these
// commands but doesn't fully parse is reported in `invalid` so the caller can
// record a failed outcome instead of silently dropping it — but only in
// contexts that opt in (digest replies); forward flows ignore near-misses
// and let the normal intake paths handle the email.
//
// Stage and deal-type vocabulary is the shared STAGE_SYNONYMS /
// DEAL_TYPE_SYNONYMS from lib/email-commands.ts — one vocabulary everywhere.

import {
  STAGE_SYNONYMS,
  DEAL_TYPE_SYNONYMS,
  type Stage,
  type DealType,
} from './email-commands'

export interface DealFieldUpdates {
  deal_type?: DealType
  parent_portco?: string
  sector?: string
  geography?: string
}

export interface ContactFieldUpdates {
  phone?: string
  title?: string
  /** Maps to contacts.firm (same convention as "log new contact … at <Company>"). */
  firm?: string
  email?: string
}

export type ActionCommand =
  | { type: 'change-stage'; dealName: string; stage: Stage; dealType: DealType | null; raw: string }
  | { type: 'update-deal'; dealName: string; fields: DealFieldUpdates; raw: string }
  | { type: 'update-contact'; contactName: string; fields: ContactFieldUpdates; raw: string }
  | { type: 'file-under'; dealName: string; raw: string }
  | { type: 'move-file'; fileName: string; dealName: string; raw: string }

export interface ParsedActionCommands {
  commands: ActionCommand[]
  /** Lines that looked like action commands but didn't fully parse. */
  invalid: { raw: string; reason: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function alternation(keys: readonly string[]): string {
  return [...keys]
    .sort((a, b) => b.length - a.length)
    .map(k => escapeRegExp(k).replace(/ /g, '\\s+'))
    .join('|')
}

const STAGE_PATTERN = alternation(Object.keys(STAGE_SYNONYMS))
const DEAL_TYPE_PATTERN = alternation(Object.keys(DEAL_TYPE_SYNONYMS))

const PREFIX_RE = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?/i
const CHANGE_STAGE_START_RE = /^(?:change|move)\s+/i
const MOVE_FILE_RE = /^move\s+file\s+/i
const UPDATE_CONTACT_RE = /^update\s+contact\s+/i
const UPDATE_DEAL_RE = /^update\s+/i
const FILE_UNDER_RE = /^file\s+(?:this\s+|it\s+|attachments?\s+)?under\s+/i
const TRAILING_TYPE_RE = new RegExp(`^\\s*,?\\s*(?:as\\s+)?(${DEAL_TYPE_PATTERN})\\b`, 'i')
const STAGE_AT_START_RE = new RegExp(`^(${STAGE_PATTERN})\\b`, 'i')

/** Strip trailing sentence punctuation from a captured name. */
function cleanName(s: string): string {
  return s.trim().replace(/[!?…]+$/, '').replace(/\.+$/, '').trim()
}

/**
 * Parse the head of `tail` as a stage phrase. Returns the stage (with the
 * 'closed' + add-on rule applied when a trailing "as <type>" is present) and
 * how much of the tail was consumed. Null when the tail doesn't start with a
 * known stage phrase.
 */
function parseStageTail(tail: string): { stage: Stage; dealType: DealType | null; consumed: number } | null {
  const m = STAGE_AT_START_RE.exec(tail)
  if (!m) return null
  const key = m[1].toLowerCase().replace(/\s+/g, ' ')
  let stage: Stage = STAGE_SYNONYMS[key]
  let dealType: DealType | null = null
  let consumed = m[0].length
  const rest = tail.slice(consumed)
  const dt = TRAILING_TYPE_RE.exec(rest)
  if (dt) {
    dealType = DEAL_TYPE_SYNONYMS[dt[1].toLowerCase().replace(/\s+/g, ' ')]
    consumed += dt[0].length
  }
  if (stage === 'Closed (Platform)' && dealType === 'add-on') stage = 'Closed (Add-On)'
  return { stage, dealType, consumed }
}

// ── change / move <Deal> to <stage> ──────────────────────────────────────────

function parseChangeStage(line: string, raw: string): ActionCommand | { error: string } | null {
  const start = CHANGE_STAGE_START_RE.exec(line)
  if (!start) return null
  // "move file …" is its own command — never a stage change.
  if (MOVE_FILE_RE.test(line)) return null
  const rest = line.slice(start[0].length)

  // Split at each " to " and take the first split whose tail parses as a
  // stage — a deal name may itself contain " to " ("Door to Door Services").
  const toRe = /\s+to\s+/gi
  let m: RegExpExecArray | null
  let sawTo = false
  while ((m = toRe.exec(rest)) !== null) {
    sawTo = true
    const dealName = cleanName(rest.slice(0, m.index))
    const tail = rest.slice(m.index + m[0].length)
    const parsed = parseStageTail(tail)
    if (parsed && dealName) {
      // Leftover text after the stage phrase (beyond punctuation / a
      // trailing "thanks") means the line wasn't really this command.
      const leftover = tail.slice(parsed.consumed).trim()
      if (leftover && !/^[,.\s]*(thanks|thank you)?[.!?\s]*$/i.test(leftover)) continue
      return { type: 'change-stage', dealName, stage: parsed.stage, dealType: parsed.dealType, raw }
    }
  }
  if (sawTo) return { error: `could not read a stage in "${raw}" — use e.g. "change Project Anchor to pre-loi"` }
  // No " to " at all: only a short line reads as a truncated command —
  // longer prose that happens to start with change/move ("change of plans,
  // see the attached deck") is not a near-miss, it's just prose.
  if (rest.includes(',') || rest.split(/\s+/).length > 5) return null
  return { error: `"${raw}" is missing "to <stage>"` }
}

// ── move file <filename> to <Deal Name> ──────────────────────────────────────

function parseMoveFile(line: string, raw: string): ActionCommand | { error: string } | null {
  const start = MOVE_FILE_RE.exec(line)
  if (!start) return null
  const rest = line.slice(start[0].length)
  // Filenames can contain " to " ("Report to Board.pdf") — the deal name is
  // after the LAST " to ".
  const idx = rest.toLowerCase().lastIndexOf(' to ')
  if (idx === -1) return { error: `"${raw}" is missing "to <Deal Name>"` }
  const fileName = rest.slice(0, idx).trim().replace(/^["']|["']$/g, '')
  const dealName = cleanName(rest.slice(idx + 4))
  if (!fileName || !dealName) return { error: `could not read a file and deal in "${raw}"` }
  return { type: 'move-file', fileName, dealName, raw }
}

// ── update <Deal Name>: field value, … ───────────────────────────────────────

const DEAL_FIELD_KEYS: Record<string, keyof DealFieldUpdates> = {
  type: 'deal_type',
  portco: 'parent_portco',
  'parent portco': 'parent_portco',
  'parent': 'parent_portco',
  sector: 'sector',
  geography: 'geography',
  geo: 'geography',
}

function parseFieldPairs(
  text: string,
  allowed: Record<string, string>,
): { fields: Record<string, string> } | { error: string } {
  const fields: Record<string, string> = {}
  for (const segment of text.split(',')) {
    const seg = segment.trim()
    if (!seg) continue
    const m = /^([a-z][a-z ]*?)\s+(.+)$/i.exec(seg)
    if (!m) return { error: `could not read "field value" in "${seg}"` }
    const key = allowed[m[1].toLowerCase().replace(/\s+/g, ' ').trim()]
    if (!key) return { error: `unknown field "${m[1].trim()}" — allowed: ${Object.keys(allowed).join(', ')}` }
    fields[key] = m[2].trim()
  }
  if (Object.keys(fields).length === 0) return { error: 'no fields given' }
  return { fields }
}

function parseUpdateDeal(line: string, raw: string): ActionCommand | { error: string } | null {
  const start = UPDATE_DEAL_RE.exec(line)
  if (!start) return null
  const rest = line.slice(start[0].length)
  const colon = rest.indexOf(':')
  if (colon === -1) return { error: `"${raw}" is missing ": <field> <value>" — use e.g. "update Project Anchor: type add-on"` }
  const dealName = cleanName(rest.slice(0, colon))
  if (!dealName) return { error: `could not read a deal name in "${raw}"` }
  const parsed = parseFieldPairs(rest.slice(colon + 1), DEAL_FIELD_KEYS)
  if ('error' in parsed) return { error: parsed.error }
  const fields: DealFieldUpdates = {}
  for (const [k, v] of Object.entries(parsed.fields)) {
    if (k === 'deal_type') {
      const t = DEAL_TYPE_SYNONYMS[v.toLowerCase().replace(/\s+/g, ' ')]
      if (!t) return { error: `unknown deal type "${v}" — use platform, add-on, growth or recap` }
      fields.deal_type = t
    } else if (k === 'parent_portco') fields.parent_portco = v
    else if (k === 'sector') fields.sector = v
    else if (k === 'geography') fields.geography = v
  }
  return { type: 'update-deal', dealName, fields, raw }
}

// ── update contact <Name>: field value, … ────────────────────────────────────

const CONTACT_FIELD_KEYS: Record<string, keyof ContactFieldUpdates> = {
  phone: 'phone',
  title: 'title',
  company: 'firm',
  firm: 'firm',
  email: 'email',
}

function parseUpdateContact(line: string, raw: string): ActionCommand | { error: string } | null {
  const start = UPDATE_CONTACT_RE.exec(line)
  if (!start) return null
  const rest = line.slice(start[0].length)
  const colon = rest.indexOf(':')
  if (colon === -1) return { error: `"${raw}" is missing ": <field> <value>" — use e.g. "update contact Jane Doe: phone 214-555-0100"` }
  const contactName = cleanName(rest.slice(0, colon))
  if (!contactName) return { error: `could not read a contact name in "${raw}"` }
  const parsed = parseFieldPairs(rest.slice(colon + 1), CONTACT_FIELD_KEYS)
  if ('error' in parsed) return { error: parsed.error }
  const fields: ContactFieldUpdates = {}
  for (const [k, v] of Object.entries(parsed.fields)) {
    ;(fields as Record<string, string>)[k] = v
  }
  return { type: 'update-contact', contactName, fields, raw }
}

// ── file under <Deal Name> ───────────────────────────────────────────────────

function parseFileUnder(line: string, raw: string): ActionCommand | { error: string } | null {
  const start = FILE_UNDER_RE.exec(line)
  if (!start) return null
  const dealName = cleanName(line.slice(start[0].length))
  if (!dealName) return { error: `"${raw}" is missing a deal name` }
  return { type: 'file-under', dealName, raw }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Does this line START like an action command (even if it won't parse)? */
export function looksLikeActionCommand(line: string): boolean {
  const stripped = line.trim().replace(PREFIX_RE, '')
  return (
    MOVE_FILE_RE.test(stripped) ||
    UPDATE_CONTACT_RE.test(stripped) ||
    UPDATE_DEAL_RE.test(stripped) ||
    FILE_UNDER_RE.test(stripped) ||
    (CHANGE_STAGE_START_RE.test(stripped) && /\s+to\s+/i.test(stripped))
  )
}

function parseLine(line: string, raw: string): ActionCommand | { error: string } | null {
  return (
    parseMoveFile(line, raw) ??
    parseUpdateContact(line, raw) ??
    parseUpdateDeal(line, raw) ??
    parseFileUnder(line, raw) ??
    parseChangeStage(line, raw)
  )
}

/**
 * Parse every line of `text` as a possible action command. Returns all
 * commands found plus the near-miss lines (started like a command, didn't
 * parse) for callers that record failures.
 */
export function parseActionCommands(text: string): ParsedActionCommands {
  const commands: ActionCommand[] = []
  const invalid: { raw: string; reason: string }[] = []
  for (const rawLine of (text ?? '').split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw) continue
    const line = raw.replace(PREFIX_RE, '')
    const parsed = parseLine(line, raw)
    if (!parsed) continue
    if ('error' in parsed) invalid.push({ raw, reason: parsed.error })
    else commands.push(parsed)
  }
  return { commands, invalid }
}

/** Human-readable one-liner for an action command — digests, queue items, logs. */
export function describeActionCommand(cmd: ActionCommand): string {
  switch (cmd.type) {
    case 'change-stage':
      return `change "${cmd.dealName}" to ${cmd.stage}${cmd.dealType ? ` as ${cmd.dealType}` : ''}`
    case 'update-deal': {
      const parts = Object.entries(cmd.fields).map(([k, v]) => `${k === 'deal_type' ? 'type' : k === 'parent_portco' ? 'portco' : k} ${v}`)
      return `update "${cmd.dealName}": ${parts.join(', ')}`
    }
    case 'update-contact': {
      const parts = Object.entries(cmd.fields).map(([k, v]) => `${k === 'firm' ? 'company' : k} ${v}`)
      return `update contact "${cmd.contactName}": ${parts.join(', ')}`
    }
    case 'file-under':
      return `file attachments under "${cmd.dealName}"`
    case 'move-file':
      return `move file "${cmd.fileName}" to "${cmd.dealName}"`
  }
}
