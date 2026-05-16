'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { X } from 'lucide-react'
import type { DealStage } from '@/types'

const SECTORS = [
  'Underground Utilities', 'Electrical Contracting', 'Civil / Public Works',
  'Commercial Landscaping', 'Fiber Optics', 'HVAC', 'Plumbing', 'Roofing',
  'Environmental Services', 'Industrial Services', 'Other'
]

const SOURCE_TYPES = ['banker', 'direct', 'referral', 'inven', 'conference', 'other']

export default function NewDealModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    company_name: '',
    sector: '',
    geography: '',
    description: '',
    revenue: '',
    ebitda: '',
    asking_price: '',
    ev_ebitda_multiple: '',
    deal_type: 'platform',
    stage: 'Sourced' as DealStage,
    source_type: 'banker',
    source_notes: '',
    debt_structure: '',
    notes: '',
  })

  const handleSubmit = async () => {
    if (!form.company_name.trim()) return
    setSaving(true)

    const payload: any = {
      company_name: form.company_name,
      sector: form.sector || null,
      geography: form.geography || null,
      description: form.description || null,
      deal_type: form.deal_type || null,
      stage: form.stage,
      source_type: form.source_type || null,
      source_notes: form.source_notes || null,
      debt_structure: form.debt_structure || null,
      notes: form.notes || null,
    }

    if (form.revenue) payload.revenue = parseFloat(form.revenue.replace(/[^0-9.]/g, '')) * 1_000_000
    if (form.ebitda) payload.ebitda = parseFloat(form.ebitda.replace(/[^0-9.]/g, '')) * 1_000_000
    if (form.asking_price) payload.asking_price = parseFloat(form.asking_price.replace(/[^0-9.]/g, '')) * 1_000_000
    if (form.ev_ebitda_multiple) payload.ev_ebitda_multiple = parseFloat(form.ev_ebitda_multiple)

    const { error } = await supabase.from('deals').insert(payload)
    setSaving(false)
    if (!error) onCreated()
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: any) => setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '48px',
      backdropFilter: 'blur(4px)',
    }}>
      <div className="card slide-in" style={{
        width: '600px',
        maxHeight: 'calc(100vh - 96px)',
        overflow: 'auto',
        padding: '28px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px' }}>New Deal</h2>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '6px' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Row 1 */}
          <div>
            <label className="label">Company Name *</label>
            <input className="input" placeholder="e.g. DiPonio Contracting" {...field('company_name')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Sector</label>
              <select className="select" {...field('sector')}>
                <option value="">Select sector</option>
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Geography</label>
              <input className="input" placeholder="e.g. Michigan" {...field('geography')} />
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={2}
              placeholder="Brief overview of the business..."
              style={{ resize: 'vertical' }}
              {...field('description')}
            />
          </div>

          {/* Financials */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>
              Financials (in $M)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
              <div>
                <label className="label">Revenue</label>
                <input className="input" placeholder="e.g. 18.5" {...field('revenue')} />
              </div>
              <div>
                <label className="label">EBITDA</label>
                <input className="input" placeholder="e.g. 4.2" {...field('ebitda')} />
              </div>
              <div>
                <label className="label">Asking Price</label>
                <input className="input" placeholder="e.g. 25" {...field('asking_price')} />
              </div>
              <div>
                <label className="label">EV/EBITDA</label>
                <input className="input" placeholder="e.g. 6.0" {...field('ev_ebitda_multiple')} />
              </div>
            </div>
          </div>

          {/* Deal details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Deal Type</label>
              <select className="select" {...field('deal_type')}>
                <option value="platform">Platform</option>
                <option value="add-on">Add-On</option>
                <option value="recap">Recap</option>
                <option value="growth">Growth</option>
              </select>
            </div>
            <div>
              <label className="label">Stage</label>
              <select className="select" {...field('stage')}>
                {['Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Source</label>
              <select className="select" {...field('source_type')}>
                {SOURCE_TYPES.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Source Notes</label>
            <input className="input" placeholder="e.g. Lincoln International — Bill Smith" {...field('source_notes')} />
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Initial thoughts, deal thesis..."
              style={{ resize: 'vertical' }}
              {...field('notes')}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || !form.company_name.trim()}
          >
            {saving ? 'Creating...' : 'Create Deal'}
          </button>
        </div>
      </div>
    </div>
  )
}
