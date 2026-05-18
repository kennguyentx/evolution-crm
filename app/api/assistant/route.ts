// app/api/assistant/route.ts
// AI assistant with Nexus data tools + web search + confirmation flow

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Tool definitions ─────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_deals',
    description: 'Search deals in the pipeline by company name, sector, geography, or stage. Use for questions about specific deals or pipeline overview.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Partial company name to search' },
        sector: { type: 'string', description: 'Sector filter' },
        geography: { type: 'string', description: 'Geography filter' },
        stage: { type: 'string', description: 'Deal stage filter' },
        status: { type: 'string', description: 'Deal status: Active, Dead, Closed' },
      },
    },
  },
  {
    name: 'get_deal_detail',
    description: 'Get full details for a specific deal including contacts, interactions, diligence, and capital assignments.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Deal UUID' },
      },
      required: ['deal_id'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search CRM contacts by name, firm, or type.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, firm, or email to search' },
        contact_type: { type: 'string', description: 'Type: banker, lp, lender, advisor, management, other' },
      },
    },
  },
  {
    name: 'search_capital_contacts',
    description: 'Search the capital contacts master list (equity investors and lenders from the tracker spreadsheet).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Firm name, contact name, or keyword' },
        source: { type: 'string', description: 'equity or lender' },
        status: { type: 'string', description: 'active, pass, or inactive' },
      },
    },
  },
  {
    name: 'get_capital_raises',
    description: 'Get capital raises with their participants, statuses, and committed amounts.',
    input_schema: {
      type: 'object',
      properties: {
        deal_name: { type: 'string', description: 'Filter by deal name' },
        status: { type: 'string', description: 'Open or Closed' },
      },
    },
  },
  {
    name: 'search_notes',
    description: 'Search the meeting notes / activity log.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
        deal_id: { type: 'string', description: 'Filter by deal UUID' },
        logged_by: { type: 'string', description: 'Filter by who logged it' },
      },
    },
  },
  {
    name: 'get_portfolio',
    description: 'Get portfolio companies and their details.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Active, Exited, etc.' },
      },
    },
  },
  {
    name: 'get_investors',
    description: 'Get LP investors and their investment history.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search by name or firm' },
      },
    },
  },
  // ─── Write tools (require confirmation) ──────────────────
  {
    name: 'update_deal_stage',
    description: 'Update a deal stage. REQUIRES USER CONFIRMATION before executing.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string' },
        company_name: { type: 'string', description: 'For confirmation display' },
        new_stage: { type: 'string' },
        current_stage: { type: 'string', description: 'For confirmation display' },
      },
      required: ['deal_id', 'company_name', 'new_stage'],
    },
  },
  {
    name: 'log_note',
    description: 'Log a meeting note or interaction. REQUIRES USER CONFIRMATION.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        next_steps: { type: 'string' },
        deal_id: { type: 'string' },
        contact_id: { type: 'string' },
        logged_by: { type: 'string' },
        note_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'update_raise_participant_status',
    description: 'Update a capital raise participant status (e.g. mark as passed, term sheet, invested). REQUIRES CONFIRMATION.',
    input_schema: {
      type: 'object',
      properties: {
        participant_id: { type: 'string' },
        firm_name: { type: 'string', description: 'For confirmation display' },
        raise_name: { type: 'string', description: 'For confirmation display' },
        new_status: { type: 'string' },
        current_status: { type: 'string' },
      },
      required: ['participant_id', 'firm_name', 'new_status'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information — market data, benchmarks, news, comps. Use when the question requires information not in Nexus.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
]

// Write tool names — these need confirmation
const WRITE_TOOLS = new Set(['update_deal_stage', 'log_note', 'update_raise_participant_status'])

// ─── Tool execution ───────────────────────────────────────────

async function executeTool(name: string, input: any): Promise<any> {
  switch (name) {

    case 'search_deals': {
      let q = supabase.from('deals').select('id, company_name, sector, geography, stage, status, ebitda, revenue, description, notes').limit(20)
      if (input.company_name) q = q.ilike('company_name', `%${input.company_name}%`)
      if (input.sector) q = q.ilike('sector', `%${input.sector}%`)
      if (input.geography) q = q.ilike('geography', `%${input.geography}%`)
      if (input.stage) q = q.eq('stage', input.stage)
      if (input.status) q = q.eq('status', input.status)
      else q = q.eq('status', 'Active')
      const { data } = await q.order('updated_at', { ascending: false })
      return data || []
    }

    case 'get_deal_detail': {
      const [dealRes, linksRes, interactionsRes, capitalRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', input.deal_id).single(),
        supabase.from('contact_deal_links').select('*, contact:contacts(first_name, last_name, firm, email, phone)').eq('deal_id', input.deal_id),
        supabase.from('interactions').select('*').eq('deal_id', input.deal_id).order('interaction_date', { ascending: false }).limit(10),
        supabase.from('deal_capital_assignments').select('*, contact:contacts(first_name, last_name, firm)').eq('deal_id', input.deal_id),
      ])
      return {
        deal: dealRes.data,
        contacts: linksRes.data,
        recent_interactions: interactionsRes.data,
        capital: capitalRes.data,
      }
    }

    case 'search_contacts': {
      let q = supabase.from('contacts').select('id, first_name, last_name, firm, title, email, phone, contact_type, notes').limit(15)
      if (input.query) q = q.or(`first_name.ilike.%${input.query}%,last_name.ilike.%${input.query}%,firm.ilike.%${input.query}%,email.ilike.%${input.query}%`)
      if (input.contact_type) q = q.eq('contact_type', input.contact_type)
      const { data } = await q.order('last_name')
      return data || []
    }

    case 'search_capital_contacts': {
      let q = supabase.from('capital_contacts').select('id, firm, firm_type, firm_focus, investment_pref, contact_name, email, phone, conf_lead, notes, status, source').limit(20)
      if (input.query) q = q.or(`firm.ilike.%${input.query}%,contact_name.ilike.%${input.query}%,notes.ilike.%${input.query}%`)
      if (input.source) q = q.eq('source', input.source)
      if (input.status) q = q.eq('status', input.status)
      const { data } = await q.order('firm')
      return data || []
    }

    case 'get_capital_raises': {
      let q = supabase.from('capital_raises').select(`
        *, deal:deals(company_name),
        participants:raise_participants(id, firm_name, contact_name, status, committed_amount, debt_amount, notes, pass_reason)
      `).order('created_at', { ascending: false })
      if (input.deal_name) q = q.ilike('name', `%${input.deal_name}%`)
      if (input.status) q = q.eq('status', input.status)
      const { data } = await q
      return data || []
    }

    case 'search_notes': {
      let q = supabase.from('notes').select(`
        *, deal:deals(company_name), contact:contacts(first_name, last_name), raise:capital_raises(name)
      `).order('note_date', { ascending: false }).limit(20)
      if (input.query) q = q.or(`summary.ilike.%${input.query}%,raw_text.ilike.%${input.query}%`)
      if (input.deal_id) q = q.eq('deal_id', input.deal_id)
      if (input.logged_by) q = q.ilike('logged_by', `%${input.logged_by}%`)
      const { data } = await q
      return data || []
    }

    case 'get_portfolio': {
      let q = supabase.from('portfolio_companies').select('*').order('name')
      if (input.status) q = q.eq('status', input.status)
      const { data } = await q
      return data || []
    }

    case 'get_investors': {
      let q = supabase.from('investors').select(`
        *, investments:lp_investments(invested_amount, portfolio_company:portfolio_companies(name)),
        entities:investment_entities(name, entity_type)
      `).limit(20)
      if (input.query) q = q.or(`first_name.ilike.%${input.query}%,last_name.ilike.%${input.query}%,firm.ilike.%${input.query}%`)
      const { data } = await q.order('last_name')
      return data || []
    }

    case 'web_search': {
      // Use Anthropic web search via a nested call
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
        messages: [{ role: 'user', content: `Search for: ${input.query}. Return a concise factual summary of what you find, with source names.` }],
      })
      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      return { result: text }
    }

    // Write tools — execution only called after confirmation
    case 'update_deal_stage': {
      await supabase.from('deals').update({ stage: input.new_stage }).eq('id', input.deal_id)
      return { success: true, message: `Updated ${input.company_name} stage to ${input.new_stage}` }
    }

    case 'log_note': {
      const { data } = await supabase.from('notes').insert({
        summary: input.summary,
        raw_text: input.summary + (input.next_steps ? `\n\nNext steps: ${input.next_steps}` : ''),
        next_steps: input.next_steps || null,
        deal_id: input.deal_id || null,
        contact_id: input.contact_id || null,
        logged_by: input.logged_by || 'Assistant',
        source: 'manual',
        note_date: input.note_date || new Date().toISOString().split('T')[0],
      }).select().single()
      return { success: true, note_id: data?.id }
    }

    case 'update_raise_participant_status': {
      await supabase.from('raise_participants').update({ status: input.new_status }).eq('id', input.participant_id)
      return { success: true, message: `Updated ${input.firm_name} to ${input.new_status}` }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ─── Main handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { messages, confirming } = await req.json()
    // messages: Anthropic message array (full history)
    // confirming: { tool_use_id, tool_name, input } — set when user confirmed a write

    const systemPrompt = `You are Nexus Assistant, an AI agent for Evolution Strategy — a lower middle market private equity firm in Austin/Dallas focused on infrastructure services businesses ($3-7M EBITDA).

You have access to Nexus (the firm's CRM) and the web. Use tools to answer questions accurately — never guess at data that could be looked up.

PORTFOLIO: Commercial landscaping (Houston), underground utilities (Texas + Michigan/DiPonio), electrical contracting (Carolinas), public works civil (DFW), fiber optics (Raleigh).

WRITE OPERATIONS: When asked to make a change, use the appropriate write tool. The system will pause for user confirmation before executing — you will see the result after they confirm.

Be concise and direct. Format numbers cleanly ($5.2M, 8.5x). When showing lists, use short tables or bullets. If data isn't in Nexus, say so and offer to search the web.

Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`

    // Handle confirmation flow — user confirmed a write tool
    if (confirming) {
      const result = await executeTool(confirming.tool_name, confirming.input)
      // Continue the conversation with the tool result injected
      const continueMessages = [
        ...messages,
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: confirming.tool_use_id, name: confirming.tool_name, input: confirming.input }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: confirming.tool_use_id, content: JSON.stringify(result) }],
        },
      ]
      const finalResp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        tools: TOOLS,
        messages: continueMessages,
      })
      return NextResponse.json({ type: 'text', content: finalResp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') })
    }

    // Normal agentic loop
    let currentMessages = [...messages]
    let iterations = 0
    const MAX_ITER = 8

    while (iterations < MAX_ITER) {
      iterations++
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        tools: TOOLS,
        messages: currentMessages,
      })

      // If no tool calls, we're done
      if (resp.stop_reason === 'end_turn') {
        const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        return NextResponse.json({ type: 'text', content: text })
      }

      // Check for write tools — pause for confirmation
      const toolUses = resp.content.filter((b: any) => b.type === 'tool_use')
      const writeToolUse = toolUses.find((t: any) => WRITE_TOOLS.has(t.name))
      if (writeToolUse) {
        // Return confirmation request to the frontend
        const textSoFar = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        return NextResponse.json({
          type: 'confirmation',
          tool_use_id: writeToolUse.id,
          tool_name: writeToolUse.name,
          tool_input: writeToolUse.input,
          preview_text: textSoFar,
          // Pass back messages so frontend can continue thread after confirm
          messages_so_far: [
            ...currentMessages,
            { role: 'assistant', content: resp.content },
          ],
        })
      }

      // Execute all read tools
      const toolResults = await Promise.all(
        toolUses.map(async (t: any) => ({
          type: 'tool_result' as const,
          tool_use_id: t.id,
          content: JSON.stringify(await executeTool(t.name, t.input)),
        }))
      )

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: resp.content },
        { role: 'user', content: toolResults },
      ]
    }

    return NextResponse.json({ type: 'text', content: 'I hit my search limit. Try a more specific question.' })
  } catch (err: any) {
    console.error('Assistant error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
