export type DealStage =
  | 'Teaser'
  | 'Reviewing'
  | 'Pre-LOI'
  | 'LOI Submitted'
  | 'Exclusivity'
  | 'Closed (Platform)'
  | 'Closed (Add-On)'
  | 'Pass (DOA)'
  | 'Pass (Pre-LOI)'
  | 'Pass (Post-LOI)'
  | 'Hold'

export type DealStatus = 'Active' | 'Dead' | 'Closed' | 'Passed'

export type ContactType = 'banker' | 'lp' | 'lender' | 'advisor' | 'management' | 'other'

export type InteractionType = 'call' | 'email' | 'meeting' | 'note' | 'site visit' | 'loi-submission' | 'lender-call' | 'other'

export interface Deal {
  id: string
  created_at: string
  updated_at: string
  company_name: string
  sector?: string
  geography?: string
  description?: string
  revenue?: number
  ebitda?: number
  asking_price?: number
  ev_ebitda_multiple?: number
  deal_type?: string
  debt_structure?: string
  equity_structure?: string
  target_leverage?: string
  stage: DealStage
  status: DealStatus
  loi_date?: string
  expected_close?: string
  sourced_date?: string
  source_type?: string
  source_notes?: string
  cim_parsed?: boolean
  cim_summary?: string
  notes?: string
  pass_reason?: string
  parent_company_id?: string | null
  dropbox_path?: string | null
}

export interface Contact {
  id: string
  created_at: string
  updated_at: string
  first_name: string
  last_name: string
  email?: string
  phone?: string
  title?: string
  firm?: string
  contact_type: ContactType
  sub_type?: string
  relationship_strength?: string
  notes?: string
  primary_deal_id?: string
}

export interface Interaction {
  id: string
  created_at: string
  contact_id: string
  deal_id?: string
  raise_id?: string
  interaction_type?: InteractionType
  interaction_date: string
  summary?: string
  next_steps?: string
  logged_by?: string
  contact?: Contact
  deal?: Deal
  raise?: { id: string; name: string }
}

export interface DiligenceItem {
  id: string
  deal_id: string
  category?: string
  item: string
  status: 'Pending' | 'In Progress' | 'Complete' | 'Waived'
  owner?: string
  due_date?: string
  notes?: string
}

export interface DealCapitalAssignment {
  id: string
  deal_id: string
  contact_id: string
  role: string
  committed_amount?: number
  status: string
  notes?: string
  contact?: Contact
}

export interface ContactDealLink {
  id: string
  contact_id: string
  deal_id: string
  role?: string
  contact?: Contact
  deal?: Deal
}

// Formatting helpers
export function formatCurrency(value?: number | null): string {
  if (!value) return '—'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

export function formatCurrencyFull(value?: number | null): string {
  if (!value) return '—'
  return `$${Math.round(value).toLocaleString('en-US')}`
}

export function formatMultiple(value?: number | null): string {
  if (!value) return '—'
  return `${value.toFixed(1)}x`
}

export function stageClass(stage: string): string {
  return `stage-${stage.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
}

export function contactTypeClass(type: string): string {
  return `type-${type.toLowerCase()}`
}

// Database types placeholder (full type gen from Supabase CLI in production)
export type Database = any
