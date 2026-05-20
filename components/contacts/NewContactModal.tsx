'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { X, ExternalLink, Trash2 } from 'lucide-react'
import Link from 'next/link'

interface ContactModalProps {
  onClose: () => void
  onCreated: (created?: any) => void  // passes newly created contact when in create mode
  contact?: any // if provided, we're editing
  prefill?: { first_name?: string; last_name?: string; firm?: string } // pre-fill from search
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
}

export default function NewContactModal({ onClose, onCreated, contact, prefill }: ContactModalProps) {
  const supabase = createClient()
  const isEdit = !!contact
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [dealLinks, setDealLinks] = useState<any[]>([])
  const [contactNotes, setContactNotes] = useState<any[]>([])
  const [form, setForm] = useState({
    first_name: contact?.first_name || prefill?.first_name || '',
    last_name:  contact?.last_name  || prefill?.last_name  || '',
    email:      contact?.email      || '',
    phone:      contact?.phone      || '',
    title:      contact?.title      || '',
    firm:       contact?.firm       || prefill?.firm       || '',
    contact_type: contact?.contact_type || 'banker',
    sub_type:   contact?.sub_type   || '',
    notes:      contact?.notes      || '',
  })

  // Fetch deals and notes linked to this contact if editing
  useEffect(() => {
    if (!contact?.id) return
    supabase
      .from('contact_deal_links')
      .select('role, deal:deals(id, company_name, stage)')
      .eq('contact_id', contact.id)
      .then(({ data }) => { if (data) setDealLinks(data) })
    supabase
      .from('notes')
      .select('id, note_date, summary, next_steps, logged_by, source')
      .eq('contact_id', contact.id)
      .order('note_date', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (data) setContactNotes(data) })
  }, [contact?.id])

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: any) => {
      let val = e.target.value
      if (key === 'phone') val = formatPhone(val)
      setForm(prev => ({ ...prev, [key]: val }))
    },
  })

  const handleDelete = async () => {
    if (!contact?.id) return
    await supabase.from('contact_deal_links').delete().eq('contact_id', contact.id)
    await supabase.from('interactions').delete().eq('contact_id', contact.id)
    await supabase.from('deal_capital_assignments').delete().eq('contact_id', contact.id)
    await supabase.from('contacts').delete().eq('id', contact.id)
    onCreated()
  }

  const handleSubmit = async () => {
    if (!form.first_name || !form.last_name) return
    setSaving(true)

    const payload = {
      first_name:   form.first_name,
      last_name:    form.last_name,
      email:        form.email    || null,
      phone:        form.phone    || null,
      title:        form.title    || null,
      firm:         form.firm     || null,
      contact_type: form.contact_type,
      sub_type:     form.sub_type || null,
      notes:        form.notes    || null,
    }

    if (isEdit) {
      await supabase.from('contacts').update(payload).eq('id', contact.id)
      setSaving(false)
      onCreated()
    } else {
      const { data: newContact } = await supabase.from('contacts').insert(payload).select().single()
      // Sync to Constant Contact (best-effort, non-blocking)
      fetch('/api/constant-contact/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
      setSaving(false)
      onCreated(newContact ?? undefined)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '48px', backdropFilter: 'blur(4px)',
    }}>
      <div className="card slide-in" style={{
        width: '540px',
        maxHeight: 'calc(100vh - 96px)',
        overflow: 'auto',
        padding: '28px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>
            {isEdit ? 'Edit Contact' : 'New Contact'}
          </h2>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '6px' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">First Name *</label>
              <input className="input" placeholder="First" {...field('first_name')} />
            </div>
            <div>
              <label className="label">Last Name *</label>
              <input className="input" placeholder="Last" {...field('last_name')} />
            </div>
          </div>

          {/* Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Type</label>
              <select className="select" {...field('contact_type')}>
                <option value="banker">Banker</option>
                <option value="lp">LP / Investor</option>
                <option value="lender">Lender</option>
                <option value="advisor">Advisor</option>
                <option value="management">Management</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Sub-type</label>
              <input className="input" placeholder="e.g. M&A banker, family office" {...field('sub_type')} />
            </div>
          </div>

          {/* Firm / Title */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Firm</label>
              <input className="input" placeholder="Firm name" {...field('firm')} />
            </div>
            <div>
              <label className="label">Title</label>
              <input className="input" placeholder="Managing Director" {...field('title')} />
            </div>
          </div>

          {/* Email / Phone */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" placeholder="email@firm.com" {...field('email')} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" placeholder="(512) 555-0100" {...field('phone')} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} placeholder="Context, how you know them..." style={{ resize: 'vertical' }} {...field('notes')} />
          </div>

          {/* Linked deals — only shown when editing */}
          {isEdit && dealLinks.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
              <label className="label" style={{ marginBottom: '10px' }}>Linked Deals</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {dealLinks.map((link: any, i: number) => (
                  <Link
                    key={i}
                    href={`/deals/${link.deal?.id}`}
                    onClick={onClose}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      textDecoration: 'none',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 500 }}>{link.deal?.company_name}</span>
                      {link.role && <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: '8px' }}>{link.role}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
                        background: 'var(--accent-muted)', color: 'var(--accent)',
                      }}>
                        {link.deal?.stage}
                      </span>
                      <ExternalLink size={12} style={{ color: 'var(--text-muted)' }} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {/* Linked notes — only shown when editing and notes exist */}
          {isEdit && contactNotes.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
              <label className="label" style={{ marginBottom: '10px' }}>Recent Notes</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {contactNotes.map((note: any) => (
                  <div key={note.id} style={{
                    padding: '10px 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    borderLeft: '3px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: note.summary ? '5px' : 0 }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                        {note.source === 'email' ? 'Email' : 'Note'}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {note.note_date ? new Date(note.note_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                        {note.logged_by ? ` · ${note.logged_by}` : ''}
                      </span>
                    </div>
                    {note.summary && <div style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.5 }}>{note.summary}</div>}
                    {note.next_steps && <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '3px' }}>→ {note.next_steps}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
          {isEdit && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{ marginRight: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--red)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || !form.first_name || !form.last_name}
          >
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Contact'}
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ padding: '28px', maxWidth: '380px', width: '90%' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Delete this contact?</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
              This will permanently delete <strong>{contact?.first_name} {contact?.last_name}</strong> and remove them from all linked deals. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
