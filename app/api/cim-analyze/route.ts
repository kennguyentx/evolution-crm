import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase'
import { dropboxUpload } from '@/lib/dropbox'

export const maxDuration = 120

// Extract plain text from a DOCX file using jszip (no external deps beyond existing jszip)
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
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function POST(req: NextRequest) {
  try {
    const formData    = await req.formData()
    const file        = formData.get('file') as File | null
    const pastedText  = formData.get('text') as string | null
    const dealId      = formData.get('deal_id') as string

    if (!dealId) return NextResponse.json({ error: 'deal_id required' }, { status: 400 })
    if (!file && !pastedText?.trim()) return NextResponse.json({ error: 'File or text required' }, { status: 400 })

    const supabase = createClient()

    // Fetch deal data + any NDAs and contacts for cross-reference
    const [dealRes, ndasRes, contactsRes] = await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase.from('ndas').select('entity_name, effective_date, term, non_solicit, financing_sources_included, overall_assessment').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(1),
      supabase.from('contact_deal_links').select('role, contact:contacts(first_name, last_name, firm, title)').eq('deal_id', dealId),
    ])

    const deal     = dealRes.data
    const latestNDA = ndasRes.data?.[0] || null
    const contacts = (contactsRes.data || []).map((l: any) => ({ role: l.role, ...l.contact }))

    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

    // Build file content for Claude
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const content: any[] = []

    let fileName = 'CIM'
    let fileBuffer: ArrayBuffer | null = null

    if (file) {
      fileName = file.name
      fileBuffer = await file.arrayBuffer()
      const isPDF  = file.type === 'application/pdf'  || file.name.toLowerCase().endsWith('.pdf')
      const isDOCX = file.type.includes('wordprocessingml') || file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')

      if (isPDF) {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(fileBuffer).toString('base64') },
          title: `CIM: ${file.name}`,
        })
      } else if (isDOCX) {
        const text = await extractDocxText(fileBuffer)
        content.push({ type: 'text', text: `CIM (${file.name}):\n${text}` })
      } else {
        content.push({ type: 'text', text: `CIM (${file.name}):\n${Buffer.from(fileBuffer).toString('utf-8')}` })
      }
    } else if (pastedText) {
      content.push({ type: 'text', text: `CIM:\n${pastedText}` })
    }

    content.push({
      type: 'text',
      text: `You are analyzing a CIM (Confidential Information Memorandum) for Evolution Strategy Partners.

EXISTING DEAL RECORD (from teaser intake):
- Company: ${deal.company_name}
- Sector: ${deal.sector || 'not set'}
- Geography: ${deal.geography || 'not set'}
- Revenue: ${deal.revenue ? `$${(deal.revenue / 1e6).toFixed(1)}M` : 'not set'}
- EBITDA: ${deal.ebitda ? `$${(deal.ebitda / 1e6).toFixed(1)}M` : 'not set'}
- Deal Type: ${deal.deal_type || 'not set'}
- Description: ${deal.description || 'none'}
- Stage: ${deal.stage}

EXISTING CONTACTS:
${contacts.length ? contacts.map((c: any) => `- ${c.first_name} ${c.last_name} (${c.firm || 'no firm'}) — ${c.role}`).join('\n') : 'None on file'}

${latestNDA ? `EXECUTED NDA ON FILE:
- Entity: ${latestNDA.entity_name}
- Term: ${latestNDA.term}
- Non-solicit: ${latestNDA.non_solicit ? 'Yes' : 'No'}
- Financing sources included: ${latestNDA.financing_sources_included ? 'Yes' : 'No'}` : 'NO NDA ON FILE'}

TASK: Extract all deal information from the CIM above, then cross-reference with the existing deal record.

EXTRACT:
1. company_name
2. sector (match to: Underground Utilities, Electrical Contracting, Civil/Public Works, Commercial Landscaping, Fiber Optics, HVAC, Plumbing, Industrial Services, Environmental Services, Construction & Engineering — or best match)
3. geography (states/regions of operations)
4. revenue (LTM revenue as number in dollars)
5. ebitda (LTM EBITDA as number in dollars)
6. ebitda_margin (percentage)
7. revenue_growth (YoY % if available)
8. deal_type (platform/add-on/recap/growth)
9. description (2-3 sentence business description)
10. financial_summary (paragraph covering historical financials, margins, growth)
11. key_risks (array of strings — 3-6 key risks)
12. growth_opportunities (array of strings — 3-5 opportunities)
13. management_team (array of {name, title})
14. customer_concentration (brief note on customer concentration)
15. banker_name (deal source/advisor name if mentioned)
16. banker_firm (deal source/advisor firm if mentioned)
17. asking_price (if disclosed, as number in dollars — otherwise null)
18. asking_multiple (EBITDA multiple if disclosed — otherwise null)

CROSS-REFERENCE (compare CIM vs existing deal record):
For each meaningful discrepancy or noteworthy alignment:
{
  "field": field name,
  "teaser_value": what was in the existing record,
  "cim_value": what the CIM says,
  "significance": "high" | "medium" | "low",
  "note": why it matters
}

Also note: does the CIM company name match the NDA entity name on file? (if NDA exists)

OVERALL: 1-2 sentence assessment of the deal based on the CIM.

Return ONLY valid JSON:
{
  "company_name": "string",
  "sector": "string",
  "geography": "string",
  "revenue": number or null,
  "ebitda": number or null,
  "ebitda_margin": number or null,
  "revenue_growth": number or null,
  "deal_type": "string",
  "description": "string",
  "financial_summary": "string",
  "key_risks": ["string"],
  "growth_opportunities": ["string"],
  "management_team": [{"name": "string", "title": "string"}],
  "customer_concentration": "string",
  "banker_name": "string or null",
  "banker_firm": "string or null",
  "asking_price": number or null,
  "asking_multiple": number or null,
  "cross_reference": {
    "discrepancies": [
      {
        "field": "string",
        "teaser_value": "string",
        "cim_value": "string",
        "significance": "high",
        "note": "string"
      }
    ],
    "nda_match": true,
    "nda_note": "string",
    "overall": "string"
  }
}`,
    })

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in Claude response')
    const extracted = JSON.parse(jsonMatch[0])

    // Upload to Dropbox
    let dropboxPath: string | null = null
    if (fileBuffer && deal.dropbox_path) {
      try {
        const safeName = deal.company_name.replace(/[<>:"/\\|?*]/g, '_')
        const folder = `/Evolution Strategy Partners/Deals/${safeName}`
        dropboxPath = await dropboxUpload(folder, fileName, Buffer.from(fileBuffer))
      } catch (e) {
        console.error('Dropbox upload error (non-fatal):', e)
      }
    }

    // Save CIM record to Supabase
    const { data: saved } = await supabase.from('deal_cims').insert({
      deal_id: dealId,
      file_name: fileName,
      dropbox_path: dropboxPath,
      extracted: extracted,
    }).select('id').single()

    return NextResponse.json({ success: true, id: saved?.id, dropbox_path: dropboxPath, ...extracted })
  } catch (err: any) {
    console.error('CIM analyze error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
