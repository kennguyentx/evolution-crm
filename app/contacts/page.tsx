'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Contact } from '@/types'
import { contactTypeClass } from '@/types'
import { Plus, Search, Phone, Mail } from 'lucide-react'
import NewContactModal from '@/components/contacts/NewContactModal'

const CONTACT_TYPES = ['banker', 'lp', 'lender', 'advisor', 'management', 'other']
const PAGE_SIZE = 100

// Fetch exact count via REST API directly
async function fetchCount(url: string, key: string, filter?: string): Promise<number> {
  const endpoint = `${url}/rest/v1/contacts?select=id${filter ? `&contact_type=eq.${filter}` : ''}`
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  })
  const contentRange = res.headers.get('content-range')
  if (contentRange) {
    const total = contentRange.split('/')[1]
    return parseInt(total) || 0
  }
  return 0
}

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
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({})
  const supabase = createClient()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  useEffect(() => {
    const fetchCounts = async () => {
      const [total, ...typeTotals] = await Promise.all([
        fetchCount(supabaseUrl, supabaseKey),
        ...CONTACT_TYPES.map(t => fetchCount(supabaseUrl, supabaseKey, t))
      ])
      setTotal(total)
      const counts: Record<string, number> = {}
      CONTACT_TYPES.forEach((t, i) => { counts[t] = typeTotals[i] })
      setTypeCounts(counts)
    }
    fetchCounts()
  }, [])

  const fetchContacts = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset
    if (reset) setLoading(true)
    else setLoadingMore(true)

    let query = supabase
      .from('contacts')
      .select('*')
      .order('last_name')
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
  }, [supabase, typeFilter, offset])

  useEffect(() => {
    setOffset(0)
    fetchContacts(true)
  }, [typeFilter])

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return }
    const timer = setTimeout(async () => {
      const q = search.trim()
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%,email.ilike.%${q}%`)
        .order('last_name')
        .limit(200)
      setSearchResults(data || [])
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const displayed = searchResults !== null ? searchResults : contacts
  const displayTotal = typeFilter !== 'all' ? (typeCounts[typeFilter] || 0) : total

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px' }}>Contacts</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
            {total.toLocaleString()} total
            {typeCounts['banker'] ? ` · ${typeCounts['banker'].toLocaleString()} bankers` : ''}
            {typeCounts['lp'] ? ` · ${typeCounts['lp'].toLocaleString()} LPs` : ''}
            {typeCounts['lender'] ? ` · ${typeCounts['lender'].toLocaleString()} lenders` : ''}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={14} /> New Contact</button>
      </div>

      <div style={{ padding: '12px 28px', display: 'flex', gap: '8px', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {CONTACT_TYPES.map(type => (
          <button key={type} onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '999px', border: `1px solid ${typeFilter === type ? 'var(--accent)' : 'var(--border)'}`, background: typeFilter === type ? 'var(--accent-muted)' : 'transparent', cursor: 'pointer', fontSize: '11px', color: typeFilter === type ? 'var(--accent)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
            {type} <span style={{ fontFamily: 'var(--font-mono)' }}>{typeCounts[type]?.toLocaleString() || 0}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '12px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ position: 'relative', maxWidth: '320px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search name, firm, email..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '30px' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '8px 28px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div>Name</div><div>Firm / Title</div><div>Type</div><div>Relationship</div><div>Contact</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px 28px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)' }}>No contacts found.</div>
        ) : (
          <>
            {displayed.map(contact => (
              <div key={contact.id} className="table-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '12px 28px' }}>
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
                <div style={{ alignSelf: 'center' }}>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: 'rgba(100,116,139,0.1)', color: 'var(--text-muted)' }}>
                    {contact.relationship_strength || 'Cold'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignSelf: 'center' }}>
                  {contact.email && <a href={`mailto:${contact.email}`} style={{ color: 'var(--text-muted)' }}><Mail size={13} /></a>}
                  {contact.phone && <a href={`tel:${contact.phone}`} style={{ color: 'var(--text-muted)' }}><Phone size={13} /></a>}
                </div>
              </div>
            ))}
            {searchResults === null && displayed.length < displayTotal && (
              <div style={{ padding: '20px 28px', textAlign: 'center' }}>
                <button className="btn btn-ghost" onClick={() => fetchContacts(false)} disabled={loadingMore}>
                  {loadingMore ? 'Loading...' : `Load more (${displayed.length.toLocaleString()} of ${displayTotal.toLocaleString()})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showNew && <NewContactModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); setOffset(0); fetchContacts(true) }} />}
    </div>
  )
}
