// ── Email action command execution ──────────────────────────────────────────
// Executes the deterministic action commands parsed by
// lib/email-action-commands.ts (change stage / update deal / update contact
// / file under / move file) against Supabase + Dropbox. One implementation
// behind every surface: forwards and fresh emails to the intake inbox,
// digest replies, and approvals of stored LLM interpretations
// (lib/email-command-fallback.ts).
//
// Safety rules (same as the rest of intake):
//   - a name resolves exactly, or by a UNIQUE partial match (lib/name-resolution)
//   - zero matches → failed outcome, nothing touched
//   - several matches → nothing touched; a queue item carrying the
//     candidates is created so Ken picks from the digest / queue UI
//   - stage changes reuse stageToStatus (lib/intake-stage) and the same
//     Dropbox folder-move the digest-reply stage path performs
//     (expectedDropboxFolder + dropboxMove, failure noted, never fatal)
//
// Outcome events: done/failed are recorded here as command-action /
// command-failed (or reply-action / reply-failed when ctx.record is
// 'reply'), and ambiguous queueing records an 'ambiguous' event — so the
// NEXT digest reports everything, whichever surface the command came from.
// With ctx.record 'none' the caller records from the returned outcome.

import {
  dropboxConfigured,
  dropboxMove,
  dropboxUpload,
  dropboxFindFilesByName,
  expectedDropboxFolder,
  type DropboxFileMatch,
} from './dropbox'
import { stageToStatus } from './intake-stage'
import { recordIntakeEvent, todayCentral } from './intake-events'
import { resolveByName, type NamedEntity } from './name-resolution'
import { describeActionCommand, type ActionCommand } from './email-action-commands'

export interface CommandOutcome {
  status: 'done' | 'failed' | 'queued'
  summary: string
  deal_id?: string | null
  contact_id?: string | null
  queue_id?: string | null
}

export interface ActionCommandContext {
  from: string
  subject: string
  messageId: string
  /** Where the command came from — carried into event detail. */
  surface: 'forward' | 'reply' | 'queue-approval'
  /** Which event kinds done/failed outcomes use; 'none' = caller records. */
  record?: 'command' | 'reply' | 'none'
  /** Attachments for 'file-under' (buffers already resolved by the caller). */
  attachments?: { name: string; buffer: Buffer }[]
  /** Set when this execution came from the LLM smart fallback. */
  interpreted?: { originalLine: string; interpretedAs: string; confidence: number }
}

export interface ActionCommandDeps {
  findFiles?: (name: string) => Promise<DropboxFileMatch[]>
  movePath?: (from: string, to: string) => Promise<string>
  uploadFile?: (folder: string, name: string, buffer: Buffer) => Promise<string>
  dropboxReady?: () => boolean
}

interface DealRow {
  id: string
  company_name: string
  stage: string
  status: string
  dropbox_path: string | null
  deal_type: string | null
  parent_portco: string | null
  sector: string | null
  geography: string | null
}

interface ContactRow {
  id: string
  first_name: string
  last_name: string
  firm: string | null
  title: string | null
  phone: string | null
  email: string | null
}

const DEAL_COLS = 'id, company_name, stage, status, dropbox_path, deal_type, parent_portco, sector, geography'
const CONTACT_COLS = 'id, first_name, last_name, firm, title, phone, email'

/** Normalize a stored dropbox_path to its folder (legacy rows may hold a file path). */
export function toFolderPath(p: string | null | undefined): string | null {
  if (!p) return null
  const last = p.split('/').pop() ?? ''
  return last.includes('.') ? p.substring(0, p.lastIndexOf('/')) : p
}

// ── Candidate pools ───────────────────────────────────────────────────────────

async function fetchDealPool(supabase: any, query: string): Promise<DealRow[]> {
  const { data } = await supabase.from('deals')
    .select(DEAL_COLS)
    .ilike('company_name', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(25)
  if (data?.length) return data as DealRow[]
  // Fall back to the first-3-words chunk, the route's findDealByName trick —
  // catches "Project Anchor Holdings LLC" vs a stored "Project Anchor".
  const stripped = query.replace(/\b(Inc|LLC|Ltd|Co|Corp|Company|Group|Partners|Holdings|the)\b\.?/gi, '').trim()
  const chunk = stripped.split(/\s+/).slice(0, 3).join(' ')
  if (chunk.length > 3 && chunk.toLowerCase() !== query.toLowerCase()) {
    const { data: partial } = await supabase.from('deals')
      .select(DEAL_COLS)
      .ilike('company_name', `%${chunk}%`)
      .order('created_at', { ascending: false })
      .limit(25)
    return (partial ?? []) as DealRow[]
  }
  return []
}

async function fetchContactPool(supabase: any, name: string): Promise<ContactRow[]> {
  const parts = name.trim().split(/\s+/)
  const firstName = parts[0]
  const lastName = parts.slice(1).join(' ')
  if (lastName) {
    const { data } = await supabase.from('contacts')
      .select(CONTACT_COLS)
      .ilike('first_name', firstName).ilike('last_name', lastName)
      .order('created_at', { ascending: false }).limit(10)
    if (data?.length) return data as ContactRow[]
  }
  const { data } = await supabase.from('contacts')
    .select(CONTACT_COLS)
    .ilike('last_name', lastName || firstName)
    .order('created_at', { ascending: false }).limit(10)
  return (data ?? []) as ContactRow[]
}

// ── Ambiguity queueing ────────────────────────────────────────────────────────

/**
 * Queue a command that named several matches. The queue item carries the
 * parsed command and the candidates (the intake's existing extras pattern);
 * approving it in the UI/reply does NOT auto-pick — Ken re-sends with the
 * exact name (approveQueueItem guards _kind 'email-command' without a
 * stored interpretation). Records the 'ambiguous' digest event.
 */
export async function queueAmbiguousCommand(
  supabase: any,
  cmd: ActionCommand,
  ctx: ActionCommandContext,
  reason: string,
  candidates: string[],
): Promise<CommandOutcome> {
  const { data: queued } = await supabase.from('intake_queue').insert({
    source: 'email',
    doc_type: 'other',
    file_name: ctx.subject.slice(0, 200),
    from_email: ctx.from,
    extracted: {
      _kind: 'email-command',
      _command: cmd,
      _candidates: candidates,
      _ambiguity: reason,
      _command_source: ctx.interpreted ? 'llm-interpreted' : 'deterministic',
      _from: ctx.from,
      _subject: ctx.subject,
      _message_id: ctx.messageId,
    },
    status: 'pending',
  }).select('id').single()
  const summary = `"${describeActionCommand(cmd)}" needs a pick — ${reason}`
  await recordIntakeEvent(supabase, {
    kind: 'ambiguous',
    summary,
    detail: {
      reason,
      candidates,
      command: cmd.raw,
      from: ctx.from,
      ...(ctx.interpreted ? { interpreted: true, original_line: ctx.interpreted.originalLine } : {}),
    },
    queue_id: queued?.id ?? null,
    message_id: ctx.messageId || null,
  })
  return { status: 'queued', summary, queue_id: queued?.id ?? null }
}

// ── Executor ──────────────────────────────────────────────────────────────────

export async function executeActionCommand(
  supabase: any,
  cmd: ActionCommand,
  ctx: ActionCommandContext,
  deps: ActionCommandDeps = {},
): Promise<CommandOutcome> {
  const findFiles = deps.findFiles ?? dropboxFindFilesByName
  const movePath = deps.movePath ?? dropboxMove
  const uploadFile = deps.uploadFile ?? dropboxUpload
  const dropboxReady = deps.dropboxReady ?? dropboxConfigured

  const finish = async (outcome: CommandOutcome): Promise<CommandOutcome> => {
    if (outcome.status !== 'queued' && ctx.record !== 'none') {
      const okKind = ctx.record === 'reply' ? 'reply-action' : 'command-action'
      const failKind = ctx.record === 'reply' ? 'reply-failed' : 'command-failed'
      await recordIntakeEvent(supabase, {
        kind: outcome.status === 'done' ? okKind : failKind,
        summary: outcome.summary,
        detail: {
          command: cmd.raw,
          command_type: cmd.type,
          surface: ctx.surface,
          from: ctx.from,
          ...(ctx.interpreted
            ? { interpreted: true, original_line: ctx.interpreted.originalLine, interpreted_as: ctx.interpreted.interpretedAs, confidence: ctx.interpreted.confidence }
            : {}),
        },
        deal_id: outcome.deal_id ?? null,
        contact_id: outcome.contact_id ?? null,
        message_id: ctx.messageId || null,
      })
    }
    return outcome
  }
  const fail = (summary: string, extra?: Partial<CommandOutcome>) =>
    finish({ status: 'failed', summary, ...extra })

  // Resolve a deal name once — every deal command shares the rules.
  const resolveDeal = async (): Promise<
    | { deal: DealRow }
    | { outcome: CommandOutcome }
  > => {
    const pool = await fetchDealPool(supabase, cmdTypeDealName(cmd))
    const named: (NamedEntity & { row: DealRow })[] = pool.map(d => ({ id: d.id, name: d.company_name, row: d }))
    const res = resolveByName(named, cmdTypeDealName(cmd))
    if (res.status === 'none') {
      return { outcome: await fail(`Command not carried out: no deal matched "${cmdTypeDealName(cmd)}"`) }
    }
    if (res.status === 'many') {
      const names = res.candidates.map(c => c.name)
      return {
        outcome: await queueAmbiguousCommand(
          supabase, cmd, ctx,
          `${names.length} deals matched "${cmdTypeDealName(cmd)}": ${names.join(', ')}`,
          names,
        ),
      }
    }
    return { deal: res.match.row }
  }

  // ── change / move <Deal> to <stage> ──────────────────────────────────────
  if (cmd.type === 'change-stage') {
    const r = await resolveDeal()
    if ('outcome' in r) return r.outcome
    const deal = r.deal
    // Capture pre-update values for the audit summary — the fetched row is
    // not guaranteed to be a snapshot once the update lands.
    const prevStage = deal.stage
    const prevType = deal.deal_type
    const updates: Record<string, any> = { stage: cmd.stage, status: stageToStatus(cmd.stage) }
    if (cmd.dealType) updates.deal_type = cmd.dealType

    // Move the Dropbox folder to the new stage's canonical parent — the
    // same re-keying the digest-reply stage path does. Non-fatal on error.
    let folderNote = ''
    const currentFolder = toFolderPath(deal.dropbox_path)
    const targetFolder = expectedDropboxFolder(deal.id, cmd.stage)
    if (dropboxReady() && currentFolder && currentFolder.toLowerCase() !== targetFolder.toLowerCase()) {
      try {
        const moved = await movePath(currentFolder, targetFolder)
        updates.dropbox_path = toFolderPath(moved) ?? targetFolder
      } catch (e: any) {
        folderNote = ` (folder move failed: ${e?.message})`
      }
    }
    await supabase.from('deals').update(updates).eq('id', deal.id)
    const typeNote = cmd.dealType && cmd.dealType !== prevType ? `, type ${prevType ?? '(none)'} → ${cmd.dealType}` : ''
    return finish({
      status: 'done',
      summary: `${deal.company_name}: stage ${prevStage} → ${cmd.stage}${typeNote}${folderNote}`,
      deal_id: deal.id,
    })
  }

  // ── update <Deal>: fields ─────────────────────────────────────────────────
  if (cmd.type === 'update-deal') {
    const r = await resolveDeal()
    if ('outcome' in r) return r.outcome
    const deal = r.deal
    const fields = { ...cmd.fields }

    // Portfolio company assignment must name a real Active portco.
    if (fields.parent_portco) {
      const { data: portcos } = await supabase.from('portfolio_companies').select('name').eq('status', 'Active')
      const named: NamedEntity[] = (portcos ?? []).map((p: any) => ({ id: p.name as string, name: p.name as string }))
      const res = resolveByName(named, fields.parent_portco)
      if (res.status === 'none') {
        return fail(`Command not carried out: parent portco "${fields.parent_portco}" is not in Nexus`)
      }
      if (res.status === 'many') {
        const names = res.candidates.map(c => c.name)
        return queueAmbiguousCommand(supabase, cmd, ctx,
          `${names.length} portfolio companies matched "${fields.parent_portco}": ${names.join(', ')}`, names)
      }
      fields.parent_portco = res.match.name
    }

    const labels: Record<string, string> = { deal_type: 'type', parent_portco: 'portco', sector: 'sector', geography: 'geography' }
    const current: Record<string, any> = { deal_type: deal.deal_type, parent_portco: deal.parent_portco, sector: deal.sector, geography: deal.geography }
    const updates: Record<string, any> = {}
    const changes: string[] = []
    for (const [k, v] of Object.entries(fields)) {
      if (v == null) continue
      updates[k] = v
      changes.push(`${labels[k] ?? k} ${current[k] ?? '(none)'} → ${v}`)
    }
    if (!Object.keys(updates).length) {
      return finish({ status: 'done', summary: `${deal.company_name}: no changes (${describeActionCommand(cmd)})`, deal_id: deal.id })
    }
    await supabase.from('deals').update(updates).eq('id', deal.id)
    return finish({ status: 'done', summary: `${deal.company_name}: ${changes.join(', ')}`, deal_id: deal.id })
  }

  // ── update contact <Name>: fields ─────────────────────────────────────────
  if (cmd.type === 'update-contact') {
    const pool = await fetchContactPool(supabase, cmd.contactName)
    const named: (NamedEntity & { row: ContactRow })[] = pool.map(c => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      row: c,
    }))
    const res = resolveByName(named, cmd.contactName)
    if (res.status === 'none') {
      return fail(`Command not carried out: no contact matched "${cmd.contactName}"`)
    }
    if (res.status === 'many') {
      const labels = res.candidates.map(c => `${c.name}${c.row.firm ? ` · ${c.row.firm}` : ''}`)
      return queueAmbiguousCommand(supabase, cmd, ctx,
        `${labels.length} contacts matched "${cmd.contactName}": ${labels.join(', ')}`, labels)
    }
    const contact = res.match.row
    const labels: Record<string, string> = { phone: 'phone', title: 'title', firm: 'company', email: 'email' }
    const updates: Record<string, any> = {}
    const changes: string[] = []
    for (const [k, v] of Object.entries(cmd.fields)) {
      if (v == null) continue
      updates[k] = v
      changes.push(`${labels[k] ?? k} ${(contact as any)[k] ?? '(none)'} → ${v}`)
    }
    await supabase.from('contacts').update(updates).eq('id', contact.id)
    return finish({
      status: 'done',
      summary: `${contact.first_name} ${contact.last_name}: ${changes.join(', ')}`,
      contact_id: contact.id,
    })
  }

  // ── file under <Deal> ─────────────────────────────────────────────────────
  if (cmd.type === 'file-under') {
    const r = await resolveDeal()
    if ('outcome' in r) return r.outcome
    const deal = r.deal
    const attachments = ctx.attachments ?? []
    if (!attachments.length) {
      return fail(`Command not carried out: "file under ${cmd.dealName}" — the email had no attachments to file`, { deal_id: deal.id })
    }
    if (!dropboxReady()) {
      return fail(`Command not carried out: Dropbox is not configured, so ${attachments.length} attachment(s) could not be filed under ${deal.company_name}`, { deal_id: deal.id })
    }
    const folder = toFolderPath(deal.dropbox_path) ?? expectedDropboxFolder(deal.id, deal.stage)
    const filed: string[] = []
    const failedNames: string[] = []
    for (const att of attachments) {
      try {
        await uploadFile(folder, att.name, att.buffer)
        filed.push(att.name)
      } catch {
        failedNames.push(att.name)
      }
    }
    if (!filed.length) {
      return fail(`Command not carried out: Dropbox upload failed for ${failedNames.join(', ')} (filing under ${deal.company_name})`, { deal_id: deal.id })
    }
    await supabase.from('notes').insert({
      note_date: todayCentral(),
      raw_text: `Filed via email command by ${ctx.from}\nSubject: ${ctx.subject}\nFiles: ${attachments.map(a => a.name).join(', ')}`,
      summary: `Filed ${filed.length} attachment(s) under ${deal.company_name} by email command: ${filed.join(', ')}${failedNames.length ? ` (failed: ${failedNames.join(', ')})` : ''}`,
      logged_by: ctx.from.split('@')[0] ?? 'email',
      source: 'email',
      deal_id: deal.id,
    })
    return finish({
      status: 'done',
      summary: `Filed ${filed.length} attachment(s) under ${deal.company_name}: ${filed.join(', ')}${failedNames.length ? ` (failed: ${failedNames.join(', ')})` : ''}`,
      deal_id: deal.id,
    })
  }

  // ── move file <filename> to <Deal> ────────────────────────────────────────
  if (cmd.type === 'move-file') {
    const r = await resolveDeal()
    if ('outcome' in r) return r.outcome
    const deal = r.deal
    if (!dropboxReady()) {
      return fail('Command not carried out: Dropbox is not configured', { deal_id: deal.id })
    }
    const targetFolder = toFolderPath(deal.dropbox_path) ?? expectedDropboxFolder(deal.id, deal.stage)
    let matches: DropboxFileMatch[]
    try {
      matches = await findFiles(cmd.fileName)
    } catch (e: any) {
      return fail(`Command not carried out: Dropbox search failed for "${cmd.fileName}" — ${e?.message}`, { deal_id: deal.id })
    }
    const inTarget = matches.filter(m => m.path.toLowerCase().startsWith(`${targetFolder.toLowerCase()}/`))
    const elsewhere = matches.filter(m => !inTarget.includes(m))
    if (elsewhere.length === 0) {
      if (inTarget.length) {
        return finish({ status: 'done', summary: `"${cmd.fileName}" is already in ${deal.company_name}'s folder`, deal_id: deal.id })
      }
      return fail(`Command not carried out: no file named "${cmd.fileName}" found in Dropbox`, { deal_id: deal.id })
    }
    if (elsewhere.length > 1) {
      const paths = elsewhere.map(m => m.path)
      return queueAmbiguousCommand(supabase, cmd, ctx,
        `${paths.length} files named "${cmd.fileName}": ${paths.join(', ')}`, paths)
    }
    const match = elsewhere[0]
    const dest = `${targetFolder}/${match.name}`
    try {
      await movePath(match.path, dest)
    } catch (e: any) {
      return fail(`Command not carried out: moving "${cmd.fileName}" to ${deal.company_name} failed — ${e?.message}`, { deal_id: deal.id })
    }
    return finish({
      status: 'done',
      summary: `Moved "${match.name}" to ${deal.company_name}'s folder (was ${match.path})`,
      deal_id: deal.id,
    })
  }

  return fail('Command not carried out: unsupported command')
}

/** The deal name a deal-scoped command refers to ('' for contact commands). */
function cmdTypeDealName(cmd: ActionCommand): string {
  switch (cmd.type) {
    case 'change-stage':
    case 'update-deal':
    case 'file-under':
    case 'move-file':
      return cmd.dealName
    default:
      return ''
  }
}
