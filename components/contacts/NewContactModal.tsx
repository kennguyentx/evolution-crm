'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { X } from 'lucide-react'

export default function NewContactModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    title: '', firm: '', contact_type: 'banker', sub_type: '',
    relationship_strength: 'Warm', notes: '',
  })

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: any) => setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  const handleSubmit = async () => {
    if (!form.first_name || !form.last_name) return
    setSaving(true)
    const { error } = await supabase.from('contacts').insert({
      ...form,
      email: form.email || null,
      phone: form.phone || null,
      title: form.title || null,
      firm: form.firm || null,
      sub_type: form.sub_type || null,
      notes: form.notes || null,
    })
    setSaving(false)
    if (!error) onCreated()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '48px', backdropFilter: 'blur(4px)',
    }}>
      <div className="card slide-in" style={{ width: '520px', maxHeight: 'calc(100vh - 96px)', overflow: 'auto', padding: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px' }}>New Contact</h2>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '6px' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">First Name *</label>
              <input className="input" placeholder="Ken" {...field('first_name')} />
            </div>
            <div>
              <label className="label">Last Name *</label>
              <input className="input" placeholder="Smith" {...field('last_name')} />
            </div>
          </div>

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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Title</label>
              <input className="input" placeholder="Managing Director" {...field('title')} />
            </div>
            <div>
              <label className="label">Firm</label>
              <input className="input" placeholder="Lincoln International" {...field('firm')} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" placeholder="ken@firm.com" {...field('email')} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" placeholder="+1 (512) 555-0100" {...field('phone')} />
            </div>
          </div>

          <div>
            <label className="label">Relationship</label>
            <select className="select" {...field('relationship_strength')}>
              <option value="Cold">Cold</option>
              <option value="Warm">Warm</option>
              <option value="Strong">Strong</option>
            </select>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} placeholder="Context, how you know them..." style={{ resize: 'vertical' }} {...field('notes')} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !form.first_name || !form.last_name}>
            {saving ? 'Creating...' : 'Create Contact'}
          </button>
        </div>
      </div>
    </div>
  )
}
