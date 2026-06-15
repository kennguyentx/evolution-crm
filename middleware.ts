import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that must remain publicly callable (external webhooks — no browser session)
const PUBLIC_API_ROUTES = [
  '/api/notes/email',   // Postmark inbound webhook
]

// Cron / automation routes — reachable WITHOUT a Supabase session, but ONLY when
// the request carries the correct CRON_SECRET. The route handlers re-validate via
// isAuthorizedCron. This is what lets GitHub Actions fire the scheduled emails:
// those requests have no browser session, so without this they'd hit the 401 below.
const CRON_API_ROUTES = [
  '/api/pipeline/weekly-email',
  '/api/digest',
  '/api/portfolio-news/daily-email',
  '/api/deals/loi-alerts',
]

function hasValidCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const fromQuery  = req.nextUrl.searchParams.get('cron_secret')
  const fromHeader = req.headers.get('x-cron-secret')
  const fromAuth   = req.headers.get('authorization')
  return fromQuery === secret || fromHeader === secret || fromAuth === `Bearer ${secret}`
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  const { pathname } = req.nextUrl

  // Protect all /api/* routes except public webhooks and secret-bearing cron calls
  if (pathname.startsWith('/api/')) {
    const isPublic = PUBLIC_API_ROUTES.some(p => pathname.startsWith(p))
    if (isPublic) return res

    const isCron = CRON_API_ROUTES.some(p => pathname.startsWith(p))
    if (isCron && hasValidCronSecret(req)) return res

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return res
  }

  // Redirect unauthenticated page requests to /login
  if (pathname !== '/login' && !session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // MFA enforcement: if user has enrolled TOTP but hasn't completed the challenge
  // this session, gate all pages except /login and /mfa/*
  if (session && !pathname.startsWith('/mfa') && pathname !== '/login') {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      return NextResponse.redirect(new URL('/mfa/verify', req.url))
    }
  }

  return res
}

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|apple-touch-icon.png|logo.png|manifest.webmanifest).*)',
  ],
}
