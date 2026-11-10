// lib/schemas.test.ts
// Tests for the Zod request-validation schemas in lib/schemas.ts.
// These schemas guard every write endpoint, so a bad one either rejects
// legitimate requests or lets malformed data into the database.

import { describe, expect, it } from 'vitest'
import {
  DealUpdateSchema,
  IntakeQueueActionSchema,
  InteractionCreateSchema,
  InteractionUpdateSchema,
} from './schemas'

const UUID = '123e4567-e89b-12d3-a456-426614174000'
const UUID2 = '123e4567-e89b-12d3-a456-426614174001'

describe('InteractionCreateSchema', () => {
  it('accepts a minimal valid interaction', () => {
    const parsed = InteractionCreateSchema.safeParse({
      deal_id: UUID,
      interaction_type: 'call',
      summary: 'Spoke with the banker.',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts every interaction_type', () => {
    for (const interaction_type of [
      'call', 'meeting', 'email', 'note', 'site visit',
      'loi-submission', 'lender-call', 'stage-change', 'other',
    ]) {
      const parsed = InteractionCreateSchema.safeParse({
        deal_id: UUID,
        interaction_type,
        summary: 'x',
      })
      expect(parsed.success).toBe(true)
    }
  })

  it('accepts the full optional set, including nulls', () => {
    const parsed = InteractionCreateSchema.safeParse({
      deal_id: UUID,
      interaction_type: 'meeting',
      summary: 'On-site visit.',
      interaction_date: '2026-11-10',
      next_steps: 'Send follow-up.',
      raise_id: UUID2,
      contact_ids: [UUID, UUID2],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.next_steps).toBe('Send follow-up.')
  })

  it('accepts null for the nullable optionals', () => {
    const parsed = InteractionCreateSchema.safeParse({
      deal_id: UUID,
      interaction_type: 'email',
      summary: 'x',
      next_steps: null,
      raise_id: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a non-UUID deal_id', () => {
    expect(InteractionCreateSchema.safeParse({
      deal_id: 'not-a-uuid',
      interaction_type: 'call',
      summary: 'x',
    }).success).toBe(false)
  })

  it('rejects an unknown interaction_type', () => {
    expect(InteractionCreateSchema.safeParse({
      deal_id: UUID,
      interaction_type: 'carrier-pigeon',
      summary: 'x',
    }).success).toBe(false)
  })

  it('rejects an empty summary and one over 10,000 chars', () => {
    const base = { deal_id: UUID, interaction_type: 'call' }
    expect(InteractionCreateSchema.safeParse({ ...base, summary: '' }).success).toBe(false)
    expect(InteractionCreateSchema.safeParse({ ...base, summary: 'x'.repeat(10001) }).success).toBe(false)
    expect(InteractionCreateSchema.safeParse({ ...base, summary: 'x'.repeat(10000) }).success).toBe(true)
  })

  it('rejects a malformed interaction_date', () => {
    expect(InteractionCreateSchema.safeParse({
      deal_id: UUID,
      interaction_type: 'call',
      summary: 'x',
      interaction_date: '11/10/2026',
    }).success).toBe(false)
    expect(InteractionCreateSchema.safeParse({
      deal_id: UUID,
      interaction_type: 'call',
      summary: 'x',
      interaction_date: '2026-11-10',
    }).success).toBe(true)
  })

  it('rejects next_steps over 2,000 chars and a non-UUID contact_id', () => {
    const base = { deal_id: UUID, interaction_type: 'call', summary: 'x' }
    expect(InteractionCreateSchema.safeParse({ ...base, next_steps: 'x'.repeat(2001) }).success).toBe(false)
    expect(InteractionCreateSchema.safeParse({ ...base, contact_ids: ['nope'] }).success).toBe(false)
  })

  it('rejects a missing required field', () => {
    expect(InteractionCreateSchema.safeParse({
      interaction_type: 'call',
      summary: 'x',
    }).success).toBe(false)
  })
})

describe('InteractionUpdateSchema', () => {
  it('accepts just an id (everything else is optional)', () => {
    expect(InteractionUpdateSchema.safeParse({ id: UUID }).success).toBe(true)
  })

  it('accepts a partial update', () => {
    const parsed = InteractionUpdateSchema.safeParse({
      id: UUID,
      summary: 'Updated notes.',
      interaction_date: '2026-11-09',
      next_steps: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a non-UUID id, an empty summary, and a bad date', () => {
    expect(InteractionUpdateSchema.safeParse({ id: 'x' }).success).toBe(false)
    expect(InteractionUpdateSchema.safeParse({ id: UUID, summary: '' }).success).toBe(false)
    expect(InteractionUpdateSchema.safeParse({ id: UUID, interaction_date: 'Nov 9' }).success).toBe(false)
  })
})

describe('IntakeQueueActionSchema', () => {
  it('accepts approve and reject with no edits', () => {
    expect(IntakeQueueActionSchema.safeParse({ action: 'approve' }).success).toBe(true)
    expect(IntakeQueueActionSchema.safeParse({ action: 'reject' }).success).toBe(true)
  })

  it('accepts a full edit payload', () => {
    const parsed = IntakeQueueActionSchema.safeParse({
      action: 'approve',
      edited: {
        company_name: 'Acme Utilities',
        sector: 'Underground Utilities',
        geography: 'Texas',
        deal_type: 'add-on',
        parent_portco: 'Amped',
        stage: 'Teaser',
        revenue: 4_200_000,
        ebitda: 600_000,
        description: 'Directional boring contractor.',
        financial_summary: 'Revenue $4.2M, EBITDA $0.6M.',
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts every stage in the enum', () => {
    for (const stage of [
      'Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity',
      'Closed (Platform)', 'Closed (Add-On)',
      'Pass (DOA)', 'Pass (Pre-LOI)', 'Pass (Post-LOI)', 'Hold',
    ]) {
      expect(IntakeQueueActionSchema.safeParse({
        action: 'approve',
        edited: { stage },
      }).success).toBe(true)
    }
  })

  it('accepts null for the nullable edit fields', () => {
    expect(IntakeQueueActionSchema.safeParse({
      action: 'approve',
      edited: { sector: null, revenue: null, parent_portco: null },
    }).success).toBe(true)
  })

  it('rejects an unknown action, an unknown stage, and negative revenue', () => {
    expect(IntakeQueueActionSchema.safeParse({ action: 'maybe' }).success).toBe(false)
    expect(IntakeQueueActionSchema.safeParse({
      action: 'approve',
      edited: { stage: 'Diligence' },
    }).success).toBe(false)
    expect(IntakeQueueActionSchema.safeParse({
      action: 'approve',
      edited: { revenue: -1 },
    }).success).toBe(false)
  })

  it('rejects an over-long company_name', () => {
    expect(IntakeQueueActionSchema.safeParse({
      action: 'approve',
      edited: { company_name: 'x'.repeat(201) },
    }).success).toBe(false)
  })
})

describe('DealUpdateSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(DealUpdateSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a full valid update', () => {
    const parsed = DealUpdateSchema.safeParse({
      company_name: 'Acme Utilities',
      sector: 'Underground Utilities',
      geography: 'Texas',
      deal_type: 'platform',
      stage: 'Reviewing',
      status: 'Active',
      revenue: 4_200_000,
      ebitda: null,
      asking_price: 10_000_000,
      description: 'd',
      financial_summary: null,
      expected_close: '2027-03-31',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts every status value', () => {
    for (const status of ['Active', 'Dead', 'Closed', 'Passed']) {
      expect(DealUpdateSchema.safeParse({ status }).success).toBe(true)
    }
  })

  it('rejects unknown keys — the schema is .strict()', () => {
    expect(DealUpdateSchema.safeParse({ company_name: 'Acme', dropbox_path: '/x' }).success).toBe(false)
  })

  it('rejects negative money, an empty company_name, and a bad status', () => {
    expect(DealUpdateSchema.safeParse({ revenue: -1 }).success).toBe(false)
    expect(DealUpdateSchema.safeParse({ asking_price: -100 }).success).toBe(false)
    expect(DealUpdateSchema.safeParse({ company_name: '' }).success).toBe(false)
    expect(DealUpdateSchema.safeParse({ status: 'Zombie' }).success).toBe(false)
  })

  it('rejects an over-long stage and a malformed expected_close', () => {
    expect(DealUpdateSchema.safeParse({ stage: 'x'.repeat(51) }).success).toBe(false)
    expect(DealUpdateSchema.safeParse({ expected_close: '03/31/2027' }).success).toBe(false)
    expect(DealUpdateSchema.safeParse({ expected_close: '2027-03-31' }).success).toBe(true)
    expect(DealUpdateSchema.safeParse({ expected_close: null }).success).toBe(true)
  })
})
