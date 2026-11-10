// lib/cron-auth.ts
// Authorizes cron/automation requests to our scheduled endpoints.
//
// We accept the CRON_SECRET three ways because Vercel's Deployment Protection
// layer STRIPS the `Authorization` header (it reserves it for its own SSO
// bypass), so a Bearer token never reaches the handler on protected projects.
// Query param and custom headers pass through untouched — those are what the
// GitHub Actions workflows use.

import type { NextRequest } from 'next/server'

export interface CronSecretCarriers {
  /** Value of the `cron_secret` query param, if present. */
  fromQuery?: string | null
  /** Value of the `x-cron-secret` header, if present. */
  fromHeader?: string | null
  /** Value of the `Authorization` header, if present. */
  fromAuth?: string | null
}

/**
 * Pure three-way CRON_SECRET check: the secret matches if it arrives via
 * the query param, the `x-cron-secret` header, or a `Bearer …`
 * Authorization header. No secret configured (or an empty one) never
 * authorizes. Extracted from isAuthorizedCron so the logic is unit-testable
 * without a NextRequest.
 */
export function matchesCronSecret(carriers: CronSecretCarriers, secret?: string | null): boolean {
  if (!secret) return false
  return (
    carriers.fromQuery === secret ||
    carriers.fromHeader === secret ||
    carriers.fromAuth === `Bearer ${secret}`
  )
}

export function isAuthorizedCron(req: NextRequest): boolean {
  return matchesCronSecret(
    {
      fromQuery: req.nextUrl.searchParams.get('cron_secret'),
      fromHeader: req.headers.get('x-cron-secret'),
      fromAuth: req.headers.get('authorization'),
    },
    process.env.CRON_SECRET,
  )
}
