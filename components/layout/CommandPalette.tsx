'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Search, X, FileText, Users, Building2, StickyNote, Briefcase } from 'lucide-react'

type ResultType = 'deal' | 'contact' | 'capital_contact' | 'portfolio' | 'note'
interface Result {
  id: string
  label: string
  sublabel?: string
  type: ResultType
  href: string
}

const NAV_SHORTCUTS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Pipeline', href: '/pipeline' },
  { label: 'Deals', href: '/deals' },
  { label: 'Contacts', href: '/contacts' },
  { label: 'Capital Raises', href: '/raises' },
  { label: 'Notes', href: '/notes' },
  { label: 'Intake', href: '/intake' },
]

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const supabase = createClient()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<any>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    clearTimeout(timer.current)
    if (!query.trim()) { setResults([]); setLoading(false); return }
    setLoading(true)
    timer.current = setTimeout(async () => {
      const q = query.trim()
      const [{ data: deals }, { data: contacts }, { data: caps }, { data: portcos }, { data: notes }] = await Promise.all([
        supabase.from('deals').select('id, company_name, sector, stage').ilike('company_name', `%${q}%`).limit(5),
        supabase.from('contacts').select('id, first_name, last_name, firm').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`).limit(5),
        supabase.from('capital_contacts').select('id, firm, contact_name').or(`firm.ilike.%${q}%,contact_name.ilike.%${q}%`).limit(3),
        supabase.from('portfolio_companies').select('id, name, sector').ilike('name', `%${q}%`).limit(3),
        supabase.from('notes').select('id, summary, note_date').ilike('summary', `%${q}%`).not('summary', 'is', null).order('note_date', { ascending: false }).limit(3),
      ])
      const r: Result[] = [
        ...(deals ?? []).map((d: any) => ({ id: d.id, label: d.company_name, sublabel: [d.sector, d.stage].filter(Boolean).join(' · ') || undefined, type: 'deal' as const, href: `/deals/${d.id}` })),
        ...(contacts ?? []).map((c: any) => ({ id: c.id, label: `${c.first_name} ${c.last_name}`, sublabel: c.firm ?? undefined, type: 'contact' as const, href: `/contacts?open=${c.id}` })),
        ...(caps ?? []).map((c: any) => ({ id: c.id, label: c.firm, sublabel: c.contact_name ?? undefined, type: 'capital_contact' as const, href: `/raises/contacts?firm=${encodeURIComponent(c.firm)}` })),
        ...(portcos ?? []).map((p: any) => ({ id: p.id, label: p.name, sublabel: p.sector ?? undefined, type: 'portfolio' as const, href: `/portfolio/${p.id}` })),
        ...(notes ?? []).map((n: any) => ({ id: n.id, label: n.summary?.slice(0, 60) + (n.summary?.length > 60 ? '…' : ''), sublabel: n.note_date ? new Date(n.note_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined, type: 'note' as const, href: `/notes` })),
      ]
      setResults(r)
      setSelected(0)
      setLoading(false)
    }, 250)
  }, [query])

  const go = (href: string) => { router.push(href); onClose() }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter' && results[selected]) go(results[selected].href)
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [results, selected, onClose])

  const typeIcon = (type: ResultType) => {
    if (type === 'deal') return <FileText size={12} />
    if (type === 'contact') return <Users size={12} />
    if (type === 'portfolio') return <Briefcase size={12} />
    if (type === 'note') return <StickyNote size={12} />
    return <Building2 size={12} />
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '80px' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: '560px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 24px 64px rgba(0,0,0,0.35)', overflow: 'hidden' }}>

        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search deals, contacts, capital contacts…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '14px', background: 'transparent', color: 'var(--text-primary)' }}
          />
          {query
            ? <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={14} /></button>
            : <kbd style={{ fontSize: '10px', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 5px' }}>esc</kbd>
          }
        </div>

        {/* Results */}
        {results.length > 0 ? (
          <div style={{ maxHeight: '380px', overflow: 'auto' }}>
            {results.map((r, i) => (
              <button key={r.id} onClick={() => go(r.href)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '10px 16px', background: i === selected ? 'var(--surface-2)' : 'transparent', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{typeIcon(r.type)}</span>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{r.label}</span>
                {r.sublabel && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.sublabel}</span>}
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid var(--border)', borderRadius: '3px', padding: '1px 5px', flexShrink: 0 }}>
                  {r.type.replace('_', ' ')}
                </span>
              </button>
            ))}
          </div>
        ) : query && !loading ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
            No results for "{query}"
          </div>
        ) : !query ? (
          <div style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Quick navigate</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {NAV_SHORTCUTS.map(n => (
                <button key={n.href} onClick={() => go(n.href)}
                  style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '6px', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  {n.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--text-muted)' }}>
              ↑↓ navigate · ↵ open · esc close
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
