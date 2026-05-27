import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDropboxToken, dropboxUpload } from '@/lib/dropbox'
import { createClient } from '@/lib/supabase'
import { AI_MODELS } from '@/lib/ai-config'

export const maxDuration = 120

const DBX_API     = 'https://api.dropboxapi.com/2'
const DBX_CONTENT = 'https://content.dropboxapi.com/2'

// Search Best Practices for an NDA template file
async function findNDATemplate(): Promise<{ base64: string; name: string } | null> {
  try {
    const token = await getDropboxToken()
    const searchRes = await fetch(`${DBX_API}/files/search_v2`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'NDA',
        options: {
          path: '/Evolution Strategy Partners/Best Practices',
          max_results: 10,
          file_status: 'active',
        },
      }),
    })
    if (!searchRes.ok) return null

    const data = await searchRes.json()
    const match = (data.matches || []).find((m: any) => {
      const meta = m.metadata?.metadata
      return meta?.['.tag'] === 'file' && /nda/i.test(meta.name) && meta.name.toLowerCase().endsWith('.pdf')
    })
    if (!match) return null

    const filePath = match.metadata?.metadata?.path_lower
    const fileName = match.metadata?.metadata?.name
    if (!filePath) return null

    const dlRes = await fetch(`${DBX_CONTENT}/files/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: filePath }),
      },
    })
    if (!dlRes.ok) return null

    const buf = await dlRes.arrayBuffer()
    return { base64: Buffer.from(buf).toString('base64'), name: fileName }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData()
    const file      = formData.get('file') as File | null
    const pastedText = formData.get('text') as string | null
    const dealId    = formData.get('deal_id') as string | null
    const companyName = formData.get('company_name') as string | null

    if (!file && !pastedText?.trim()) {
      return NextResponse.json({ error: 'File or text required' }, { status: 400 })
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // Fetch NDA template from Best Practices (best-effort)
    const template = await findNDATemplate()

    // Build message content
    const content: any[] = []

    if (template) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: template.base64 },
        title: `ESP Standard NDA Template (${template.name})`,
        context: "This is Evolution Strategy Partners' standard NDA template — the benchmark for comparison.",
      })
    }

    // Incoming NDA
    let fileBase64: string | null = null
    let fileName: string | null = null

    if (file) {
      const arrayBuffer = await file.arrayBuffer()
      fileBase64 = Buffer.from(arrayBuffer).toString('base64')
      fileName = file.name
      const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

      if (isPDF) {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 },
          title: `Incoming NDA: ${file.name}`,
          context: 'This is the incoming NDA to analyze and compare against the template.',
        })
      } else {
        // Plain text or other
        content.push({
          type: 'text',
          text: `INCOMING NDA (${file.name}):\n${Buffer.from(arrayBuffer).toString('utf-8')}`,
        })
      }
    } else if (pastedText) {
      content.push({ type: 'text', text: `INCOMING NDA:\n${pastedText}` })
    }

    content.push({
      type: 'text',
      text: `You are reviewing an NDA on behalf of Evolution Strategy Partners (ESP), a private equity firm.

${template
  ? "The first document is ESP's standard NDA template. The second is the incoming NDA. Compare them carefully."
  : "Review the incoming NDA below. No template was available for comparison."}

TASK: Extract the following fields from the INCOMING NDA, then provide a markup review.

EXTRACTION FIELDS:
1. entity_name — Counterparty entity name (not ESP / Evolution Strategy Partners)
2. effective_date — Date as written in the document
3. term — Duration of confidentiality obligations (e.g. "2 years from the date of the Agreement")
4. term_expiry — Calculated expiry date if determinable, otherwise null
5. non_solicit — Boolean: does a non-solicitation clause exist?
6. non_solicit_term — If yes, its specific duration
7. non_solicit_notes — Any carveouts, scope limitations, or unusual provisions in the non-solicit
8. representatives — Array of all named categories of people who may receive confidential information (e.g. "directors, officers, employees, advisors, financing sources")
9. financing_sources_included — Boolean: are "financing sources", "debt financing sources", "potential lenders", "equity co-investors", or equivalent language explicitly included as permitted representatives?
10. financing_sources_notes — The exact language used regarding financing sources, or state clearly that it is absent and where it should appear

MARKUP REVIEW:
For each meaningful issue or deviation${template ? " from ESP's template" : ""}, provide:
- section: Section number/title
- issue: One-line description of the problem
- significance: "high", "medium", or "low"
- incoming_language: Exact or paraphrased language from the incoming NDA (or "Absent" if missing)
- preferred_language: ${template ? "ESP's template language or" : ""} suggested corrective language
- note: Why this matters for ESP

Prioritize these areas:
• Financing sources in representative definitions (HIGH if absent)
• Non-solicit scope and duration vs standard (12 months)
• NDA term length
• Standstill provisions
• Exclusions from confidentiality definition
• Return/destruction of materials clause
• Governing law (flag if non-Delaware/non-standard)

Finally, provide:
- overall_assessment: 1-2 sentence plain-English summary of whether this NDA is acceptable and what, if anything, needs to change

Return ONLY valid JSON — no prose before or after:
{
  "entity_name": "string",
  "effective_date": "string",
  "term": "string",
  "term_expiry": "string or null",
  "non_solicit": true,
  "non_solicit_term": "string or null",
  "non_solicit_notes": "string or null",
  "representatives": ["string"],
  "financing_sources_included": false,
  "financing_sources_notes": "string",
  "markup": [
    {
      "section": "string",
      "issue": "string",
      "significance": "high",
      "incoming_language": "string",
      "preferred_language": "string",
      "note": "string"
    }
  ],
  "overall_assessment": "string"
}`,
    })

    const response = await anthropic.messages.create({
      model: AI_MODELS.powerful,
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in Claude response')
    const extracted = JSON.parse(jsonMatch[0])

    // Save to Supabase if we have a deal_id
    let ndaId: string | null = null
    if (dealId) {
      const supabase = createClient()
      const { data: saved, error: saveErr } = await supabase
        .from('ndas')
        .insert({
          deal_id: dealId,
          file_name: fileName || 'Pasted text',
          status: 'reviewing',
          entity_name: extracted.entity_name,
          effective_date: extracted.effective_date,
          term: extracted.term,
          term_expiry: extracted.term_expiry,
          non_solicit: extracted.non_solicit,
          non_solicit_term: extracted.non_solicit_term,
          non_solicit_notes: extracted.non_solicit_notes,
          representatives: extracted.representatives,
          financing_sources_included: extracted.financing_sources_included,
          financing_sources_notes: extracted.financing_sources_notes,
          markup: extracted.markup,
          overall_assessment: extracted.overall_assessment,
        })
        .select('id')
        .single()

      if (!saveErr && saved) {
        ndaId = saved.id

        // Upload file to Dropbox under deal folder
        if (fileBase64 && fileName && companyName) {
          try {
            const safeName = companyName.replace(/[<>:"/\\|?*]/g, '_')
            const folderPath = `/Evolution Strategy Partners/Deals/${safeName}/NDAs`
            await dropboxUpload(folderPath, fileName, Buffer.from(fileBase64, 'base64'))
          } catch (dbxErr) {
            console.error('Dropbox upload error (non-fatal):', dbxErr)
          }
        }
      }
    }

    return NextResponse.json({ success: true, id: ndaId, ...extracted })
  } catch (err: any) {
    console.error('NDA analyze error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET: list NDAs for a deal
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dealId = searchParams.get('deal_id')
  if (!dealId) return NextResponse.json({ error: 'deal_id required' }, { status: 400 })

  const supabase = createClient()
  const { data, error } = await supabase
    .from('ndas')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ndas: data || [] })
}

// PATCH: update NDA status
export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json()
    if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })
    const supabase = createClient()
    const { error } = await supabase.from('ndas').update({ status }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
