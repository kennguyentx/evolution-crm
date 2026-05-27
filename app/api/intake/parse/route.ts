import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { dropboxConfigured, dropboxUpload, dropboxFolderExists } from '@/lib/dropbox'
import { AI_MODELS } from '@/lib/ai-config'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const BUCKET = 'intake-temp'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const SYSTEM_PROMPT = `You extract factual deal data from teasers and CIMs. Return ONLY valid JSON, no markdown, no explanation, no opinions.

{
  "company_name": "string — exact company name as stated",
  "sector": "string — use the closest match from: Underground Utilities | Electrical Contracting | Civil / Public Works | Commercial Landscaping | Fiber Optics | HVAC | Plumbing | Industrial Services | Environmental Services | Construction & Engineering. If none fit well, return a short descriptive sector name (2-4 words, title case) that accurately describes the industry.",
  "geography": "string — primary state(s) or region of operations as stated in the document",
  "deal_type": "string — one of: platform | add-on | recap | growth",
  "revenue": "number in raw dollars or null — most recent annual revenue as stated",
  "ebitda": "number in raw dollars or null — most recent annual EBITDA (use adjusted/normalized if explicitly stated)",
  "cim_summary": "string — 3-5 factual sentences describing: what the company does, where it operates, its financial profile, and ownership/transaction context. State only facts from the document. No opinions, no qualitative assessments, no phrases like 'attractive', 'compelling', 'strong', 'impressive', or 'unique'.",
  "contacts": [
    {
      "name": "string — full name as stated",
      "firm": "string or null — company or advisory firm name",
      "role": "string — one of: Source / Banker | Management | Advisor | Lender | Other",
      "title": "string or null — job title as stated",
      "email": "string or null — email address as stated",
      "phone": "string or null — phone number as stated"
    }
  ]
}

Rules:
- Dollar values as raw numbers (4200000 for $4.2M)
- If a field is not stated in the document, return null
- Do not infer or estimate values not explicitly stated
- The summary must be purely factual — no adjectives that express quality or opinion
- contacts: extract ALL named individuals — investment bankers/brokers, management team (CEO, CFO, COO, President, etc.), legal/financial advisors, lenders. Return [] if none found.
- For each contact, role must be exactly one of the values listed above
- For email and phone: only extract values explicitly shown next to or under that contact's name`

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
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

export async function POST(req: NextRequest) {
  let storagePath: string | null = null
  try {
    const body = await req.json()
    const { storagePath: sp, fileName, text: pastedText, deal_type: userDealType, parent_portco: userParentPortco } = body
    storagePath = sp || null

    let messageContent: any[]
    let parsedCompanyName: string | null = null
    let buffer: ArrayBuffer | null = null
    let resolvedFileName: string = fileName || 'teaser'

    // ── Path A: pasted text ───────────────────────────────────────────────────
    if (pastedText?.trim()) {
      messageContent = [
        { type: 'text', text: `TEASER / CIM TEXT:\n${pastedText}` },
        { type: 'text', text: 'Extract deal data from the text above. Return only valid JSON.' },
      ]

    // ── Path B: file from Supabase Storage ───────────────────────────────────
    } else if (storagePath) {
      const supabase = serviceClient()
      const { data: fileData, error: dlError } = await supabase.storage.from(BUCKET).download(storagePath)
      if (dlError || !fileData) throw new Error(`Download failed: ${dlError?.message ?? 'no data'}`)

      buffer = await (fileData as Blob).arrayBuffer()
      const ext = resolvedFileName.split('.').pop()?.toLowerCase() ?? ''
      const isDocx = ext === 'docx' || ext === 'doc'

      if (isDocx) {
        const docText = await extractDocxText(buffer)
        messageContent = [
          { type: 'text', text: `TEASER / CIM (${resolvedFileName}):\n${docText}` },
          { type: 'text', text: 'Extract deal data from the text above. Return only valid JSON.' },
        ]
      } else {
        // PDF
        const base64 = Buffer.from(buffer).toString('base64')
        messageContent = [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: `Extract deal data from this document (${resolvedFileName}). Return only valid JSON.` },
        ]
      }
    } else {
      return NextResponse.json({ error: 'No file or text provided' }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      model: AI_MODELS.powerful_latest,
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }],
    })

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim()

    const parsed = JSON.parse(text)

    // Clean up temp storage file if one was used
    if (storagePath) {
      const supabase = serviceClient()
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
    }

    // Override deal_type with user's explicit selection (more reliable than Claude's guess)
    if (userDealType) parsed.deal_type = userDealType
    if (userParentPortco) parsed.parent_portco = userParentPortco

    // Upload to Dropbox (best-effort — doesn't fail the parse if Dropbox is unavailable)
    let dropbox_folder: string | null = null
    let dropbox_error: string | null = null
    let dropbox_folder_existed = false
    const dbx_configured = dropboxConfigured()

    if (dbx_configured && parsed.company_name) {
      const safeName = parsed.company_name.replace(/[<>:"/\\|?*]/g, '_')
      // Append [PortcoName] suffix for add-on deals so the folder is clearly scoped
      const portcoSuffix = userParentPortco ? ` [${String(userParentPortco).replace(/[<>:"/\\|?*]/g, '_')}]` : ''
      const folderPath = `/Evolution Strategy Partners/Deals/${safeName}${portcoSuffix}`

      // Check whether a folder for this company already exists in Dropbox
      dropbox_folder_existed = await dropboxFolderExists(folderPath).catch(() => false)

      if (buffer) {
        try {
          const uploadedFilePath = await dropboxUpload(folderPath, resolvedFileName, Buffer.from(buffer))
          dropbox_folder = uploadedFilePath.substring(0, uploadedFilePath.lastIndexOf('/'))
        } catch (dbxErr: any) {
          dropbox_error = dbxErr.message ?? 'Unknown Dropbox error'
          // If upload failed but folder existed, still surface the folder path so the UI can link to it
          if (dropbox_folder_existed) dropbox_folder = folderPath
          console.warn('Dropbox upload failed:', dropbox_error)
        }
      } else if (dropbox_folder_existed) {
        // Paste mode — no file to upload, but still surface the existing folder
        dropbox_folder = folderPath
      }
    } else if (!dbx_configured) {
      dropbox_error = 'Dropbox is not configured (missing env vars)'
    }

    return NextResponse.json({ ...parsed, dropbox_folder, dropbox_folder_existed, dropbox_error, dbx_configured })
  } catch (err: any) {
    // Attempt cleanup even on error
    if (storagePath) {
      try {
        serviceClient().storage.from(BUCKET).remove([storagePath])
      } catch { /* ignore */ }
    }
    console.error('CIM parse error:', err)
    return NextResponse.json({ error: err.message || 'Parse failed' }, { status: 500 })
  }
}
