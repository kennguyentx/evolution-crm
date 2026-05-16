'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Contact } from '@/types'
import { contactTypeClass } from '@/types'
import { Plus, Search, Phone, Mail, Building2, Users } from 'lucide-react'
import NewContactModal from '@/components/contacts/NewContactModal'

const CONTACT_TYPES = ['banker', 'lp', 'lender', 'advisor', 'management', 'other']

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const supabase = createClient()

  const fetchContacts = useCallback(async () => {
    let query = supabase.from('contacts').select('*').order('last_name')
    if (typeFilter !== 'all') query = query.eq('contact_type', typeFilter)
    const { data } = await query
    if (data) setContacts(data)
    setLoading(false)
  }, [supabase, typeFilter])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  const filtered = contacts.filter(c =>
    `${c.first_name} ${c.last_name} ${c.firm || ''} ${c.email || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  const byType = (type: string) => contacts.filter(c => c.contact_type === type).length

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '20px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px' }}>Contacts</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
            {contacts.length} total · {byType('banker')} bankers · {byType('lp')} LPs · {byType('lender')} lenders
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New Contact
        </button>
      </div>

      {/* Stats row */}
      <div style={{
        padding: '14px 28px',
        display: 'flex', gap: '16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {CONTACT_TYPES.map(type => (
          <button
            key={type}
            onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 10px', borderRadius: '999px',
              border: `1px solid ${typeFilter === type ? 'var(--accent)' : 'var(--border)'}`,
              background: typeFilter === type ? 'var(--accent-muted)' : 'transparent',
              cursor: 'pointer', fontSize: '12px',
              color: typeFilter === type ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <span className={`badge type-${type}`} style={{ padding: '0 6px', fontSize: '10px' }}>{type}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{byType(type)}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: '12px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ position: 'relative', maxWidth: '320px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search name, firm, email..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '30px' }} />
        </div>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr 1fr 80px',
        padding: '8px 28px',
        fontSize: '11px', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div>Name</div>
        <div>Firm / Title</div>
        <div>Type</div>
        <div>Relationship</div>
        <div>Contact</div>
      </div>

      {/* Contacts list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px 28px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)' }}>No contacts found.</div>
        ) : filtered.map(contact => (
          <div
            key={contact.id}
            className="table-row"
            style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '12px 28px' }}
          >
            <div>
              <div style={{ fontWeight: 500, fontSize: '13px' }}>
                {contact.first_name} {contact.last_name}
              </div>
              {contact.notes && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{contact.notes}</div>
              )}
            </div>
            <div style={{ alignSelf: 'center' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{contact.firm || '—'}</div>
              {contact.title && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{contact.title}</div>}
            </div>
            <div style={{ alignSelf: 'center' }}>
              <span className={`badge ${contactTypeClass(contact.contact_type)}`}>{contact.contact_type}</span>
              {contact.sub_type && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>{contact.sub_type}</div>}
            </div>
            <div style={{ alignSelf: 'center' }}>
              <span style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
                background: contact.relationship_strength === 'Strong' ? 'rgba(52,211,153,0.1)' :
                             contact.relationship_strength === 'Warm' ? 'rgba(251,191,36,0.1)' : 'rgba(100,116,139,0.1)',
                color: contact.relationship_strength === 'Strong' ? 'var(--green)' :
                       contact.relationship_strength === 'Warm' ? 'var(--yellow)' : 'var(--text-muted)',
              }}>
                {contact.relationship_strength || 'Cold'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignSelf: 'center' }}>
              {contact.email && (
                <a href={`mailto:${contact.email}`} style={{ color: 'var(--text-muted)' }} title={contact.email}>
                  <Mail size={13} />
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} style={{ color: 'var(--text-muted)' }} title={contact.phone}>
                  <Phone size={13} />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {showNew && (
        <NewContactModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); fetchContacts() }}
        />
      )}
    </div>
  )
}
