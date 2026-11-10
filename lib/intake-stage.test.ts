// lib/intake-stage.test.ts
// Tests for the deterministic intake stage mapping in lib/intake-stage.ts.
//
// Context: on main, the stage itself is interpreted from the forwarding
// note by an LLM call (parseForwardingNote in app/api/notes/email/route.ts),
// so the note→stage interpretation is NOT unit-testable here. What is
// testable — and what this covers — is the deterministic mapping around it
// that the route used to inline in three places:
//   - stage → deal status (Pass* → Dead, Closed* → Closed, else Active)
//   - which stage wins when an existing deal, an instruction, or neither
//     is present
//   - the default stage for a deal with no instruction
// The parallel intake-improvements work owns note-text parsing; this module
// deliberately does not parse note text.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTAKE_STAGE,
  resolveDealStatus,
  resolveEffectiveStage,
  resolveIntakeStage,
  stageToStatus,
} from './intake-stage'

describe('stageToStatus', () => {
  it('maps every Pass stage to Dead', () => {
    expect(stageToStatus('Pass (DOA)')).toBe('Dead')
    expect(stageToStatus('Pass (Pre-LOI)')).toBe('Dead')
    expect(stageToStatus('Pass (Post-LOI)')).toBe('Dead')
  })

  it('maps every Closed stage to Closed', () => {
    expect(stageToStatus('Closed (Platform)')).toBe('Closed')
    expect(stageToStatus('Closed (Add-On)')).toBe('Closed')
  })

  it('maps every live pipeline stage to Active', () => {
    for (const stage of ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity', 'Hold']) {
      expect(stageToStatus(stage)).toBe('Active')
    }
  })

  it('defaults unknown stages to Active rather than failing', () => {
    expect(stageToStatus('Something New')).toBe('Active')
  })
})

describe('resolveDealStatus', () => {
  it('prefers an explicit valid status over the stage derivation', () => {
    // e.g. the forwarding-note interpretation explicitly said Dead
    expect(resolveDealStatus('Teaser', 'Dead')).toBe('Dead')
    expect(resolveDealStatus('Pass (DOA)', 'Active')).toBe('Active')
    expect(resolveDealStatus('Closed (Platform)', 'Closed')).toBe('Closed')
  })

  it('derives the status from the stage when none is given', () => {
    expect(resolveDealStatus('Pass (DOA)', null)).toBe('Dead')
    expect(resolveDealStatus('Pass (DOA)', undefined)).toBe('Dead')
    expect(resolveDealStatus('Closed (Add-On)', null)).toBe('Closed')
    expect(resolveDealStatus('Reviewing', null)).toBe('Active')
  })

  it('ignores a garbage explicit status and derives from the stage instead', () => {
    expect(resolveDealStatus('Pass (DOA)', 'banana')).toBe('Dead')
    expect(resolveDealStatus('Teaser', '')).toBe('Active')
  })
})

describe('resolveEffectiveStage', () => {
  it('keeps an existing deal’s stage over any instruction', () => {
    expect(resolveEffectiveStage('Reviewing', 'Pass (DOA)')).toBe('Reviewing')
  })

  it('uses the instructed stage when there is no existing deal', () => {
    expect(resolveEffectiveStage(null, 'Pass (DOA)')).toBe('Pass (DOA)')
    expect(resolveEffectiveStage(undefined, 'Hold')).toBe('Hold')
  })

  it('defaults to Teaser when neither source has a stage', () => {
    expect(resolveEffectiveStage(null, null)).toBe('Teaser')
    expect(resolveEffectiveStage(undefined, undefined)).toBe('Teaser')
    expect(resolveEffectiveStage(null, undefined)).toBe('Teaser')
  })
})

describe('resolveIntakeStage', () => {
  it('uses the instructed stage when present', () => {
    expect(resolveIntakeStage('LOI Submitted')).toBe('LOI Submitted')
    expect(resolveIntakeStage('Pass (DOA)')).toBe('Pass (DOA)')
  })

  it('defaults to Teaser for null, undefined, or an empty instruction', () => {
    expect(resolveIntakeStage(null)).toBe('Teaser')
    expect(resolveIntakeStage(undefined)).toBe('Teaser')
    expect(resolveIntakeStage('')).toBe('Teaser')
  })

  it('exposes the default as a named constant', () => {
    expect(DEFAULT_INTAKE_STAGE).toBe('Teaser')
  })
})
