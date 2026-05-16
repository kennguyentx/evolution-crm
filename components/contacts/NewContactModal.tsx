'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { X, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface ContactModalProps {
  onClose: () => void
  onCreated: () => void
  contact?: any // if provided, we're editing
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
}

export default function NewContactModal({ onClose, onCreated, contact }: ContactModalProps) {
  const supabase = createClient()
  const isEdit = !!contact
  const [saving, setSaving] = useState(false)
  const [dealLinks, setDealLinks] = useState<any[]>([])
  const [form, setForm] = useState({
    first_name: contact?.first_name || '',
    last_name:  contact?.last_name  || '',
    email:      contact?.email      || '',
    phone:      contact?.phone      || '',
    title:      contact?.title      || '',
    firm:       contact?.firm       || '',
    contact_type: contact?.contact_type || 'banker',
    sub_type:   contact?.sub_type   || '',
    notes:      contact?.notes      || '',
  })

  // Fetch deals linked to this contact if editing
  useEffect(() => {
    if (!contact?.id) return
    supabase
      .from('contact_deal_links')
      .select('role, deal:deals(id, company_name, stage)')
      .eq('contact_id', contact.id)
      .then(({ data }) => {
        if (data) setDealLinks(data)
      })
  }, [contact?.id])

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: any) => {
      let val = e.target.value
      if (key === 'phone') val = formatPhone(val)
      setForm(prev => ({ ...prev, [key]: val }))
    },
  })

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
    } else {
      await supabase.from('contacts').insert(payload)
    }

    setSaving(false)
    onCreated()
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
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
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
    </div>
  )
}
