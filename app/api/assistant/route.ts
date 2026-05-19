// app/api/assistant/route.ts

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Tool definitions ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: any[] = [
  {
    name: 'search_deals',
    description: 'Search ALL deals (active, dead, closed) by company name, sector, geography, stage, status, or year. Default returns ALL statuses — never filter to Active only unless explicitly asked. Use year filter for historical counting questions.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Partial company name' },
        sector: { type: 'string', description: 'Sector keyword' },
        geography: { type: 'string', description: 'Geography keyword' },
        stage: { type: 'string', description: 'Exact stage value only: Teaser | Reviewing | Pre-LOI | LOI Submitted | Exclusivity | Closed (Platform) | Closed (Add-On) | Pass (DOA) | Pass (Pre-LOI) | Pass (Post-LOI) | Hold' },
        status: { type: 'string', description: 'Active | Dead | Closed — omit for all statuses' },
        year: { type: 'number', description: 'Calendar year to filter by created_at (e.g. 2025)' },
        sourced_year: { type: 'number', description: 'Calendar year to filter by sourced_date (Salesforce close date, more accurate than created_at)' },
      },
    },
  },
  {
    name: 'get_deal_detail',
    description: 'Get complete details for one deal: all fields, linked contacts, recent interactions, capital assignments, and capital raises. Call this after search_deals to get full context on a specific deal.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Deal UUID from search_deals results' },
      },
      required: ['deal_id'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search CRM contacts by name, firm, email, or type. Returns contacts with their deal links.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, firm, or email keyword' },
        contact_type: { type: 'string', description: 'banker | lp | lender | advisor | management | other' },
      },
    },
  },
  {
    name: 'search_capital_contacts',
    description: 'Search the capital contacts master list — 1,180 equity investors and lenders from the Evolution tracker spreadsheet. Use for questions about specific firms, investors, or lenders we track.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Firm name, contact name, or keyword (searches firm, contact, and notes)' },
        source: { type: 'string', description: 'equity | lender' },
        status: { type: 'string', description: 'active | pass | inactive' },
      },
    },
  },
  {
    name: 'get_capital_raises',
    description: 'Get capital raises with all participants, their statuses, committed amounts, and dates. Use for questions about fundraising activity, committed capital, or investor engagement on a specific raise.',
    input_schema: {
      type: 'object',
      properties: {
        deal_name: { type: 'string', description: 'Filter by deal or raise name keyword' },
        status: { type: 'string', description: 'Open | Closed' },
      },
    },
  },
  {
    name: 'search_notes',
    description: 'Search meeting notes and interaction logs. Use for questions about what was discussed, who was called, or what happened on a deal.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search in summary and raw text' },
        deal_id: { type: 'string', description: 'Filter by specific deal UUID' },
        logged_by: { type: 'string', description: 'Filter by person who logged it (Ken, SS, etc.)' },
        source: { type: 'string', description: 'discord | email | manual' },
      },
    },
  },
  {
    name: 'get_portfolio',
    description: 'Get portfolio companies with all their details.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Active | Exited — omit for all' },
      },
    },
  },
  {
    name: 'get_investors',
    description: 'Get LP investors with their investment history, entities, and committed amounts.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search by name or firm' },
      },
    },
  },
  // ─── Write tools — ALL require confirmation ───────────────────
  {
    name: 'update_deal_field',
    description: 'Update any field on a deal. ALWAYS requires user confirmation before executing — do not skip. First use search_deals to find the deal ID, then call this tool.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID from search_deals' },
        company_name: { type: 'string', description: 'Display name for confirmation' },
        field: { type: 'string', description: 'Exact DB column: stage | status | notes | sector | geography | revenue | ebitda | description | loi_date | expected_close | pass_reason | source_notes | deal_type' },
        new_value: { type: 'string', description: 'New value. For stage: Teaser | Reviewing | Pre-LOI | LOI Submitted | Exclusivity | Closed (Platform) | Closed (Add-On) | Pass (DOA) | Pass (Pre-LOI) | Pass (Post-LOI) | Hold. For status: Active | Dead | Closed.' },
        current_value: { type: 'string', description: 'Current value for display in confirmation' },
      },
      required: ['deal_id', 'company_name', 'field', 'new_value'],
    },
  },
  {
    name: 'update_contact_field',
    description: 'Update any field on a CRM contact. ALWAYS requires user confirmation. First use search_contacts to find the contact ID.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'UUID from search_contacts' },
        contact_name: { type: 'string', description: 'Display name for confirmation' },
        field: { type: 'string', description: 'Exact DB column: first_name | last_name | firm | title | email | phone | notes | contact_type' },
        new_value: { type: 'string', description: 'New value. For contact_type: banker | lp | lender | advisor | management | other' },
        current_value: { type: 'string', description: 'Current value for display' },
      },
      required: ['contact_id', 'contact_name', 'field', 'new_value'],
    },
  },
  {
    name: 'update_raise_participant',
    description: 'Update any field on a capital raise participant. ALWAYS requires user confirmation. First use get_capital_raises to find the participant ID.',
    input_schema: {
      type: 'object',
      properties: {
        participant_id: { type: 'string', description: 'UUID from get_capital_raises participants list' },
        firm_name: { type: 'string', description: 'Display name for confirmation' },
        raise_name: { type: 'string', description: 'Raise name for context' },
        field: { type: 'string', description: 'Exact DB column: status | notes | pass_reason | committed_amount | debt_amount | teaser_date | nda_date | cim_date | first_call_date | term_sheet_date' },
        new_value: { type: 'string', description: 'New value. For status: outreach | teaser_sent | nda_signed | cim_sent | call_had | in_dd | term_sheet | invested | confirmed | pass | no_response. For amounts: number in millions (e.g. "5.0" for $5M). For dates: YYYY-MM-DD.' },
        current_value: { type: 'string', description: 'Current value for display' },
      },
      required: ['participant_id', 'firm_name', 'field', 'new_value'],
    },
  },
  {
    name: 'log_note',
    description: 'Log a meeting note or interaction against a deal, contact, or raise. ALWAYS requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Note summary / what was discussed' },
        next_steps: { type: 'string', description: 'Follow-up actions' },
        deal_id: { type: 'string', description: 'Link to deal UUID (from search_deals)' },
        contact_id: { type: 'string', description: 'Link to contact UUID (from search_contacts)' },
        raise_id: { type: 'string', description: 'Link to raise UUID (from get_capital_raises)' },
        logged_by: { type: 'string', description: 'Who logged it (Ken, SS, etc.)' },
        note_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information: market data, benchmarks, news, M&A comps, lender rates, sector trends. Use freely for anything not in Nexus.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_deal_files',
    description: 'List files in the Dropbox folder linked to a deal. Use before read_deal_file to find the right file name and path. Returns folder contents with file names, types, and full paths.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Deal UUID to look up the linked Dropbox folder path' },
        subfolder: { type: 'string', description: 'Optional: drill into a subfolder path returned by a previous list_deal_files call' },
      },
      required: ['deal_id'],
    },
  },
  {
    name: 'read_deal_file',
    description: 'Read the contents of a file from the deal Dropbox folder. Works with PDF, Word, Excel, CSV, and text files. Use to answer questions about credit agreements, NDAs, financials, diligence docs, or any file in the deal room. Always call list_deal_files first to get the exact path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full Dropbox file path from list_deal_files (e.g. /deals/diponio/credit agreement.pdf)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_portco_files',
    description: 'List files in the Dropbox folder linked to a portfolio company. Use for accessing portco documents like credit agreements, financials, legal docs. Always use this for portfolio company file questions.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Portfolio company name to look up (e.g. "DiPonio")' },
        subfolder: { type: 'string', description: 'Optional: subfolder path to drill into' },
      },
      required: ['company_name'],
    },
  },
  {
    name: 'get_calendar_events',
    description: 'Get calendar events. Use for questions about upcoming meetings, deadlines, calls, or site visits. Can filter by date range, event type, or linked deal/contact.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Start date filter YYYY-MM-DD (default: today)' },
        date_to:   { type: 'string', description: 'End date filter YYYY-MM-DD (default: 30 days from date_from)' },
        event_type: { type: 'string', description: 'meeting | call | deadline | reminder | site visit | other' },
        query: { type: 'string', description: 'Keyword to search in title or description' },
      },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Add an event to the calendar. ALWAYS requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Event title' },
        event_date:  { type: 'string', description: 'Date in YYYY-MM-DD format' },
        start_time:  { type: 'string', description: 'Start time HH:MM (24h), optional' },
        end_time:    { type: 'string', description: 'End time HH:MM (24h), optional' },
        event_type:  { type: 'string', description: 'meeting | call | deadline | reminder | site visit | other' },
        description: { type: 'string', description: 'Notes or agenda, optional' },
        deal_id:     { type: 'string', description: 'Link to deal UUID from search_deals, optional' },
        contact_id:  { type: 'string', description: 'Link to contact UUID from search_contacts, optional' },
      },
      required: ['title', 'event_date', 'event_type'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and folders at any path in the Evolution Strategy Dropbox. Use for general browsing when not looking for a specific deal or portco.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dropbox folder path, e.g. /Ken Nguyen/Evolution Strategy Partners or a subfolder' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of any file in the Evolution Strategy Dropbox. Works with PDF, Word, Excel, CSV, and text files. Always call list_files first to get the exact path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full Dropbox file path from list_files' },
      },
      required: ['path'],
    },
  },
]

const WRITE_TOOLS = new Set(['update_deal_field', 'update_contact_field', 'update_raise_participant', 'log_note', 'create_calendar_event'])

// ─── Allowed write fields (whitelist to prevent injection) ────

const ALLOWED_DEAL_FIELDS = new Set(['stage','status','notes','sector','geography','revenue','ebitda','description','loi_date','expected_close','pass_reason','source_notes','deal_type','asking_price'])
const ALLOWED_CONTACT_FIELDS = new Set(['first_name','last_name','firm','title','email','phone','notes','contact_type','sub_type'])
const ALLOWED_PARTICIPANT_FIELDS = new Set(['status','notes','pass_reason','committed_amount','debt_amount','pricing_notes','teaser_date','nda_date','cim_date','first_call_date','term_sheet_date'])

// ─── Direct Dropbox helpers (avoids internal HTTP round-trips) ───────────────

let _dbxToken: string | null = null
let _dbxTokenExpiry: number = 0

async function getDbxToken(): Promise<string> {
  const now = Date.now()
  if (_dbxToken && now < _dbxTokenExpiry) return _dbxToken
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN!,
      client_id: process.env.DROPBOX_APP_KEY!,
      client_secret: process.env.DROPBOX_APP_SECRET!,
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Dropbox auth failed: ${JSON.stringify(data)}`)
  _dbxToken = data.access_token
  _dbxTokenExpiry = now + (data.expires_in - 1800) * 1000
  return _dbxToken!
}

async function dbxListFolder(path: string): Promise<any[]> {
  const token = await getDbxToken()
  const dbxPath = path === '/' || path === '.' ? '' : path
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dbxPath, recursive: false, include_deleted: false }),
  })
  if (!res.ok) throw new Error(`Dropbox list error: ${await res.text()}`)
  const data = await res.json()
  return (data.entries || []).map((e: any) => ({
    name: e.name,
    path: e.path_lower,
    type: e['.tag'],
    size: e.size,
    readable: e['.tag'] === 'file' && ['.pdf','.txt','.md','.csv','.docx','.xlsx','.xls'].includes(e.name.slice(e.name.lastIndexOf('.')).toLowerCase()),
  }))
}

async function dbxDownload(path: string): Promise<{ base64: string; name: string; ext: string }> {
  const token = await getDbxToken()
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path }) },
  })
  if (!res.ok) throw new Error(`Dropbox download error: ${await res.text()}`)
  const buffer = await res.arrayBuffer()
  const name = path.split('/').pop() || 'file'
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return { base64: Buffer.from(buffer).toString('base64'), name, ext }
}



async function executeTool(name: string, input: any): Promise<any> {
  switch (name) {

    case 'search_deals': {
      let q = supabase
        .from('deals')
        .select('id, company_name, sector, geography, stage, status, ebitda, revenue, description, notes, sourced_date, created_at')
        .limit(200)
      if (input.company_name) q = q.ilike('company_name', `%${input.company_name}%`)
      if (input.sector) q = q.ilike('sector', `%${input.sector}%`)
      if (input.geography) q = q.ilike('geography', `%${input.geography}%`)
      if (input.stage) q = q.eq('stage', input.stage)
      if (input.status) q = q.eq('status', input.status)
      if (input.year) q = q.gte('created_at', `${input.year}-01-01`).lte('created_at', `${input.year}-12-31`)
      if (input.sourced_year) q = q.gte('sourced_date', `${input.sourced_year}-01-01`).lte('sourced_date', `${input.sourced_year}-12-31`)
      const { data, error } = await q.order('created_at', { ascending: false })
      if (error) return { error: error.message }
      return { count: (data || []).length, deals: data || [] }
    }

    case 'get_deal_detail': {
      const [dealRes, linksRes, interactionsRes, capitalRes, raisesRes] = await Promise.all([
        supabase.from('deals').select('*').eq('id', input.deal_id).single(),
        supabase.from('contact_deal_links').select('*, contact:contacts(first_name, last_name, firm, email, phone, contact_type)').eq('deal_id', input.deal_id),
        supabase.from('interactions').select('*').eq('deal_id', input.deal_id).order('interaction_date', { ascending: false }).limit(10),
        supabase.from('deal_capital_assignments').select('*, contact:contacts(first_name, last_name, firm)').eq('deal_id', input.deal_id),
        supabase.from('capital_raises').select('*, participants:raise_participants(firm_name, status, committed_amount)').eq('deal_id', input.deal_id),
      ])
      if (!dealRes.data) return { error: 'Deal not found' }
      return {
        deal: dealRes.data,
        contacts: linksRes.data || [],
        recent_interactions: interactionsRes.data || [],
        capital_assignments: capitalRes.data || [],
        capital_raises: raisesRes.data || [],
      }
    }

    case 'search_contacts': {
      let q = supabase.from('contacts').select('id, first_name, last_name, firm, title, email, phone, contact_type, notes, created_at').limit(20)
      if (input.query) q = q.or(`first_name.ilike.%${input.query}%,last_name.ilike.%${input.query}%,firm.ilike.%${input.query}%,email.ilike.%${input.query}%`)
      if (input.contact_type) q = q.eq('contact_type', input.contact_type)
      const { data } = await q.order('last_name')
      return data || []
    }

    case 'search_capital_contacts': {
      let q = supabase.from('capital_contacts').select('id, firm, firm_type, firm_focus, investment_pref, contact_name, title, email, phone, conf_lead, notes, status, source').limit(25)
      if (input.query) q = q.or(`firm.ilike.%${input.query}%,contact_name.ilike.%${input.query}%,notes.ilike.%${input.query}%,firm_type.ilike.%${input.query}%`)
      if (input.source) q = q.eq('source', input.source)
      if (input.status) q = q.eq('status', input.status)
      const { data } = await q.order('firm')
      return data || []
    }

    case 'get_capital_raises': {
      let q = supabase.from('capital_raises').select(`
        id, name, status, target_equity, target_debt, close_date, notes, created_at,
        deal:deals(id, company_name),
        participants:raise_participants(id, firm_name, contact_name, status, committed_amount, debt_amount, notes, pass_reason, teaser_date, nda_date, cim_date, first_call_date, term_sheet_date)
      `).order('created_at', { ascending: false })
      if (input.deal_name) q = q.ilike('name', `%${input.deal_name}%`)
      if (input.status) q = q.eq('status', input.status)
      const { data } = await q
      // Summarize committed amounts
      return (data || []).map((r: any) => ({
        ...r,
        total_committed: (r.participants || []).filter((p: any) => ['invested','confirmed'].includes(p.status)).reduce((s: number, p: any) => s + (p.committed_amount || p.debt_amount || 0), 0),
        participant_count: (r.participants || []).length,
      }))
    }

    case 'search_notes': {
      let q = supabase.from('notes').select(`
        id, note_date, summary, next_steps, sentiment, logged_by, source, raw_text,
        deal:deals(company_name), contact:contacts(first_name, last_name), raise:capital_raises(name)
      `).order('note_date', { ascending: false }).limit(25)
      if (input.query) q = q.or(`summary.ilike.%${input.query}%,raw_text.ilike.%${input.query}%,next_steps.ilike.%${input.query}%`)
      if (input.deal_id) q = q.eq('deal_id', input.deal_id)
      if (input.logged_by) q = q.ilike('logged_by', `%${input.logged_by}%`)
      if (input.source) q = q.eq('source', input.source)
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
        id, first_name, last_name, firm, email, investor_type, notes,
        investments:lp_investments(invested_amount, investment_date, portfolio_company:portfolio_companies(name)),
        entities:investment_entities(name, entity_type),
        commitments:lp_commitments(committed_amount, status)
      `).limit(20)
      if (input.query) q = q.or(`first_name.ilike.%${input.query}%,last_name.ilike.%${input.query}%,firm.ilike.%${input.query}%`)
      const { data } = await q.order('last_name')
      return (data || []).map((inv: any) => ({
        ...inv,
        total_invested: (inv.investments || []).reduce((s: number, i: any) => s + (i.invested_amount || 0), 0),
        total_committed: (inv.commitments || []).filter((c: any) => ['Committed','Funded'].includes(c.status)).reduce((s: number, c: any) => s + (c.committed_amount || 0), 0),
      }))
    }

    case 'web_search': {
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
        messages: [{ role: 'user', content: `Search for: ${input.query}. Return a concise factual summary with source names.` }],
      })
      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      return { result: text || 'No results found.' }
    }

    case 'get_calendar_events': {
      const today = new Date().toISOString().split('T')[0]
      const dateFrom = input.date_from || today
      const dateTo   = input.date_to   || (() => {
        const d = new Date(dateFrom); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]
      })()
      let q = supabase
        .from('calendar_events')
        .select('id, title, event_date, start_time, end_time, event_type, description, deal:deals(company_name), contact:contacts(first_name, last_name), portfolio_company:portfolio_companies(name)')
        .gte('event_date', dateFrom)
        .lte('event_date', dateTo)
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false })
        .limit(50)
      if (input.event_type) q = q.eq('event_type', input.event_type)
      if (input.query) q = q.or(`title.ilike.%${input.query}%,description.ilike.%${input.query}%`)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { count: (data || []).length, from: dateFrom, to: dateTo, events: data || [] }
    }

    case 'create_calendar_event': {
      const { data, error } = await supabase.from('calendar_events').insert({
        title:       input.title,
        event_date:  input.event_date,
        start_time:  input.start_time  || null,
        end_time:    input.end_time    || null,
        event_type:  input.event_type  || 'meeting',
        description: input.description || null,
        deal_id:     input.deal_id     || null,
        contact_id:  input.contact_id  || null,
      }).select().single()
      if (error) return { error: error.message }
      return { success: true, event_id: data?.id, message: `Calendar event "${input.title}" created for ${input.event_date}` }
    }

    case 'list_portco_files': {
      const { data: portco } = await supabase
        .from('portfolio_companies')
        .select('id, name, dropbox_path')
        .ilike('name', `%${input.company_name}%`)
        .single()
      if (!portco) return { error: `Portfolio company "${input.company_name}" not found` }
      const folderPath = input.subfolder || portco.dropbox_path
      if (!folderPath) return { error: `No Dropbox folder linked to ${portco.name}. Link it in the Portfolio section → Documents tab.` }
      const items = await dbxListFolder(folderPath)
      return { company: portco.name, folder: folderPath, items }
    }

    case 'list_deal_files': {
      // Look up the Dropbox path from the deal record
      const { data: deal } = await supabase.from('deals').select('company_name, dropbox_path').eq('id', input.deal_id).single()
      if (!deal) return { error: 'Deal not found' }
      const folderPath = input.subfolder || deal.dropbox_path
      if (!folderPath) return { error: `No Dropbox folder linked to ${deal.company_name}. The deal needs a dropbox_path set in Nexus.` }

      const items = await dbxListFolder(folderPath)
      return { company: deal.company_name, folder: folderPath, items }
    }

    case 'read_deal_file': {
      const { base64, name, ext: fileExt } = await dbxDownload(input.path)
      const isText = ['.txt', '.md', '.csv'].includes(fileExt)
      if (isText) {
        return { file: name, path: input.path, content: Buffer.from(base64, 'base64').toString('utf-8').slice(0, 20000) }
      }
      if (!['.pdf', '.xlsx', '.xls', '.docx'].includes(fileExt)) {
        return { error: `Cannot read file type: ${fileExt}` }
      }
      // Only PDFs work as base64 documents in Claude API
      if (fileExt !== '.pdf') {
        return { error: `File type ${fileExt} cannot be read directly. Ask the user to convert to PDF.` }
      }
      const extractResp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: `Extract and summarize the full content of this file "${name}". Include all key facts, figures, dates, parties, terms, and any other materially important information. Be comprehensive.` },
        ]}],
      })
      const extracted = extractResp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      return { file: name, path: input.path, content: extracted }
    }

    case 'list_files': {
      const items = await dbxListFolder(input.path || '')
      return { folder: input.path || 'root', items }
    }

    case 'read_file': {
      const { base64, name, ext: fileExt } = await dbxDownload(input.path)
      const isText = ['.txt', '.md', '.csv'].includes(fileExt)
      if (isText) {
        return { file: name, path: input.path, content: Buffer.from(base64, 'base64').toString('utf-8').slice(0, 20000) }
      }
      if (fileExt !== '.pdf') {
        return { error: `File type ${fileExt} cannot be read directly. Try a PDF or CSV version.` }
      }
      const extractResp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: `Extract and summarize the full content of this file "${name}". Include all key facts, figures, dates, parties, terms, and materially important information. Be comprehensive.` },
        ]}],
      })
      const extracted2 = extractResp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      return { file: name, path: input.path, content: extracted2 }
    }

    // ─── Write tools — only called after confirmation ─────────

    case 'update_deal_field': {
      if (!ALLOWED_DEAL_FIELDS.has(input.field)) return { error: `Field "${input.field}" is not editable` }
      let value: any = input.new_value
      if (['revenue','ebitda','asking_price'].includes(input.field)) {
        const n = parseFloat(String(value).replace(/[$,MmBb\s]/g, ''))
        if (isNaN(n)) return { error: 'Invalid number format' }
        value = n * 1_000_000
      }
      if (input.field === 'ev_ebitda_multiple') {
        value = parseFloat(String(value).replace(/x/gi, ''))
      }
      const extraUpdates: Record<string, any> = {}
      if (input.field === 'stage') {
        if (value === 'Closed (Platform)' || value === 'Closed (Add-On)') {
          extraUpdates.status = 'Closed'
        } else if (String(value).startsWith('Pass')) {
          extraUpdates.status = 'Dead'
        } else {
          extraUpdates.status = 'Active'
        }
      } else if (input.field === 'status') {
        if (value === 'Closed') {
          extraUpdates.stage = 'Closed (Platform)'
        } else if (value === 'Dead') {
          const { data: current } = await supabase.from('deals').select('stage').eq('id', input.deal_id).single()
          extraUpdates.stage = current?.stage?.startsWith('Pass') ? current.stage : 'Pass (Pre-LOI)'
        } else if (value === 'Active') {
          const { data: current } = await supabase.from('deals').select('stage').eq('id', input.deal_id).single()
          const s = current?.stage || ''
          extraUpdates.stage = (s.startsWith('Pass') || s.startsWith('Closed')) ? 'Reviewing' : s
        }
      }
      const { error } = await supabase.from('deals').update({ [input.field]: value, ...extraUpdates }).eq('id', input.deal_id)
      if (error) return { error: error.message }
      return { success: true, message: `Updated ${input.company_name} — ${input.field} set to ${input.new_value}${extraUpdates.status ? `, status set to ${extraUpdates.status}` : ''}` }
    }

    case 'update_contact_field': {
      if (!ALLOWED_CONTACT_FIELDS.has(input.field)) return { error: `Field "${input.field}" is not editable` }
      const { error } = await supabase.from('contacts').update({ [input.field]: input.new_value }).eq('id', input.contact_id)
      if (error) return { error: error.message }
      return { success: true, message: `Updated ${input.contact_name} — ${input.field} set to ${input.new_value}` }
    }

    case 'update_raise_participant': {
      if (!ALLOWED_PARTICIPANT_FIELDS.has(input.field)) return { error: `Field "${input.field}" is not editable` }
      let value: any = input.new_value
      if (['committed_amount','debt_amount'].includes(input.field)) {
        const n = parseFloat(String(value).replace(/[$,MmBb\s]/g, ''))
        if (isNaN(n)) return { error: 'Invalid number format' }
        value = n * 1_000_000
      }
      const { error } = await supabase.from('raise_participants').update({ [input.field]: value }).eq('id', input.participant_id)
      if (error) return { error: error.message }
      return { success: true, message: `Updated ${input.firm_name} — ${input.field} set to ${input.new_value}` }
    }

    case 'log_note': {
      const { data, error } = await supabase.from('notes').insert({
        summary: input.summary,
        raw_text: [input.summary, input.next_steps ? `Next steps: ${input.next_steps}` : ''].filter(Boolean).join('\n\n'),
        next_steps: input.next_steps || null,
        deal_id: input.deal_id || null,
        contact_id: input.contact_id || null,
        raise_id: input.raise_id || null,
        logged_by: input.logged_by || 'Assistant',
        source: 'manual',
        note_date: input.note_date || new Date().toISOString().split('T')[0],
      }).select().single()
      if (error) return { error: error.message }
      return { success: true, note_id: data?.id }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ─── Main handler ─────────────────────────────────────────────

const SYSTEM_PROMPT = () => `You are Nexus Assistant, an AI agent for Evolution Strategy Partners — a lower middle market PE firm in Austin/Dallas focused on infrastructure services ($3–7M EBITDA).

You have full access to Nexus (the firm's CRM) and the web. Always use tools for data — never fabricate numbers or names.

FIRM CONTEXT:
- Portfolio: commercial landscaping (Houston), underground utilities Texas (Allied), underground utilities Michigan (DiPonio), electrical contracting Carolinas (Amped), public works civil DFW (Coggins), fiber optics Raleigh
- Team: Ken Nguyen (Managing Partner), SS (Principal/Senior Associate)
- Deal-by-deal structure — raises equity and debt separately per deal

DEAL STAGES — use EXACTLY these strings:
Teaser | Reviewing | Pre-LOI | LOI Submitted | Exclusivity | Closed (Platform) | Closed (Add-On) | Pass (DOA) | Pass (Pre-LOI) | Pass (Post-LOI) | Hold

DEAL STATUS: Active | Dead | Closed | Passed

NEXUS SIDEBAR NAVIGATION — mention these links when directing a user to a section:
- /dashboard → Dashboard (deal funnel, recent activity)
- /pipeline → Pipeline (Kanban board, active deals only)
- /deals → Deals (full list, all stages, sortable/filterable)
- /intake → Teaser / CIM Intake (upload a PDF to auto-parse a new deal)
- /contacts → Contacts (all CRM contacts)
- /raises → Capital Raises
- /raises/contacts → Capital Contacts (LP/lender master list)
- /investors → Investors (LP commitments and investments)
- /portfolio → Portfolio Companies
- /calendar → Calendar (meetings, calls, deadlines)
- /notes → Notes (interaction log)
- /contacts/dupes → Contact Deduplication

RULES:
1. When counting or listing deals historically, search ALL statuses — never default to Active only
2. Use sourced_year filter (Salesforce close date) for "deals we looked at in [year]" questions — it is more accurate than created_at
3. For ambiguous company names, search first and confirm the match before updating
4. Always fetch the deal/contact ID via a read tool before calling any write tool
5. Write tools always go to confirmation — never execute them directly
6. For dollar amounts in tool calls, pass the number in millions as a plain string (e.g. "5.2" for $5.2M)
7. When presenting data, include counts. E.g. "Found 47 deals in 2025 (32 Dead, 12 Active, 3 Closed)"

Format responses cleanly: bold for key figures, bullet points for lists, tables where helpful. Be concise.

DROPBOX: The Evolution Strategy Dropbox root path is "/Ken Nguyen/Evolution Strategy Partners". Subfolders: Auditors, Bankers, Best Practices, Claude, Compliance, Consultants, Dealflow, Deals, Evolution Investments, Industry Data, Investors, Lenders, Marketing, Office, Portfolio Co's. Deal files are under "/Ken Nguyen/Evolution Strategy Partners/Deals/[Company Name]". Portfolio files are under "/Ken Nguyen/Evolution Strategy Partners/Portfolio Co's/[Company Name]". For portfolio company file questions, ALWAYS use list_portco_files first — it looks up the linked Dropbox path automatically. For deal file questions use list_deal_files. Only use list_files for general browsing. If Dropbox access fails, report what you already found in this session rather than saying you need to try again later.

Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { messages, confirming } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages array' }, { status: 400 })
    }

    const systemPrompt = SYSTEM_PROMPT()

    // ── Confirmation flow ──────────────────────────────────────
    if (confirming) {
      const result = await executeTool(confirming.tool_name, confirming.input)
      const continueMessages = [
        ...messages,
        { role: 'assistant', content: [{ type: 'tool_use', id: confirming.tool_use_id, name: confirming.tool_name, input: confirming.input }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: confirming.tool_use_id, content: JSON.stringify(result) }] },
      ]
      const finalResp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        tools: TOOLS,
        messages: continueMessages,
      })
      const text = finalResp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      return NextResponse.json({ type: 'text', content: text || (result.error ? `Error: ${result.error}` : 'Done.') })
    }

    // ── Agentic read loop ──────────────────────────────────────
    let currentMessages = [...messages]
    const MAX_ITER = 10

    for (let i = 0; i < MAX_ITER; i++) {
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        tools: TOOLS,
        messages: currentMessages,
      })

      if (resp.stop_reason === 'end_turn') {
        const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        return NextResponse.json({ type: 'text', content: text })
      }

      const toolUses = resp.content.filter((b: any) => b.type === 'tool_use')

      // Pause for any write tool
      const writeToolUse = toolUses.find((t: any) => WRITE_TOOLS.has(t.name)) as any
      if (writeToolUse) {
        const textSoFar = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        return NextResponse.json({
          type: 'confirmation',
          tool_use_id: writeToolUse.id,
          tool_name: writeToolUse.name,
          tool_input: writeToolUse.input,
          preview_text: textSoFar,
          messages_so_far: [...currentMessages, { role: 'assistant', content: resp.content }],
        })
      }

      if (toolUses.length === 0) {
        // No tools called, no end_turn — shouldn't happen but bail gracefully
        const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        return NextResponse.json({ type: 'text', content: text || 'No response generated.' })
      }

      // Execute read tools in parallel
      const toolResults = await Promise.all(
        toolUses.map(async (t: any) => {
          let content: string
          try {
            const result = await executeTool(t.name, t.input)
            content = JSON.stringify(result)
          } catch (err: any) {
            content = JSON.stringify({ error: err.message })
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: t.id,
            content,
          }
        })
      )

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: resp.content },
        { role: 'user', content: toolResults },
      ]
    }

    return NextResponse.json({ type: 'text', content: 'I reached my iteration limit. Try breaking the question into smaller parts.' })

  } catch (err: any) {
    console.error('Assistant error:', err)
    const msg = typeof err === 'string' ? err : err?.message || JSON.stringify(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
