'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Contact } from '@/types'
import { contactTypeClass } from '@/types'
import { Plus, Search, Phone, Mail } from 'lucide-react'
import NewContactModal from '@/components/contacts/NewContactModal'

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
  const supabase = createClient()

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

  const fetchContacts = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset
    if (reset) setLoading(true)
    else setLoadingMore(true)
    let query = supabase.from('contacts').select('*').order('last_name')
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

  useEffect(() => { setOffset(0); fetchContacts(true) }, [typeFilter])

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return }
    const timer = setTimeout(async () => {
      const q = search.trim()
      const { data } = await supabase.from('contacts').select('*')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%,email.ilike.%${q}%`)
        .order('last_name').limit(100)
      setSearchResults(data || [])
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const handleSaved = () => {
    setShowNew(false)
    setEditingContact(null)
    setOffset(0)
    fetchContacts(true)
  }

  const displayed = searchResults !== null ? searchResults : contacts
  const displayTotal = typeFilter !== 'all' ? (typeCounts[typeFilter] || 0) : total

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header — New Contact button next to title */}
      <div style={{
        padding: '20px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '16px',
        flexShrink: 0, background: 'var(--surface)',
      }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Contacts</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New Contact
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
      <div style={{ padding: '10px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ position: 'relative', maxWidth: '320px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search name, firm, email..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '30px' }} />
        </div>
      </div>

      {/* Table header */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 80px', padding: '8px 28px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div>Name</div><div>Firm / Title</div><div>Type</div><div>Contact</div>
      </div>

      {/* Contacts list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px 28px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)' }}>No contacts found.</div>
        ) : (
          <>
            {displayed.map(contact => (
              <div
                key={contact.id}
                className="table-row"
                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 80px', padding: '12px 28px', cursor: 'pointer' }}
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
                <div style={{ display: 'flex', gap: '8px', alignSelf: 'center' }} onClick={e => e.stopPropagation()}>
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
    </div>
  )
}
