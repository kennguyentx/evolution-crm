// lib/api-response.ts
// Standardised API response helpers.
// Usage:
//   return apiError('Not found', 404)
//   return apiOk({ deal })
//   export const GET = withErrorHandler(async (req) => { ... })

import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/log'

const log = createLogger('api')

export function apiError(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

/**
 * Second argument Next.js passes to a route handler. In the App Router
 * (Next 14) dynamic route params arrive as a plain record; in Next 15 the
 * same shape is delivered as a Promise, so handlers should `await ctx.params`
 * — awaiting a non-Promise value is a no-op, which keeps this type correct
 * for both.
 */
export interface RouteContext {
  params: Record<string, string | string[]> | Promise<Record<string, string | string[]>>
}

type RouteHandler<C = RouteContext> = (req: NextRequest, ctx: C) => Promise<NextResponse | Response>

/**
 * Wraps a route handler so any unhandled throw becomes a structured JSON 500
 * instead of an empty response or HTML error page.
 */
export function withErrorHandler<C = RouteContext>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error'
      log.error('request failed', { method: req.method, path: req.nextUrl?.pathname, message, error: err })
      return apiError(message)
    }
  }
}
