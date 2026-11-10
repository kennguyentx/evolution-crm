// lib/rate-limit.ts
// Tiny in-memory fixed-window rate limiter for the unauthenticated and
// AI-cost endpoints (email webhook, assistant, CIM/NDA analysis).
// No external service, no credentials — state lives per serverless instance,
// so on Vercel this is a best-effort per-instance cap, not a global one.
// That is enough to stop a leaked webhook token or a retry loop from burning
// Anthropic spend unchecked; a distributed limiter (e.g. Upstash) would be
// the upgrade if the app ever needs exact global counts.
//
// Usage:
//   const result = checkRateLimit(`assistant:${getClientIp(req)}`, { limit: 20, windowMs: 60_000 })
//   if (!result.allowed) return rateLimitResponse(result.retryAfterSeconds)

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export interface RateLimitOptions {
  /** Max requests allowed per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the current window resets (0 when allowed). */
  retryAfterSeconds: number
}

interface Bucket {
  count: number
  resetAt: number
}

// Key -> bucket. Pruned opportunistically on each check.
const buckets = new Map<string, Bucket>()

export function checkRateLimit(key: string, { limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    // Opportunistic prune: drop expired buckets so the map can't grow forever.
    if (buckets.size > 10000) {
      for (const [k, b] of buckets) {
        if (now >= b.resetAt) buckets.delete(k)
      }
    }
    return { allowed: true, retryAfterSeconds: 0 }
  }

  bucket.count += 1
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/** Best-effort client IP: first entry of x-forwarded-for (set by Vercel), else 'unknown'. */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}

/** 429 JSON response with a Retry-After header, matching the apiError shape. */
export function rateLimitResponse(retryAfterSeconds: number): NextResponse {
  const res = NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  res.headers.set('Retry-After', String(retryAfterSeconds))
  return res
}
