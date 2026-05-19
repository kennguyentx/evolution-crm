'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Kanban, Building2, Users, BarChart3, Zap, TrendingUp, FileText, Menu, X, FileText as NoteIcon, Star, LayoutDashboard, Calendar, Search, BookOpen } from 'lucide-react'

const NAV = [
  { href: '/dashboard',        label: 'Dashboard',         icon: LayoutDashboard },
  { href: '/pipeline',         label: 'Pipeline',          icon: Kanban },
  { href: '/deals',            label: 'Deals',             icon: FileText },
  { href: '/intake',           label: 'Teaser / CIM',      icon: Zap },
  { href: '/contacts',         label: 'Contacts',          icon: Users },
  { href: '/raises',           label: 'Capital Raises',    icon: TrendingUp },
  { href: '/raises/contacts',  label: 'Capital Contacts',  icon: BarChart3 },
  { href: '/investors',        label: 'Investors',         icon: Users },
  { href: '/portfolio',        label: 'Portfolio',         icon: Building2 },
  { href: '/calendar',         label: 'Calendar',          icon: Calendar },
  { href: '/notes',            label: 'Notes',             icon: NoteIcon },
  { href: '/best-practices',   label: 'Best Practices',    icon: BookOpen },
  { href: '/assistant',        label: 'Assistant',         icon: Star },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  const isActive = (href: string) => {
    if (pathname === href) return true
    if (!pathname.startsWith(href + '/')) return false
    return !NAV.some(n => n.href !== href && n.href.startsWith(href + '/') && (pathname === n.href || pathname.startsWith(n.href + '/')))
  }

  const NavLinks = () => (
    <>
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: isMobile ? '14px 20px' : '8px 16px',
          borderRadius: '7px',
          textDecoration: 'none',
          fontSize: '13px',
          fontWeight: isActive(href) ? 600 : 400,
          color: isActive(href) ? '#ffffff' : 'rgba(255,255,255,0.6)',
          background: isActive(href) ? 'rgba(255,255,255,0.15)' : 'transparent',
          transition: 'all 0.15s',
        }}>
          <Icon size={15} />
          {label}
        </Link>
      ))}
    </>
  )

  if (isMobile) {
    return (
      <>
        {/* Mobile top bar */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          background: '#4F284B',
          height: 'calc(52px + env(safe-area-inset-top))',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          paddingLeft: '16px', paddingRight: '16px', paddingBottom: '0',
          paddingTop: 'env(safe-area-inset-top)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '10px', height: '52px', textDecoration: 'none' }}>
            <img src="/esp-icon.svg" alt="ESP" style={{ width: '28px', height: '28px', flexShrink: 0 }} />
            <span style={{ color: 'white', fontSize: '14px', fontWeight: 700 }}>Evolution Strategy Partners</span>
          </Link>
          <button onClick={() => setMobileOpen(!mobileOpen)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'white', padding: '4px', height: '52px', display: 'flex', alignItems: 'center' }}>
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setMobileOpen(false)} />
            <div style={{
              position: 'absolute', top: 'calc(52px + env(safe-area-inset-top))', left: 0, bottom: 0, width: '260px',
              background: '#4F284B', padding: '12px 8px',
              display: 'flex', flexDirection: 'column', gap: '2px',
              overflowY: 'auto',
            }}>
              <NavLinks />
            </div>
          </div>
        )}

      </>
    )
  }

  // Desktop sidebar
  return (
    <div style={{
      width: '200px', minWidth: '200px', background: '#4F284B',
      display: 'flex', flexDirection: 'column', padding: '16px 8px',
      height: '100vh', position: 'sticky', top: 0,
    }}>
      {/* Logo */}
      <Link href="/dashboard" style={{ padding: '8px 10px 20px', display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
        <img src="/esp-icon.svg" alt="ESP" style={{ width: '32px', height: '32px', flexShrink: 0 }} />
        <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px', fontWeight: 600, lineHeight: 1.2 }}>Evolution Strategy Partners</span>
      </Link>

      {/* Search button */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('open-search'))}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          margin: '0 0 10px', padding: '7px 12px',
          borderRadius: '7px', border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.08)', cursor: 'pointer',
          color: 'rgba(255,255,255,0.6)', fontSize: '12px', width: '100%',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.14)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'}
      >
        <Search size={13} />
        <span style={{ flex: 1, textAlign: 'left' }}>Search…</span>
        <kbd style={{ fontSize: '9px', opacity: 0.5, border: '1px solid rgba(255,255,255,0.3)', borderRadius: '3px', padding: '1px 4px' }}>⌘K</kbd>
      </button>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
        <NavLinks />
      </nav>
    </div>
  )
}
