// Evolution CRM — Email Intake Server
// Standalone Express server deployed on Render.com.
// Handles large CIM/Teaser PDFs that exceed Vercel's 4.5MB request body limit.
// All logic mirrors app/api/notes/email/route.ts — keep them in sync.

require('dotenv').config()

const express   = require('express')
const Anthropic  = require('@anthropic-ai/sdk').default
const { createClient } = require('@supabase/supabase-js')

const app  = express()
// 50MB limit — handles even very large CIM PDFs sent as base64 via Postmark
app.use(express.json({ limit: '50mb' }))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// ── Dropbox helpers (inlined — no Next.js import available) ──────────────────
const DBX_CONTENT = 'https://content.dropboxapi.com/2'
const DBX_API     = 'https://api.dropboxapi.com/2'
let cachedToken = null
let tokenExpiry = 0

async function getDropboxToken() {
  const now = Date.now()
  if (cachedToken && now < tokenExpiry) return cachedToken
  const res  = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id:     process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Dropbox token refresh failed: ${JSON.stringify(data)}`)
  cachedToken = data.access_token
  tokenExpiry = now + (data.expires_in - 1800) * 1000
  return cachedToken
}

function dropboxConfigured() {
  return !!(process.env.DROPBOX_REFRESH_TOKEN && process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET)
}

async function dropboxUpload(folderPath, fileName, buffer) {
  const token    = await getDropboxToken()
  const fullPath = `${folderPath.replace(/\/$/, '')}/${fileName}`
  const res = await fetch(`${DBX_CONTENT}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization:    `Bearer ${token}`,
      'Content-Type':   'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: fullPath, mode: 'add', autorename: true, mute: false }),
    },
    body: new Uint8Array(buffer),
  })
  if (!res.ok) throw new Error(`Dropbox upload failed: ${await res.text()}`)
  const result = await res.json()
  return result.path_lower
}

async function dropboxMove(fromPath, toPath) {
  const token        = await getDropboxToken()
  const parentFolder = toPath.substring(0, toPath.lastIndexOf('/'))
  if (parentFolder) {
    await fetch(`${DBX_API}/files/create_folder_v2`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: parentFolder, autorename: false }),
    }).catch(() => {})
  }
  const res = await fetch(`${DBX_API}/files/move_v2`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_path: fromPath, to_path: toPath, autorename: true }),
  })
  if (!res.ok) throw new Error(`Dropbox move failed: ${await res.text()}`)
  const result = await res.json()
  return result.metadata?.path_lower ?? toPath.toLowerCase()
}

const PASS_STAGES   = ['Pass (DOA)', 'Pass (Pre-LOI)', 'Pass (Post-LOI)']
const CLOSED_STAGES = ['Closed (Platform)', 'Closed (Add-On)']

function expectedDropboxFolder(companyName, stage) {
  const safe = companyName.replace(/[<>:"/\\|?*]/g, '_')
  if (PASS_STAGES.includes(stage))   return `/Evolution Strategy Partners/Deals/!Passed Deals/${safe}`
  if (CLOSED_STAGES.includes(stage)) return `/Evolution Strategy Partners/Portfolio Co's/${safe}`
  return `/Evolution Strategy Partners/Deals/${safe}`
}

// ── Utilities ────────────────────────────────────────────────────────────────
function toFolder(p) {
  if (!p) return null
  const last = p.split('/').pop() ?? ''
  return last.includes('.') ? p.substring(0, p.lastIndexOf('/')) : p
}

function todayCST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

function isInternal(email) {
  if (!email) return false
  return email.toLowerCase().endsWith('@evolutionstrategy.com')
}

function filterInternalContacts(contacts) {
  return contacts.filter(c => !isInternal(c.email))
}

// ── DOCX text extraction ─────────────────────────────────────────────────────
async function extractDocxText(buffer) {
  const JSZip = require('jszip')
  const zip   = await JSZip.loadAsync(buffer)
  const xml   = await zip.file('word/document.xml')?.async('string')
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

// ── Email body prompt ────────────────────────────────────────────────────────
const EMAIL_SYSTEM_PROMPT = `You extract structured information from forwarded emails for a CRM. Return ONLY valid JSON.

{
  "summary": "string — 1-3 sentence factual summary",
  "next_steps": "string or null — explicit action items or follow-ups",
  "deal_names": ["string array — company or deal names mentioned"],
  "contact_names": ["string array — personal names in First Last format"],
  "logged_by": "string or null — first name of person who forwarded this"
}

Rules: factual only, no opinions, null/[] if nothing found.`

// ── Process a single attachment through Claude ───────────────────────────────
async function processAttachment(fileName, buffer, contentType) {
  const isPDF  = contentType.includes('pdf')  || fileName.toLowerCase().endsWith('.pdf')
  const isDOCX = contentType.includes('word') || /\.docx?$/i.test(fileName)

  let messageContent
  if (isPDF) {
    messageContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') }, title: fileName },
      { type: 'text', text: `Extract deal data from this document (${fileName}). Return only valid JSON.` },
    ]
  } else if (isDOCX) {
    const text = await extractDocxText(buffer)
    messageContent = [
      { type: 'text', text: `DOCUMENT (${fileName}):\n${text}` },
      { type: 'text', text: 'Extract deal data from the document above. Return only valid JSON.' },
    ]
  } else {
    return null
  }

  const response = await anthropic.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 3000,
    system:     DOC_SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: messageContent }],
  })

  const raw = response.content
    .filter(b => b.type === 'text').map(b => b.text).join('')
    .replace(/```json|```/g, '').trim()
  return JSON.parse(raw)
}

// ── Parse forwarding note ────────────────────────────────────────────────────
async function parseForwardingNote(bodyText, emailHeaders) {
  const empty = { stage: null, deal_name: null, status: null, deal_type: null, parent_portco: null, forwarder_note: null, auto_approve: false, contacts: [] }
  if (!bodyText?.trim()) return empty

  const headerContacts = (emailHeaders.cc || [])
    .filter(c => c.Email && !isInternal(c.Email))
    .map(c => ({ name: c.Name || c.Email.split('@')[0], email: c.Email, firm: null, title: null, role: 'Other', phone: null }))

  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
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
    { "name": "Full Name", "email": "email or null", "phone": "phone or null", "firm": "company or null", "title": "job title or null", "role": "Source / Banker | Management | Advisor | Lender | Other" }
  ]
}

For contacts: extract all named people mentioned in the email body — bankers, advisors, sellers, management.
Do NOT include people with @evolutionstrategy.com emails.
If no contacts found, return contacts: [].`,
    messages: [{ role: 'user', content: `Forwarding note:\n${bodyText.split(/\n-{3,}|\nFrom:|_+\nFrom:/i)[0].slice(0, 800)}` }],
  })

  try {
    const raw    = response.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(raw)
    const bodyContacts = filterInternalContacts(parsed.contacts ?? [])
    const merged = [...headerContacts]
    for (const c of bodyContacts) {
      if (!c.email || !merged.some(m => m.email?.toLowerCase() === c.email?.toLowerCase())) merged.push(c)
    }
    return { ...parsed, contacts: merged }
  } catch {
    return { ...empty, contacts: headerContacts }
  }
}

// ── Upsert contacts and link to deal ─────────────────────────────────────────
async function upsertContacts(supabase, contacts, dealId) {
  for (const c of contacts) {
    if (!c.name) continue
    const parts     = c.name.trim().split(/\s+/)
    const firstName = parts[0]
    const lastName  = parts.slice(1).join(' ') || ''

    // Priority 1: match by email (most reliable — avoids merging same-name people)
    let existing = null
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
        first_name: firstName, last_name: lastName,
        firm: c.firm || null, title: c.title || null, email: c.email || null, phone: c.phone || null,
      }).select('id').single()
      contactId = newContact?.id
    }

    if (contactId && dealId) {
      await supabase.from('contact_deal_links').upsert(
        { contact_id: contactId, deal_id: dealId, role: c.role || 'Other' },
        { onConflict: 'contact_id,deal_id', ignoreDuplicates: true }
      )
    }
  }
}

// ── Main email intake handler ─────────────────────────────────────────────────
async function handleEmailIntake(req, res) {
  const webhookToken = process.env.POSTMARK_WEBHOOK_TOKEN
  if (webhookToken) {
    const provided = req.query.token ?? req.headers['x-webhook-token']
    if (provided !== webhookToken) return res.status(403).json({ error: 'Forbidden' })
  }

  try {
    const body        = req.body
    const from        = body.From      ?? body.from    ?? ''
    const fromName    = body.FromFull?.Name ?? ''
    const subject     = body.Subject   ?? body.subject ?? ''
    const text        = body.TextBody  ?? body.text    ?? body.body ?? ''
    const date        = body.Date      ?? body.date    ?? new Date().toISOString()
    const messageId   = body.MessageID ?? body.message_id ?? ''
    const attachments = body.Attachments ?? []
    const ccFull      = body.CcFull ?? []

    const supabase  = serviceClient()
    const noteDate  = todayCST()
    const results   = []

    console.log(`[email-intake] messageId=${messageId} from=${from} subject="${subject}" attachments=${attachments.length}`,
      attachments.map(a => ({ name: a.Name, type: a.ContentType, size: a.Content?.length ?? 0 })))

    // ── Idempotency guard ────────────────────────────────────────────────────
    if (messageId) {
      try {
        const { error: lockError } = await supabase.from('intake_queue').insert({
          message_id: messageId, source: 'email', status: 'processing',
          from_email: from, file_name: subject.slice(0, 200), extracted: {},
        })
        if (lockError?.code === '23505') {
          console.log(`[email-intake] Idempotency: duplicate messageId, skipping`)
          return res.json({ success: true, skipped: 'duplicate messageId' })
        }
        if (lockError) console.warn(`[email-intake] Sentinel insert failed (migration needed?): ${lockError.code} ${lockError.message}`)
      } catch (e) {
        console.warn(`[email-intake] Sentinel error:`, e?.message)
      }
    }

    // ── Path A: process document attachments ─────────────────────────────────
    const docAttachments = attachments.filter(a => {
      const name = (a.Name ?? '').toLowerCase()
      const ct   = (a.ContentType ?? '').toLowerCase()
      return ct.includes('pdf') || ct.includes('word') || name.endsWith('.pdf') || /\.docx?$/.test(name)
    })

    if (docAttachments.length > 0) {
      const instructions = await parseForwardingNote(text, { from, fromName, cc: ccFull })
      console.log(`[email-intake] instructions:`, JSON.stringify(instructions))

      // ── Portco fallback: if add-on but parent_portco wasn't extracted by LLM,
      // scan known portfolio company names against the full email text.
      if ((instructions.deal_type === 'add-on' || instructions.parent_portco) && !instructions.parent_portco) {
        try {
          const { data: portcos } = await supabase.from('portfolio_companies').select('name').eq('status', 'Active')
          if (portcos?.length) {
            const haystack = (subject + ' ' + text).toLowerCase()
            const match = portcos.find(p => haystack.includes(p.name.toLowerCase()))
            if (match) {
              instructions.parent_portco = match.name
              console.log(`[email-intake] Inferred parent_portco="${match.name}" from email text (portco fallback)`)
            }
          }
        } catch (e) {
          console.warn(`[email-intake] Portco fallback failed:`, e?.message)
        }
      }

      const isNdaFile      = name => /nda|non.?disclosure/i.test(name)
      const ndaAttachments  = docAttachments.filter(a => isNdaFile(a.Name ?? ''))
      const dealAttachments = docAttachments.filter(a => !isNdaFile(a.Name ?? ''))

      console.log(`[email-intake] deal docs: ${dealAttachments.length}, NDAs: ${ndaAttachments.length}`)

      const extracted_docs = []

      // NDAs — no Claude extraction needed
      for (const att of ndaAttachments) {
        const fileName = att.Name ?? 'nda'
        const buffer   = Buffer.from(att.Content, 'base64')
        extracted_docs.push({ fileName, buffer, extracted: { doc_type: 'nda', company_name: null, contacts: [] } })
      }

      // Deal docs — extract sequentially
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
        } catch (e) {
          console.error(`[email-intake] Extract error (${fileName}):`, e?.message)
          results.push({ type: 'error', file: fileName, error: e?.message })
        }
      }

      if (extracted_docs.filter(d => d.extracted.doc_type !== 'nda').length === 0 && ndaAttachments.length === 0) {
        return res.json({ success: true, processed: results })
      }

      const primary    = extracted_docs.find(d => d.extracted.doc_type === 'teaser' || d.extracted.doc_type === 'cim')
        ?? extracted_docs.find(d => d.extracted.doc_type !== 'nda')
        ?? extracted_docs[0]
      const supporting = extracted_docs.filter(d => d !== primary)

      if (instructions.deal_type)     primary.extracted.deal_type    = instructions.deal_type
      if (instructions.parent_portco) primary.extracted.parent_portco = instructions.parent_portco

      const allFileNames = extracted_docs.map(d => d.fileName).join(', ')

      // ── Existing deal lookup ──────────────────────────────────────────────
      let existingDeal = null

      async function findDealByName(searchName) {
        const { data: exact } = await supabase.from('deals')
          .select('id, company_name, stage, status, dropbox_path')
          .ilike('company_name', searchName)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (exact) return exact

        const stripped = searchName.replace(/\b(Inc|LLC|Ltd|Co|Corp|Company|Group|Partners|Holdings|the)\b\.?/gi, '').trim()
        const chunk    = stripped.split(/\s+/).slice(0, 3).join(' ')
        if (chunk.length > 3) {
          const { data: partial } = await supabase.from('deals')
            .select('id, company_name, stage, status, dropbox_path')
            .ilike('company_name', `%${chunk}%`)
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
          if (partial) return partial
        }
        return null
      }

      if (instructions.deal_name) {
        const found = await findDealByName(instructions.deal_name.trim())
        if (found) {
          existingDeal = found
          console.log(`[email-intake] Matched by deal_name "${instructions.deal_name}": ${found.id} stage="${found.stage}"`)
        }
      }

      if (!existingDeal && primary.extracted.company_name) {
        const found = await findDealByName(primary.extracted.company_name.trim())
        if (found) {
          existingDeal = found
          console.log(`[email-intake] Matched by company_name "${primary.extracted.company_name}": ${found.id} stage="${found.stage}"`)
        }
      }

      // Guard: if matched deal IS the parent portco, clear it (new add-on deal)
      if (existingDeal && instructions.parent_portco &&
          existingDeal.company_name.toLowerCase().includes(instructions.parent_portco.toLowerCase().trim())) {
        console.log(`[email-intake] Matched deal "${existingDeal.company_name}" is parent portco — clearing for new add-on`)
        existingDeal = null
      }

      // ── Dropbox folder resolution ─────────────────────────────────────────
      const effectiveStage = existingDeal?.stage ?? instructions.stage ?? 'Teaser'
      const companyForPath = primary.extracted.company_name
        ? (instructions.parent_portco
            ? `${primary.extracted.company_name} [${instructions.parent_portco}]`
            : primary.extracted.company_name)
        : null

      const targetFolder = existingDeal
        ? (toFolder(existingDeal.dropbox_path) ?? (companyForPath ? expectedDropboxFolder(companyForPath, effectiveStage) : null))
        : (companyForPath ? expectedDropboxFolder(companyForPath, effectiveStage) : null)

      let dealFolderPath = targetFolder

      // ── Rename folder when CIM reveals real company name ──────────────────
      let renamedCompany = null
      if (existingDeal && primary.extracted.doc_type === 'cim' && primary.extracted.company_name &&
          primary.extracted.company_name.toLowerCase().trim() !== existingDeal.company_name.toLowerCase().trim()) {
        const newCompanyName = primary.extracted.company_name.trim()
        const newFolder      = expectedDropboxFolder(newCompanyName, existingDeal.stage)
        if (dropboxConfigured() && targetFolder) {
          try {
            console.log(`[email-intake] Renaming folder: "${targetFolder}" → "${newFolder}"`)
            const movedPath = await dropboxMove(targetFolder, newFolder)
            dealFolderPath  = toFolder(movedPath) ?? newFolder
            console.log(`[email-intake] Folder renamed ✓ → "${dealFolderPath}"`)
          } catch (e) {
            console.error(`[email-intake] Folder rename failed (non-fatal):`, e?.message)
          }
        }
        renamedCompany = newCompanyName
        console.log(`[email-intake] Deal will be renamed: "${existingDeal.company_name}" → "${newCompanyName}"`)
      }

      // ── Upload all files to Dropbox ───────────────────────────────────────
      const uploadFolder = dealFolderPath ?? targetFolder
      console.log(`[email-intake] Dropbox upload target="${uploadFolder}" existing=${!!existingDeal}`)
      if (dropboxConfigured() && uploadFolder) {
        for (const doc of extracted_docs) {
          try {
            await dropboxUpload(uploadFolder, doc.fileName, doc.buffer)
            console.log(`[email-intake] Uploaded ${doc.fileName} ✓`)
          } catch (e) {
            console.error(`[email-intake] Dropbox upload failed (${doc.fileName}):`, e?.message)
          }
        }
      }

      const allContacts = filterInternalContacts([
        ...extracted_docs.flatMap(d => d.extracted.contacts ?? []),
        ...(instructions.contacts ?? []),
      ])

      const docLabel       = primary.extracted.doc_type === 'cim' ? 'CIM' : 'Teaser'
      const supportingLabel = supporting.length > 0 ? ` Also received: ${supporting.map(d => d.fileName).join(', ')}.` : ''

      console.log(`[email-intake] Writing deal/note. existingDeal=${existingDeal?.id ?? 'none'} rename=${renamedCompany ?? 'none'}`)

      // ── Step 5: Create/update deal and log note ───────────────────────────
      if (existingDeal) {
        const updates = {}
        if (primary.extracted.doc_type === 'cim') updates.cim_parsed = true
        if (primary.extracted.revenue != null) updates.revenue = primary.extracted.revenue
        if (primary.extracted.ebitda  != null) updates.ebitda  = primary.extracted.ebitda
        if (primary.extracted.historical_financials?.length) updates.historical_financials = primary.extracted.historical_financials
        if (primary.extracted.customer_concentration) updates.customer_concentration = primary.extracted.customer_concentration
        if (primary.extracted.employee_count != null) updates.employee_count = primary.extracted.employee_count
        if (primary.extracted.financial_summary) updates.financial_summary = primary.extracted.financial_summary
        if (dealFolderPath)  updates.dropbox_path = dealFolderPath
        if (renamedCompany)  updates.company_name = renamedCompany
        if (Object.keys(updates).length > 0) {
          await supabase.from('deals').update(updates).eq('id', existingDeal.id)
        }

        if (primary.extracted.doc_type === 'cim') {
          try {
            await supabase.from('deal_cims').insert({
              deal_id: existingDeal.id, file_name: primary.fileName,
              dropbox_path: dealFolderPath, extracted: primary.extracted,
            })
          } catch {}
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

        if (allContacts.length > 0) await upsertContacts(supabase, allContacts, existingDeal.id)
        results.push({ type: primary.extracted.doc_type, status: 'linked-to-existing', deal_id: existingDeal.id, files: allFileNames })

      } else if (instructions.auto_approve && instructions.stage) {
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
          financial_summary:      primary.extracted.financial_summary     || null,
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

        if (allContacts.length > 0 && deal?.id) await upsertContacts(supabase, allContacts, deal.id)
        results.push({ type: primary.extracted.doc_type, status: 'auto-approved', stage, files: allFileNames, deal_id: deal?.id })

      } else {
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

      return res.json({ success: true, processed: results })
    }

    // ── Path B: no attachments — parse email body as note ────────────────────
    if (!text && !subject) return res.status(400).json({ error: 'No email content provided' })

    const { data: existingBodyNote } = await supabase.from('notes').select('id')
      .eq('source', 'email').eq('note_date', noteDate)
      .ilike('raw_text', `%Subject: ${subject}%`).limit(1).maybeSingle()
    if (existingBodyNote) {
      console.log(`[email-intake] Dedup: note exists for subject "${subject}", skipping`)
      return res.json({ success: true, processed: [{ type: 'skipped', reason: 'duplicate email body' }] })
    }

    const emailContent = `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${text}`.trim()
    const response     = await anthropic.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 800,
      system: EMAIL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Extract CRM data from this email:\n\n${emailContent}` }],
    })

    const parsed = JSON.parse(
      response.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim()
    )

    let deal_id = null, contact_id = null
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
        const { data } = await supabase.from('contacts').select('id')
          .ilike('first_name', parts[0]).ilike('last_name', parts.slice(1).join(' ')).limit(1).maybeSingle()
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
      deal_id, contact_id,
    }).select().single()

    if (error) return res.status(400).json({ error: error.message })
    return res.json({ success: true, processed: [{ type: 'note', note_id: note?.id }] })

  } catch (err) {
    console.error('[email-intake] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.post('/api/notes/email', handleEmailIntake)
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Email intake server running on port ${PORT}`))
