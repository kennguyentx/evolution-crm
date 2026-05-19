import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { dropboxConfigured, dropboxUpload } from '@/lib/dropbox'

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
- Dollar values as raw numbers (4200000 for $4.2M)
- Null for fields not explicitly stated — do not estimate
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
    messages: [{ role: 'user', content: `Forwarding note:\n${bodyText.slice(0, 1000)}` }],
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
    const body    = await req.json()
    const from    = body.From     ?? body.from    ?? ''
    const fromName = body.FromFull?.Name ?? ''
    const subject = body.Subject  ?? body.subject ?? ''
    const text    = body.TextBody ?? body.text    ?? body.body ?? ''
    const date    = body.Date     ?? body.date    ?? new Date().toISOString()
    const attachments: any[] = body.Attachments ?? []
    const ccFull: any[] = body.CcFull ?? []

    const supabase  = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const noteDate  = new Date(date).toISOString().split('T')[0]
    const results: any[] = []

    // ── Path A: process document attachments ──────────────────────────────────
    const docAttachments = attachments.filter((a: any) => {
      const name = (a.Name ?? '').toLowerCase()
      const ct   = (a.ContentType ?? '').toLowerCase()
      return ct.includes('pdf') || ct.includes('word') || name.endsWith('.pdf') || /\.docx?$/.test(name)
    })

    if (docAttachments.length > 0) {
      // Parse forwarding note for instructions + contacts (runs once for all attachments)
      const instructions = await parseForwardingNote(text, { from, fromName, cc: ccFull })

      for (const att of docAttachments) {
        const fileName    = att.Name ?? 'document'
        const buffer      = Buffer.from(att.Content, 'base64')
        const contentType = att.ContentType ?? ''

        try {
          const extracted = await processAttachment(fileName, buffer, contentType)
          if (!extracted) continue

          // Apply instruction overrides to extracted data
          if (instructions.deal_type)    extracted.deal_type    = instructions.deal_type
          if (instructions.parent_portco) extracted.parent_portco = instructions.parent_portco

          // Upload to Dropbox (best-effort)
          let dropboxPath: string | null = null
          if (dropboxConfigured() && extracted.company_name) {
            try {
              const safeName     = extracted.company_name.replace(/[<>:"/\\|?*]/g, '_')
              const portcoSuffix = instructions.parent_portco ? ` [${instructions.parent_portco.replace(/[<>:"/\\|?*]/g, '_')}]` : ''
              const folder       = `/Evolution Strategy Partners/Deals/${safeName}${portcoSuffix}`
              dropboxPath        = await dropboxUpload(folder, fileName, buffer)
            } catch { /* non-fatal */ }
          }

          // If auto_approve (explicit decision from forwarder), create deal directly
          if (instructions.auto_approve && instructions.stage) {
            const stage  = instructions.stage
            const status = instructions.status ?? (stage.startsWith('Pass') || stage.startsWith('Closed') ? (stage.startsWith('Pass') ? 'Dead' : 'Closed') : 'Active')
            const { data: deal } = await supabase.from('deals').insert({
              company_name:   extracted.company_name || 'Unknown (email intake)',
              sector:         extracted.sector       || null,
              geography:      extracted.geography    || null,
              deal_type:      extracted.deal_type    || 'platform',
              parent_portco:  extracted.parent_portco || null,
              revenue:        extracted.revenue      ?? null,
              ebitda:         extracted.ebitda       ?? null,
              description:    extracted.description  || null,
              stage, status,
              cim_parsed:     extracted.doc_type === 'cim',
              dropbox_path:   dropboxPath || null,
              expected_close: new Date().toISOString().split('T')[0],
            }).select('id').single()

            // Log note on the deal
            await supabase.from('notes').insert({
              note_date:  noteDate,
              raw_text:   `Forwarded via email by ${from}\nSubject: ${subject}\nFile: ${fileName}`,
              summary:    `${extracted.doc_type === 'cim' ? 'CIM' : 'Teaser'} received for ${extracted.company_name ?? 'unknown company'}. Auto-logged as ${stage}.${instructions.forwarder_note ? ` Note: ${instructions.forwarder_note}` : ''}`,
              next_steps: null,
              logged_by:  from.split('@')[0] ?? 'email',
              source:     'email',
              deal_id:    deal?.id ?? null,
            })

            // Upsert contacts from both document and forwarding note
            const allContacts = filterInternalContacts([
              ...(extracted.contacts ?? []),
              ...(instructions.contacts ?? []),
            ])
            if (allContacts.length > 0 && deal?.id) {
              await upsertContacts(supabase, allContacts, deal.id)
            }

            results.push({ type: extracted.doc_type, status: 'auto-approved', stage, file: fileName, company: extracted.company_name, deal_id: deal?.id })
          } else {
            // Save to intake queue (pending review)
            await supabase.from('intake_queue').insert({
              source:       'email',
              doc_type:     extracted.doc_type ?? 'teaser',
              file_name:    fileName,
              from_email:   from,
              dropbox_path: dropboxPath,
              extracted: {
                ...extracted,
                _stage_suggestion:  instructions.stage         || null,
                _forwarder_note:    instructions.forwarder_note || null,
              },
              status: 'pending',
            })

            // Log a note (no deal_id yet — will be set on approval)
            const noteSummary = `${extracted.doc_type === 'cim' ? 'CIM' : 'Teaser'} received for ${extracted.company_name ?? 'unknown company'} via email intake. Pending review.${instructions.forwarder_note ? ` Forwarder note: "${instructions.forwarder_note}"` : ''}`
            await supabase.from('notes').insert({
              note_date:  noteDate,
              raw_text:   `Forwarded via email by ${from}\nSubject: ${subject}\nFile: ${fileName}`,
              summary:    noteSummary,
              next_steps: instructions.stage ? `Suggested stage: ${instructions.stage}` : 'Review in Document Intake → Pending Review',
              logged_by:  from.split('@')[0] ?? 'email',
              source:     'email',
              deal_id:    null,
            })

            // Store contacts in extracted so queue approval can upsert them
            const allContacts = filterInternalContacts([
              ...(extracted.contacts ?? []),
              ...(instructions.contacts ?? []),
            ])
            if (allContacts.length > 0) {
              await supabase.from('intake_queue')
                .update({ extracted: { ...extracted, contacts: allContacts, _stage_suggestion: instructions.stage, _forwarder_note: instructions.forwarder_note } })
                .eq('source', 'email').eq('file_name', fileName).eq('status', 'pending')
                .order('created_at', { ascending: false }).limit(1)
            }

            results.push({ type: extracted.doc_type, status: 'queued', file: fileName, company: extracted.company_name })
          }
        } catch (attErr: any) {
          console.error(`Attachment parse error (${fileName}):`, attErr)
          results.push({ type: 'error', file: fileName, error: attErr.message })
        }
      }

      return NextResponse.json({ success: true, processed: results })
    }

    // ── Path B: no attachments — parse email body as a note ───────────────────
    if (!text && !subject) {
      return NextResponse.json({ error: 'No email content provided' }, { status: 400 })
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
