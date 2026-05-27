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
})

// ── Intake queue ──────────────────────────────────────────────────────────────

export const IntakeQueueActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  edited: z.object({
    company_name:      z.string().max(200).optional(),
    sector:            z.string().max(100).optional().nullable(),
    geography:         z.string().max(100).optional().nullable(),
    deal_type:         z.string().max(50).optional().nullable(),
    parent_portco:     z.string().uuid().optional().nullable(),
    revenue:           z.number().nonnegative().optional().nullable(),
    ebitda:            z.number().optional().nullable(),
    description:       z.string().max(5000).optional().nullable(),
    financial_summary: z.string().max(5000).optional().nullable(),
  }).optional(),
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
