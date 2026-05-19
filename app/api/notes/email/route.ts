import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const SYSTEM_PROMPT = `You extract structured information from forwarded emails for a CRM. Return ONLY valid JSON.

{
  "summary": "string — 1-3 sentence factual summary of what this email is about",
  "next_steps": "string or null — any explicit action items or follow-ups mentioned",
  "deal_names": ["string array — any company or deal names mentioned"],
  "contact_names": ["string array — any personal names mentioned (First Last format)"],
  "logged_by": "string or null — the person who forwarded/sent this (first name only if clear)"
}

Rules:
- Be factual, no opinions
- deal_names: only explicit company/deal names, not generic references
- contact_names: full names only, skip email addresses
- If nothing is present for a field, use null or []`

export async function POST(req: NextRequest) {
  // Verify webhook token if one is configured
  const webhookToken = process.env.POSTMARK_WEBHOOK_TOKEN
  if (webhookToken) {
    const provided = req.nextUrl.searchParams.get('token') ?? req.headers.get('x-webhook-token')
    if (provided !== webhookToken) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const body = await req.json()

    // Support Postmark inbound webhook format and generic format
    const from: string = body.From ?? body.from ?? ''
    const subject: string = body.Subject ?? body.subject ?? ''
    const text: string = body.TextBody ?? body.text ?? body.body ?? ''
    const date: string = body.Date ?? body.date ?? new Date().toISOString()

    if (!text && !subject) {
      return NextResponse.json({ error: 'No email content provided' }, { status: 400 })
    }

    const emailContent = `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${text}`.trim()

    // Parse with Claude
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Extract CRM data from this email:\n\n${emailContent}` }],
    })

    const parsed = JSON.parse(
      response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').replace(/```json|```/g, '').trim()
    )

    const supabase = serviceClient()

    // Try to match deal and contact from extracted names
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

    // Create note
    const noteDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    const rawText = `From: ${from}\nSubject: ${subject}\n\n${text}`.slice(0, 4000)

    const { data: note, error } = await supabase.from('notes').insert({
      note_date: noteDate,
      raw_text: rawText,
      summary: parsed.summary ?? null,
      next_steps: parsed.next_steps ?? null,
      logged_by: parsed.logged_by ?? 'email',
      source: 'email',
      deal_id,
      contact_id,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ note, parsed })
  } catch (err: any) {
    console.error('Email parse error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
