// lib/api-response.ts
// Standardised API response helpers.
// Usage:
//   return apiError('Not found', 404)
//   return apiOk({ deal })
//   export const GET = withErrorHandler(async (req) => { ... })

import { NextRequest, NextResponse } from 'next/server'

export function apiError(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

type RouteHandler = (req: NextRequest, ctx: any) => Promise<NextResponse>

/**
 * Wraps a route handler so any unhandled throw becomes a structured JSON 500
 * instead of an empty response or HTML error page.
 */
export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err: any) {
      const message = err?.message ?? 'Internal server error'
      console.error('[api]', req.method, req.nextUrl?.pathname, message, err?.stack)
      return apiError(message)
    }
  }
}
