// lib/schemas.ts
// Zod schemas for API request validation.
// Usage: const parsed = MySchema.safeParse(await req.json())
//        if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)

import { z } from 'zod'

// ── Interactions ──────────────────────────────────────────────────────────────

export const InteractionCreateSchema = z.object({
  deal_id:          z.string().uuid(),
  interaction_type: z.enum(['call','meeting','email','note','site visit','loi-submission','lender-call','stage-change','other']),
  summary:          z.string().min(1, 'Summary is required').max(10000),
  interaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  next_steps:       z.string().max(2000).optional().nullable(),
  raise_id:         z.string().uuid().optional().nullable(),
  contact_ids:      z.array(z.string().uuid()).optional(),
})

export const InteractionUpdateSchema = z.object({
  id:               z.string().uuid(),
  interaction_type: z.enum(['call','meeting','email','note','site visit','loi-submission','lender-call','stage-change','other']).optional(),
  summary:          z.string().min(1).max(10000).optional(),
  interaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  next_steps:       z.string().max(2000).optional().nullable(),
  raise_id:         z.string().uuid().optional().nullable(),
})

export const InteractionDeleteSchema = z.object({
  id: z.string().uuid(),
})

// ── Intake queue ──────────────────────────────────────────────────────────────

export const IntakeQueueActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  edited: z.object({
    company_name:      z.string().max(200).optional(),
    sector:            z.string().max(100).optional().nullable(),
    geography:         z.string().max(100).optional().nullable(),
    deal_type:         z.string().max(50).optional().nullable(),
    parent_portco:     z.string().max(200).optional().nullable(),  // portco name, not UUID
    stage:             z.enum([
      'Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity',
      'Closed (Platform)','Closed (Add-On)',
      'Pass (DOA)','Pass (Pre-LOI)','Pass (Post-LOI)','Hold',
    ]).optional(),
    revenue:           z.number().nonnegative().optional().nullable(),
    ebitda:            z.number().optional().nullable(),
    description:       z.string().max(5000).optional().nullable(),
    financial_summary: z.string().max(5000).optional().nullable(),
    // Note-append queue items: the contact the note should be filed under,
    // picked by the reviewer from the candidates shown in the intake UI.
    contact_id:        z.string().uuid().optional(),
  }).optional(),
})

// ── Notes ─────────────────────────────────────────────────────────────────────

export const NoteCreateSchema = z.object({
  note_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  raw_text:             z.string().min(1, 'Note text is required').max(20000),
  summary:              z.string().max(10000).optional().nullable(),
  next_steps:           z.string().max(2000).optional().nullable(),
  logged_by:            z.string().max(200).optional().nullable(),
  source:               z.string().max(50).optional(),
  deal_id:              z.string().uuid().optional().nullable(),
  contact_id:           z.string().uuid().optional().nullable(),
  portfolio_company_id: z.string().uuid().optional().nullable(),
  raise_id:             z.string().uuid().optional().nullable(),
  capital_contact_id:   z.string().uuid().optional().nullable(),
})

// ── Deals ─────────────────────────────────────────────────────────────────────

export const DealUpdateSchema = z.object({
  company_name:      z.string().min(1).max(200).optional(),
  sector:            z.string().max(100).optional().nullable(),
  geography:         z.string().max(100).optional().nullable(),
  deal_type:         z.string().max(50).optional().nullable(),
  stage:             z.string().max(50).optional(),
  status:            z.enum(['Active','Dead','Closed','Passed']).optional(),
  revenue:           z.number().nonnegative().optional().nullable(),
  ebitda:            z.number().optional().nullable(),
  asking_price:      z.number().nonnegative().optional().nullable(),
  description:       z.string().max(5000).optional().nullable(),
  financial_summary: z.string().max(5000).optional().nullable(),
  expected_close:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
}).strict()

// NOTE: DealUpdateSchema has no API route to wire into yet — deal edits are
// made client-side via Supabase directly (app/deals/[id]/page.tsx,
// app/intake/page.tsx, app/pipeline/page.tsx). If a PATCH /api/deals/[id]
// route is ever added, validate its body with this schema first.

// ── Notes ───────────────────────────────────────────────────────────────────
export const NoteUpdateSchema = z.object({
  id:                 z.string().uuid(),
  note_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  raw_text:           z.string().min(1).max(50000).optional(),
  summary:            z.string().max(10000).optional().nullable(),
  next_steps:         z.string().max(2000).optional().nullable(),
  logged_by:          z.string().max(200).optional().nullable(),
  deal_id:            z.string().uuid().optional().nullable(),
  contact_id:         z.string().uuid().optional().nullable(),
  capital_contact_id: z.string().uuid().optional().nullable(),
})

// ── Assistant (web chat) ────────────────────────────────────────────────────
export const AssistantRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.union([z.string(), z.array(z.object({}).passthrough())]),
  }).passthrough()).min(1, 'messages must not be empty').max(100),
  confirming: z.object({
    tool_name: z.string().min(1),
    tool_use_id: z.string().min(1),
    input: z.object({}).passthrough(),
  }).passthrough().optional(),
})

// ── Deal research (Claude + web search) ─────────────────────────────────────
const DealResearchBaseSchema = z.object({
  company_name: z.string().max(200).optional(),
  sector:       z.string().max(100).optional(),
  geography:    z.string().max(100).optional(),
  deal_type:    z.string().max(50).optional(),
  parent_portco: z.string().max(200).optional().nullable(),
})

export const DealCompsSchema = DealResearchBaseSchema.extend({
  ebitda:  z.number().nonnegative().optional().nullable(),
  revenue: z.number().nonnegative().optional().nullable(),
}).refine(d => d.sector || d.company_name, {
  message: 'Need at least sector or company name',
})

export const DealNewsSchema = DealResearchBaseSchema.refine(d => d.sector || d.company_name, {
  message: 'Need at least sector or company name',
})

// ── Share CIM ───────────────────────────────────────────────────────────────
export const ShareCimSchema = z.object({
  action: z.enum(['preview', 'send']),
  company_name: z.string().max(200).optional(),
  sector: z.string().max(100).optional().nullable(),
  geography: z.string().max(100).optional().nullable(),
  revenue: z.number().nonnegative().optional().nullable(),
  ebitda: z.number().optional().nullable(),
  description: z.string().max(10000).optional().nullable(),
  cim_summary: z.string().max(50000).optional().nullable(),
  financial_summary: z.string().max(50000).optional().nullable(),
  historical_financials: z.array(z.object({}).passthrough()).optional().nullable(),
  customer_concentration: z.string().max(5000).optional().nullable(),
  employee_count: z.number().int().nonnegative().optional().nullable(),
  key_risks: z.string().max(10000).optional().nullable(),
  growth_opportunities: z.string().max(10000).optional().nullable(),
  management_team: z.string().max(10000).optional().nullable(),
  banker_name: z.string().max(200).optional().nullable(),
  banker_firm: z.string().max(200).optional().nullable(),
  deal_type: z.string().max(50).optional().nullable(),
  asking_price: z.number().nonnegative().optional().nullable(),
  asking_multiple: z.number().nonnegative().optional().nullable(),
  summary: z.string().min(1).max(50000).optional(),
  recipients: z.array(z.string().email()).min(1).optional(),
  dropbox_folder: z.string().max(500).optional().nullable(),
}).refine(d => d.action === 'preview' || (d.summary && d.recipients?.length), {
  message: 'summary and recipients are required',
})

// ── Deal notification ───────────────────────────────────────────────────────
export const DealNotifySchema = z.object({
  companyName: z.string().min(1).max(200),
  stage: z.string().min(1).max(50),
  status: z.string().max(50).optional().nullable(),
  sector: z.string().max(100).optional().nullable(),
  geography: z.string().max(100).optional().nullable(),
  revenue: z.number().nonnegative().optional().nullable(),
  ebitda: z.number().optional().nullable(),
  askingPrice: z.number().nonnegative().optional().nullable(),
  askingMultiple: z.number().nonnegative().optional().nullable(),
  description: z.string().max(10000).optional().nullable(),
  banker: z.string().max(200).optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  isPending: z.boolean().optional(),
  loiDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

// ── Digest ──────────────────────────────────────────────────────────────────
export const DigestGenerateSchema = z.object({
  deals: z.array(z.object({}).passthrough()),
})

export const DiscordSendSchema = z.object({
  content: z.string().min(1, 'content is required').max(4000),
})

// ── Dropbox ─────────────────────────────────────────────────────────────────
export const DropboxUploadSchema = z.object({
  path: z.string().min(1).max(500),
  name: z.string().min(1).max(255),
  base64: z.string().optional(),
  storagePath: z.string().max(500).optional(),
}).refine(d => d.base64 || d.storagePath, {
  message: 'path, name, and base64 or storagePath required',
})

export const DropboxMoveSchema = z.object({
  from_path: z.string().min(1).max(500),
  to_path: z.string().min(1).max(500),
})

// ── Intake ──────────────────────────────────────────────────────────────────
export const IntakeParseSchema = z.object({
  storagePath: z.string().max(500).optional(),
  fileName: z.string().max(255).optional(),
  text: z.string().max(500000).optional(),
  deal_type: z.string().max(50).optional(),
  parent_portco: z.string().max(200).optional().nullable(),
}).refine(d => d.storagePath || d.text?.trim(), {
  message: 'No file or text provided',
})

export const IntakeUploadUrlSchema = z.object({
  fileName: z.string().min(1, 'fileName is required').max(255),
})

// ── Weekly pipeline email ───────────────────────────────────────────────────
export const WeeklyEmailRecipientsSchema = z.object({
  recipients: z.array(z.string().email()).min(1, 'recipients must not be empty'),
})

// ── Portfolio ───────────────────────────────────────────────────────────────
export const PortfolioAnalyzeSchema = z.object({
  company: z.string().min(1, 'company is required').max(200),
  sector: z.string().max(100).optional().nullable(),
  financials: z.array(z.object({}).passthrough()).optional(),
})

export const PortfolioParseSchema = z.object({
  base64: z.string().optional(),
  fileName: z.string().max(255).optional(),
  companyName: z.string().max(200).optional(),
  csvText: z.string().max(200000).optional(),
}).refine(d => d.base64 || d.csvText, {
  message: 'No file content provided',
})

// ── Constant Contact ────────────────────────────────────────────────────────
export const ConstantContactSyncSchema = z.object({
  id: z.string().max(100).optional(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  firm: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
}).refine(d => d.email || d.first_name, {
  message: 'email or first_name required',
})

export const ConstantContactListSchema = z.object({
  list_id: z.string().min(1, 'list_id is required').max(100),
})

// ── NDA / CIM analysis (multipart form-data — validate the text fields) ─────
export const CimAnalyzeSchema = z.object({
  deal_id: z.string().uuid('deal_id must be a valid UUID'),
  company_name: z.string().max(200).optional(),
})

export const NdaAnalyzeSchema = z.object({
  deal_id: z.string().uuid('deal_id must be a valid UUID').optional(),
  company_name: z.string().max(200).optional(),
})

export const NdaStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['reviewing', 'negotiating', 'executed', 'declined']),
})
