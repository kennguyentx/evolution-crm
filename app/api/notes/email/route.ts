import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { dropboxConfigured, dropboxUpload, dropboxMove, expectedDropboxFolder } from '@/lib/dropbox'

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
  "revenue": "number in raw dollars or null — use the most recent / LTM figure",
  "ebitda": "number in raw dollars or null — use the most recent / LTM figure",
  "description": "string — 2-4 factual sentences about the business. No opinions or qualitative assessments.",
  "financial_summary": "string or null — 2-3 sentence narrative on margins, growth trend, and any notable items (CIM only)",
  "historical_financials": [
    {
      "year": "string — e.g. '2022', '2023', 'LTM', 'TTM', 'Budget 2025', 'Forecast 2026', 'Proj. 2025'",
      "revenue": "number in raw dollars or null",
      "ebitda": "number in raw dollars or null",
      "ebitda_margin": "number as decimal (0.22 for 22%) or null",
      "is_forecast": "boolean — true if this row is a projection, budget, or forecast; false for actuals and LTM/TTM"
    }
  ],
  "customer_concentration": "string or null — describe top customer %, customer count, or 'no single customer >X%' (CIM only)",
  "employee_count": "integer or null — total headcount if stated",
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
- Dollar values as raw numbers (4200000 for $4.2M). If a range is given (e.g. "$4–6M revenue"), use the midpoint (5000000). If described as "approximately $5M" use 5000000.
- historical_financials: extract EVERY row shown in a financial table or summary — historical years, LTM/TTM, AND any projections, budgets, or forecasts. Order chronologically (actuals first, then LTM/TTM, then forecasts). Use [] if only one year is available or this is a teaser. Mark is_forecast=true for any projected/budget/forecast row.
- revenue/ebitda at the top level: always the most recent / LTM figure from historical_financials.
- Null ONLY if no numeric hint is given anywhere in the document — do not leave null if you can infer from context.
- description: purely factual, no adjectives expressing quality.`

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
  status: string | null
  deal_type: string | null
  parent_portco: string | null
  forwarder_note: string | null
  auto_approve: boolean
  contacts: any[]
}> {
  const empty = { stage: null, deal_name: null, status: null, deal_type: null, parent_portco: null, forwarder_note: null, auto_approve: false, contacts: [] }
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
  "deal_name": "string or null — name of a SPECIFIC EXISTING DEAL to link this document to (e.g. 'for Project Anchor', 're: Anchor deal'). Only set if the sender is linking to a previously-created deal by a project codename or company name. Do NOT set this to a portfolio company name when the sender is describing an add-on acquisition.",
  "status": "Active | Dead | Closed | null",
  "deal_type": "platform | add-on | null",
  "parent_portco": "string or null — name of our EXISTING PORTFOLIO COMPANY that would acquire this target. Set when sender uses language like 'add-on for Amped', 'under Amped', 'bolt-on for Amped', 'for the Amped platform'. This is NOT the target company — it is the acquirer we already own.",
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
    company_name:          extracted.company_name || 'Unknown (email intake)',
    sector:                extracted.sector       || null,
    geography:             extracted.geography    || null,
    deal_type:             extracted.deal_type    || 'platform',
    stage,
    status:                'Active',
    revenue:               extracted.revenue      ?? null,
    ebitda:                extracted.ebitda       ?? null,
    description:           extracted.description  || null,
    financial_summary:     extracted.financial_summary     || null,
    historical_financials: extracted.historical_financials?.length ? extracted.historical_financials : null,
    customer_concentration: extracted.customer_concentration || null,
    employee_count:        extracted.employee_count        ?? null,
    cim_parsed:            false,
    expected_close:        new Date().toISOString().split('T')[0],
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

    // Priority 1: match by email (most reliable — avoids merging same-name people)
    let existing: any = null
    if (c.email) {
      const { data } = await supabase.from('contacts').select('id').ilike('email', c.email).limit(1).maybeSingle()
      existing = data
    }
    // Priority 2: match by first + last name
    if (!existing) {
      const { data } = await supabase.from('contacts').select('id')
        .ilike('first_name', firstName).ilike('last_name', lastName).limit(1).maybeSingle()
      existing = data
    }

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

    // Layer 2 (subject-based fallback) intentionally removed — it blocked
    // legitimate re-sends when a previous attempt had partially failed.
    // Layer 1 (messageId unique constraint) is the reliable dedup once the
    // migration has been run.

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
              console.log(`[email-intake] Inferred parent_portco="${match.name}" from email text (portco fallback)`)
            }
          }
        } catch (e: any) {
          console.warn(`[email-intake] Portco fallback failed:`, e?.message)
        }
      }

      // ── Step 1: Separate NDAs (skip Claude, just upload) from deal docs ─────
      // Detecting NDAs by filename avoids wasting Claude Opus time on them.
      const isNdaFile = (name: string) => /nda|non.?disclosure/i.test(name)

      const ndaAttachments  = docAttachments.filter((a: any) => isNdaFile(a.Name ?? ''))
      const dealAttachments = docAttachments.filter((a: any) => !isNdaFile(a.Name ?? ''))

      console.log(`[email-intake] deal docs: ${dealAttachments.length}, NDAs: ${ndaAttachments.length}`)

      // ── Step 2: Extract deal docs sequentially (avoids parallel timeout) ───
      const extracted_docs: Array<{ fileName: string; buffer: Buffer; extracted: any }> = []

      // Add NDAs as stub entries — no extraction needed
      for (const att of ndaAttachments) {
        const fileName = att.Name ?? 'nda'
        const buffer   = Buffer.from(att.Content, 'base64')
        extracted_docs.push({ fileName, buffer, extracted: { doc_type: 'nda', company_name: null, contacts: [] } })
      }

      for (const att of dealAttachments) {
        const fileName    = att.Name ?? 'document'
        const buffer      = Buffer.from(att.Content, 'base64')
        const contentType = att.ContentType ?? ''
        console.log(`[email-intake] Extracting ${fileName} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)…`)
        try {
          const extracted = await processAttachment(fileName, buffer, contentType)
          if (extracted) {
            extracted_docs.push({ fileName, buffer, extracted })
            console.log(`[email-intake] Extracted ${fileName}: doc_type=${extracted.doc_type} company="${extracted.company_name}"`)
          }
        } catch (e: any) {
          console.error(`[email-intake] Extract error (${fileName}):`, e?.message)
          results.push({ type: 'error', file: fileName, error: e?.message })
        }
      }

      if (extracted_docs.filter(d => d.extracted.doc_type !== 'nda').length === 0 && ndaAttachments.length === 0) {
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

      // ── Step 3: Look up existing deal by company name ─────────────────────
      // If a deal already exists, associate the CIM/teaser with it instead of
      // creating a duplicate. Use the existing deal's stage for Dropbox routing.
      let existingDeal: { id: string; company_name: string; stage: string; status: string; dropbox_path: string | null } | null = null

      // Helper: search deals by name with exact-then-partial fallback
      async function findDealByName(searchName: string) {
        const { data: exact } = await supabase
          .from('deals')
          .select('id, company_name, stage, status, dropbox_path')
          .ilike('company_name', searchName)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (exact) return exact

        // Partial match on first 3 meaningful words
        const stripped = searchName.replace(/\b(Inc|LLC|Ltd|Co|Corp|Company|Group|Partners|Holdings|the)\b\.?/gi, '').trim()
        const chunk = stripped.split(/\s+/).slice(0, 3).join(' ')
        if (chunk.length > 3) {
          const { data: partial } = await supabase
            .from('deals')
            .select('id, company_name, stage, status, dropbox_path')
            .ilike('company_name', `%${chunk}%`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (partial) return partial
        }
        return null
      }

      // Priority 1: deal name the user explicitly stated in their forwarding note
      if (instructions.deal_name) {
        const found = await findDealByName(instructions.deal_name.trim())
        if (found) {
          existingDeal = found
          console.log(`[email-intake] Matched by forwarder deal_name "${instructions.deal_name}": deal ${found.id} stage="${found.stage}"`)
        } else {
          console.log(`[email-intake] Forwarder said deal_name="${instructions.deal_name}" but no match found`)
        }
      }

      // Priority 2: company name extracted from the document
      if (!existingDeal && primary.extracted.company_name) {
        const name = primary.extracted.company_name.trim()
        const found = await findDealByName(name)
        if (found) {
          existingDeal = found
          console.log(`[email-intake] Matched by doc company_name "${name}": deal ${found.id} stage="${found.stage}"`)
        } else {
          console.log(`[email-intake] No existing deal found for "${name}"`)
        }
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
        console.log(`[email-intake] Matched deal "${existingDeal.company_name}" appears to be the parent portco "${instructions.parent_portco}" — clearing to create new add-on deal`)
        existingDeal = null
      }

      // ── Step 4: Upload ALL files to Dropbox ───────────────────────────────
      // deals.dropbox_path stores the FOLDER path (not a file path).
      // toFolder() (defined at module scope) strips filenames from legacy records.
      const effectiveStage = existingDeal?.stage ?? instructions.stage ?? 'Teaser'
      const companyForPath = primary.extracted.company_name
        ? (instructions.parent_portco
            ? `${primary.extracted.company_name} [${instructions.parent_portco}]`
            : primary.extracted.company_name)
        : null

      // Resolve the target Dropbox folder
      const targetFolder: string | null = existingDeal
        ? (toFolder(existingDeal.dropbox_path) ?? (companyForPath ? expectedDropboxFolder(companyForPath, effectiveStage) : null))
        : (companyForPath ? expectedDropboxFolder(companyForPath, effectiveStage) : null)

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
        const newFolder = expectedDropboxFolder(newCompanyName, existingDeal.stage)

        if (dropboxConfigured() && targetFolder) {
          try {
            console.log(`[email-intake] Renaming Dropbox folder: "${targetFolder}" → "${newFolder}"`)
            const movedPath = await dropboxMove(targetFolder, newFolder)
            dealFolderPath = toFolder(movedPath) ?? newFolder
            console.log(`[email-intake] Folder renamed ✓ → "${dealFolderPath}"`)
          } catch (renameErr: any) {
            console.error(`[email-intake] Folder rename failed (non-fatal):`, renameErr?.message)
            // Keep original folder path, still rename the deal in DB
          }
        }

        renamedCompany = newCompanyName
        console.log(`[email-intake] Deal will be renamed: "${existingDeal.company_name}" → "${newCompanyName}"`)
      }

      // Use the (possibly renamed) folder for uploads
      const uploadFolder = dealFolderPath ?? targetFolder
      console.log(`[email-intake] Step 4: Dropbox upload target="${uploadFolder}" existing=${!!existingDeal}`)
      if (dropboxConfigured() && uploadFolder) {
        for (const doc of extracted_docs) {
          try {
            console.log(`[email-intake] Uploading ${doc.fileName}…`)
            await dropboxUpload(uploadFolder, doc.fileName, doc.buffer)
            console.log(`[email-intake] Uploaded ${doc.fileName} ✓`)
          } catch (dbxErr: any) {
            console.error(`[email-intake] Dropbox upload failed (${doc.fileName}):`, dbxErr?.message)
          }
        }
      }
      console.log(`[email-intake] Step 5: writing deal/note. existingDeal=${existingDeal?.id ?? 'none'} rename=${renamedCompany ?? 'none'}`)

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

      } else if (instructions.auto_approve && instructions.stage) {
        // ── New deal, auto-approved ──────────────────────────────────────────
        const stage  = instructions.stage
        const status = instructions.status ?? (stage.startsWith('Pass') ? 'Dead' : stage.startsWith('Closed') ? 'Closed' : 'Active')
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

        results.push({ type: primary.extracted.doc_type, status: 'auto-approved', stage, files: allFileNames, company: primary.extracted.company_name, deal_id: deal?.id })

      } else {
        // ── New deal, pending review ─────────────────────────────────────────
        await supabase.from('intake_queue').insert({
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
