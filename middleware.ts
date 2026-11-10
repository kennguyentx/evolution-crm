import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Protect all /api/* routes except public webhooks and secret-bearing cron
  // calls. These exemptions run before the Supabase client is created, so
  // webhooks and cron calls behave exactly as they did on auth-helpers:
  // no session is consulted for them at all.
  if (pathname.startsWith('/api/')) {
    const isPublic = PUBLIC_API_ROUTES.some(p => pathname.startsWith(p))
    if (isPublic) return NextResponse.next()

    const isCron = CRON_API_ROUTES.some(p => pathname.startsWith(p))
    if (isCron && isAuthorizedCron(req)) return NextResponse.next()
  }

  // @supabase/ssr middleware pattern (Supabase's Next.js server-side auth
  // guide): createServerClient with getAll/setAll cookie handlers. setAll
  // writes refreshed auth cookies to BOTH the request (so Server Components
  // see the refreshed token) and a rebuilt response (so the browser does).
  // That response object — `supabaseResponse` — must be the one returned,
  // or the refreshed cookies are lost and users get logged out at random.
  let supabaseResponse = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: per the @supabase/ssr docs, no code may run between
  // createServerClient and this auth call, and the check must be getUser()
  // (which revalidates the token against the Auth server), never
  // getSession() (which trusts the cookie unverified). This call is also
  // what refreshes an expired access token and triggers setAll above.
  const { data: { user } } = await supabase.auth.getUser()

  // When we must return a different response than supabaseResponse (a
  // redirect or the API 401), carry the refreshed auth cookies over so a
  // token refresh that just happened is not silently dropped.
  const withRefreshedCookies = (response: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Protect all remaining /api/* routes: a valid Supabase user is required
  if (pathname.startsWith('/api/')) {
    if (!user) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      )
    }
    return supabaseResponse
  }

  // Redirect unauthenticated page requests to /login
  if (pathname !== '/login' && !user) {
    return withRefreshedCookies(NextResponse.redirect(new URL('/login', req.url)))
  }

  // MFA enforcement: if user has enrolled TOTP but hasn't completed the challenge
  // this session, gate all pages except /login and /mfa/*
  if (user && !pathname.startsWith('/mfa') && pathname !== '/login') {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      return withRefreshedCookies(NextResponse.redirect(new URL('/mfa/verify', req.url)))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|apple-touch-icon.png|logo.png|manifest.webmanifest).*)',
  ],
}
