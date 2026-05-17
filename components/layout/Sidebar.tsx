'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Kanban, Building2, Users, BarChart3, Zap, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const nav = [
  { href: '/pipeline',   label: 'Pipeline',   icon: Kanban },
  { href: '/deals',      label: 'Deals',      icon: Building2 },
  { href: '/contacts',   label: 'Contacts',   icon: Users },
  { href: '/digest',     label: 'Digest',     icon: BarChart3 },
  { href: '/intake',     label: 'Teaser / CIM', icon: Zap },
  { href: '/portfolio',  label: 'Portfolio',    icon: Building2 },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside style={{
      width: '220px',
      minWidth: '220px',
      height: '100vh',
      background: '#ffffff',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '1px 0 8px rgba(49,20,50,0.04)',
    }}>
      {/* Logo */}
      <div style={{
        padding: '18px 18px 14px',
        borderBottom: '1px solid var(--border)',
      }}>
        <img
          src="/logo.png"
          alt="Evolution Strategy Partners"
          style={{ width: '168px', height: 'auto', display: 'block' }}
        />
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px' }}>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                padding: '8px 10px',
                borderRadius: '7px',
                marginBottom: '1px',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--accent-light)' : 'transparent',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: active ? 600 : 400,
                transition: 'all 0.12s',
                borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                paddingLeft: active ? '8px' : '8px',
              }}
              onMouseEnter={e => {
                if (!active) {
                  const el = e.currentTarget as HTMLElement
                  el.style.background = 'var(--surface-2)'
                  el.style.color = 'var(--text-primary)'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  const el = e.currentTarget as HTMLElement
                  el.style.background = 'transparent'
                  el.style.color = 'var(--text-secondary)'
                }
              }}
            >
              <Icon size={15} strokeWidth={active ? 2.5 : 2} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '10px 8px', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={handleSignOut}
          className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'flex-start', fontSize: '12px' }}
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
