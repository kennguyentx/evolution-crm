// lib/cron-auth.ts
// Authorizes cron/automation requests to our scheduled endpoints.
//
// We accept the CRON_SECRET three ways because Vercel's Deployment Protection
// layer STRIPS the `Authorization` header (it reserves it for its own SSO
// bypass), so a Bearer token never reaches the handler on protected projects.
// Query param and custom headers pass through untouched — those are what the
// GitHub Actions workflows use.

import type { NextRequest } from 'next/server'

export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const fromQuery  = req.nextUrl.searchParams.get('cron_secret')
  const fromHeader = req.headers.get('x-cron-secret')
  const fromAuth   = req.headers.get('authorization')

  return (
    fromQuery === secret ||
    fromHeader === secret ||
    fromAuth === `Bearer ${secret}`
  )
}
