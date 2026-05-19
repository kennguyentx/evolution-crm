import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { dropboxConfigured, dropboxUpload } from '@/lib/dropbox'

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
  "sector": "string — one of: Underground Utilities | Electrical Contracting | Civil / Public Works | Commercial Landscaping | Fiber Optics | HVAC | Plumbing | Industrial Services | Environmental Services | Construction & Engineering | Other",
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

export async function POST(req: NextRequest) {
  let storagePath: string | null = null
  try {
    const { storagePath: sp, fileName } = await req.json()
    storagePath = sp || null

    if (!storagePath) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Download the file from Supabase Storage using the service role key
    const supabase = serviceClient()
    const { data: fileData, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(storagePath)

    if (dlError || !fileData) throw new Error(`Download failed: ${dlError?.message ?? 'no data'}`)

    const buffer = await (fileData as Blob).arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: `Extract deal data from this document (${fileName}). Return only valid JSON.` },
        ],
      }],
    })

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim()

    const parsed = JSON.parse(text)

    // Clean up temp storage file
    await supabase.storage.from(BUCKET).remove([storagePath])

    // Upload to Dropbox (best-effort — doesn't fail the parse if Dropbox is unavailable)
    let dropbox_folder: string | null = null
    if (dropboxConfigured() && parsed.company_name) {
      try {
        const safeName = parsed.company_name.replace(/[<>:"/\\|?*]/g, '_')
        const folderPath = `/Deals/${safeName}`
        await dropboxUpload(folderPath, fileName, Buffer.from(buffer))
        dropbox_folder = folderPath
      } catch (dbxErr) {
        console.warn('Dropbox upload skipped:', (dbxErr as Error).message)
      }
    }

    return NextResponse.json({ ...parsed, dropbox_folder })
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
