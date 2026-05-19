import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { dropboxConfigured, dropboxUpload, expectedDropboxFolder } from '@/lib/dropbox'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// ── DOCX text extraction ─────────────────────────────────────────────────────
async function extractDocxText(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) return ''
  return xml
    .replace(/<w:br[^/]*/g, '\n')
    .replace(/<w:p[ >][^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Document extraction prompt ───────────────────────────────────────────────
const DOC_SYSTEM_PROMPT = `You extract deal data from teasers and CIMs forwarded via email. Return ONLY valid JSON.

{
  "doc_type": "teaser | cim | nda | other",
  "company_name": "string or null",
  "sector": "string — closest match from: Underground Utilities | Electrical Contracting | Civil / Public Works | Commercial Landscaping | Fiber Optics | HVAC | Plumbing | Industrial Services | Environmental Services | Construction & Engineering. If none fit, short descriptive name.",
  "geography": "string or null — primary state(s) or region",
  "deal_type": "platform | add-on | recap | growth",
  "revenue": "number in raw dollars or null",
  "ebitda": "number in raw dollars or null",
  "description": "string — 2-4 factual sentences about the business. No opinions or qualitative assessments.",
  "financial_summary": "string or null — paragraph on financials, margins, growth (CIM only)",
  "key_risks": ["string array — 3-5 risks (CIM only, else [])"],
  "growth_opportunities": ["string array — 3-5 opportunities (CIM only, else [])"],
  "management_team": [{"name": "string", "title": "string"}],
  "banker_name": "string or null",
  "banker_firm": "string or null",
  "asking_price": "number or null",
  "asking_multiple": "number or null",
  "contacts": [
    {
      "name": "string",
      "firm": "string or null",
      "role": "Source / Banker | Management | Advisor | Lender | Other",
      "title": "string or null",
      "email": "string or null",
      "phone": "string or null"
    }
  ]
}

Rules:
- doc_type: "teaser" = short marketing summary, "cim" = detailed confidential memo, "nda" = non-disclosure agreement, "other" = anything else
- Dollar values as raw numbers (4200000 for $4.2M). If a range is given (e.g. "$4–6M revenue"), use the midpoint (5000000). If described as "approximately $5M" use 5000000. If only TTM or LTM is stated, use that figure.
- Null ONLY if no numeric hint is given anywhere in the document — do not leave null if you can infer from context
- description: purely factual, no adjectives expressing quality`

// ── Email body prompt ─────────────────────────────────────────────────────────
const EMAIL_SYSTEM_PROMPT = `You extract structured information from forwarded emails for a CRM. Return ONLY valid JSON.

{
  "summary": "string — 1-3 sentence factual summary",
  "next_steps": "string or null — explicit action items or follow-ups",
  "deal_names": ["string array — company or deal names mentioned"],
  "contact_names": ["string array — personal names in First Last format"],
  "logged_by": "string or null — first name of person who forwarded this"
}

Rules: factual only, no opinions, null/[] if nothing found.`

// ── Process a single attachment through Claude ────────────────────────────────
async function processAttachment(
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<any> {
  const isPDF  = contentType.includes('pdf')  || fileName.toLowerCase().endsWith('.pdf')
  const isDOCX = contentType.includes('word') || /\.docx?$/i.test(fileName)

  let messageContent: any[]

  if (isPDF) {
    messageContent = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
        title: fileName,
      },
      { type: 'text', text: `Extract deal data from this document (${fileName}). Return only valid JSON.` },
    ]
  } else if (isDOCX) {
    const text = await extractDocxText(buffer)
    messageContent = [
      { type: 'text', text: `DOCUMENT (${fileName}):\n${text}` },
      { type: 'text', text: 'Extract deal data from the document above. Return only valid JSON.' },
    ]
  } else {
    return null // unsupported type
  }

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    system: DOC_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: messageContent }],
  })

  const raw = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim()

  return JSON.parse(raw)
}

// ── Get today's date in US Central time ───────────────────────────────────────
// Vercel runs in UTC. Using toISOString() can return tomorrow's date for US
// evening hours. Always format in America/Chicago (CST/CDT) so notes are
// dated correctly regardless of when the serverless function runs.
function todayCST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
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
  status: string | null
  deal_type: string | null
  parent_portco: string | null
  forwarder_note: string | null
  auto_approve: boolean
  contacts: any[]
}> {
  const empty = { stage: null, status: null, deal_type: null, parent_portco: null, forwarder_note: null, auto_approve: false, contacts: [] }
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
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    system: `Extract deal instructions AND contact info from a forwarding note. Return ONLY valid JSON.

{
  "stage": "exact stage or null — one of: Teaser | Reviewing | Pre-LOI | LOI Submitted | Exclusivity | Closed (Platform) | Closed (Add-On) | Pass (DOA) | Pass (Pre-LOI) | Pass (Post-LOI) | Hold",
  "status": "Active | Dead | Closed | null",
  "deal_type": "platform | add-on | null",
  "parent_portco": "portfolio company name if add-on, else null",
  "forwarder_note": "any context or commentary the sender added, else null",
  "auto_approve": true or false — true only if sender made an explicit final decision (pass, hold, close),
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
    const raw = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(raw)
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

// ── Find or create a deal by company name ────────────────────────────────────
async function findOrCreateDeal(supabase: any, extracted: any): Promise<string> {
  // Try to find existing deal
  if (extracted.company_name) {
    const { data: existing } = await supabase
      .from('deals')
      .select('id')
      .ilike('company_name', extracted.company_name)
      .limit(1)
      .maybeSingle()
    if (existing) return existing.id
  }

  // Create new deal
  const stage = 'Teaser'
  const { data: newDeal } = await supabase.from('deals').insert({
    company_name: extracted.company_name || 'Unknown (email intake)',
    sector:       extracted.sector    || null,
    geography:    extracted.geography || null,
    deal_type:    extracted.deal_type || 'platform',
    stage,
    status:       'Active',
    revenue:      extracted.revenue   ?? null,
    ebitda:       extracted.ebitda    ?? null,
    description:  extracted.description || null,
    cim_parsed:   false,
    expected_close: new Date().toISOString().split('T')[0],
  }).select('id').single()

  return newDeal?.id
}

// ── Upsert contacts and link to deal ─────────────────────────────────────────
async function upsertContacts(supabase: any, contacts: any[], dealId: string) {
  for (const c of contacts) {
    if (!c.name) continue
    const parts = c.name.trim().split(/\s+/)
    const firstName = parts[0]
    const lastName  = parts.slice(1).join(' ') || ''

    // Check if contact exists
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .ilike('first_name', firstName)
      .ilike('last_name', lastName)
      .limit(1)
      .maybeSingle()

    let contactId = existing?.id

    if (!contactId) {
      const { data: newContact } = await supabase.from('contacts').insert({
        first_name: firstName,
        last_name:  lastName,
        firm:       c.firm  || null,
        title:      c.title || null,
        email:      c.email || null,
        phone:      c.phone || null,
      }).select('id').single()
      contactId = newContact?.id
    }

    if (contactId && dealId) {
      // Link contact to deal if not already linked
      await supabase.from('contact_deal_links').upsert(
        { contact_id: contactId, deal_id: dealId, role: c.role || 'Other' },
        { onConflict: 'contact_id,deal_id', ignoreDuplicates: true }
      )
    }
  }
}

export async function POST(req: NextRequest) {
  // ── Webhook token verification ─────────────────────────────────────────────
  const webhookToken = process.env.POSTMARK_WEBHOOK_TOKEN
  if (webhookToken) {
    const provided = req.nextUrl.searchParams.get('token') ?? req.headers.get('x-webhook-token')
    if (provided !== webhookToken) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

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
    console.log(`[email-intake] messageId=${messageId} from=${from} subject="${subject}" attachments=${attachments.length}`,
      attachments.map((a: any) => ({ name: a.Name, type: a.ContentType, size: a.Content?.length ?? 0 })))

    // ── Idempotency guard — block duplicate webhook calls ─────────────────────
    // Two-layer check: (1) Postmark MessageID unique constraint if migration ran,
    // (2) fallback subject+from check against notes table.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()

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
          console.log(`[email-intake] Idempotency (messageId): duplicate, skipping`)
          return NextResponse.json({ success: true, skipped: 'duplicate messageId' })
        }
        if (lockError) {
          // Column probably doesn't exist yet — migration not run; fall through to layer 2
          console.warn(`[email-intake] Sentinel insert failed (run migration?): ${lockError.code} ${lockError.message}`)
        }
      } catch (e: any) {
        console.warn(`[email-intake] Sentinel error:`, e?.message)
      }
    }

    // Layer 2: fallback — check notes table for same subject today (note_date = today)
    {
      const today = new Date().toISOString().split('T')[0]
      const { data: recentNote } = await supabase
        .from('notes')
        .select('id')
        .eq('source', 'email')
        .eq('note_date', today)
        .ilike('raw_text', `%Subject: ${subject}%`)
        .limit(1)
        .maybeSingle()
      if (recentNote) {
        console.log(`[email-intake] Idempotency (fallback): note for subject "${subject}" already exists today, skipping`)
        return NextResponse.json({ success: true, skipped: 'duplicate subject+sender' })
      }
    }

    // ── Path A: process document attachments ──────────────────────────────────
    const docAttachments = attachments.filter((a: any) => {
      const name = (a.Name ?? '').toLowerCase()
      const ct   = (a.ContentType ?? '').toLowerCase()
      return ct.includes('pdf') || ct.includes('word') || name.endsWith('.pdf') || /\.docx?$/.test(name)
    })

    if (docAttachments.length > 0) {
      // Parse forwarding note once for all attachments
      const instructions = await parseForwardingNote(text, { from, fromName, cc: ccFull })
      console.log(`[email-intake] instructions:`, JSON.stringify(instructions))

      // ── Step 1: Extract all attachments in parallel ───────────────────────
      const extracted_docs: Array<{ fileName: string; buffer: Buffer; extracted: any }> = []
      await Promise.all(docAttachments.map(async (att: any) => {
        const fileName    = att.Name ?? 'document'
        const buffer      = Buffer.from(att.Content, 'base64')
        const contentType = att.ContentType ?? ''
        try {
          const extracted = await processAttachment(fileName, buffer, contentType)
          if (extracted) extracted_docs.push({ fileName, buffer, extracted })
        } catch (e: any) {
          console.error(`[email-intake] Extract error (${fileName}):`, e?.message)
          results.push({ type: 'error', file: fileName, error: e?.message })
        }
      }))

      if (extracted_docs.length === 0) {
        return NextResponse.json({ success: true, processed: results })
      }

      // ── Step 2: Find primary doc (teaser or CIM) — NDAs are supporting ────
      const primary = extracted_docs.find(d =>
        d.extracted.doc_type === 'teaser' || d.extracted.doc_type === 'cim'
      ) ?? extracted_docs[0] // fallback: first doc if no teaser/CIM
      const supporting = extracted_docs.filter(d => d !== primary)

      // Apply instruction overrides to primary
      if (instructions.deal_type)     primary.extracted.deal_type    = instructions.deal_type
      if (instructions.parent_portco) primary.extracted.parent_portco = instructions.parent_portco

      // Track all file names for the note
      const allFileNames = extracted_docs.map(d => d.fileName).join(', ')

      // ── Step 3: Look up existing deal by company name ─────────────────────
      // If a deal already exists, associate the CIM/teaser with it instead of
      // creating a duplicate. Use the existing deal's stage for Dropbox routing.
      let existingDeal: { id: string; stage: string; status: string; dropbox_path: string | null } | null = null
      if (primary.extracted.company_name) {
        const name = primary.extracted.company_name.trim()

        // Try exact match first, then partial match on the first significant word cluster
        let { data: found } = await supabase
          .from('deals')
          .select('id, stage, status, dropbox_path')
          .ilike('company_name', name)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // Fallback: partial match — useful when Claude extracts slightly different name
        if (!found) {
          // Use first 3+ meaningful words stripped of common suffixes
          const keywords = name.replace(/\b(Inc|LLC|Ltd|Co|Corp|Company|Group|Partners|Holdings|the)\b\.?/gi, '').trim()
          const firstChunk = keywords.split(/\s+/).slice(0, 3).join(' ')
          if (firstChunk.length > 3) {
            const { data: partial } = await supabase
              .from('deals')
              .select('id, stage, status, dropbox_path')
              .ilike('company_name', `%${firstChunk}%`)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            found = partial
          }
        }

        if (found) {
          existingDeal = found
          console.log(`[email-intake] Matched existing deal ${found.id} ("${name}") stage="${found.stage}"`)
        } else {
          console.log(`[email-intake] No existing deal found for "${name}"`)
        }
      }

      // ── Step 4: Upload ALL files to Dropbox ───────────────────────────────
      // Use the existing deal's stage (and its current folder) if one was found;
      // otherwise fall back to the instruction stage or 'Teaser'.
      const effectiveStage = existingDeal?.stage ?? instructions.stage ?? 'Teaser'
      const companyForPath = primary.extracted.company_name
        ? (instructions.parent_portco
            ? `${primary.extracted.company_name} [${instructions.parent_portco}]`
            : primary.extracted.company_name)
        : null
      let primaryDropboxPath: string | null = existingDeal?.dropbox_path
        ? existingDeal.dropbox_path.substring(0, existingDeal.dropbox_path.lastIndexOf('/'))  // parent folder
        : null

      if (dropboxConfigured() && companyForPath) {
        // If existing deal has a known dropbox_path, upload into its parent folder.
        // Otherwise derive the folder from expectedDropboxFolder.
        const folder = existingDeal?.dropbox_path
          ? existingDeal.dropbox_path.substring(0, existingDeal.dropbox_path.lastIndexOf('/'))
          : expectedDropboxFolder(companyForPath, effectiveStage)
        console.log(`[email-intake] Dropbox target: "${folder}" (stage="${effectiveStage}", existing=${!!existingDeal})`)
        for (const doc of extracted_docs) {
          try {
            const path = await dropboxUpload(folder, doc.fileName, doc.buffer)
            if (doc === primary) primaryDropboxPath = path
          } catch (dbxErr: any) {
            console.error(`[email-intake] Dropbox upload failed (${doc.fileName}):`, dbxErr?.message)
          }
        }
      }

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
        if (primary.extracted.revenue  != null && !existingDeal) updates.revenue = primary.extracted.revenue
        if (primary.extracted.ebitda   != null && !existingDeal) updates.ebitda  = primary.extracted.ebitda
        if (primaryDropboxPath) updates.dropbox_path = primaryDropboxPath
        if (Object.keys(updates).length > 0) {
          await supabase.from('deals').update(updates).eq('id', existingDeal.id)
        }

        // Store CIM in deal_cims if it's a CIM
        if (primary.extracted.doc_type === 'cim') {
          try {
            await supabase.from('deal_cims').insert({
              deal_id:      existingDeal.id,
              file_name:    primary.fileName,
              dropbox_path: primaryDropboxPath,
              extracted:    primary.extracted,
            })
          } catch { /* non-fatal */ }
        }

        await supabase.from('notes').insert({
          note_date:  noteDate,
          raw_text:   `Forwarded via email by ${from}\nSubject: ${subject}\nFiles: ${allFileNames}`,
          summary:    `${docLabel} received for ${primary.extracted.company_name}. Linked to existing deal (${existingDeal.stage}).${supportingLabel}${instructions.forwarder_note ? ` Note: ${instructions.forwarder_note}` : ''}`,
          next_steps: null,
          logged_by:  from.split('@')[0] ?? 'email',
          source:     'email',
          deal_id:    existingDeal.id,
        })

        if (allContacts.length > 0) {
          await upsertContacts(supabase, allContacts, existingDeal.id)
        }

        results.push({ type: primary.extracted.doc_type, status: 'linked-to-existing', deal_id: existingDeal.id, files: allFileNames, company: primary.extracted.company_name })

      } else if (instructions.auto_approve && instructions.stage) {
        // ── New deal, auto-approved ──────────────────────────────────────────
        const stage  = instructions.stage
        const status = instructions.status ?? (stage.startsWith('Pass') ? 'Dead' : stage.startsWith('Closed') ? 'Closed' : 'Active')
        const { data: deal } = await supabase.from('deals').insert({
          company_name:  primary.extracted.company_name || 'Unknown (email intake)',
          sector:        primary.extracted.sector       || null,
          geography:     primary.extracted.geography    || null,
          deal_type:     primary.extracted.deal_type    || 'platform',
          parent_portco: primary.extracted.parent_portco || null,
          revenue:       primary.extracted.revenue      ?? null,
          ebitda:        primary.extracted.ebitda       ?? null,
          description:   primary.extracted.description  || null,
          stage, status,
          cim_parsed:    primary.extracted.doc_type === 'cim',
          dropbox_path:  primaryDropboxPath || null,
          expected_close: new Date().toISOString().split('T')[0],
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

        results.push({ type: primary.extracted.doc_type, status: 'auto-approved', stage, files: allFileNames, company: primary.extracted.company_name, deal_id: deal?.id })

      } else {
        // ── New deal, pending review ─────────────────────────────────────────
        await supabase.from('intake_queue').insert({
          source:       'email',
          doc_type:     primary.extracted.doc_type ?? 'teaser',
          file_name:    primary.fileName,
          from_email:   from,
          dropbox_path: primaryDropboxPath,
          extracted: {
            ...primary.extracted,
            contacts:          allContacts,
            _supporting_files: supporting.map(d => d.fileName),
            _stage_suggestion: instructions.stage         || null,
            _forwarder_note:   instructions.forwarder_note || null,
          },
          status: 'pending',
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
      console.log(`[email-intake] Dedup: note already exists for subject "${subject}", skipping Path B`)
      return NextResponse.json({ success: true, processed: [{ type: 'skipped', reason: 'duplicate email body' }] })
    }

    const emailContent = `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${text}`.trim()

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      system: EMAIL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Extract CRM data from this email:\n\n${emailContent}` }],
    })

    const parsed = JSON.parse(
      response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').replace(/```json|```/g, '').trim()
    )

    // Match existing deal and contact
    let deal_id: string | null = null
    let contact_id: string | null = null

    if (parsed.deal_names?.length > 0) {
      for (const name of parsed.deal_names) {
        const { data } = await supabase.from('deals').select('id').ilike('company_name', `%${name}%`).limit(1).maybeSingle()
        if (data) { deal_id = data.id; break }
      }
    }

    if (parsed.contact_names?.length > 0) {
      for (const name of parsed.contact_names) {
        const parts = name.trim().split(/\s+/)
        if (parts.length < 2) continue
        const { data } = await supabase.from('contacts').select('id').ilike('first_name', parts[0]).ilike('last_name', parts.slice(1).join(' ')).limit(1).maybeSingle()
        if (data) { contact_id = data.id; break }
      }
    }

    const { data: note, error } = await supabase.from('notes').insert({
      note_date:  noteDate,
      raw_text:   `From: ${from}\nSubject: ${subject}\n\n${text}`.slice(0, 4000),
      summary:    parsed.summary    ?? null,
      next_steps: parsed.next_steps ?? null,
      logged_by:  parsed.logged_by  ?? from.split('@')[0] ?? 'email',
      source:     'email',
      deal_id,
      contact_id,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, processed: [{ type: 'note', note_id: note?.id }] })

  } catch (err: any) {
    console.error('Email intake error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
