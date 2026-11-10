// lib/digest-schedule.test.ts
// Tests for the 07:00 America/Chicago gate in lib/digest-schedule.ts.
// vercel.json fires the digest at both 12:00 and 13:00 UTC; these cases pin
// which firing is 7am in Chicago across CST, CDT, and both 2026 DST
// transition days, so the digest stays at 7am CT year-round.

import { describe, expect, it } from 'vitest'
import { chicagoHour, isDigestHourInChicago } from './digest-schedule'

describe('isDigestHourInChicago — CST (winter, UTC−6)', () => {
  it('13:00 UTC is 07:00 CST — the 13:00 firing sends', () => {
    expect(isDigestHourInChicago(new Date('2026-01-15T13:00:00Z'))).toBe(true)
  })

  it('the whole 7am hour counts (13:59 UTC)', () => {
    expect(isDigestHourInChicago(new Date('2026-01-15T13:59:00Z'))).toBe(true)
  })

  it('12:00 UTC is 06:00 CST — the 12:00 firing skips', () => {
    expect(isDigestHourInChicago(new Date('2026-01-15T12:00:00Z'))).toBe(false)
  })

  it('14:00 UTC is 08:00 CST — skips', () => {
    expect(isDigestHourInChicago(new Date('2026-01-15T14:00:00Z'))).toBe(false)
  })
})

describe('isDigestHourInChicago — CDT (summer, UTC−5)', () => {
  it('12:00 UTC is 07:00 CDT — the 12:00 firing sends', () => {
    expect(isDigestHourInChicago(new Date('2026-07-15T12:00:00Z'))).toBe(true)
  })

  it('the whole 7am hour counts (12:59 UTC)', () => {
    expect(isDigestHourInChicago(new Date('2026-07-15T12:59:00Z'))).toBe(true)
  })

  it('13:00 UTC is 08:00 CDT — the 13:00 firing skips', () => {
    expect(isDigestHourInChicago(new Date('2026-07-15T13:00:00Z'))).toBe(false)
  })

  it('11:00 UTC is 06:00 CDT — skips', () => {
    expect(isDigestHourInChicago(new Date('2026-07-15T11:00:00Z'))).toBe(false)
  })
})

describe('isDigestHourInChicago — DST transition days (2026)', () => {
  it('spring forward (Mar 8): 12:00 UTC is already 07:00 CDT', () => {
    expect(isDigestHourInChicago(new Date('2026-03-08T12:00:00Z'))).toBe(true)
    expect(isDigestHourInChicago(new Date('2026-03-08T13:00:00Z'))).toBe(false)
  })

  it('fall back (Nov 1): 13:00 UTC is 07:00 CST again', () => {
    expect(isDigestHourInChicago(new Date('2026-11-01T13:00:00Z'))).toBe(true)
    expect(isDigestHourInChicago(new Date('2026-11-01T12:00:00Z'))).toBe(false)
  })
})

describe('chicagoHour', () => {
  it('reports midnight as 0, not 24', () => {
    expect(chicagoHour(new Date('2026-01-15T06:00:00Z'))).toBe(0)
  })

  it('reports the Chicago hour, not the UTC hour', () => {
    expect(chicagoHour(new Date('2026-07-15T12:00:00Z'))).toBe(7)
    expect(chicagoHour(new Date('2026-01-15T12:00:00Z'))).toBe(6)
  })
})
