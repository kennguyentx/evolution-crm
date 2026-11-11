import { resolveDealStatus, resolveEffectiveStage, resolveIntakeStage } from '@/lib/intake-stage'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { upsertContacts } from '@/lib/contacts'
import { parseEmailCommand, type ParsedEmailCommand } from '@/lib/email-commands'
import { parseActionCommands } from '@/lib/email-action-commands'
import { executeActionCommand } from '@/lib/email-command-actions'
import { runSmartFallback } from '@/lib/email-command-fallback'
import { fileNoteForContact } from '@/lib/intake-note'
import { extractEmailSignature, enrichContactsFromSignature, parseForwardedFrom } from '@/lib/email-signature'
import { recordIntakeEvent, fetchDigestBatch, fetchLatestDigestBatch, type IntakeEvent, type IntakeEventInput } from '@/lib/intake-events'
import { flattenDigestEvents } from '@/lib/digest-format'
import { findDigestBatch, isDigestReplySubject, extractReplyText, parseReplyInstructions, resolveByNumber, findByName, type ReplyInstruction } from '@/lib/digest-reply'
import { approveQueueItem, rejectQueueItem, type QueueActionEdited } from '@/lib/intake-queue-actions'
import { dropboxConfigured, dropboxUpload, dropboxMove, expectedDropboxFolder, uniqueDropboxFolder } from '@/lib/dropbox'
import { parseAiJson, extractText } from '@/lib/ai-json'
import { AI_MODELS } from '@/lib/ai-config'
import { runAgentToText } from '@/lib/assistant-core'
import { isAskEmail, stripAskPrefix, topOfBody, sendAssistantReply } from '@/lib/email-ask'
import { processAttachment } from '@/lib/email-doc-extract'
import { sendDealNotification } from '@/lib/deal-notify'
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit'
import { withErrorHandler } from '@/lib/api-response'
import { createLogger } from '@/lib/log'

const log = createLogger('email-intake')

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const STORAGE_BUCKET = 'intake-temp'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Resolve an attachment's buffer — supports both inline base64 (Postmark direct)
// and storage-path references uploaded by the email-server relay.
async function resolveAttachmentBuffer(att: any, supabase: ReturnType<typeof serviceClient>): Promise<Buffer | null> {
  if (att.StoragePath) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(att.StoragePath)
    if (error || !data) {
      log.error(`Storage download failed for ${att.StoragePath}:`, error?.message)
      return null
    }
    const buf = Buffer.from(await data.arrayBuffer())
    // Best-effort cleanup; don't await so it doesn't block processing
    supabase.storage.from(STORAGE_BUCKET).remove([att.StoragePath]).catch(() => {})
    return buf
  }
  if (att.Content) {
    return Buffer.from(att.Content, 'base64')
  }
  return null
}

// ── Email body prompt ─────────────────────────────────────────────────────────
const EMAIL_SYSTEM_PROMPT = `You extract structured information from forwarded emails for a CRM. Return ONLY valid JSON.

{
  "summary": "string — 1-3 sentence factual summary",
  "next_steps": "string or null — explicit action items or follow-ups",
  "deal_names": ["string array — prospective deal/target company names mentioned"],
  "portco_names": ["string array — names of OUR EXISTING PORTFOLIO COMPANIES mentioned. These are companies we already own, not acquisition targets."],
  "contacts": [
    {
      "name": "Full Name",
      "email": "email or null",
      "phone": "phone or null",
      "firm": "company / firm or null",
      "title": "job title or null",
      "role": "Source / Banker | Management | Advisor | Lender | Other"
    }
  ],
  "logged_by": "string or null — first name of person who forwarded this"
}

Rules:
- factual only, no opinions, null/[] if nothing found.
- For contacts: extract EVERY named person mentioned ANYWHERE in the email — including the original sender, anyone in the email signature, bankers, brokers, sellers, management team members, advisors. Match emails from "From:" lines, "To:" lines, signatures, and inline references. If a name appears without a discoverable email, still include them with email: null.
- Skip anyone with an @evolutionstrategy.com email.
- "role": "Source / Banker" for bankers/brokers/M&A advisors; "Management" for target-company executives; "Advisor" for lawyers/accountants; "Lender" for debt providers; "Other" for everyone else.`

// ── Normalize a Dropbox path to a folder (strip filename if present) ──────────
function toFolder(p: string | null | undefined): string | null {
  if (!p) return null
  const last = p.split('/').pop() ?? ''
  return last.includes('.') ? p.substring(0, p.lastIndexOf('/')) : p
}

// ── Get today's date in US Central time ───────────────────────────────────────
// Vercel runs in UTC. Using toISOString() can return tomorrow's date for US
// evening hours. Always format in America/Chicago (CST/CDT) so notes are
// dated correctly regardless of when the serverless function runs.
function todayCST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

// ── Rebuild the forwarder's command as a one-line summary for the queue UI ──
// (the parser returns slots, not the matched text).
function commandSummary(cmd: ParsedEmailCommand): string | null {
  if (cmd.kind === 'log-deal') {
    return `log as ${cmd.stage ?? '?'}${cmd.deal_type ? ` as ${cmd.deal_type}` : ''}${cmd.parent_portco ? ` for ${cmd.parent_portco}` : ''}`
  }
  if (cmd.kind === 'log-contact') {
    if (!cmd.contactNames.length) return 'log new contact'
    const parts = cmd.contacts.length
      ? cmd.contacts.map(c => (c.company ? `${c.name} at ${c.company}` : c.name))
      : cmd.contactNames
    return `log new contact ${parts.join(', ')}`
  }
  if (cmd.kind === 'note' && cmd.contactName) return `note for ${cmd.contactName}`
  return null
}

// ── Parse forwarding note for explicit instructions ───────────────────────────
// ── Filter out internal email addresses ───────────────────────────────────────
function isInternal(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase().endsWith('@evolutionstrategy.com')
}

function filterInternalContacts(contacts: any[]): any[] {
  return contacts.filter(c => !isInternal(c.email))
}

async function parseForwardingNote(bodyText: string, emailHeaders: { from: string; fromName: string; cc: any[] }): Promise<{
  stage: string | null
  deal_name: string | null
  portco_name: string | null
  status: string | null
  deal_type: string | null
  parent_portco: string | null
  forwarder_note: string | null
  auto_approve: boolean
  contacts: any[]
}> {
  const empty = { stage: null, deal_name: null, portco_name: null, status: null, deal_type: null, parent_portco: null, forwarder_note: null, auto_approve: false, contacts: [] }
  if (!bodyText?.trim()) return empty

  // Build CC contact list from headers directly
  const headerContacts: any[] = emailHeaders.cc
    .filter(c => c.Email && !isInternal(c.Email))
    .map(c => ({
      name:  c.Name || c.Email.split('@')[0],
      email: c.Email,
      firm:  null, title: null, role: 'Other', phone: null,
    }))

  const response = await anthropic.messages.create({
    model: AI_MODELS.fast,
    max_tokens: 600,
    system: `Extract deal instructions AND contact info from a forwarding note. Return ONLY valid JSON.

{
  "stage": "exact stage or null — one of: Teaser | Reviewing | Pre-LOI | LOI Submitted | Exclusivity | Closed (Platform) | Closed (Add-On) | Pass (DOA) | Pass (Pre-LOI) | Pass (Post-LOI) | Hold",
  "deal_name": "string or null — name of a SPECIFIC EXISTING DEAL to link this document to (e.g. 'for Project Anchor', 're: Anchor deal'). Only set if the sender is linking to a previously-created deal by a project codename or company name. Do NOT set this to a portfolio company name when the sender is describing an add-on acquisition.",
  "portco_name": "string or null — name of OUR EXISTING PORTFOLIO COMPANY this email note should be filed under. Set when the sender explicitly wants to attach a note/article/update to a portco they already own (e.g. 'portco: Ethoscapes', 'file under Ethoscapes', 'industry note for Ethoscapes'). Do NOT set for acquisition targets or add-ons.",
  "status": "Active | Dead | Closed | null",
  "deal_type": "platform | add-on | null",
  "parent_portco": "string or null — name of our EXISTING PORTFOLIO COMPANY that would acquire this target. Set when sender uses language like 'add-on for Amped', 'under Amped', 'bolt-on for Amped', 'for the Amped platform'. This is NOT the target company — it is the acquirer we already own.",
  "forwarder_note": "any context or commentary the sender added, else null",
  "auto_approve": true or false — true if the sender made an explicit decision about how to log this deal. Examples that should be TRUE: "pass", "pass on this", "not for us", "no thanks", "skip", "hold", "park this", "closed", "done deal", "log as teaser", "log as pre-LOI", "log as <stage>" (any "log as <stage>" instruction is an explicit decision to log at that stage), or any clear stage like "submitted LOI". Default to TRUE for these short decisive phrases even without other context. Default to FALSE only when the email is purely informational (asking a question, sharing news, etc.).

  When auto_approve is true, ALSO set "stage" to the appropriate value:
  - "pass", "not for us", "no thanks", "skip" → "Pass (DOA)"
  - "pass post-LOI", "passed after LOI" → "Pass (Post-LOI)"
  - "pass pre-LOI" → "Pass (Pre-LOI)"
  - "hold", "park" → "Hold"
  - "submitted LOI", "LOI out" → "LOI Submitted"
  - "log as teaser" / "log as pre-LOI" / "log as hold" → the named stage (Teaser / Pre-LOI / Hold, etc.)
  - "closed", "done" → "Closed (Platform)" (or "Closed (Add-On)" if context suggests),
  "contacts": [
    {
      "name": "Full Name",
      "email": "email or null",
      "phone": "phone or null",
      "firm": "company or null",
      "title": "job title or null",
      "role": "Source / Banker | Management | Advisor | Lender | Other"
    }
  ]
}

For contacts: extract all named people mentioned in the email body — bankers, advisors, sellers, management.
Do NOT include people with @evolutionstrategy.com emails.
If no contacts found, return contacts: [].`,
    messages: [{ role: 'user', content: `Forwarding note (text BEFORE the forwarded content, which is the user's actual instruction):\n${bodyText.split(/\n-{3,}|\nFrom:|_+\nFrom:/i)[0].slice(0, 800)}` }],
  })

  try {
    const parsed = parseAiJson<any>(extractText(response.content as any))
    // Merge header CC contacts with body-extracted contacts, dedupe by email
    const bodyContacts = filterInternalContacts(parsed.contacts ?? [])
    const merged = [...headerContacts]
    for (const c of bodyContacts) {
      if (!c.email || !merged.some(m => m.email?.toLowerCase() === c.email?.toLowerCase())) {
        merged.push(c)
      }
    }
    return { ...parsed, contacts: merged }
  } catch {
    return { ...empty, contacts: headerContacts }
  }
}

const ADD_NAME_STOPWORDS = new Set([
  'to','note','deal','this','that','them','it','its','the','a','an','me','my','new',
  'contact','contacts','him','her','his','their','and','as','in','on','for','all',
  'please','both','these','those','everyone','people','person',
])

// Parse an "add … contacts" / "add <name>" / "log new contact" instruction from
// the forwarder's own note (top of the body) or the subject — NOT the forwarded
// thread below it.
// Handles: "add contacts", "add nick dreps to contacts", "add John Smith",
// "save Nick Dreps and Jane Doe as contacts", "log new contact",
// "log Jane Doe as contacts", lowercase names, etc.
// NOTE: "log" is in the verb set, but "log as <stage> …" (a deal command) can
// never trigger here — its name extraction yields nothing and there is no
// "contact" word, so trigger stays false. The deterministic parser
// (parseEmailCommand, kind 'log-contact') is checked first in POST anyway.
function parseAddContactInstruction(topNote: string, subject: string): { trigger: boolean; names: string[] } {
  const combined = `${subject}\n${topNote}`.trim()
  if (!/\b(add|save|file|store|log)\b/i.test(combined)) return { trigger: false, names: [] }

  const contactIntent = /\bcontacts?\b/i.test(combined)

  const names: string[] = []
  // Grab the text after each add/save/file/store/log verb, within a line
  const re = /\b(?:add|save|file|store|log)\s+(.+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(combined)) !== null) {
    let rest = m[1]
    // Drop a trailing "to / as / into … contacts" clause
    rest = rest.replace(/\b(to|as|into|in|under|for)\b.*$/i, ' ').trim()
    // Drop a leading "a/the/new contact(s)" label
    rest = rest.replace(/^(a\s+|the\s+|new\s+)?contacts?\b[:,\-]?\s*/i, '').trim()
    // Split multiple names on commas / "and" / "&"
    for (const piece of rest.split(/\s*(?:,|;|&|\band\b)\s*/i)) {
      // Keep the leading run of name-like words (letters, ., ', -)
      const words: string[] = []
      for (const w of piece.trim().split(/\s+/)) {
        if (/^[A-Za-z][A-Za-z.'’\-]*$/.test(w)) words.push(w)
        else break
      }
      if (!words.length) continue
      if (ADD_NAME_STOPWORDS.has(words[0].toLowerCase())) continue
      names.push(words.slice(0, 4).join(' '))
    }
  }

  // A name is "strong" (enough to trigger on its own, no "contact" word needed)
  // when it's capitalized or has 2+ words — avoids false-firing on "add pricing".
  const strongName = names.some(n => /^[A-Z]/.test(n) || n.split(/\s+/).length >= 2)

  return { trigger: contactIntent || strongName, names }
}

// ── Digest replies ────────────────────────────────────────────────────────────
// A reply to the daily digest comes back to this same inbox (the digest's
// ReplyTo is the intake address). It is recognized by the [NEXUS-DIGEST <ts>]
// marker in the quoted body — or, failing that, by its subject — and ONLY
// from internal senders, the same trust bar as every other command path.
// Ken's own text (above the quote) is parsed line by line as instructions
// (lib/digest-reply.ts); the quoted digest is never re-classified as intake.
// Every instruction's outcome is recorded as a reply-action / reply-failed
// intake event, so the NEXT digest confirms what the reply did.

interface DigestReplyCtx {
  ordered: IntakeEvent[]
  from: string
  fromName: string
  subject: string
  messageId: string
  noteDate: string
  record: (ok: boolean, summary: string, extra?: Partial<IntakeEventInput>) => Promise<void>
}

async function executeReplyInstruction(
  supabase: ReturnType<typeof serviceClient>,
  ins: ReplyInstruction,
  ctx: DigestReplyCtx,
): Promise<{ instruction: string; ok: boolean; summary: string }> {
  const { ordered, record } = ctx
  const done = async (summary: string, extra?: Partial<IntakeEventInput>) => {
    await record(true, summary, extra)
    return { instruction: ins.raw, ok: true, summary }
  }
  const fail = async (summary: string, extra?: Partial<IntakeEventInput>) => {
    await record(false, summary, extra)
    return { instruction: ins.raw, ok: false, summary }
  }
  const detail = { instruction: ins.raw }

  if (ins.type === 'invalid') {
    return fail(`Reply instruction not carried out: "${ins.raw}"`, { detail: { ...detail, reason: ins.reason } })
  }

  // ── approve / reject a queued item from the digest ──────────────────────
  if (ins.type === 'approve' || ins.type === 'reject') {
    const verb = ins.type
    let event: IntakeEvent | null = null
    let label = ''
    if (ins.ref.kind === 'number') {
      event = resolveByNumber(ordered, ins.ref.n)
      if (!event) {
        return fail(`Reply: no item #${ins.ref.n} in the digest (it had ${ordered.length} item${ordered.length !== 1 ? 's' : ''}) — nothing was ${verb === 'approve' ? 'approved' : 'rejected'}`, { detail })
      }
      label = `item #${ins.ref.n}`
    } else {
      const matches = findByName(ordered, ins.ref.name).filter(e => e.queue_id)
      if (matches.length === 0) {
        return fail(`Reply: no queued item in the digest matches "${ins.ref.name}"`, { detail })
      }
      if (matches.length > 1) {
        return fail(`Reply: "${ins.ref.name}" matches ${matches.length} queued items — use the item number instead`, { detail })
      }
      event = matches[0]
      label = `item #${ordered.indexOf(event) + 1}`
    }
    if (!event.queue_id) {
      return fail(`Reply: ${label} ("${event.summary}") has no queued item to ${verb}`, { detail })
    }
    const { data: item } = await supabase.from('intake_queue').select('*').eq('id', event.queue_id).single()
    if (!item) {
      return fail(`Reply: the queued item for ${label} no longer exists`, { detail, queue_id: event.queue_id })
    }

    if (verb === 'reject') {
      if (item.status === 'approved') {
        return fail(`Reply: ${label} ("${event.summary}") is already approved — it can't be rejected by reply`, { detail, queue_id: item.id })
      }
      if (item.status !== 'pending') {
        return fail(`Reply: ${label} ("${event.summary}") is already ${item.status}`, { detail, queue_id: item.id })
      }
      await rejectQueueItem(supabase, item.id)
      return done(`Rejected ${label}: ${event.summary}`, { detail, queue_id: item.id })
    }

    // approve — note-append items first need their contact pick resolved.
    const edited: QueueActionEdited = {}
    if (item.extracted?._kind === 'note-append') {
      const candidates = (item.extracted?._candidates ?? []) as any[]
      let contactId: string | null = null
      if (ins.ref.kind === 'name') {
        const nm = ins.ref.name.toLowerCase().trim()
        const hit = candidates.filter((c: any) => {
          const full = `${c.first_name} ${c.last_name}`.toLowerCase()
          return full === nm || full.includes(nm) || nm.includes(full)
        })
        if (hit.length === 1) contactId = hit[0].id
      }
      if (!contactId && candidates.length === 1) contactId = candidates[0].id
      if (!contactId) {
        return fail(`Reply: ${label} is a note that needs a contact pick (${candidates.length} candidates) — approve it in the intake queue`, { detail, queue_id: item.id })
      }
      edited.contact_id = contactId
    } else {
      // A plain "approve" honors the stage already on the item — the
      // forwarder's original suggestion first, else the extracted stage —
      // since approveQueueItem otherwise defaults to Teaser (the review UI
      // always passes the stage explicitly; a reply has to supply it).
      const stage = item.extracted?._stage_suggestion ?? item.extracted?.stage
      if (stage) edited.stage = stage
    }
    const res = await approveQueueItem(supabase, item.id, edited)
    if (!res.ok) {
      return fail(`Reply: approving ${label} failed — ${res.error}`, { detail, queue_id: item.id })
    }
    if (res.skipped) {
      return done(`Reply: ${label} was already approved (${event.summary})`, { detail, queue_id: item.id, deal_id: res.deal_id ?? null })
    }
    if (res.note_id) {
      return done(`Filed the note from ${label}: ${event.summary}`, { detail, queue_id: item.id })
    }
    return done(`Approved ${label}: ${event.summary}`, { detail, queue_id: item.id, deal_id: res.deal_id ?? null })
  }

  // ── "<n>: log as <stage> …" — stage change for the item's deal ──────────
  if (ins.type === 'stage') {
    const event = resolveByNumber(ordered, ins.n)
    if (!event) {
      return fail(`Reply: no item #${ins.n} in the digest (it had ${ordered.length} item${ordered.length !== 1 ? 's' : ''}) — no stage was changed`, { detail })
    }
    const cmd = ins.command
    if (event.deal_id) {
      const { data: deal } = await supabase.from('deals')
        .select('id, company_name, stage, status, dropbox_path')
        .eq('id', event.deal_id)
        .single()
      if (!deal) {
        return fail(`Reply: item #${ins.n} refers to a deal that no longer exists`, { detail })
      }
      const newStage = cmd.stage!
      const updates: Record<string, any> = { stage: newStage, status: resolveDealStatus(newStage) }
      if (cmd.deal_type) updates.deal_type = cmd.deal_type
      if (cmd.parent_portco) updates.parent_portco = cmd.parent_portco
      // Move the Dropbox folder to the new stage's canonical parent, the
      // same re-keying the forward flow does on a rename. Non-fatal on error.
      let folderNote = ''
      const currentFolder = toFolder(deal.dropbox_path)
      const targetFolder = expectedDropboxFolder(deal.id, newStage)
      if (dropboxConfigured() && currentFolder && currentFolder.toLowerCase() !== targetFolder.toLowerCase()) {
        try {
          const moved = await dropboxMove(currentFolder, targetFolder)
          updates.dropbox_path = toFolder(moved) ?? targetFolder
        } catch (e: any) {
          folderNote = ` (folder move failed: ${e?.message})`
          log.error('[digest-reply] folder move failed:', e?.message)
        }
      }
      await supabase.from('deals').update(updates).eq('id', deal.id)
      return done(`Moved ${deal.company_name} to ${newStage} (was ${deal.stage})${folderNote}`, {
        detail: { ...detail, stage: newStage },
        deal_id: deal.id,
      })
    }
    if (event.queue_id) {
      // The item is still queued — "log as" approves it at the given stage.
      const { data: item } = await supabase.from('intake_queue').select('*').eq('id', event.queue_id).single()
      if (!item) {
        return fail(`Reply: the queued item for item #${ins.n} no longer exists`, { detail })
      }
      if (item.status !== 'pending') {
        return fail(`Reply: item #${ins.n} is already ${item.status} — its stage can't be set by reply`, { detail, queue_id: item.id })
      }
      const edited: QueueActionEdited = {
        stage: cmd.stage!,
        ...(cmd.deal_type ? { deal_type: cmd.deal_type } : {}),
        ...(cmd.parent_portco ? { parent_portco: cmd.parent_portco } : {}),
      }
      const res = await approveQueueItem(supabase, item.id, edited)
      if (!res.ok) {
        return fail(`Reply: item #${ins.n} stage change failed — ${res.error}`, { detail, queue_id: item.id })
      }
      return done(`Approved item #${ins.n} as ${cmd.stage}: ${event.summary}`, {
        detail,
        queue_id: item.id,
        deal_id: res.deal_id ?? null,
      })
    }
    return fail(`Reply: item #${ins.n} ("${event.summary}") does not refer to a deal`, { detail })
  }

  // ── Action commands: change/update/file/move by name ────────────────────
  if (ins.type === 'action') {
    const outcome = await executeActionCommand(supabase, ins.command, {
      from: ctx.from,
      subject: ctx.subject,
      messageId: ctx.messageId,
      surface: 'reply',
      record: 'none',
    })
    if (outcome.status === 'done') {
      return done(outcome.summary, { detail, deal_id: outcome.deal_id ?? null, contact_id: outcome.contact_id ?? null })
    }
    if (outcome.status === 'queued') {
      return fail(`Reply: "${ins.raw}" was queued instead — ${outcome.summary}`, { detail, queue_id: outcome.queue_id ?? null })
    }
    return fail(outcome.summary, { detail, deal_id: outcome.deal_id ?? null, contact_id: outcome.contact_id ?? null })
  }

  // ── Standalone commands: note-for / ask / log-contact ────────────────────
  const cmd = ins.command
  if (cmd.kind === 'note' && cmd.contactName) {
    const noteBody = cmd.noteText.trim()
    if (!noteBody) {
      return fail(`Reply: "note for ${cmd.contactName}" had no note text`, { detail })
    }
    const filed = await fileNoteForContact(supabase, {
      name: cmd.contactName,
      noteBody,
      from: ctx.from,
      subject: ctx.subject,
      messageId: ctx.messageId,
      noteDate: ctx.noteDate,
    })
    if (filed.outcome === 'filed') {
      return done(`Note filed under ${cmd.contactName} (from your digest reply)`, { detail, contact_id: filed.contactId })
    }
    return fail(`Reply: note for "${cmd.contactName}" was queued instead — ${filed.ambiguity}`, { detail, queue_id: filed.queueId ?? null })
  }
  if (cmd.kind === 'ask') {
    const question = cmd.noteText.trim()
    if (!question) {
      return fail('Reply: "ask:" had no question', { detail })
    }
    try {
      const { text: answer } = await runAgentToText(question, {
        channel: 'email',
        senderName: ctx.fromName || ctx.from.split('@')[0],
      })
      await sendAssistantReply({ to: ctx.from, subject: ctx.subject, answer, inReplyTo: ctx.messageId || undefined })
      return done(`Answered your ask: "${question.slice(0, 80)}"`, { detail })
    } catch (e: any) {
      log.error('[digest-reply] ask failed:', e?.message)
      await sendAssistantReply({
        to: ctx.from,
        subject: ctx.subject,
        answer: `Sorry — I hit an error answering that: ${e?.message || 'unknown error'}. Try rephrasing or ask in the Nexus web assistant.\n\n— Nexus Assistant`,
        inReplyTo: ctx.messageId || undefined,
      }).catch(() => {})
      return fail(`Reply: ask failed — ${e?.message || 'unknown error'}`, { detail })
    }
  }
  if (cmd.kind === 'log-contact') {
    const people = cmd.contacts.length
      ? cmd.contacts
      : cmd.contactNames.map(name => ({ name, company: null as string | null }))
    if (!people.length) {
      return fail('Reply: "log new contact" needs at least one name in a reply', { detail })
    }
    // Deterministic only: in a reply there is no source email to mine, so the
    // named people are created/filled directly — same bare-contact behavior
    // the forward flow uses for names it can't find in the email.
    const { created, existing } = await upsertContacts(
      supabase,
      people.map(p => ({ name: p.name, firm: p.company ?? null, role: 'Other' })),
      null,
      { fillBlanks: true },
    )
    const parts = [
      created.length ? `added ${created.join(', ')}` : '',
      existing.length ? `already in Nexus: ${existing.join(', ')}` : '',
    ].filter(Boolean)
    return done(`Contacts from your digest reply: ${parts.join(' · ') || 'none added'}`, {
      detail: { ...detail, created, existing },
    })
  }
  return fail(`Reply: could not carry out "${ins.raw}"`, { detail })
}

async function handleDigestReply(
  supabase: ReturnType<typeof serviceClient>,
  args: { from: string; fromName: string; subject: string; text: string; messageId: string; noteDate: string; batchTs: string | null },
): Promise<NextResponse> {
  const { from, subject, text, messageId, noteDate } = args

  const record = async (ok: boolean, summary: string, extra: Partial<IntakeEventInput> = {}) => {
    await recordIntakeEvent(supabase, {
      kind: ok ? 'reply-action' : 'reply-failed',
      summary,
      detail: { source: 'digest-reply', from, ...(extra.detail ?? {}) },
      deal_id: extra.deal_id ?? null,
      contact_id: extra.contact_id ?? null,
      queue_id: extra.queue_id ?? null,
      message_id: messageId || null,
    })
  }

  // Webhook retries must not execute the same instructions twice. Reply
  // outcomes carry this message's id, so a prior outcome means "done".
  if (messageId) {
    const { data: prior } = await supabase.from('intake_events')
      .select('id')
      .eq('message_id', messageId)
      .in('kind', ['reply-action', 'reply-failed'])
      .limit(1)
    if (prior?.length) {
      log.info('[digest-reply] duplicate webhook delivery — skipping', { messageId })
      return NextResponse.json({ success: true, skipped: 'duplicate digest reply' })
    }
  }

  let batch: IntakeEvent[] = []
  try {
    batch = args.batchTs
      ? await fetchDigestBatch(supabase, args.batchTs)
      : await fetchLatestDigestBatch(supabase)
  } catch (e: any) {
    log.error('[digest-reply] batch fetch failed:', e?.message)
  }
  if (!batch.length) {
    await record(false, 'Reply to the intake digest could not be matched to a sent digest', {
      detail: { reason: 'digest batch not found', marker: args.batchTs },
    })
    return NextResponse.json({ success: true, processed: [{ type: 'digest-reply', actions: 0, error: 'batch not found' }] })
  }

  const ordered = flattenDigestEvents(batch)
  const replyText = extractReplyText(text)
  const instructions = parseReplyInstructions(replyText)

  const ctx: DigestReplyCtx = {
    ordered,
    from,
    fromName: args.fromName,
    subject,
    messageId,
    noteDate,
    record,
  }
  const outcomes = []
  for (const ins of instructions) {
    outcomes.push(await executeReplyInstruction(supabase, ins, ctx))
  }

  // ── Smart fallback: instruction-like lines the grammar didn't claim ─────
  // Only Ken's extracted top text is scanned (never the quoted digest), and
  // only lines no deterministic instruction consumed. Interpretations
  // execute at high confidence (Pass/Dead always queue) via
  // lib/email-command-fallback.ts; a "decide" interpretation re-enters the
  // reply executor with recording muted so the outcome is recorded once.
  const consumed = new Set(instructions.map(i => i.raw))
  const unmatchedLines = replyText.split(/\r?\n/).map(l => l.trim()).filter(l => l && !consumed.has(l))
  if (unmatchedLines.length) {
    const fb = await runSmartFallback(supabase, unmatchedLines, {
      from,
      fromName: args.fromName,
      subject,
      messageId,
      noteDate,
      surface: 'reply',
      record,
      adapters: {
        decide: async (verb, ref) => {
          const ins: ReplyInstruction = {
            type: verb,
            ref: /^\d{1,3}$/.test(ref.trim())
              ? { kind: 'number', n: parseInt(ref, 10) }
              : { kind: 'name', name: ref },
            raw: `${verb} ${ref}`,
          }
          const r = await executeReplyInstruction(supabase, ins, { ...ctx, record: async () => {} })
          return { status: r.ok ? 'done' : 'failed', summary: r.summary }
        },
      },
    })
    for (const o of fb.outcomes) {
      outcomes.push({ instruction: o.line, ok: o.status === 'done', summary: o.summary })
    }
  }

  if (!outcomes.length) {
    await recordIntakeEvent(supabase, {
      kind: 'skipped',
      summary: 'Digest reply had no recognizable instructions',
      detail: { source: 'digest-reply', reason: 'no instructions parsed', from },
      message_id: messageId || null,
    })
    return NextResponse.json({ success: true, processed: [{ type: 'digest-reply', actions: 0 }] })
  }

  log.info('[digest-reply] executed instructions', { count: outcomes.length, batch: args.batchTs ?? 'latest' })
  return NextResponse.json({ success: true, processed: [{ type: 'digest-reply', actions: outcomes.length, outcomes }] })
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  // ── Auth: accept either a Postmark webhook token or the relay internal secret ──
  // Direct Postmark path: token in query param or X-Webhook-Token header.
  // Relay path: email-server uploads large attachments to Supabase Storage and
  //   forwards a compact payload with X-Internal-Secret instead of the webhook token.
  const internalSecret = process.env.INTERNAL_WEBHOOK_SECRET
  const isRelay = internalSecret && req.headers.get('x-internal-secret') === internalSecret

  if (!isRelay) {
    const webhookToken = process.env.POSTMARK_WEBHOOK_TOKEN
    if (!webhookToken) {
      log.error('POSTMARK_WEBHOOK_TOKEN is not set — rejecting request')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    const provided = req.nextUrl.searchParams.get('token') ?? req.headers.get('x-webhook-token')
    if (provided !== webhookToken) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Rate-limit the webhook per credential + IP: the token is the only gate,
  // so a leaked token or a sender loop must not be able to burn AI spend
  // unchecked. Checked after auth so unauthenticated floods still get the
  // cheap 403 above.
  const emailLimit = checkRateLimit(
    `notes-email:${isRelay ? 'relay' : 'postmark'}:${getClientIp(req)}`,
    { limit: 60, windowMs: 60_000 },
  )
  if (!emailLimit.allowed) return rateLimitResponse(emailLimit.retryAfterSeconds)

  try {
    const body     = await req.json()
    const from     = body.From      ?? body.from    ?? ''
    const fromName = body.FromFull?.Name ?? ''
    const subject  = body.Subject   ?? body.subject ?? ''
    const text     = body.TextBody  ?? body.text    ?? body.body ?? ''
    const date     = body.Date      ?? body.date    ?? new Date().toISOString()
    const messageId: string = body.MessageID ?? body.message_id ?? ''
    const attachments: any[] = body.Attachments ?? []
    const ccFull: any[] = body.CcFull ?? []

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const noteDate = todayCST()
    const results: any[] = []

    // Debug logging — shows up in Vercel Function logs
    log.info('intake received', {
      messageId: messageId || null,
      attachments: attachments.length,
      attachmentBytes: attachments.reduce((sum: number, a: any) => sum + (a.Content?.length ?? 0), 0),
    })

    // ── "Ask:" assistant path ─────────────────────────────────────────────────
    // Subject starts with "Ask:" / "Q:" → answer via the Nexus assistant and reply
    // by email. Internal senders only (email identity is weak; the agent has write
    // access). Runs before everything else so it never files a note or creates a deal.
    if (isAskEmail(subject)) {
      if (!isInternal(from)) {
        log.warn('[ask-email] Ignoring "Ask:" email from external sender', { senderDomain: from.split('@')[1] ?? 'unknown' })
        return NextResponse.json({ success: true, skipped: 'ask-email from non-internal sender' })
      }
      const questionSubject = stripAskPrefix(subject)
      const questionBody = topOfBody(text)
      const question = [questionSubject, questionBody].filter(Boolean).join('\n\n').trim()
      if (!question) {
        return NextResponse.json({ success: true, skipped: 'empty ask-email' })
      }
      log.info('[ask-email] question received', { questionLength: question.length })
      try {
        const { text: answer, toolsUsed } = await runAgentToText(question, {
          channel: 'email',
          senderName: fromName || from.split('@')[0],
        })
        log.info(`[ask-email] answered (tools: ${toolsUsed.join(', ') || 'none'})`)
        await sendAssistantReply({ to: from, subject, answer, inReplyTo: messageId || undefined })
        return NextResponse.json({ success: true, processed: [{ type: 'ask', tools: toolsUsed }] })
      } catch (e: any) {
        log.error('[ask-email] assistant failed:', e?.message)
        await sendAssistantReply({
          to: from,
          subject,
          answer: `Sorry — I hit an error answering that: ${e?.message || 'unknown error'}. Try rephrasing or ask in the Nexus web assistant.\n\n— Nexus Assistant`,
          inReplyTo: messageId || undefined,
        })
        return NextResponse.json({ success: false, error: e?.message }, { status: 200 })
      }
    }

    // ── Digest replies ──────────────────────────────────────────────────────
    // A reply to the daily digest (ReplyTo points back at this inbox) is
    // recognized by the [NEXUS-DIGEST <ts>] marker in the quoted body, or by
    // its subject as a secondary signal. Internal senders only — the same
    // trust bar as the note/add-contact commands. Handled before everything
    // below so the quoted digest is never classified as new intake.
    const digestBatchTs = findDigestBatch(text)
    if (digestBatchTs || isDigestReplySubject(subject)) {
      if (!isInternal(from)) {
        log.warn('[digest-reply] Ignoring digest reply from non-internal sender', { senderDomain: from.split('@')[1] ?? 'unknown' })
        return NextResponse.json({ success: true, skipped: 'digest reply from non-internal sender' })
      }
      return handleDigestReply(supabase, { from, fromName, subject, text, messageId, noteDate, batchTs: digestBatchTs })
    }

    // ── Deterministic command parse (runs before the LLM) ───────────────────
    // The forwarder's own note (top of body + subject) may carry an explicit
    // command: "log as teaser as add-on for DiPonio", "log new contact",
    // "note for <name>". Slots the parser matches win over anything the LLM
    // says later; the LLM only fills what's left.
    const topNote = topOfBody(text)
    const command = parseEmailCommand(`${subject}\n${topNote}`)
    if (command.kind !== 'none') {
      log.info('command parsed', { kind: command.kind, stage: command.stage, dealType: command.deal_type, parentPortco: command.parent_portco, contacts: command.contactNames.length, withCompany: command.contacts.filter(c => c.company).length, hasContactName: !!command.contactName })
    }

    // ── "Note for <name>" command ────────────────────────────────────────────
    // File the forwarder's note under a specific contact. Resolves by exact
    // name, then fuzzy; ambiguous (0 or 2+ matches) goes to the intake queue
    // with candidates — the daily digest flags it and Ken picks in the queue.
    // Never auto-creates a contact from a note command.
    if (isInternal(from) && command.kind === 'note' && command.contactName) {
      const name = command.contactName
      // Re-parse the body alone so the filed note is just the forwarder's text
      // with the command removed (no subject line in it).
      let noteBody = parseEmailCommand(topNote).noteText
      if (!noteBody.trim()) {
        // The command was the whole note — the note is the forwarded thread.
        const threadParts = text.split(/\n-{3,}|\r?\nFrom:|\r?\nOn .+wrote:|_{5,}/i)
        noteBody = threadParts.slice(1).join('\n').trim()
      }
      const filed = await fileNoteForContact(supabase, { name, noteBody, from, subject, messageId, noteDate })
      if (filed.outcome === 'filed') {
        return NextResponse.json({ success: true, processed: [{ type: 'note-appended', contact_id: filed.contactId, note_id: filed.noteId }] })
      }
      return NextResponse.json({ success: true, processed: [{ type: 'note-append', status: 'queued', queue_id: filed.queueId }] })
    }

    // ── "Add contact" path ────────────────────────────────────────────────────
    // Forward an email and write "add contact" (or "save contacts", or
    // "log new contact") in your note → extract every person in the email and
    // save them as standalone CRM contacts, no deal required. Internal senders
    // only. Runs before deal/note processing.
    // Outcomes are recorded for the daily digest — no per-event reply email.
    const addParse = parseAddContactInstruction(topNote, subject)
    // The deterministic parser's "log new contact" / "log <names> as contacts"
    // wins over the heuristic parser when it matched.
    const addTrigger = addParse.trigger || command.kind === 'log-contact'
    const addNames = command.kind === 'log-contact' && command.contactNames.length > 0
      ? command.contactNames
      : addParse.names
    // Companies named in a deterministic contact command, keyed by lowercase
    // name ("log new contact Jane Doe at Acme" → "jane doe" ↦ "Acme"). A
    // command company wins over signature- and LLM-extracted firms below.
    const companyByName = new Map<string, string>(
      command.kind === 'log-contact'
        ? command.contacts
            .filter(c => c.company)
            .map(c => [c.name.toLowerCase().trim(), c.company!] as [string, string])
        : [],
    )
    if (isInternal(from) && addTrigger) {
      log.info('add-contact request', { from, requestedNames: addNames.length })
      try {
        const emailContent = `From: ${from}\nSubject: ${subject}\n\n${text}`.trim()
        const resp = await anthropic.messages.create({
          model: AI_MODELS.fast,
          max_tokens: 1800,
          system: EMAIL_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `Extract CRM data from this email:\n\n${emailContent}` }],
        })
        const parsed = parseAiJson<any>(extractText(resp.content as any))

        // Merge body-extracted contacts with CC-header contacts; dedupe by email then name
        const headerContacts = (ccFull || [])
          .filter((c: any) => c.Email && !isInternal(c.Email))
          .map((c: any) => ({ name: c.Name || c.Email.split('@')[0], email: c.Email, firm: null, title: null, role: 'Other', phone: null }))
        const merged: any[] = []
        const seenEmails = new Set<string>()
        const seenNames = new Set<string>()
        for (const c of [...filterInternalContacts(parsed.contacts ?? []), ...headerContacts]) {
          if (!c.name?.trim()) continue
          const ek = c.email?.toLowerCase(); const nk = c.name.toLowerCase().trim()
          if (ek && seenEmails.has(ek)) continue
          if (!ek && seenNames.has(nk)) continue
          if (ek) seenEmails.add(ek)
          seenNames.add(nk)
          merged.push(c)
        }

        // If the forwarder named specific people ("add John Smith"), add only those.
        // Match named people against the email-extracted contacts; if a named person
        // isn't found in the email, still create a bare contact from the name.
        const requestedNames = addNames
        let toAdd = merged
        if (requestedNames.length > 0) {
          const wanted = requestedNames.map(n => n.toLowerCase().trim())
          const matched = merged.filter(c => {
            const nm = c.name.toLowerCase().trim()
            const last = nm.split(/\s+/).pop()
            return wanted.some(w => nm.includes(w) || w.includes(nm) || (last && w.endsWith(last)))
          })
          // For any requested name not matched to an extracted contact, add it bare
          const matchedLower = matched.map(c => c.name.toLowerCase().trim())
          const unmatched = requestedNames.filter(n => {
            const nl = n.toLowerCase().trim()
            return !matchedLower.some(m => m.includes(nl) || nl.includes(m))
          }).map(n => ({ name: n, role: 'Other' }))
          toAdd = [...matched, ...unmatched]
        }

        // ── Deterministic signature enrichment ─────────────────────────────
        // Parse the forwarded email's signature block without the LLM and
        // merge it into the contacts above: it fills blanks only (a value
        // already extracted is kept). If the signature belongs to the
        // forwarded message's sender (From: header match) and no extracted
        // contact carries them, add a contact built from the signature.
        const signature = extractEmailSignature(text)
        if (signature.name || signature.email) {
          enrichContactsFromSignature(toAdd, signature)
          const fwdFrom = parseForwardedFrom(text)
          const senderPresent = toAdd.some(c =>
            (signature.email && c.email?.toLowerCase() === signature.email) ||
            (signature.name && c.name?.toLowerCase().trim() === signature.name.toLowerCase().trim()))
          const isSenderSig =
            (!!fwdFrom.email && !!signature.email && fwdFrom.email === signature.email) ||
            (!!fwdFrom.name && !!signature.name && fwdFrom.name.toLowerCase().trim() === signature.name.toLowerCase().trim())
          if (isSenderSig && !senderPresent && signature.name) {
            toAdd.push({
              name: signature.name,
              email: signature.email,
              firm: signature.company,
              title: signature.title,
              phone: signature.phone ?? signature.mobile,
              role: 'Other',
            })
          }
        }
        // Command companies win over signature/LLM firms — applied last.
        if (companyByName.size > 0) {
          for (const [reqName, firm] of companyByName) {
            for (const c of toAdd) {
              const nm = c.name?.toLowerCase().trim()
              if (nm && (nm === reqName || nm.includes(reqName) || reqName.includes(nm))) c.firm = firm
            }
          }
        }

        if (toAdd.length === 0) {
          await recordIntakeEvent(supabase, {
            kind: 'skipped',
            summary: 'Add-contact request: no contacts found in the email',
            detail: { reason: 'No contacts found (internal addresses are skipped)', from, subject },
            message_id: messageId || null,
          })
          return NextResponse.json({ success: true, processed: [{ type: 'add-contact', added: 0 }] })
        }

        // fillBlanks: signature/command details also patch EMPTY fields on
        // contacts that already exist in Nexus — never overwriting anything.
        const { created, existing } = await upsertContacts(supabase, toAdd, null, { fillBlanks: true })
        const summaryParts = [
          created.length ? `Added ${created.length} new contact${created.length !== 1 ? 's' : ''}: ${created.join(', ')}` : '',
          existing.length ? `Already in Nexus (${existing.length}): ${existing.join(', ')}` : '',
        ].filter(Boolean)
        await recordIntakeEvent(supabase, {
          kind: 'contact-logged',
          summary: summaryParts.join(' · ') || 'Add-contact request processed',
          detail: { created, existing, from, subject },
          message_id: messageId || null,
        })
        log.info(`add-contact: ${created.length} new, ${existing.length} existing`)
        return NextResponse.json({ success: true, processed: [{ type: 'add-contact', created: created.length, existing: existing.length }] })
      } catch (e: any) {
        log.error('add-contact failed:', e?.message)
        await recordIntakeEvent(supabase, {
          kind: 'failed',
          summary: 'Add-contact request failed',
          detail: { error: e?.message || 'unknown error', from, subject },
          message_id: messageId || null,
        })
        return NextResponse.json({ success: false, error: e?.message }, { status: 200 })
      }
    }

    // ── Action commands (change / update / file / move by name) ─────────────
    // An internal sender can operate on EXISTING deals, contacts and
    // Dropbox files by email — in a forward's note or a fresh command
    // email — not just log new intake. Deterministic grammar first
    // (lib/email-action-commands.ts); whatever executes here ends the
    // request, so the email is never ALSO filed as a note/deal below.
    // Off-grammar instruction lines get the smart fallback (one LLM
    // interpretation pass — lib/email-command-fallback.ts), scoped to the
    // same command-position text (subject + forwarder's own note), never
    // the forwarded thread.
    if (isInternal(from)) {
      const cmdText = `${subject}\n${topNote}`
      const actionParse = parseActionCommands(cmdText)
      if (actionParse.commands.length > 0) {
        // Buffers are resolved only when a file-under command needs them.
        let cmdAttachments: { name: string; buffer: Buffer }[] | undefined
        if (actionParse.commands.some(c => c.type === 'file-under')) {
          cmdAttachments = []
          for (const a of attachments) {
            const buf = await resolveAttachmentBuffer(a, supabase)
            if (buf) cmdAttachments.push({ name: a.Name ?? 'attachment', buffer: buf })
          }
        }
        const outcomes = []
        for (const c of actionParse.commands) {
          outcomes.push(await executeActionCommand(supabase, c, {
            from, subject, messageId, surface: 'forward', record: 'command', attachments: cmdAttachments,
          }))
        }
        log.info('action commands executed', { count: outcomes.length })
        return NextResponse.json({
          success: true,
          processed: [{ type: 'email-commands', outcomes: outcomes.map(o => ({ status: o.status, summary: o.summary })) }],
        })
      }

      const fb = await runSmartFallback(supabase, cmdText.split(/\r?\n/), {
        from,
        fromName,
        subject,
        messageId,
        noteDate,
        surface: 'forward',
        // Inline (base64) attachments only — resolving storage-backed ones
        // here would consume them before the normal intake paths below.
        attachments: attachments
          .filter((a: any) => a.Content)
          .map((a: any) => ({ name: a.Name ?? 'attachment', buffer: Buffer.from(a.Content, 'base64') })),
        record: async (ok, summary, extra) => {
          await recordIntakeEvent(supabase, {
            kind: ok ? 'command-action' : 'command-failed',
            summary,
            detail: { source: 'email-command-fallback', from, ...(extra?.detail ?? {}) },
            deal_id: extra?.deal_id ?? null,
            contact_id: extra?.contact_id ?? null,
            message_id: messageId || null,
          })
        },
      })
      if (fb.handled) {
        return NextResponse.json({
          success: true,
          processed: [{ type: 'email-command-fallback', outcomes: fb.outcomes }],
        })
      }
    }

    // ── Idempotency guard — block duplicate webhook calls ─────────────────────
    // Two-layer check: (1) Postmark MessageID unique constraint if migration ran,
    if (messageId) {
      // Layer 1: try atomic sentinel insert (requires message_id column + unique index)
      try {
        const { error: lockError } = await supabase
          .from('intake_queue')
          .insert({
            message_id: messageId,
            source:     'email',
            status:     'processing',
            from_email: from,
            file_name:  subject.slice(0, 200),
            extracted:  {},
          })
        if (lockError?.code === '23505') {
          log.info(`Idempotency (messageId): duplicate, skipping`)
          return NextResponse.json({ success: true, skipped: 'duplicate messageId' })
        }
        if (lockError) {
          // Column probably doesn't exist yet — migration not run; fall through to layer 2
          log.warn(`Sentinel insert failed (run migration?): ${lockError.code} ${lockError.message}`)
        }
      } catch (e: any) {
        log.warn(`Sentinel error:`, e?.message)
      }
    }

    // Layer 2 (subject-based fallback) intentionally removed — it blocked
    // legitimate re-sends when a previous attempt had partially failed.
    // Layer 1 (messageId unique constraint) is the reliable dedup once the
    // migration has been run.

    // ── Path A: process document attachments ──────────────────────────────────
    // Attachments arriving from the relay have StoragePath instead of Content.
    const docAttachments = attachments.filter((a: any) => {
      const name = (a.Name ?? '').toLowerCase()
      const ct   = (a.ContentType ?? '').toLowerCase()
      const hasContent = !!(a.Content || a.StoragePath)
      return hasContent && (ct.includes('pdf') || ct.includes('word') || name.endsWith('.pdf') || /\.docx?$/.test(name))
    })

    if (docAttachments.length > 0) {
      // Parse forwarding note once for all attachments
      const instructions = await parseForwardingNote(text, { from, fromName, cc: ccFull })
      log.info('instructions parsed', { stage: instructions.stage, status: instructions.status, dealType: instructions.deal_type, autoApprove: instructions.auto_approve, hasDealName: !!instructions.deal_name, hasPortco: !!(instructions.portco_name || instructions.parent_portco), hasForwarderNote: !!instructions.forwarder_note, contacts: instructions.contacts?.length ?? 0 })

      // ── Portco fallback: if add-on but parent_portco wasn't extracted by LLM,
      // scan known portfolio company names against the full email text.
      // This catches cases where Claude Haiku misclassifies the portco as deal_name.
      if ((instructions.deal_type === 'add-on' || instructions.parent_portco) && !instructions.parent_portco) {
        try {
          const { data: portcos } = await supabase.from('portfolio_companies').select('name').eq('status', 'Active')
          if (portcos?.length) {
            const haystack = (subject + ' ' + text).toLowerCase()
            const match = portcos.find((p: any) => haystack.includes(p.name.toLowerCase()))
            if (match) {
              instructions.parent_portco = match.name
              log.info(`Inferred parent_portco="${match.name}" from email text (portco fallback)`)
            }
          }
        } catch (e: any) {
          log.warn(`Portco fallback failed:`, e?.message)
        }
      }

      // ── Deterministic command slots win over the LLM's guesses ─────────────
      // An explicit "log as <stage>" is a decision: auto-approve at that stage.
      // This also holds when the LLM call above failed and returned all-nulls.
      if (command.kind === 'log-deal') {
        if (command.stage) instructions.stage = command.stage
        if (command.deal_type) instructions.deal_type = command.deal_type
        if (command.parent_portco) instructions.parent_portco = command.parent_portco
        if (command.stage) instructions.auto_approve = true
      }

      // ── Validate parent_portco against real portfolio companies ────────────
      // A "for <name>" that isn't an Active portco queues as ambiguous with
      // candidates instead of creating a deal with a bogus parent.
      let parentAmbiguity: { reason: string; candidates: string[] } | null = null
      if (instructions.parent_portco) {
        try {
          const { data: portcos } = await supabase.from('portfolio_companies').select('name').eq('status', 'Active')
          const names = (portcos ?? []).map((p: any) => p.name as string)
          const exact = names.find(n => n.toLowerCase() === instructions.parent_portco!.toLowerCase().trim())
          if (exact) {
            instructions.parent_portco = exact // normalize casing
          } else {
            const needle = instructions.parent_portco.toLowerCase().trim()
            parentAmbiguity = {
              reason: `Parent portco "${instructions.parent_portco}" is not in Nexus`,
              candidates: names.filter(n => n.toLowerCase().includes(needle) || needle.includes(n.toLowerCase())),
            }
            instructions.auto_approve = false // force the queue branch below
          }
        } catch (e: any) {
          log.warn('Parent portco validation failed:', e?.message)
        }
      }

      // ── Step 1: Separate NDAs (skip Claude, just upload) from deal docs ─────
      // Detecting NDAs by filename avoids wasting Claude Opus time on them.
      const isNdaFile = (name: string) => /nda|non.?disclosure/i.test(name)

      const ndaAttachments  = docAttachments.filter((a: any) => isNdaFile(a.Name ?? ''))
      const dealAttachments = docAttachments.filter((a: any) => !isNdaFile(a.Name ?? ''))

      log.info(`deal docs: ${dealAttachments.length}, NDAs: ${ndaAttachments.length}`)

      // ── Step 2: Extract deal docs sequentially (avoids parallel timeout) ───
      const extracted_docs: Array<{ fileName: string; buffer: Buffer; extracted: any }> = []

      // Add NDAs as stub entries — no extraction needed
      for (const att of ndaAttachments) {
        const fileName = att.Name ?? 'nda'
        const buffer   = await resolveAttachmentBuffer(att, supabase)
        if (!buffer) { log.warn(`Could not resolve buffer for NDA ${fileName}`); continue }
        extracted_docs.push({ fileName, buffer, extracted: { doc_type: 'nda', company_name: null, contacts: [] } })
      }

      for (const att of dealAttachments) {
        const fileName    = att.Name ?? 'document'
        const buffer      = await resolveAttachmentBuffer(att, supabase)
        const contentType = att.ContentType ?? ''
        if (!buffer) { log.warn(`Could not resolve buffer for ${fileName}`); continue }
        log.info(`Extracting ${fileName} (${(buffer!.length / 1024 / 1024).toFixed(1)} MB)…`)
        try {
          const extracted = await processAttachment(fileName, buffer!, contentType)
          if (extracted) {
            extracted_docs.push({ fileName, buffer, extracted })
            log.info(`Extracted ${fileName}: doc_type=${extracted.doc_type} company="${extracted.company_name}"`)
          }
        } catch (e: any) {
          log.error(`Extract error (${fileName}):`, e?.message)
          results.push({ type: 'error', file: fileName, error: e?.message })
          await recordIntakeEvent(supabase, {
            kind: 'failed',
            summary: `Failed to extract ${fileName}`,
            detail: { error: e?.message, file: fileName, from },
            message_id: messageId || null,
          })
        }
      }

      if (extracted_docs.filter(d => d.extracted.doc_type !== 'nda').length === 0 && ndaAttachments.length === 0) {
        // Nothing usable came out of the attachments. If the per-file errors
        // above already recorded 'failed' events, don't double-report.
        if (!results.some(r => r.type === 'error')) {
          await recordIntakeEvent(supabase, {
            kind: 'failed',
            summary: `Could not process ${docAttachments.length} attachment(s) from "${subject.slice(0, 60)}"`,
            detail: { files: docAttachments.map((a: any) => a.Name).join(', '), from },
            message_id: messageId || null,
          })
        }
        return NextResponse.json({ success: true, processed: results })
      }

      // ── Step 3: Find primary doc (teaser or CIM) — NDAs are supporting ────
      const primary = extracted_docs.find(d =>
        d.extracted.doc_type === 'teaser' || d.extracted.doc_type === 'cim'
      ) ?? extracted_docs.find(d => d.extracted.doc_type !== 'nda')
        ?? extracted_docs[0]
      const supporting = extracted_docs.filter(d => d !== primary)

      // Apply instruction overrides to primary
      if (instructions.deal_type)     primary.extracted.deal_type    = instructions.deal_type
      if (instructions.parent_portco) primary.extracted.parent_portco = instructions.parent_portco

      // Track all file names for the note
      const allFileNames = extracted_docs.map(d => d.fileName).join(', ')

      // ── Early exit: non-deal document with no identifiable company ───────────
      // Industry newsletters, M&A digests, and other 'other'-type PDFs with no
      // company name should NOT create "Unknown — FW: ..." garbage deals.
      // Save as a plain note and stop processing.
      if (primary.extracted.doc_type === 'other' && !primary.extracted.company_name) {
        log.info(`Skipping deal creation: doc_type=other, no company_name. Saving as note.`)
        await supabase.from('notes').insert({
          note_date:  noteDate,
          raw_text:   `Forwarded via email by ${from}\nSubject: ${subject}\nFiles: ${allFileNames}`,
          summary:    `Received document(s) via email: ${allFileNames}. Subject: "${subject}".${instructions.forwarder_note ? ` Note: ${instructions.forwarder_note}` : ''}`,
          next_steps: null,
          logged_by:  from.split('@')[0] ?? 'email',
          source:     'email',
          deal_id:    null,
        })
        results.push({ type: 'other', status: 'saved-as-note', files: allFileNames })
        await recordIntakeEvent(supabase, {
          kind: 'skipped',
          summary: `Skipped deal creation for "${subject.slice(0, 60)}" — no company identified, saved as note`,
          detail: { reason: 'doc_type=other, no company_name', files: allFileNames, from },
          message_id: messageId || null,
        })
        return NextResponse.json({ success: true, processed: results })
      }

      // ── Step 3: Look up existing deal by company name ─────────────────────
      // If a deal already exists, associate the CIM/teaser with it instead of
      // creating a duplicate. Use the existing deal's stage for Dropbox routing.
      let existingDeal: { id: string; company_name: string; stage: string; status: string; dropbox_path: string | null } | null = null

      // Helper: find an existing deal by name.
      //   opts.fuzzy    — also try a partial "first 3 words" match (only when the
      //                   forwarder EXPLICITLY named a deal; too aggressive otherwise).
      //   opts.activeOnly — only match deals with status 'Active' (so a new
      //                   opportunity never absorbs into a Passed/Closed/Dead record).
      async function findDealByName(searchName: string, opts: { fuzzy?: boolean; activeOnly?: boolean } = {}) {
        let exactQ = supabase
          .from('deals')
          .select('id, company_name, stage, status, dropbox_path')
          .ilike('company_name', searchName)
          .order('created_at', { ascending: false })
          .limit(1)
        if (opts.activeOnly) exactQ = exactQ.eq('status', 'Active')
        const { data: exact } = await exactQ.maybeSingle()
        if (exact) return exact

        if (!opts.fuzzy) return null

        // Partial match on first 3 meaningful words — explicit references only
        const stripped = searchName.replace(/\b(Inc|LLC|Ltd|Co|Corp|Company|Group|Partners|Holdings|the)\b\.?/gi, '').trim()
        const chunk = stripped.split(/\s+/).slice(0, 3).join(' ')
        if (chunk.length > 3) {
          let partialQ = supabase
            .from('deals')
            .select('id, company_name, stage, status, dropbox_path')
            .ilike('company_name', `%${chunk}%`)
            .order('created_at', { ascending: false })
            .limit(1)
          if (opts.activeOnly) partialQ = partialQ.eq('status', 'Active')
          const { data: partial } = await partialQ.maybeSingle()
          if (partial) return partial
        }
        return null
      }

      // Priority 1: deal the forwarder EXPLICITLY referenced ("for Project Anchor").
      // Explicit intent → allow fuzzy matching.
      if (instructions.deal_name) {
        const found = await findDealByName(instructions.deal_name.trim(), { fuzzy: true })
        if (found) {
          existingDeal = found
          log.info(`Matched by forwarder deal_name "${instructions.deal_name}": deal ${found.id} stage="${found.stage}"`)
        } else {
          log.info(`Forwarder said deal_name="${instructions.deal_name}" but no match found`)
        }
      }

      // Priority 2: auto-match by extracted company name — ONLY for CIMs (a
      // follow-up doc for a deal you already opened). Teasers and other docs are
      // treated as NEW deals so same-named opportunities stay separate. And only
      // match an ACTIVE deal (exact name), never a passed/closed one.
      if (!existingDeal && primary.extracted.doc_type === 'cim' && primary.extracted.company_name) {
        const name = primary.extracted.company_name.trim()
        const found = await findDealByName(name, { activeOnly: true })
        if (found) {
          existingDeal = found
          log.info(`CIM auto-matched to active deal "${name}": deal ${found.id} stage="${found.stage}"`)
        } else {
          log.info(`No active deal found for CIM "${name}" — creating new deal`)
        }
      } else if (!existingDeal && primary.extracted.company_name) {
        log.info(`doc_type=${primary.extracted.doc_type} for "${primary.extracted.company_name}" — creating a NEW deal (no auto-merge)`)
      }

      // ── Guard: if the matched "existing deal" IS the parent portco (not the
      // acquisition target), clear existingDeal so we create a fresh add-on deal
      // with the correct "[PortcoName]" folder suffix.
      // e.g. user says "add-on for Amped" — we might match Amped's own deal record,
      // but Amped is the acquirer, not the target we're evaluating.
      if (
        existingDeal &&
        instructions.parent_portco &&
        existingDeal.company_name.toLowerCase().includes(instructions.parent_portco.toLowerCase().trim())
      ) {
        log.info(`Matched deal "${existingDeal.company_name}" appears to be the parent portco "${instructions.parent_portco}" — clearing to create new add-on deal`)
        existingDeal = null
      }

      // ── Step 4: Upload ALL files to Dropbox ───────────────────────────────
      // deals.dropbox_path stores the FOLDER path (not a file path).
      // toFolder() (defined at module scope) strips filenames from legacy records.
      const effectiveStage = resolveEffectiveStage(existingDeal?.stage, instructions.stage)
      const companyForPath = primary.extracted.company_name
        ? (instructions.parent_portco
            ? `${primary.extracted.company_name} [${instructions.parent_portco}]`
            : primary.extracted.company_name)
        : null

      // Resolve the target Dropbox folder.
      // - Existing deal: reuse its stored folder (attach files there).
      // - New deal: use a UNIQUE folder so a separate same-named deal doesn't
      //   share a folder — appends " (2)", " (3)" if one already exists.
      const targetFolder: string | null = existingDeal
        ? (toFolder(existingDeal.dropbox_path) ?? (companyForPath ? await uniqueDropboxFolder(companyForPath, effectiveStage) : null))
        : (companyForPath ? await uniqueDropboxFolder(companyForPath, effectiveStage) : null)

      // dealFolderPath is what we store on the deal — always the folder, never a file
      let dealFolderPath: string | null = targetFolder

      // ── Rename deal + Dropbox folder when CIM reveals the real company name ──
      // If the existing deal was created under a project codename (e.g. "Project Anchor")
      // and the CIM contains the real company name, rename both the deal and the folder.
      let renamedCompany: string | null = null
      if (
        existingDeal &&
        primary.extracted.doc_type === 'cim' &&
        primary.extracted.company_name &&
        primary.extracted.company_name.toLowerCase().trim() !== existingDeal.company_name.toLowerCase().trim()
      ) {
        const newCompanyName = primary.extracted.company_name.trim()
        // Folder identity is the deal ID (item 45), so a company rename no
        // longer derives a new folder name from the new name. For a legacy
        // name-keyed folder this move re-keys it to the ID path; for an
        // already-ID-keyed folder newFolder == targetFolder and dropboxMove
        // no-ops.
        const newFolder = expectedDropboxFolder(existingDeal.id, existingDeal.stage)

        if (dropboxConfigured() && targetFolder) {
          try {
            log.info(`Renaming Dropbox folder: "${targetFolder}" → "${newFolder}"`)
            const movedPath = await dropboxMove(targetFolder, newFolder)
            dealFolderPath = toFolder(movedPath) ?? newFolder
            log.info(`Folder renamed ✓ → "${dealFolderPath}"`)
          } catch (renameErr: any) {
            log.error(`Folder rename failed (non-fatal):`, renameErr?.message)
            // Keep original folder path, still rename the deal in DB
          }
        }

        renamedCompany = newCompanyName
        log.info(`Deal will be renamed: "${existingDeal.company_name}" → "${newCompanyName}"`)
      }

      // Use the (possibly renamed) folder for uploads.
      // Fall back to a shared inbox folder so files are never silently dropped.
      const DROPBOX_INBOX = '/evolution strategy partners/Deals/Inbox'
      const uploadFolder = dealFolderPath ?? targetFolder ?? DROPBOX_INBOX
      log.info(`Step 4: Dropbox upload target="${uploadFolder}" existing=${!!existingDeal}`)
      if (dropboxConfigured() && uploadFolder) {
        for (const doc of extracted_docs) {
          try {
            log.info(`Uploading ${doc.fileName}…`)
            await dropboxUpload(uploadFolder, doc.fileName, doc.buffer)
            log.info(`Uploaded ${doc.fileName} ✓`)
          } catch (dbxErr: any) {
            log.error(`Dropbox upload failed (${doc.fileName}):`, dbxErr?.message)
          }
        }
      }
      log.info(`Step 5: writing deal/note. existingDeal=${existingDeal?.id ?? 'none'} rename=${renamedCompany ?? 'none'}`)

      // Merge contacts from all docs + forwarding note
      const allContacts = filterInternalContacts([
        ...extracted_docs.flatMap(d => d.extracted.contacts ?? []),
        ...(instructions.contacts ?? []),
      ])

      const docLabel = primary.extracted.doc_type === 'cim' ? 'CIM' : 'Teaser'
      const supportingLabel = supporting.length > 0 ? ` Also received: ${supporting.map(d => d.fileName).join(', ')}.` : ''

      // ── Step 5: Create or update deal, then log note ───────────────────────
      if (existingDeal) {
        // ── Existing deal: attach CIM data and log note ──────────────────────
        const updates: Record<string, any> = {}
        if (primary.extracted.doc_type === 'cim') updates.cim_parsed = true
        if (primary.extracted.revenue != null) updates.revenue = primary.extracted.revenue
        if (primary.extracted.ebitda  != null) updates.ebitda  = primary.extracted.ebitda
        if (primary.extracted.historical_financials?.length) updates.historical_financials = primary.extracted.historical_financials
        if (primary.extracted.customer_concentration) updates.customer_concentration = primary.extracted.customer_concentration
        if (primary.extracted.employee_count != null) updates.employee_count = primary.extracted.employee_count
        if (primary.extracted.financial_summary) updates.financial_summary = primary.extracted.financial_summary
        if (dealFolderPath) updates.dropbox_path = dealFolderPath
        if (renamedCompany)  updates.company_name = renamedCompany
        if (Object.keys(updates).length > 0) {
          await supabase.from('deals').update(updates).eq('id', existingDeal.id)
        }

        // Store CIM in deal_cims if it's a CIM
        if (primary.extracted.doc_type === 'cim') {
          try {
            await supabase.from('deal_cims').insert({
              deal_id:      existingDeal.id,
              file_name:    primary.fileName,
              dropbox_path: dealFolderPath,
              extracted:    primary.extracted,
            })
          } catch { /* non-fatal */ }
        }

        await supabase.from('notes').insert({
          note_date:  noteDate,
          raw_text:   `Forwarded via email by ${from}\nSubject: ${subject}\nFiles: ${allFileNames}`,
          summary:    `${docLabel} received for ${primary.extracted.company_name}. Linked to existing deal (${existingDeal.stage}).${renamedCompany ? ` Deal renamed from "${existingDeal.company_name}" to "${renamedCompany}" and Dropbox folder updated.` : ''}${supportingLabel}${instructions.forwarder_note ? ` Note: ${instructions.forwarder_note}` : ''}`,
          next_steps: null,
          logged_by:  from.split('@')[0] ?? 'email',
          source:     'email',
          deal_id:    existingDeal.id,
        })

        if (allContacts.length > 0) {
          await upsertContacts(supabase, allContacts, existingDeal.id)
        }

        results.push({ type: primary.extracted.doc_type, status: 'linked-to-existing', deal_id: existingDeal.id, files: allFileNames, company: primary.extracted.company_name })
        await recordIntakeEvent(supabase, {
          kind: 'deal-updated',
          summary: `${docLabel} linked to existing deal ${primary.extracted.company_name} (${existingDeal.stage})`,
          detail: { company: primary.extracted.company_name, stage: existingDeal.stage, file: allFileNames, from },
          deal_id: existingDeal.id,
          message_id: messageId || null,
        })

      } else if (instructions.auto_approve && instructions.stage) {
        // ── New deal, auto-approved ──────────────────────────────────────────
        const stage  = instructions.stage
        const status = resolveDealStatus(stage, instructions.status)
        const { data: deal } = await supabase.from('deals').insert({
          company_name:           primary.extracted.company_name || `Unknown — ${subject.slice(0, 60)}`,
          sector:                 primary.extracted.sector       || null,
          geography:              primary.extracted.geography    || null,
          deal_type:              primary.extracted.deal_type    || 'platform',
          parent_portco:          primary.extracted.parent_portco || null,
          revenue:                primary.extracted.revenue      ?? null,
          ebitda:                 primary.extracted.ebitda       ?? null,
          description:            primary.extracted.description  || null,
          financial_summary:      primary.extracted.financial_summary || null,
          historical_financials:  primary.extracted.historical_financials?.length ? primary.extracted.historical_financials : null,
          customer_concentration: primary.extracted.customer_concentration || null,
          employee_count:         primary.extracted.employee_count ?? null,
          stage, status,
          cim_parsed:             primary.extracted.doc_type === 'cim',
          dropbox_path:           dealFolderPath || null,
          expected_close:         new Date().toISOString().split('T')[0],
        }).select('id').single()

        await supabase.from('notes').insert({
          note_date:  noteDate,
          raw_text:   `Forwarded via email by ${from}\nSubject: ${subject}\nFiles: ${allFileNames}`,
          summary:    `${docLabel} received for ${primary.extracted.company_name ?? 'unknown company'}. Auto-logged as ${stage}.${supportingLabel}${instructions.forwarder_note ? ` Note: ${instructions.forwarder_note}` : ''}`,
          next_steps: null,
          logged_by:  from.split('@')[0] ?? 'email',
          source:     'email',
          deal_id:    deal?.id ?? null,
        })

        if (allContacts.length > 0 && deal?.id) {
          await upsertContacts(supabase, allContacts, deal.id)
        }

        // Notify for active-pipeline deals only (skip passes/closed). Must await on serverless.
        if (status === 'Active') {
          try {
            await sendDealNotification({
              companyName: primary.extracted.company_name || `Unknown — ${subject.slice(0, 60)}`,
              stage, status,
              sector:      primary.extracted.sector      || null,
              geography:   primary.extracted.geography   || null,
              revenue:     primary.extracted.revenue     ?? null,
              ebitda:      primary.extracted.ebitda      ?? null,
              description: primary.extracted.description || null,
              dealId:      deal?.id || null,
              isPending:   false,
            })
          } catch (e: any) { log.error('[deal-notify] email auto-approve:', e?.message) }
        }

        results.push({ type: primary.extracted.doc_type, status: 'auto-approved', stage, files: allFileNames, company: primary.extracted.company_name, deal_id: deal?.id })
        await recordIntakeEvent(supabase, {
          kind: 'deal-logged',
          summary: `Logged ${primary.extracted.company_name ?? 'Unknown'} as ${stage}${primary.extracted.deal_type ? ` (${primary.extracted.deal_type})` : ''}${primary.extracted.parent_portco ? ` for ${primary.extracted.parent_portco}` : ''}`,
          detail: { company: primary.extracted.company_name ?? null, stage, deal_type: primary.extracted.deal_type ?? null, parent_portco: primary.extracted.parent_portco ?? null, from, file: allFileNames },
          deal_id: deal?.id ?? null,
          message_id: messageId || null,
        })

      } else {
        // ── New deal, pending review ─────────────────────────────────────────
        const { data: queuedItem } = await supabase.from('intake_queue').insert({
          source:       'email',
          doc_type:     primary.extracted.doc_type ?? 'teaser',
          file_name:    primary.fileName,
          from_email:   from,
          dropbox_path: dealFolderPath,
          extracted: {
            ...primary.extracted,
            contacts:          allContacts,
            _supporting_files: supporting.map(d => d.fileName),
            _stage_suggestion: instructions.stage         || null,
            _forwarder_note:   instructions.forwarder_note || null,
            // What the forwarder asked for, and how sure we are — shown in the queue UI.
            _command:          command.kind === 'log-deal' ? commandSummary(command) : null,
            _command_source:   command.kind === 'log-deal' ? 'deterministic' : 'llm',
            _ambiguity:        parentAmbiguity?.reason ?? null,
            _candidates:       parentAmbiguity?.candidates ?? [],
          },
          status: 'pending',
        }).select('id').single()

        await recordIntakeEvent(supabase, {
          kind: parentAmbiguity ? 'ambiguous' : 'deal-queued',
          summary: parentAmbiguity
            ? `"${primary.extracted.company_name ?? 'Unknown'}" queued — ${parentAmbiguity.reason}`
            : `Queued for review: ${primary.extracted.company_name ?? 'Unknown'}${instructions.stage ? ` (${instructions.stage})` : ''}`,
          detail: { company: primary.extracted.company_name ?? null, stage: instructions.stage ?? null, reason: parentAmbiguity?.reason ?? null, candidates: parentAmbiguity?.candidates ?? [], from, file: primary.fileName },
          queue_id: queuedItem?.id ?? null,
          message_id: messageId || null,
        })

        await supabase.from('notes').insert({
          note_date:  noteDate,
          raw_text:   `Forwarded via email by ${from}\nSubject: ${subject}\nFiles: ${allFileNames}`,
          summary:    `${docLabel} received for ${primary.extracted.company_name ?? 'unknown company'} via email intake. Pending review.${supportingLabel}${instructions.forwarder_note ? ` Forwarder note: "${instructions.forwarder_note}"` : ''}`,
          next_steps: instructions.stage ? `Suggested stage: ${instructions.stage}` : 'Review in Document Intake → Pending Review',
          logged_by:  from.split('@')[0] ?? 'email',
          source:     'email',
          deal_id:    null,
        })

        results.push({ type: primary.extracted.doc_type, status: 'queued', files: allFileNames, company: primary.extracted.company_name })
      }

      return NextResponse.json({ success: true, processed: results })
    }

    // ── Path B: no attachments — parse email body as a note ───────────────────
    if (!text && !subject) {
      return NextResponse.json({ error: 'No email content provided' }, { status: 400 })
    }

    // Dedup: skip if a note from the same sender with the same subject already exists today
    const { data: existingBodyNote } = await supabase
      .from('notes')
      .select('id')
      .eq('source', 'email')
      .eq('note_date', noteDate)
      .ilike('raw_text', `%Subject: ${subject}%`)
      .limit(1)
      .maybeSingle()
    if (existingBodyNote) {
      log.info('Dedup: note already exists for this subject, skipping Path B')
      await recordIntakeEvent(supabase, {
        kind: 'skipped',
        summary: `Duplicate email body skipped: "${subject.slice(0, 60)}"`,
        detail: { reason: 'duplicate email body', from },
        message_id: messageId || null,
      })
      return NextResponse.json({ success: true, processed: [{ type: 'skipped', reason: 'duplicate email body' }] })
    }

    // Parse the forwarding note for explicit instructions (same as Path A).
    // In a no-attachment context "for Amped" or "parent_portco: Amped" both mean
    // "file this under the Amped portfolio company", not an add-on acquisition.
    const pathBInstructions = await parseForwardingNote(text, { from, fromName, cc: ccFull })
    log.info('Path B instructions parsed', { stage: pathBInstructions.stage, status: pathBInstructions.status, dealType: pathBInstructions.deal_type, autoApprove: pathBInstructions.auto_approve, hasDealName: !!pathBInstructions.deal_name, hasPortco: !!(pathBInstructions.portco_name || pathBInstructions.parent_portco), hasForwarderNote: !!pathBInstructions.forwarder_note, contacts: pathBInstructions.contacts?.length ?? 0 })

    // Deterministic command slots win (also holds when the LLM failed).
    if (command.kind === 'log-deal') {
      if (command.stage) pathBInstructions.stage = command.stage
      if (command.deal_type) pathBInstructions.deal_type = command.deal_type
      if (command.parent_portco) pathBInstructions.parent_portco = command.parent_portco
      if (command.stage) pathBInstructions.auto_approve = true
    }

    const emailContent = `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${text}`.trim()

    const response = await anthropic.messages.create({
      model: AI_MODELS.fast,
      max_tokens: 1800, // larger budget so multi-contact extraction isn't truncated
      system: EMAIL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Extract CRM data from this email:\n\n${emailContent}` }],
    })

    const parsed = parseAiJson<any>(extractText(response.content as any))

    // Match existing deal, portco, and contact
    let deal_id: string | null = null
    let contact_id: string | null = null
    let portfolio_company_id: string | null = null

    // Only try deal matching if the forwarding note didn't explicitly name a portco
    const hasExplicitPortco = !!(pathBInstructions.portco_name || pathBInstructions.parent_portco)

    if (!hasExplicitPortco && parsed.deal_names?.length > 0) {
      for (const name of parsed.deal_names) {
        const { data } = await supabase.from('deals').select('id').ilike('company_name', `%${name}%`).limit(1).maybeSingle()
        if (data) { deal_id = data.id; break }
      }
    }

    // If no deal matched, try to match a portfolio company.
    // In Path B (no attachment), both portco_name AND parent_portco from the
    // forwarding note are valid portco signals — "for Amped" sets parent_portco
    // but here it means "file under Amped", not "acquire for Amped".
    if (!deal_id) {
      const portcoNames = [
        pathBInstructions.portco_name,
        pathBInstructions.parent_portco,  // "for Amped" → parent_portco in LLM, but means portco note here
        ...(parsed.portco_names ?? []),
      ].filter(Boolean) as string[]

      for (const name of portcoNames) {
        const { data } = await supabase
          .from('portfolio_companies')
          .select('id')
          .ilike('name', `%${name}%`)
          .limit(1)
          .maybeSingle()
        if (data) { portfolio_company_id = data.id; break }
      }
    }

    // Merge contacts from email body, forwarding note, and CC headers — dedupe by email
    const bodyContacts: any[] = filterInternalContacts(parsed.contacts ?? [])
    const allPathBContacts: any[] = []
    const seenEmails = new Set<string>()
    const seenNames  = new Set<string>()
    for (const c of [...(pathBInstructions.contacts ?? []), ...bodyContacts]) {
      if (!c.name?.trim()) continue
      const emailKey = c.email?.toLowerCase()
      const nameKey  = c.name.toLowerCase().trim()
      if (emailKey && seenEmails.has(emailKey)) continue
      if (!emailKey && seenNames.has(nameKey)) continue
      if (emailKey) seenEmails.add(emailKey)
      seenNames.add(nameKey)
      allPathBContacts.push(c)
    }

    // Try to match a single primary contact for the note (first one with a real DB hit)
    for (const c of allPathBContacts) {
      const parts = c.name.trim().split(/\s+/)
      if (parts.length < 2) continue
      const { data } = await supabase.from('contacts').select('id').ilike('first_name', parts[0]).ilike('last_name', parts.slice(1).join(' ')).limit(1).maybeSingle()
      if (data) { contact_id = data.id; break }
    }

    // ── Create a deal from a plain-text email if it describes a new opportunity ─
    // Triggers when: no existing deal matched, no portco matched, and the email
    // body mentions a prospective target company name. Respects "pass / hold /
    // closed" intent from the forwarding note so a quick "pass" email goes
    // straight to the right stage instead of defaulting to Teaser → NDA flow.
    let createdDeal: { id: string; company_name: string; stage: string } | null = null
    if (!deal_id && !portfolio_company_id && parsed.deal_names?.length > 0) {
      const candidateName = parsed.deal_names[0].trim()
      const stage  = resolveIntakeStage(pathBInstructions.stage)
      const status = resolveDealStatus(stage, pathBInstructions.status)
      log.info('Path B creating deal', { company: candidateName, stage, status })
      const { data: newDeal, error: dealErr } = await supabase.from('deals').insert({
        company_name:   candidateName,
        deal_type:      pathBInstructions.deal_type || 'platform',
        parent_portco:  pathBInstructions.parent_portco || null,
        stage,
        status,
        cim_parsed:     false,
        expected_close: new Date().toISOString().split('T')[0],
      }).select('id, company_name, stage').single()
      if (dealErr) {
        log.error('Path B deal create failed:', dealErr.message)
      } else if (newDeal) {
        createdDeal = newDeal
        deal_id = newDeal.id
        // Link ALL contacts (body + forwarding note + CC) to the new deal
        if (allPathBContacts.length) {
          log.info(`Path B linking ${allPathBContacts.length} contacts to deal ${newDeal.id}`)
          try { await upsertContacts(supabase, allPathBContacts, newDeal.id) }
          catch (e: any) { log.warn('contact link failed:', e?.message) }
        }
        // Notify for active-pipeline deals only (skip passes/closed). Must await on serverless.
        if (status === 'Active') {
          try {
            await sendDealNotification({
              companyName: candidateName,
              stage, status,
              dealId:      newDeal.id,
              isPending:   false,
            })
          } catch (e: any) { log.error('[deal-notify] email path B:', e?.message) }
        }
      }
    }

    // If forwarder explicitly decided pass/hold/closed, surface that as the note's
    // next steps instead of whatever the LLM guessed (often "process NDA").
    const explicitDecision = pathBInstructions.auto_approve && pathBInstructions.stage
      ? `Logged as ${pathBInstructions.stage}`
      : null

    const summaryWithCreated = createdDeal
      ? `Created new deal "${createdDeal.company_name}" in stage ${createdDeal.stage}.${parsed.summary ? ` ${parsed.summary}` : ''}`
      : parsed.summary ?? null

    const { data: note, error } = await supabase.from('notes').insert({
      note_date:            noteDate,
      raw_text:             `From: ${from}\nSubject: ${subject}\n\n${text}`.slice(0, 4000),
      summary:              summaryWithCreated,
      next_steps:           explicitDecision ?? parsed.next_steps ?? null,
      logged_by:            parsed.logged_by  ?? from.split('@')[0] ?? 'email',
      source:               'email',
      deal_id,
      contact_id,
      portfolio_company_id,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await recordIntakeEvent(supabase, {
      kind: createdDeal ? 'deal-logged' : 'note-logged',
      summary: createdDeal
        ? `Logged ${createdDeal.company_name} as ${createdDeal.stage} from email`
        : `Note saved from email: "${subject.slice(0, 60)}"`,
      detail: { company: createdDeal?.company_name ?? null, stage: createdDeal?.stage ?? null, deal_name: parsed.deal_names?.[0] ?? null, from },
      deal_id,
      contact_id,
      message_id: messageId || null,
    })

    return NextResponse.json({
      success: true,
      processed: [{
        type: createdDeal ? 'deal-from-email' : 'note',
        note_id: note?.id,
        deal_id: createdDeal?.id,
        deal_stage: createdDeal?.stage,
      }],
    })

  } catch (err: any) {
    log.error('Email intake error:', err)
    // Best-effort: a top-level failure is invisible otherwise — the digest
    // surfaces it so a broken webhook doesn't silently drop intake.
    try {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      await recordIntakeEvent(sb, {
        kind: 'failed',
        summary: 'Email intake failed',
        detail: { error: err.message },
        message_id: null,
      })
    } catch { /* ignore — intake is already failing */ }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
})
