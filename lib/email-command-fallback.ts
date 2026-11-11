// ── Smart fallback for off-grammar email commands ───────────────────────────
// Runs AFTER the deterministic parsers, on command-position text ONLY (a
// digest reply's extracted top text, a forward's note, a fresh command
// email's body — never forwarded/quoted content). Lines that look like
// attempted instructions but matched no grammar go through ONE LLM
// classification pass (lib/email-command-classifier.ts):
//
//   high confidence → executed exactly like the deterministic equivalent;
//     the outcome event carries the original line + "interpreted as: …"
//   low confidence  → NOT executed. A queue item stores the structured
//     interpretation; the digest reports it as "I think you meant: … —
//     approve?" and approving (UI or digest reply) executes the stored
//     interpretation with no re-classification (lib/intake-queue-actions.ts)
//   Pass / Dead interpretations → ALWAYS queue, even at high confidence
//   unclassifiable  → a failed outcome is recorded; nothing is done
//
// Internal-sender trust is enforced by the callers (the same bar as every
// other command path); this module never sees external mail.

import { sendAssistantReply } from './email-ask'
import { upsertContacts } from './contacts'
import { fileNoteForContact } from './intake-note'
import { recordIntakeEvent, type IntakeEventInput } from './intake-events'
import {
  HIGH_CONFIDENCE,
  classifyCommandWithLLM,
  describeInterpretation,
  type Classification,
  type ClassifyFn,
  type InterpretedCommand,
} from './email-command-classifier'
import {
  executeActionCommand,
  type ActionCommandDeps,
  type CommandOutcome,
} from './email-command-actions'

export interface FallbackContext {
  from: string
  fromName: string
  subject: string
  messageId: string
  noteDate: string
  surface: 'forward' | 'reply'
  attachments?: { name: string; buffer: Buffer }[]
  /** Records a done/failed outcome in the caller's event kinds. */
  record: (ok: boolean, summary: string, extra?: Partial<IntakeEventInput>) => Promise<void>
  adapters?: {
    /** Reply-surface only: approve/reject a digest item by number or name. */
    decide?: (verb: 'approve' | 'reject', ref: string) => Promise<CommandOutcome>
  }
}

export interface FallbackDeps {
  classify?: ClassifyFn
  actionDeps?: ActionCommandDeps
}

export interface FallbackOutcome {
  line: string
  status: 'done' | 'failed' | 'queued'
  summary: string
}

const INSTRUCTION_VERBS = [
  'change', 'move', 'update', 'file', 'log', 'note', 'ask', 'approve',
  'reject', 'dismiss', 'add', 'save', 'put', 'mark', 'set', 'kill',
  'pass', 'park', 'send', 'store', 'create', 'close',
]
const VERB_START_RE = new RegExp(
  `^(?:please\\s+|can\\s+you\\s+|could\\s+you\\s+)?(${INSTRUCTION_VERBS.join('|')})\\b`,
  'i',
)
const POSSESSIVE_UPDATE_RE = /\b(?:'s|his|her|their)\s+new\s+(number|phone|email|title|company)\b/i
const BARE_STAGE_MOVE_RE = /\bto\s+(teaser|reviewing|pre-loi|loi|exclusivity|hold|pass|dead|closed)\b/i

/**
 * Cheap gate for "this line tried to be an instruction". Deliberately
 * start-anchored (plus a couple of possessive-update shapes) so ordinary
 * prose mid-paragraph is never classified. The classifier itself is the
 * second gate — it returns null for anything that isn't a CRM instruction.
 */
export function looksLikeInstruction(line: string): boolean {
  const t = (line ?? '').trim()
  if (t.length < 4 || t.length > 300) return false
  if (VERB_START_RE.test(t)) return true
  if (POSSESSIVE_UPDATE_RE.test(t)) return true
  if (BARE_STAGE_MOVE_RE.test(t) && /\b(deal|project|company)\b/i.test(t)) return true
  return false
}

/** HARD RULE: interpretations that would move a deal to a Pass stage or Dead never auto-execute. */
export function isPassOrDeadInterpretation(cmd: InterpretedCommand): boolean {
  return (
    cmd.type === 'action' &&
    cmd.command.type === 'change-stage' &&
    (cmd.command.stage === 'Dead' || cmd.command.stage.startsWith('Pass'))
  )
}

/**
 * Execute an interpretation (high-confidence path, or a stored one being
 * approved from the queue). Returns the outcome; recording is the caller's
 * job, except outcomes that queue internally (ambiguous names), which
 * record their own 'ambiguous' event like the deterministic paths do.
 */
export async function executeInterpretedCommand(
  supabase: any,
  interp: InterpretedCommand,
  ctx: FallbackContext,
  meta: { originalLine: string; interpretedAs: string; confidence: number },
  deps: FallbackDeps = {},
): Promise<CommandOutcome> {
  if (interp.type === 'action') {
    return executeActionCommand(supabase, interp.command, {
      from: ctx.from,
      subject: ctx.subject,
      messageId: ctx.messageId,
      surface: ctx.surface === 'reply' ? 'reply' : 'forward',
      record: 'none',
      attachments: ctx.attachments,
      interpreted: { originalLine: meta.originalLine, interpretedAs: meta.interpretedAs, confidence: meta.confidence },
    }, deps.actionDeps)
  }
  if (interp.type === 'note') {
    const filed = await fileNoteForContact(supabase, {
      name: interp.contactName,
      noteBody: interp.noteText,
      from: ctx.from,
      subject: ctx.subject,
      messageId: ctx.messageId,
      noteDate: ctx.noteDate,
    })
    if (filed.outcome === 'filed') {
      return { status: 'done', summary: `Note filed under ${interp.contactName}`, contact_id: filed.contactId }
    }
    return { status: 'queued', summary: `Note for "${interp.contactName}" was queued instead — ${filed.ambiguity}`, queue_id: filed.queueId ?? null }
  }
  if (interp.type === 'log-contact') {
    const { created, existing } = await upsertContacts(
      supabase,
      interp.contacts.map(p => ({ name: p.name, firm: p.company ?? null, role: 'Other' })),
      null,
      { fillBlanks: true },
    )
    const parts = [
      created.length ? `added ${created.join(', ')}` : '',
      existing.length ? `already in Nexus: ${existing.join(', ')}` : '',
    ].filter(Boolean)
    return { status: 'done', summary: `Contacts: ${parts.join(' · ') || 'none added'}` }
  }
  if (interp.type === 'ask') {
    try {
      // Lazy import: assistant-core constructs API clients at module scope,
      // so it must not enter this module's static import graph (unit tests
      // import the fallback without env credentials).
      const { runAgentToText } = await import('./assistant-core')
      const { text: answer } = await runAgentToText(interp.question, {
        channel: 'email',
        senderName: ctx.fromName || ctx.from.split('@')[0],
      })
      await sendAssistantReply({ to: ctx.from, subject: ctx.subject, answer, inReplyTo: ctx.messageId || undefined })
      return { status: 'done', summary: `Answered your ask: "${interp.question.slice(0, 80)}"` }
    } catch (e: any) {
      return { status: 'failed', summary: `Ask failed — ${e?.message || 'unknown error'}` }
    }
  }
  // decide — only meaningful on the reply surface, via the caller's adapter.
  if (!ctx.adapters?.decide) {
    return { status: 'failed', summary: `"${meta.interpretedAs}" can only be carried out from the digest reply itself` }
  }
  return ctx.adapters.decide(interp.verb, interp.ref)
}

/** Queue an interpretation for approval, storing it verbatim on the item. */
async function queueInterpretation(
  supabase: any,
  cls: Classification,
  line: string,
  ctx: FallbackContext,
  reason: 'low-confidence' | 'pass-dead',
): Promise<FallbackOutcome> {
  const text = describeInterpretation(cls.command)
  const { data: queued } = await supabase.from('intake_queue').insert({
    source: 'email',
    doc_type: 'other',
    file_name: ctx.subject.slice(0, 200),
    from_email: ctx.from,
    extracted: {
      _kind: 'email-command',
      _interpretation: cls.command,
      _interpretation_text: text,
      _original_line: line,
      _confidence: cls.confidence,
      _queue_reason: reason,
      _command_source: 'llm-interpreted',
      _from: ctx.from,
      _subject: ctx.subject,
      _message_id: ctx.messageId,
      _note_date: ctx.noteDate,
    },
    status: 'pending',
  }).select('id').single()
  const summary = reason === 'pass-dead'
    ? `I think you meant: ${text} — approve? (Pass/Dead changes always need approval)`
    : `I think you meant: ${text} — approve?`
  await recordIntakeEvent(supabase, {
    kind: 'ambiguous',
    summary,
    detail: {
      reason: reason === 'pass-dead'
        ? 'Interpreted Pass/Dead change — always queued for approval'
        : `Interpreted "${line}" with low confidence (${cls.confidence})`,
      candidates: [],
      interpretation: text,
      original_line: line,
      confidence: cls.confidence,
      from: ctx.from,
    },
    queue_id: queued?.id ?? null,
    message_id: ctx.messageId || null,
  })
  return { line, status: 'queued', summary }
}

/**
 * Run the fallback over candidate lines. Returns handled=true when at least
 * one line was attempted (executed, queued, or recorded unclassifiable) —
 * callers use that to stop normal intake processing for command emails.
 */
export async function runSmartFallback(
  supabase: any,
  lines: string[],
  ctx: FallbackContext,
  deps: FallbackDeps = {},
): Promise<{ handled: boolean; outcomes: FallbackOutcome[] }> {
  const classify = deps.classify ?? classifyCommandWithLLM
  const outcomes: FallbackOutcome[] = []
  let handled = false

  for (const rawLine of lines) {
    const line = (rawLine ?? '').trim()
    if (!looksLikeInstruction(line)) continue
    handled = true

    let cls: Classification | null = null
    try {
      cls = await classify(line, ctx.surface)
    } catch {
      cls = null
    }
    if (!cls) {
      const summary = `Could not interpret: "${line}"`
      await ctx.record(false, summary, { detail: { original_line: line, interpreted: false } })
      outcomes.push({ line, status: 'failed', summary })
      continue
    }

    const text = describeInterpretation(cls.command)

    // A low-confidence approve/reject of a digest item is never queued —
    // by approval time the batch reference is stale. Fail it honestly.
    if (cls.command.type === 'decide' && cls.confidence < HIGH_CONFIDENCE) {
      const summary = `Not carried out: "${line}" — deciding a digest item needs the exact form, e.g. "approve 2"`
      await ctx.record(false, summary, { detail: { original_line: line, interpreted_as: text, confidence: cls.confidence } })
      outcomes.push({ line, status: 'failed', summary })
      continue
    }

    if (cls.confidence < HIGH_CONFIDENCE) {
      outcomes.push(await queueInterpretation(supabase, cls, line, ctx, 'low-confidence'))
      continue
    }
    if (isPassOrDeadInterpretation(cls.command)) {
      outcomes.push(await queueInterpretation(supabase, cls, line, ctx, 'pass-dead'))
      continue
    }

    const outcome = await executeInterpretedCommand(
      supabase, cls.command, ctx,
      { originalLine: line, interpretedAs: text, confidence: cls.confidence },
      deps,
    )
    if (outcome.status === 'queued') {
      // The executor already recorded an 'ambiguous' event for this.
      outcomes.push({ line, status: 'queued', summary: outcome.summary })
      continue
    }
    await ctx.record(outcome.status === 'done', outcome.summary, {
      detail: { interpreted: true, original_line: line, interpreted_as: text, confidence: cls.confidence },
      deal_id: outcome.deal_id ?? null,
      contact_id: outcome.contact_id ?? null,
      queue_id: outcome.queue_id ?? null,
    })
    outcomes.push({ line, status: outcome.status, summary: outcome.summary })
  }

  return { handled, outcomes }
}

/**
 * Execute a stored interpretation when its queue item is approved
 * (lib/intake-queue-actions.ts). No re-classification — the stored
 * structure is executed as-is, and the outcome is recorded as a
 * command-action / command-failed event noting the approval.
 */
export async function executeStoredInterpretation(
  supabase: any,
  extracted: Record<string, any>,
  deps: FallbackDeps = {},
): Promise<CommandOutcome> {
  const interp = extracted._interpretation as InterpretedCommand | undefined
  if (!interp) {
    return { status: 'failed', summary: 'This item has no stored interpretation to execute' }
  }
  const ctx: FallbackContext = {
    from: extracted._from ?? '',
    fromName: '',
    subject: extracted._subject ?? '',
    messageId: extracted._message_id ?? '',
    noteDate: extracted._note_date ?? '',
    surface: 'forward',
    record: async () => {},
  }
  const outcome = await executeInterpretedCommand(supabase, interp, ctx, {
    originalLine: extracted._original_line ?? '',
    interpretedAs: extracted._interpretation_text ?? describeInterpretation(interp),
    confidence: extracted._confidence ?? 0,
  }, deps)
  if (outcome.status !== 'queued') {
    await recordIntakeEvent(supabase, {
      kind: outcome.status === 'done' ? 'command-action' : 'command-failed',
      summary: `${outcome.summary} (approved interpretation of "${extracted._original_line ?? ''}")`,
      detail: {
        interpreted: true,
        original_line: extracted._original_line ?? '',
        interpreted_as: extracted._interpretation_text ?? '',
        approved_from_queue: true,
      },
      deal_id: outcome.deal_id ?? null,
      contact_id: outcome.contact_id ?? null,
      message_id: extracted._message_id || null,
    })
  }
  return outcome
}
