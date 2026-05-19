import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that must remain publicly callable (external webhooks — no browser session)
const PUBLIC_API_ROUTES = [
  '/api/notes/email',   // Postmark inbound webhook
]

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  const { pathname } = req.nextUrl

  // Protect all /api/* routes except public webhooks
  if (pathname.startsWith('/api/')) {
    const isPublic = PUBLIC_API_ROUTES.some(p => pathname.startsWith(p))
    if (!isPublic && !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return res
  }

  // Redirect unauthenticated page requests to /login
  if (pathname !== '/login' && !session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return res
}

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|apple-touch-icon.png|logo.png|manifest.webmanifest).*)',
  ],
}
