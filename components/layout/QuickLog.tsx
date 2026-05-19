'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { X, Check } from 'lucide-react'

const TYPES = ['call', 'email', 'meeting', 'note', 'site visit', 'loi-submission', 'lender-call', 'other'] as const

export default function QuickLog({ onClose }: { onClose: () => void }) {
  const supabase = createClient()
  const [form, setForm] = useState({
    interaction_type: 'call',
    interaction_date: new Date().toISOString().split('T')[0],
    summary: '',
    next_steps: '',
    logged_by: 'Ken',
    contact_id: '',
    contact_label: '',
    deal_id: '',
    deal_label: '',
  })
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
  const [dealSearch, setDealSearch] = useState('')
  const [dealResults, setDealResults] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const contactTimer = useRef<any>(null)
  const dealTimer = useRef<any>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const searchContacts = (q: string) => {
    setContactSearch(q)
    clearTimeout(contactTimer.current)
    if (!q.trim()) { setContactResults([]); return }
    contactTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('contacts').select('id, first_name, last_name, firm').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`).limit(6)
      setContactResults(data ?? [])
    }, 250)
  }

  const searchDeals = (q: string) => {
    setDealSearch(q)
    clearTimeout(dealTimer.current)
    if (!q.trim()) { setDealResults([]); return }
    dealTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('deals').select('id, company_name').ilike('company_name', `%${q}%`).limit(6)
      setDealResults(data ?? [])
    }, 250)
  }

  const save = async () => {
    if (!form.summary.trim()) { setError('Summary is required'); return }
    if (!form.contact_id) { setError('Select a contact'); return }
    setSaving(true)
    setError('')
    const payload: any = {
      contact_id: form.contact_id,
      interaction_type: form.interaction_type,
      interaction_date: form.interaction_date,
      summary: form.summary,
      next_steps: form.next_steps || null,
      logged_by: form.logged_by || null,
    }
    if (form.deal_id) payload.deal_id = form.deal_id
    await supabase.from('interactions').insert(payload)
    setSaving(false)
    setSaved(true)
    setTimeout(onClose, 700)
  }

  const dropStyle: React.CSSProperties = {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px',
    zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  }
  const dropBtnStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
    fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer',
    borderBottom: '1px solid var(--border-subtle)',
  }
  const chipStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px',
    border: '1px solid var(--accent)', borderRadius: '6px', fontSize: '12px',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: '520px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 24px 64px rgba(0,0,0,0.35)', padding: '20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600 }}>Log interaction</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={15} /></button>
        </div>

        {saved ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--green)', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Check size={16} /> Logged
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* Type + Date */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label className="label">Type</label>
                <select className="select" value={form.interaction_type} onChange={e => setForm(p => ({ ...p, interaction_type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t.replace('-', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={form.interaction_date} onChange={e => setForm(p => ({ ...p, interaction_date: e.target.value }))} />
              </div>
            </div>

            {/* Contact */}
            <div>
              <label className="label">Contact *</label>
              <div style={{ position: 'relative' }}>
                {form.contact_id ? (
                  <div style={chipStyle}>
                    <span style={{ flex: 1 }}>{form.contact_label}</span>
                    <button onClick={() => setForm(p => ({ ...p, contact_id: '', contact_label: '' }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={11} /></button>
                  </div>
                ) : (
                  <>
                    <input className="input" placeholder="Search contacts…" value={contactSearch} onChange={e => searchContacts(e.target.value)} autoFocus />
                    {contactResults.length > 0 && (
                      <div style={dropStyle}>
                        {contactResults.map((c: any) => (
                          <button key={c.id} style={dropBtnStyle}
                            onClick={() => { setForm(p => ({ ...p, contact_id: c.id, contact_label: `${c.first_name} ${c.last_name}${c.firm ? ` · ${c.firm}` : ''}` })); setContactSearch(''); setContactResults([]) }}>
                            {c.first_name} {c.last_name}
                            {c.firm && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>· {c.firm}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Deal */}
            <div>
              <label className="label">Deal <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <div style={{ position: 'relative' }}>
                {form.deal_id ? (
                  <div style={chipStyle}>
                    <span style={{ flex: 1 }}>{form.deal_label}</span>
                    <button onClick={() => setForm(p => ({ ...p, deal_id: '', deal_label: '' }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={11} /></button>
                  </div>
                ) : (
                  <>
                    <input className="input" placeholder="Search deals…" value={dealSearch} onChange={e => searchDeals(e.target.value)} />
                    {dealResults.length > 0 && (
                      <div style={dropStyle}>
                        {dealResults.map((d: any) => (
                          <button key={d.id} style={dropBtnStyle}
                            onClick={() => { setForm(p => ({ ...p, deal_id: d.id, deal_label: d.company_name })); setDealSearch(''); setDealResults([]) }}>
                            {d.company_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Summary */}
            <div>
              <label className="label">Summary *</label>
              <textarea className="input" rows={3} placeholder="What happened, key points, outcome…"
                value={form.summary} onChange={e => setForm(p => ({ ...p, summary: e.target.value }))}
                style={{ resize: 'vertical', width: '100%' }} />
            </div>

            {/* Next steps */}
            <div>
              <label className="label">Next steps</label>
              <input className="input" placeholder="Follow up by…, Send materials…" value={form.next_steps} onChange={e => setForm(p => ({ ...p, next_steps: e.target.value }))} />
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
              <div style={{ flex: '0 0 120px' }}>
                <label className="label">Logged by</label>
                <input className="input" value={form.logged_by} onChange={e => setForm(p => ({ ...p, logged_by: e.target.value }))} />
              </div>
              {error && <div style={{ fontSize: '11px', color: 'var(--red)', flex: 1, paddingTop: '16px' }}>{error}</div>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', paddingTop: '16px' }}>
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Log'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
