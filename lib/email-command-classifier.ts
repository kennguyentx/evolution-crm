// ── LLM classifier for off-grammar email commands (smart fallback) ─────────
// The deterministic parsers (lib/email-commands.ts, lib/email-action-
// commands.ts) run first, always. A command-position line they don't match
// — but that still looks like an attempted instruction — gets ONE pass
// through this classifier, which maps it onto the known command vocabulary
// and reports a confidence. The fallback orchestrator
// (lib/email-command-fallback.ts) decides what happens next:
//
//   high confidence  → execute like the deterministic equivalent
//   low confidence   → queue as "I think you meant: … — approve?"
//   Pass / Dead      → ALWAYS queue, even at high confidence
//   no mapping       → failed outcome, nothing done
//
// SCOPE RULE: the classifier only ever sees command-position text — a digest
// reply's extracted top text, a forward's note, a fresh command email's
// body. Forwarded/quoted content is never passed here (the callers' text
// extraction guarantees that), so prose in a forwarded thread can never
// become a command.
//
// The classifier is an injectable interface (tests stub it — no live API in
// tests); the default implementation mirrors the intake LLM fallback's
// plumbing (Anthropic SDK, fast model, JSON-only response).

import Anthropic from '@anthropic-ai/sdk'
import { AI_MODELS } from './ai-config'
import { parseAiJson, extractText } from './ai-json'
import { STAGE_SYNONYMS, DEAL_TYPE_SYNONYMS, type Stage, type DealType } from './email-commands'
import { describeActionCommand, type ActionCommand } from './email-action-commands'

/** At or above this confidence an interpretation may auto-execute. */
export const HIGH_CONFIDENCE = 0.8

export type InterpretedCommand =
  | { type: 'action'; command: ActionCommand }
  | { type: 'note'; contactName: string; noteText: string }
  | { type: 'log-contact'; contacts: { name: string; company: string | null }[] }
  | { type: 'ask'; question: string }
  /** Digest-reply surface only: decide a queued digest item by number or name. */
  | { type: 'decide'; verb: 'approve' | 'reject'; ref: string }

export interface Classification {
  command: InterpretedCommand
  /** 0..1 — the model's self-reported certainty that this is the intent. */
  confidence: number
}

export type ClassifyFn = (
  line: string,
  surface: 'forward' | 'reply',
) => Promise<Classification | null>

const VALID_STAGES = new Set<string>(Object.values(STAGE_SYNONYMS))
const VALID_DEAL_TYPES = new Set<string>(Object.values(DEAL_TYPE_SYNONYMS))

function cleanStr(v: any): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Validate/normalize a raw classifier JSON payload into an
 * InterpretedCommand. Anything malformed or outside the vocabulary returns
 * null (unclassifiable) — the model proposes, this disposes.
 */
export function normalizeClassification(raw: any, line: string): Classification | null {
  if (!raw || typeof raw !== 'object') return null
  const confidence = typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0
  const c = raw.command
  if (!c || typeof c !== 'object' || typeof c.type !== 'string') return null

  switch (c.type) {
    case 'change-stage': {
      const dealName = cleanStr(c.deal_name)
      const stage = cleanStr(c.stage)
      if (!dealName || !stage || !VALID_STAGES.has(stage)) return null
      const dealType = cleanStr(c.deal_type)
      if (dealType && !VALID_DEAL_TYPES.has(dealType)) return null
      return {
        confidence,
        command: {
          type: 'action',
          command: { type: 'change-stage', dealName, stage: stage as Stage, dealType: (dealType as DealType) ?? null, raw: line },
        },
      }
    }
    case 'update-deal': {
      const dealName = cleanStr(c.deal_name)
      const f = c.fields ?? {}
      const fields: Record<string, any> = {}
      if (cleanStr(f.type)) {
        if (!VALID_DEAL_TYPES.has(f.type)) return null
        fields.deal_type = f.type
      }
      if (cleanStr(f.portco)) fields.parent_portco = f.portco
      if (cleanStr(f.sector)) fields.sector = f.sector
      if (cleanStr(f.geography)) fields.geography = f.geography
      if (!dealName || !Object.keys(fields).length) return null
      return { confidence, command: { type: 'action', command: { type: 'update-deal', dealName, fields, raw: line } } }
    }
    case 'update-contact': {
      const contactName = cleanStr(c.contact_name)
      const f = c.fields ?? {}
      const fields: Record<string, any> = {}
      if (cleanStr(f.phone)) fields.phone = f.phone
      if (cleanStr(f.title)) fields.title = f.title
      if (cleanStr(f.company)) fields.firm = f.company
      if (cleanStr(f.email)) fields.email = f.email
      if (!contactName || !Object.keys(fields).length) return null
      return { confidence, command: { type: 'action', command: { type: 'update-contact', contactName, fields, raw: line } } }
    }
    case 'move-file': {
      const fileName = cleanStr(c.file_name)
      const dealName = cleanStr(c.deal_name)
      if (!fileName || !dealName) return null
      return { confidence, command: { type: 'action', command: { type: 'move-file', fileName, dealName, raw: line } } }
    }
    case 'file-under': {
      const dealName = cleanStr(c.deal_name)
      if (!dealName) return null
      return { confidence, command: { type: 'action', command: { type: 'file-under', dealName, raw: line } } }
    }
    case 'note': {
      const contactName = cleanStr(c.contact_name)
      const noteText = cleanStr(c.note_text)
      if (!contactName || !noteText) return null
      return { confidence, command: { type: 'note', contactName, noteText } }
    }
    case 'log-contact': {
      const contacts = (Array.isArray(c.contacts) ? c.contacts : [])
        .map((p: any) => ({ name: cleanStr(p?.name) ?? '', company: cleanStr(p?.company) }))
        .filter((p: any) => p.name)
      if (!contacts.length) return null
      return { confidence, command: { type: 'log-contact', contacts } }
    }
    case 'ask': {
      const question = cleanStr(c.question)
      if (!question) return null
      return { confidence, command: { type: 'ask', question } }
    }
    case 'approve':
    case 'reject': {
      const ref = cleanStr(c.ref)
      if (!ref) return null
      return { confidence, command: { type: 'decide', verb: c.type, ref } }
    }
    default:
      return null
  }
}

/** Human-readable one-liner for an interpretation — digests, queue items, logs. */
export function describeInterpretation(cmd: InterpretedCommand): string {
  switch (cmd.type) {
    case 'action':
      return describeActionCommand(cmd.command)
    case 'note':
      return `note for "${cmd.contactName}": ${cmd.noteText.slice(0, 120)}`
    case 'log-contact':
      return `log new contact ${cmd.contacts.map(p => (p.company ? `${p.name} at ${p.company}` : p.name)).join(', ')}`
    case 'ask':
      return `ask: ${cmd.question.slice(0, 120)}`
    case 'decide':
      return `${cmd.verb} ${cmd.ref}`
  }
}

// ── Default LLM implementation ────────────────────────────────────────────────

const CLASSIFIER_SYSTEM = `You map ONE line of an email from a CRM user onto the CRM's command vocabulary. Return ONLY valid JSON.

The user writes short instructions to a CRM ("Nexus") by email. The line you get did NOT match the strict command grammar, so it is phrased freely ("kill the Anchor deal", "Jane's new number is 214-555-0100", "put the CIM in Anchor's folder"). Map it to the closest command:

{
  "command": {
    "type": "change-stage" | "update-deal" | "update-contact" | "move-file" | "file-under" | "note" | "log-contact" | "ask" | "approve" | "reject",
    ...fields per type below
  } | null,
  "confidence": 0.0 to 1.0 — how certain you are this mapping is exactly what the user meant
}

Fields per type:
- change-stage: { "deal_name": string, "stage": exact stage string, "deal_type": "platform"|"add-on"|"growth"|"recap"|null }
- update-deal: { "deal_name": string, "fields": { "type"?, "portco"?, "sector"?, "geography"? } }
- update-contact: { "contact_name": string, "fields": { "phone"?, "title"?, "company"?, "email"? } }
- move-file: { "file_name": string, "deal_name": string }
- file-under: { "deal_name": string }  (the email's attachments go into that deal's folder)
- note: { "contact_name": string, "note_text": string }
- log-contact: { "contacts": [{ "name": string, "company": string|null }] }
- ask: { "question": string }
- approve / reject: { "ref": string }  (a digest item number like "2" or an item name; digest replies only)

Stages (exact strings): Teaser | Reviewing | Pre-LOI | LOI Submitted | Exclusivity | Pass (DOA) | Pass (Pre-LOI) | Pass (Post-LOI) | Hold | Dead | Closed (Platform) | Closed (Add-On).
"kill", "pass on", "not for us" → Pass (DOA) unless a pre/post-LOI qualifier is stated. "park" → Hold. "done deal"/"we closed it" → Closed (Platform) (Closed (Add-On) if the deal is described as an add-on).

Rules:
- If the line is NOT an instruction to the CRM (greetings, prose, commentary, a signature, a question about the email itself), return {"command": null, "confidence": 0}.
- Never invent a deal name, contact name, file name, or value that isn't in the line.
- A value you're unsure you read correctly (a phone number, an email) lowers confidence — do not guess digits.
- confidence ≥ 0.9 only when the intent and every value are unambiguous.`

/** The production classifier: one Haiku call per off-grammar line. */
export const classifyCommandWithLLM: ClassifyFn = async (line, surface) => {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const response = await anthropic.messages.create({
    model: AI_MODELS.fast,
    max_tokens: 400,
    system: CLASSIFIER_SYSTEM,
    messages: [{
      role: 'user',
      content: `Surface: ${surface === 'reply' ? 'a reply to the daily intake digest (approve/reject of digest items is possible)' : 'a forwarded or fresh email to the intake inbox'}\nLine: ${line}`,
    }],
  })
  try {
    const parsed = parseAiJson<any>(extractText(response.content as any))
    if (!parsed?.command) return null
    return normalizeClassification(parsed, line)
  } catch {
    return null
  }
}
