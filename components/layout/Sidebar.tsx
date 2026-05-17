'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Kanban, Building2, Users, BarChart3, Zap, LogOut, TrendingUp, FileText, Menu, X } from 'lucide-react'

const NAV = [
  { href: '/pipeline',   label: 'Pipeline',       icon: Kanban },
  { href: '/deals',      label: 'Deals',           icon: FileText },
  { href: '/contacts',   label: 'Contacts',        icon: Users },
  { href: '/intake',     label: 'Teaser / CIM',    icon: Zap },
  { href: '/portfolio',  label: 'Portfolio',       icon: Building2 },
  { href: '/investors',  label: 'Investors',       icon: Users },
  { href: '/raises',     label: 'Capital Raises',  icon: TrendingUp },
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

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

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
          background: '#4F284B', height: '52px', paddingTop: 'env(safe-area-inset-top)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', background: 'rgba(255,255,255,0.15)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'white', fontSize: '12px', fontWeight: 700 }}>ES</span>
            </div>
            <span style={{ color: 'white', fontSize: '14px', fontWeight: 700 }}>Evolution Strategy</span>
          </div>
          <button onClick={() => setMobileOpen(!mobileOpen)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'white', padding: '4px' }}>
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 99,
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setMobileOpen(false)} />
            <div style={{
              position: 'absolute', top: 52, left: 0, bottom: 0, width: '260px',
              background: '#4F284B', padding: '12px 8px',
              display: 'flex', flexDirection: 'column', gap: '2px',
              overflowY: 'auto',
            }}>
              <NavLinks />
            </div>
          </div>
        )}

        {/* Spacer for fixed top bar */}
        <div style={{ height: 'calc(52px + env(safe-area-inset-top))', flexShrink: 0 }} />
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
      <div style={{ padding: '8px 10px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: 'white', fontSize: '12px', fontWeight: 700 }}>ES</span>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px', fontWeight: 600, lineHeight: 1.2 }}>Evolution Strategy</span>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
        <NavLinks />
      </nav>
    </div>
  )
}
