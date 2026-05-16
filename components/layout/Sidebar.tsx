'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Kanban,
  Users,
  Building2,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  Zap,
} from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const nav = [
  { href: '/pipeline',   label: 'Pipeline',   icon: Kanban },
  { href: '/deals',      label: 'Deals',      icon: Building2 },
  { href: '/contacts',   label: 'Contacts',   icon: Users },
  { href: '/digest',     label: 'Digest',     icon: BarChart3 },
  { href: '/intake',     label: 'CIM Intake', icon: Zap },
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
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      padding: '0',
    }}>
      {/* Logo */}
      <div style={{
        padding: '24px 20px 20px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '18px',
          color: 'var(--accent)',
          lineHeight: 1.2,
        }}>
          Evolution
        </div>
        <div style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginTop: '2px',
        }}>
          Strategy
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px' }}>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 10px',
                borderRadius: '6px',
                marginBottom: '2px',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--accent-muted)' : 'transparent',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: active ? 500 : 400,
                transition: 'all 0.12s',
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
              <Icon size={15} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div style={{
        padding: '12px 10px',
        borderTop: '1px solid var(--border)',
      }}>
        <button
          onClick={handleSignOut}
          className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'flex-start', fontSize: '13px' }}
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
