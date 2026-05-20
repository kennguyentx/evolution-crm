'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Sidebar from './Sidebar'
import CommandPalette from './CommandPalette'
import QuickLog from './QuickLog'
import { Plus } from 'lucide-react'
import { useIsMobile } from '@/hooks/useIsMobile'

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()
  const [session, setSession] = useState<any>(undefined)
  const [showPalette, setShowPalette] = useState(false)
  const [showQuickLog, setShowQuickLog] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

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

  // Global Cmd+K / Ctrl+K and sidebar search button event
  useEffect(() => {
    if (!session) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowPalette(p => !p)
      }
    }
    const onOpen = () => setShowPalette(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-search', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-search', onOpen)
    }
  }, [session])

  if (session === undefined) return null
  if (!session) return <>{children}</>

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', marginTop: 0 }} className="main-content">
        {children}
      </main>

      {/* Floating quick-log button */}
      <button
        onClick={() => setShowQuickLog(true)}
        title="Log interaction (quick)"
        style={{
          position: 'fixed',
          bottom: isMobile ? 'calc(20px + env(safe-area-inset-bottom))' : '28px',
          right: isMobile ? '20px' : '28px',
          zIndex: 100,
          width: isMobile ? '44px' : '48px',
          height: isMobile ? '44px' : '48px',
          borderRadius: '50%',
          background: '#4F284B', color: 'white',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(79,40,75,0.5)',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(79,40,75,0.65)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(79,40,75,0.5)' }}
      >
        <Plus size={22} />
      </button>

      {showPalette && <CommandPalette onClose={() => setShowPalette(false)} />}
      {showQuickLog && <QuickLog onClose={() => setShowQuickLog(false)} />}
    </div>
  )
}
