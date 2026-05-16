import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export const createClient = () =>
  createClientComponentClient<Database>()

export const createServerClient = () =>
  createServerComponentClient<Database>({ cookies })
