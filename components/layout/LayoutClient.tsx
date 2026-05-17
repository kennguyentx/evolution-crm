'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Sidebar from './Sidebar'

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(undefined)
  const [isMobile, setIsMobile] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (!session && pathname !== '/login') router.push('/login')
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session && pathname !== '/login') router.push('/login')
    })
    return () => subscription.unsubscribe()
  }, [pathname])

  if (session === undefined) return null
  if (!session) return <>{children}</>

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{
        flex: 1,
        overflow: 'auto',
        // On mobile, subtract the 52px top bar so pages fill the remaining height correctly
        height: isMobile ? 'calc(100vh - 52px)' : '100vh',
      }}>
        {children}
      </main>
    </div>
  )
}
