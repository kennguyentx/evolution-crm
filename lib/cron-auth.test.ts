// lib/cron-auth.test.ts
// Tests for the cron three-way CRON_SECRET check in lib/cron-auth.ts.
// The check accepts the secret via query param, `x-cron-secret` header, or
// Bearer Authorization header — because Vercel's Deployment Protection
// strips the Authorization header, the first two are what GitHub Actions
// actually relies on.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { isAuthorizedCron, matchesCronSecret } from './cron-auth'

const SECRET = 's3cret-value'

describe('matchesCronSecret (pure three-way check)', () => {
  it('accepts the secret via the cron_secret query param', () => {
    expect(matchesCronSecret({ fromQuery: SECRET }, SECRET)).toBe(true)
  })

  it('accepts the secret via the x-cron-secret header', () => {
    expect(matchesCronSecret({ fromHeader: SECRET }, SECRET)).toBe(true)
  })

  it('accepts the secret as a Bearer Authorization header', () => {
    expect(matchesCronSecret({ fromAuth: `Bearer ${SECRET}` }, SECRET)).toBe(true)
  })

  it('accepts when any one carrier matches, even if the others are wrong', () => {
    expect(matchesCronSecret(
      { fromQuery: 'wrong', fromHeader: SECRET, fromAuth: 'Bearer wrong' },
      SECRET,
    )).toBe(true)
  })

  it('rejects when no carrier carries the secret', () => {
    expect(matchesCronSecret({}, SECRET)).toBe(false)
    expect(matchesCronSecret(
      { fromQuery: 'wrong', fromHeader: 'wrong', fromAuth: 'Bearer wrong' },
      SECRET,
    )).toBe(false)
  })

  it('rejects a bare secret in the Authorization header (must be Bearer)', () => {
    expect(matchesCronSecret({ fromAuth: SECRET }, SECRET)).toBe(false)
  })

  it('rejects a Bearer token with extra whitespace or a different scheme', () => {
    expect(matchesCronSecret({ fromAuth: `Bearer  ${SECRET}` }, SECRET)).toBe(false)
    expect(matchesCronSecret({ fromAuth: `Basic ${SECRET}` }, SECRET)).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(matchesCronSecret({ fromQuery: SECRET.toUpperCase() }, SECRET)).toBe(false)
  })

  it('never authorizes when no secret is configured', () => {
    expect(matchesCronSecret({ fromQuery: SECRET }, undefined)).toBe(false)
    expect(matchesCronSecret({ fromQuery: SECRET }, null)).toBe(false)
    expect(matchesCronSecret({ fromQuery: SECRET }, '')).toBe(false)
    expect(matchesCronSecret({ fromQuery: '' }, '')).toBe(false)
  })
})

describe('isAuthorizedCron (NextRequest wrapper)', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  function req(url: string, headers?: Record<string, string>): NextRequest {
    return new NextRequest(url, headers ? { headers } : undefined)
  }

  it('authorizes via the cron_secret query param', () => {
    expect(isAuthorizedCron(req(`http://localhost/api/digest?cron_secret=${SECRET}`))).toBe(true)
  })

  it('authorizes via the x-cron-secret header', () => {
    expect(isAuthorizedCron(req('http://localhost/api/digest', {
      'x-cron-secret': SECRET,
    }))).toBe(true)
  })

  it('authorizes via a Bearer Authorization header', () => {
    expect(isAuthorizedCron(req('http://localhost/api/digest', {
      authorization: `Bearer ${SECRET}`,
    }))).toBe(true)
  })

  it('rejects a request with no secret anywhere', () => {
    expect(isAuthorizedCron(req('http://localhost/api/digest'))).toBe(false)
  })

  it('rejects a request with the wrong secret', () => {
    expect(isAuthorizedCron(req('http://localhost/api/digest?cron_secret=nope'))).toBe(false)
  })

  it('rejects everything when CRON_SECRET is not configured', () => {
    delete process.env.CRON_SECRET
    expect(isAuthorizedCron(req(`http://localhost/api/digest?cron_secret=${SECRET}`))).toBe(false)
    expect(isAuthorizedCron(req('http://localhost/api/digest', {
      'x-cron-secret': SECRET,
    }))).toBe(false)
  })
})
