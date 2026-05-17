'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { X, Search, Plus } from 'lucide-react'
import type { DealStage } from '@/types'

const SECTORS = [
  'Underground Utilities', 'Electrical Contracting', 'Civil / Public Works',
  'Commercial Landscaping', 'Fiber Optics', 'HVAC', 'Plumbing', 'Roofing',
  'Environmental Services', 'Industrial Services', 'Other'
]

const ALL_STAGES = [
  { group: 'Active', stages: ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity'] },
  { group: 'Closed', stages: ['Closed (Platform)', 'Closed (Add-On)'] },
  { group: 'Pass', stages: ['Pass (DOA)', 'Pass (Pre-LOI)', 'Pass (Post-LOI)'] },
  { group: 'Other', stages: ['Hold'] },
]

export default function NewDealModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
  const [selectedContact, setSelectedContact] = useState<any>(null)
  const [showContactSearch, setShowContactSearch] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState({
    company_name: '',
    sector: '',
    geography: '',
    description: '',
    revenue: '',
    ebitda: '',
    deal_type: 'platform',
    stage: 'Teaser' as DealStage,
    notes: '',
  })

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowContactSearch(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Contact search
  useEffect(() => {
    if (!contactSearch.trim()) { setContactResults([]); return }
    const timer = setTimeout(async () => {
      const q = contactSearch.trim()
      const parts = q.split(' ').filter(Boolean)
      let results: any[] = []
      if (parts.length >= 2) {
        const [a, b] = await Promise.all([
          supabase.from('contacts').select('id,first_name,last_name,firm,contact_type').ilike('first_name', `%${parts[0]}%`).limit(100),
          supabase.from('contacts').select('id,first_name,last_name,firm,contact_type').ilike('last_name', `%${parts[parts.length-1]}%`).limit(100),
        ])
        const ids = new Set((a.data || []).map((c: any) => c.id))
        results = (b.data || []).filter((c: any) => ids.has(c.id))
      }
      if (!results.length) {
        const { data } = await supabase.from('contacts').select('id,first_name,last_name,firm,contact_type').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`).limit(8)
        results = data || []
      }
      setContactResults(results.slice(0, 8))
    }, 250)
    return () => clearTimeout(timer)
  }, [contactSearch])

  const handleSubmit = async () => {
    if (!form.company_name.trim()) return
    setSaving(true)

    const payload: any = {
      company_name: form.company_name,
      sector:       form.sector || null,
      geography:    form.geography || null,
      description:  form.description || null,
      deal_type:    form.deal_type || null,
      stage:        form.stage,
      status:       'Active',
      notes:        form.notes || null,
      source_notes: selectedContact?.firm || null,
      expected_close: new Date().toISOString().split('T')[0],
    }

    if (form.revenue) payload.revenue = parseFloat(form.revenue) * 1_000_000
    if (form.ebitda)  payload.ebitda  = parseFloat(form.ebitda)  * 1_000_000

    const { data, error } = await supabase.from('deals').insert(payload).select().single()

    // Link source contact
    if (!error && data && selectedContact) {
      await supabase.from('contact_deal_links').insert({
        contact_id: selectedContact.id,
        deal_id: data.id,
        role: 'Source / Banker',
      })
    }

    setSaving(false)
    if (!error) onCreated()
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: any) => setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '48px', backdropFilter: 'blur(4px)' }}>
      <div className="card slide-in" style={{ width: '600px', maxHeight: 'calc(100vh - 96px)', overflow: 'auto', padding: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px' }}>New Deal</h2>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '6px' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Company */}
          <div>
            <label className="label">Company Name *</label>
            <input className="input" placeholder="e.g. DiPonio Contracting" {...field('company_name')} />
          </div>

          {/* Sector / Geography */}
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

          {/* Description */}
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} placeholder="Brief overview..." style={{ resize: 'vertical' }} {...field('description')} />
          </div>

          {/* Financials */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Financials (in $M)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label className="label">Revenue</label>
                <input className="input" placeholder="e.g. 18.5" {...field('revenue')} />
              </div>
              <div>
                <label className="label">EBITDA</label>
                <input className="input" placeholder="e.g. 4.2" {...field('ebitda')} />
              </div>
            </div>
          </div>

          {/* Deal Type + Stage */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
                {ALL_STAGES.map(({ group, stages }) => (
                  <optgroup key={group} label={group}>
                    {stages.map(s => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Source Contact */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Source</div>
            <label className="label">Contact Person</label>
            {selectedContact ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '7px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{selectedContact.first_name} {selectedContact.last_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{selectedContact.firm || selectedContact.contact_type}</div>
                </div>
                <button onClick={() => { setSelectedContact(null); setContactSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={13} /></button>
              </div>
            ) : (
              <div ref={searchRef} style={{ position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={12} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input className="input" placeholder="Search by name or firm..." value={contactSearch} onChange={e => { setContactSearch(e.target.value); setShowContactSearch(true) }} onFocus={() => setShowContactSearch(true)} style={{ paddingLeft: '30px' }} />
                </div>
                {showContactSearch && contactResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: '200px', overflow: 'auto' }}>
                    {contactResults.map(c => (
                      <button key={c.id} onClick={() => { setSelectedContact(c); setShowContactSearch(false); setContactSearch('') }}
                        style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.firm || c.contact_type}</div>
                      </button>
                    ))}
                  </div>
                )}
                {showContactSearch && contactSearch.length > 1 && contactResults.length === 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    No contacts found — <a href="/contacts" style={{ color: 'var(--accent)' }}>add them in Contacts first</a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} placeholder="Initial thoughts, deal thesis..." style={{ resize: 'vertical' }} {...field('notes')} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !form.company_name.trim()}>
            {saving ? 'Creating...' : 'Create Deal'}
          </button>
        </div>
      </div>
    </div>
  )
}
