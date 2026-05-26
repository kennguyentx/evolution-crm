'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Contact } from '@/types'
import { contactTypeClass } from '@/types'
import { Plus, Search, Phone, Mail, ChevronUp, ChevronDown, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import NewContactModal from '@/components/contacts/NewContactModal'
import CCSyncPanel from '@/components/contacts/CCSyncPanel'
import UndoToast, { type UndoEntry } from '@/components/layout/UndoToast'
import { useIsMobile } from '@/hooks/useIsMobile'

const CONTACT_TYPES = ['banker', 'lp', 'lender', 'advisor', 'management', 'other']
const PAGE_SIZE = 100

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Contact[] | null>(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [showNew, setShowNew] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({})
  const [sortField, setSortField] = useState<'name'|'firm'|'type'|'created_at'>('created_at')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [showCCSync, setShowCCSync] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const isMobile = useIsMobile()

  // Close modals on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNew(false)
        setEditingContact(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const fetchCounts = async () => {
      const { count: totalCount } = await supabase
        .from('contacts').select('*', { count: 'exact', head: true })
      if (totalCount !== null) setTotal(totalCount)
      const types = ['banker', 'lp', 'lender', 'advisor', 'management', 'other']
      const counts: Record<string, number> = {}
      await Promise.all(types.map(async (t) => {
        const { count } = await supabase
          .from('contacts').select('*', { count: 'exact', head: true }).eq('contact_type', t)
        counts[t] = count || 0
      }))
      setTypeCounts(counts)
    }
    fetchCounts()
  }, [])

  const fetchContacts = useCallback(async (reset = false, field = sortField, dir = sortDir) => {
    const currentOffset = reset ? 0 : offset
    if (reset) setLoading(true)
    else setLoadingMore(true)

    // Map sort field to DB column
    const dbCol: Record<string, string> = {
      name: 'last_name',
      firm: 'firm',
      type: 'contact_type',
      created_at: 'created_at',
    }
    const col = dbCol[field] || 'last_name'
    const asc = dir === 'asc'

    let query = supabase.from('contacts').select('*')
      .order(col, { ascending: asc, nullsFirst: false })
      .range(currentOffset, currentOffset + PAGE_SIZE - 1)
    if (typeFilter !== 'all') query = query.eq('contact_type', typeFilter)
    const { data } = await query
    if (data) {
      if (reset) setContacts(data)
      else setContacts(prev => [...prev, ...data])
      setOffset(currentOffset + data.length)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [supabase, typeFilter, offset, sortField, sortDir])

  useEffect(() => { setOffset(0); fetchContacts(true) }, [typeFilter])

  // Auto-open a contact from ?open=<id> (e.g. navigated from global search)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const openId = params.get('open')
    if (!openId) return
    supabase.from('contacts').select('*').eq('id', openId).single().then(({ data }) => {
      if (data) setEditingContact(data as Contact)
    })
    // Clean the param from the URL without a full navigation
    const url = new URL(window.location.href)
    url.searchParams.delete('open')
    window.history.replaceState({}, '', url.toString())
  }, [])

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return }
    const timer = setTimeout(async () => {
      const q = search.trim()
      const parts = q.split(' ').filter(Boolean)
      let results: any[] = []

      if (parts.length >= 2) {
        // Multi-word: fetch matching first name AND last name separately, then intersect
        const [firstRes, lastRes] = await Promise.all([
          supabase.from('contacts').select('*').ilike('first_name', `%${parts[0]}%`).limit(500),
          supabase.from('contacts').select('*').ilike('last_name', `%${parts[parts.length - 1]}%`).limit(500),
        ])
        const firstIds = new Set((firstRes.data || []).map((c: any) => c.id))
        const lastMatches = (lastRes.data || []).filter((c: any) => firstIds.has(c.id))
        // Also include firm/email matches for the full query
        const { data: firmData } = await supabase.from('contacts').select('*')
          .or(`firm.ilike.%${q}%,email.ilike.%${q}%`).limit(50)
        const combined = [...lastMatches, ...(firmData || [])]
        const seen = new Set<string>()
        results = combined.filter((c: any) => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
      } else {
        const { data } = await supabase.from('contacts').select('*')
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%,email.ilike.%${q}%`)
          .order('last_name').limit(100)
        results = data || []
      }

      results.sort((a: any, b: any) => (a.last_name || '').localeCompare(b.last_name || ''))
      setSearchResults(results.slice(0, 100))
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const handleSaved = () => {
    setShowNew(false)
    setEditingContact(null)
    setOffset(0)
    fetchContacts(true)
  }

  const pushUndo = (entry: Omit<UndoEntry,'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setUndoStack(prev => [{ ...entry, id }, ...prev].slice(0,3))
  }
  const handleUndo = async (id: string) => {
    const entry = undoStack.find(e => e.id===id)
    if (entry) { await entry.undo(); fetchContacts(true) }
    setUndoStack(prev => prev.filter(e => e.id!==id))
  }
  const handleDismiss = (id: string) => setUndoStack(prev => prev.filter(e => e.id!==id))

  const handleSort = (field: 'name'|'firm'|'type'|'created_at') => {
    const newDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : (field === 'created_at' ? 'desc' : 'asc')
    setSortField(field)
    setSortDir(newDir)
    setOffset(0)
    fetchContacts(true, field, newDir)
  }

  const displayed = searchResults !== null ? searchResults : contacts

  // Server handles ordering for non-search results
  // For search results (client-side), apply sort
  const sortedDisplayed = searchResults !== null ? [...displayed].sort((a: any, b: any) => {
    let av: string, bv: string
    if (sortField==='name') { av=`${a.last_name} ${a.first_name}`; bv=`${b.last_name} ${b.first_name}` }
    else if (sortField==='firm') { av=a.firm||''; bv=b.firm||'' }
    else if (sortField==='created_at') { av=a.created_at||''; bv=b.created_at||'' }
    else { av=a.contact_type||''; bv=b.contact_type||'' }
    const cmp = av.localeCompare(bv)
    return sortDir==='asc'?cmp:-cmp
  }) : displayed

  const displayTotal = typeFilter !== 'all' ? (typeCounts[typeFilter] || 0) : total

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header — New Contact button next to title */}
      <div style={{
        padding: isMobile ? '14px 16px' : '20px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '16px',
        flexShrink: 0, background: 'var(--surface)',
      }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Contacts</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New Contact
        </button>
        <button className="btn btn-ghost" onClick={() => router.push('/contacts/dupes')} style={{ fontSize: '12px' }}>
          Find Duplicates
        </button>
        <button className="btn btn-ghost" onClick={() => setShowCCSync(true)} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Zap size={12} /> CC Sync
        </button>
        <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '12px' }}>
          {total.toLocaleString()} total
          {typeCounts['banker'] ? ` · ${typeCounts['banker'].toLocaleString()} bankers` : ''}
          {typeCounts['lp'] ? ` · ${typeCounts['lp'].toLocaleString()} LPs` : ''}
          {typeCounts['lender'] ? ` · ${typeCounts['lender'].toLocaleString()} lenders` : ''}
        </div>
      </div>

      {/* Type filters */}
      <div style={{ padding: '12px 28px', display: 'flex', gap: '8px', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {CONTACT_TYPES.map(type => (
          <button key={type} onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '999px', border: `1px solid ${typeFilter === type ? 'var(--accent)' : 'var(--border)'}`, background: typeFilter === type ? 'var(--accent-muted)' : 'transparent', cursor: 'pointer', fontSize: '11px', color: typeFilter === type ? 'var(--accent)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
            {type} <span style={{ fontFamily: 'var(--font-mono)' }}>{typeCounts[type]?.toLocaleString() || 0}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: isMobile ? '10px 16px' : '10px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ position: 'relative', maxWidth: isMobile ? '100%' : '320px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search name, firm, email..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '30px' }} />
        </div>
      </div>

      {/* Table header */}
      <div style={{ display: isMobile ? 'none' : 'grid', gridTemplateColumns: '2fr 1fr 1fr 90px 80px', padding: '8px 28px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {([['name','Name'],['firm','Firm / Title'],['type','Type'],['created_at','Added']] as ['name'|'firm'|'type'|'created_at', string][]).map(([field, label]) => (
          <div key={field} onClick={() => handleSort(field)} style={{ display:'flex', alignItems:'center', gap:'4px', cursor:'pointer', userSelect:'none', color: sortField===field?'var(--accent)':'var(--text-muted)' }}>
            {label}
            {sortField===field ? (sortDir==='asc'?<ChevronUp size={11}/>:<ChevronDown size={11}/>) : <ChevronDown size={11} style={{opacity:0.3}}/>}
          </div>
        ))}
        <div style={{ color:'var(--text-muted)' }}>Contact</div>
      </div>

      {/* Contacts list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px 28px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)' }}>No contacts found.</div>
        ) : (
          <>
            {sortedDisplayed.map(contact => (
              isMobile ? (
                <div
                  key={contact.id}
                  className="table-row"
                  style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
                  onClick={() => setEditingContact(contact)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>{contact.first_name} {contact.last_name}</div>
                      <div style={{ marginTop: '3px' }}>
                        <span className={`badge ${contactTypeClass(contact.contact_type)}`}>{contact.contact_type}</span>
                      </div>
                      {(contact.firm || contact.title) && (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {contact.firm}{contact.firm && contact.title ? ' · ' : ''}{contact.title}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }} onClick={e => e.stopPropagation()}>
                        {contact.email && <a href={`mailto:${contact.email}`} style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px' }}><Mail size={12} /></a>}
                        {contact.phone && <a href={`tel:${contact.phone}`} style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px' }}><Phone size={12} /></a>}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  key={contact.id}
                  className="table-row"
                  style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 90px 80px', padding: '12px 28px', cursor: 'pointer' }}
                  onClick={() => setEditingContact(contact)}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '13px' }}>{contact.first_name} {contact.last_name}</div>
                  </div>
                  <div style={{ alignSelf: 'center' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{contact.firm || '—'}</div>
                    {contact.title && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{contact.title}</div>}
                  </div>
                  <div style={{ alignSelf: 'center' }}>
                    <span className={`badge ${contactTypeClass(contact.contact_type)}`}>{contact.contact_type}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', alignSelf: 'center', fontFamily: 'var(--font-mono)' }}>
                    {contact.created_at ? new Date(contact.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }) : '—'}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignSelf: 'center' }} onClick={e => e.stopPropagation()}>
                    {contact.email && <a href={`mailto:${contact.email}`} style={{ color: 'var(--text-muted)' }}><Mail size={13} /></a>}
                    {contact.phone && <a href={`tel:${contact.phone}`} style={{ color: 'var(--text-muted)' }}><Phone size={13} /></a>}
                  </div>
                </div>
              )
            ))}
            {searchResults === null && sortedDisplayed.length < displayTotal && (
              <div style={{ padding: '20px 28px', textAlign: 'center' }}>
                <button className="btn btn-ghost" onClick={() => fetchContacts(false)} disabled={loadingMore}>
                  {loadingMore ? 'Loading...' : `Load more (${sortedDisplayed.length.toLocaleString()} of ${displayTotal.toLocaleString()})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* New Contact modal */}
      {showNew && (
        <NewContactModal onClose={() => setShowNew(false)} onCreated={handleSaved} />
      )}

      {/* Edit Contact modal */}
      {editingContact && (
        <NewContactModal
          onClose={() => setEditingContact(null)}
          onCreated={handleSaved}
          contact={editingContact}
        />
      )}
      <UndoToast stack={undoStack} onUndo={handleUndo} onDismiss={handleDismiss}/>

      {/* CC Sync panel */}
      {showCCSync && <CCSyncPanel onClose={() => setShowCCSync(false)} />}
    </div>
  )
}
