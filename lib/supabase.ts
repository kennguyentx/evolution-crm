import { createBrowserClient } from '@supabase/ssr'

// Browser client for Client Components (and the two analyze API routes that
// have always used this shared client). Replaces the deprecated
// @supabase/auth-helpers-nextjs `createClientComponentClient`.
// Env names are unchanged: the project uses the legacy anon key, which
// @supabase/ssr accepts in place of the newer publishable key.
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
