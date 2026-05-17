'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Zap, Upload, Check, AlertCircle, ChevronRight, Search, Plus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

const SECTORS = [
  'Underground Utilities', 'Electrical Contracting', 'Civil / Public Works',
  'Commercial Landscaping', 'Fiber Optics', 'HVAC', 'Plumbing', 'Industrial Services',
  'Environmental Services', 'Construction & Engineering', 'Other'
]

interface ParsedDeal {
  company_name: string
  sector: string
  geography: string
  deal_type: string
  stage: string
  revenue: number | null
  ebitda: number | null
  cim_summary: string
  banker_name: string
  banker_firm: string
}

interface MissingField {
  key: keyof ParsedDeal
  label: string
}

export default function IntakePage() {
  const supabase = createClient()
  const [stage, setStage] = useState<'idle' | 'uploading' | 'parsing' | 'review' | 'saving' | 'done'>('idle')
  const [parsed, setParsed] = useState<ParsedDeal | null>(null)
  const [edited, setEdited] = useState<ParsedDeal | null>(null)
  const [dealId, setDealId] = useState<string | null>(null)
  const [duplicateDeals, setDuplicateDeals] = useState<any[]>([])
  const [ignoreDuplicate, setIgnoreDuplicate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [missingFields, setMissingFields] = useState<MissingField[]>([])

  // Contact linking
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
  const [selectedContact, setSelectedContact] = useState<any | null>(null)
  const [showContactSearch, setShowContactSearch] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContactForm, setNewContactForm] = useState({ first_name: '', last_name: '', firm: '', title: '', email: '', phone: '' })
  const searchRef = useRef<HTMLDivElement>(null)

  // Close search on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowContactSearch(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Contact search — searches name AND firm
  useEffect(() => {
    if (!contactSearch.trim()) { setContactResults([]); return }
    const timer = setTimeout(async () => {
      const q = contactSearch.trim()
      const parts = q.split(' ').filter(Boolean)
      let results: any[] = []

      if (parts.length >= 2) {
        // Multi-word: intersect first + last name
        const [firstRes, lastRes] = await Promise.all([
          supabase.from('contacts').select('id, first_name, last_name, firm, title').ilike('first_name', `%${parts[0]}%`).limit(100),
          supabase.from('contacts').select('id, first_name, last_name, firm, title').ilike('last_name', `%${parts[parts.length-1]}%`).limit(100),
        ])
        const firstIds = new Set((firstRes.data || []).map((c: any) => c.id))
        results = (lastRes.data || []).filter((c: any) => firstIds.has(c.id))
        // Also add firm matches
        const { data: firmData } = await supabase.from('contacts').select('id, first_name, last_name, firm, title').ilike('firm', `%${q}%`).limit(8)
        const seen = new Set(results.map((c: any) => c.id))
        ;(firmData || []).forEach((c: any) => { if (!seen.has(c.id)) { results.push(c); seen.add(c.id) } })
      } else {
        const { data } = await supabase.from('contacts')
          .select('id, first_name, last_name, firm, title')
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`)
          .limit(8)
        results = data || []
      }

      setContactResults(results.slice(0, 8))

      // If no results found, pre-fill the add contact form with what was typed
      if (results.length === 0 && q.length > 2) {
        const nameParts = q.split(' ')
        setNewContactForm(prev => ({
          ...prev,
          first_name: nameParts.length >= 2 ? nameParts[0] : prev.first_name,
          last_name: nameParts.length >= 2 ? nameParts.slice(1).join(' ') : prev.last_name,
          firm: nameParts.length === 1 ? q : prev.firm, // if single word, treat as firm
        }))
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [contactSearch])

  // When parsed data arrives, check for missing fields
  useEffect(() => {
    if (!edited) return
    const required: { key: keyof ParsedDeal; label: string }[] = [
      { key: 'company_name', label: 'Company Name' },
      { key: 'sector', label: 'Sector' },
      { key: 'geography', label: 'Geography' },
      { key: 'deal_type', label: 'Deal Type' },
      { key: 'stage', label: 'Stage' },
      { key: 'revenue', label: 'Revenue' },
      { key: 'ebitda', label: 'EBITDA' },
    ]
    const missing = required.filter(f => !edited[f.key])
    setMissingFields(missing)
  }, [edited])

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setFileName(file.name)
    setStage('uploading')
    setError(null)

    try {
      const base64 = await fileToBase64(file)
      setStage('parsing')

      const res = await fetch('/api/intake/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, fileName: file.name }),
      })

      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setParsed(data)
      setEdited({ ...data, stage: data.stage || 'Teaser' })

      // Auto-search for banker in DB
      if (data.banker_name) {
        const parts = data.banker_name.split(' ')
        const { data: contacts } = await supabase.from('contacts')
          .select('id, first_name, last_name, firm, title')
          .or(`first_name.ilike.%${parts[0]}%,last_name.ilike.%${parts[parts.length-1]}%`)
          .limit(5)
        if (contacts && contacts.length === 1) {
          setSelectedContact(contacts[0])
        } else if (contacts && contacts.length > 1) {
          setContactResults(contacts)
          setShowContactSearch(true)
        } else {
          // Not found — prompt to add
          const nameParts = data.banker_name.split(' ')
          setNewContactForm({
            first_name: nameParts[0] || '',
            last_name: nameParts.slice(1).join(' ') || '',
            firm: data.banker_firm || '',
            title: '',
            email: '',
            phone: '',
          })
          setShowAddContact(true)
        }
      }

      setStage('review')
    } catch (err: any) {
      setError(err.message || 'Parsing failed')
      setStage('idle')
    }
  }, [supabase])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: stage !== 'idle',
  })

  const updateField = (key: keyof ParsedDeal, value: any) => {
    setEdited(prev => prev ? { ...prev, [key]: value } : null)
  }

  const addNewContact = async () => {
    if (!newContactForm.first_name || !newContactForm.last_name) return
    const { data } = await supabase.from('contacts').insert({
      first_name: newContactForm.first_name,
      last_name: newContactForm.last_name,
      firm: newContactForm.firm || null,
      title: newContactForm.title || null,
      email: newContactForm.email || null,
      phone: newContactForm.phone || null,
      contact_type: 'banker',
      sub_type: 'M&A banker / intermediary',
      relationship_strength: 'Cold',
    }).select().single()
    if (data) {
      setSelectedContact(data)
      setShowAddContact(false)
    }
  }

  const handleSave = async (force = false) => {
    if (!edited) return

    // Check for duplicates unless user has confirmed
    if (!force && !ignoreDuplicate) {
      const name = edited.company_name?.trim()
      if (name) {
        const { data: existing } = await supabase
          .from('deals')
          .select('id, company_name, stage, status, created_at')
          .ilike('company_name', `%${name}%`)
          .limit(5)
        if (existing && existing.length > 0) {
          setDuplicateDeals(existing)
          return
        }
      }
    }

    setDuplicateDeals([])
    setStage('saving')

    const { data, error } = await supabase.from('deals').insert({
      company_name: edited.company_name || 'Unknown Company',
      sector: edited.sector || null,
      geography: edited.geography || null,
      description: edited.cim_summary || null,
      deal_type: edited.deal_type || 'platform',
      revenue: edited.revenue,
      ebitda: edited.ebitda,
      cim_summary: edited.cim_summary,
      cim_parsed: true,
      stage: edited.stage || 'Reviewing',
      status: 'Active',
      expected_close: new Date().toISOString().split('T')[0],
      source_notes: selectedContact?.firm || edited.banker_firm || null,
    }).select().single()

    if (error) {
      setError(error.message)
      setStage('review')
      return
    }

    // Link contact to deal
    if (selectedContact && data) {
      await supabase.from('contact_deal_links').insert({
        contact_id: selectedContact.id,
        deal_id: data.id,
        role: 'Source / Banker',
      })
    }

    setDealId(data.id)
    setStage('done')
  }

  const reset = () => {
    setStage('idle')
    setParsed(null)
    setEdited(null)
    setDealId(null)
    setError(null)
    setFileName('')
    setSelectedContact(null)
    setShowAddContact(false)
    setContactSearch('')
    setContactResults([])
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Teaser / CIM Intake</h1>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Upload a PDF — AI extracts deal data automatically</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '32px 28px', maxWidth: '680px' }}>

        {/* IDLE */}
        {stage === 'idle' && (
          <div
            {...getRootProps()}
            style={{
              border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '12px', padding: '60px 40px', textAlign: 'center',
              cursor: 'pointer', background: isDragActive ? 'var(--accent-muted)' : 'var(--surface)',
              transition: 'all 0.2s',
            }}
          >
            <input {...getInputProps()} />
            <Upload size={32} style={{ color: isDragActive ? 'var(--accent)' : 'var(--text-muted)', marginBottom: '16px', display: 'block', margin: '0 auto 16px' }} />
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Drop teaser or CIM here
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>PDF files only</div>
          </div>
        )}

        {/* PARSING */}
        {(stage === 'uploading' || stage === 'parsing') && (
          <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
            <Zap size={32} style={{ color: 'var(--accent)', marginBottom: '16px' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>
              {stage === 'uploading' ? `Uploading ${fileName}...` : `Parsing ${fileName}...`}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Claude is reading and extracting deal data</div>
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', gap: '6px' }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', animation: `pulse 1.2s ${i*0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* ERROR */}
        {error && (
          <div style={{ display: 'flex', gap: '10px', padding: '12px 16px', background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: 'var(--red)' }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}

        {/* REVIEW */}
        {stage === 'review' && edited && (
          <div className="fade-in">

            {/* Missing fields warning */}
            {missingFields.length > 0 && (
              <div style={{ display: 'flex', gap: '10px', padding: '12px 16px', background: 'rgba(237,117,32,0.08)', border: '1px solid rgba(237,117,32,0.2)', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: 'var(--orange)' }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <strong>Missing fields:</strong> {missingFields.map(f => f.label).join(', ')} — please fill these in before saving.
                </div>
              </div>
            )}

            <div className="card" style={{ padding: '24px', marginBottom: '16px' }}>
              <div className="label" style={{ marginBottom: '18px' }}>Deal Information</div>

              {/* Company */}
              <IntakeField label="Company *" required={!edited.company_name}>
                <input className="input" value={edited.company_name || ''} onChange={e => updateField('company_name', e.target.value)} placeholder="Company name" />
              </IntakeField>

              {/* Sector */}
              <IntakeField label="Sector *" required={!edited.sector}>
                <select className="select" value={edited.sector || ''} onChange={e => updateField('sector', e.target.value)}>
                  <option value="">Select sector</option>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </IntakeField>

              {/* Geography */}
              <IntakeField label="Geography *" required={!edited.geography}>
                <input className="input" value={edited.geography || ''} onChange={e => updateField('geography', e.target.value)} placeholder="e.g. Michigan, Texas" />
              </IntakeField>

              {/* Deal Type */}
              <IntakeField label="Deal Type *" required={!edited.deal_type}>
                <select className="select" value={edited.deal_type || ''} onChange={e => updateField('deal_type', e.target.value)}>
                  <option value="">Select type</option>
                  <option value="platform">Platform</option>
                  <option value="add-on">Add-On</option>
                  <option value="recap">Recap</option>
                  <option value="growth">Growth</option>
                </select>
              </IntakeField>

              {/* Stage */}
              <IntakeField label="Stage *" required={!edited.stage}>
                <select className="select" value={edited.stage || 'Reviewing'} onChange={e => updateField('stage', e.target.value)}>
                  <optgroup label="Active">
                    <option value="Teaser">Teaser</option>
                    <option value="Reviewing">Reviewing</option>
                    <option value="Pre-LOI">Pre-LOI</option>
                    <option value="LOI Submitted">LOI Submitted</option>
                    <option value="Exclusivity">Exclusivity</option>
                  </optgroup>
                  <optgroup label="Closed">
                    <option value="Closed (Platform)">Closed (Platform)</option>
                    <option value="Closed (Add-On)">Closed (Add-On)</option>
                  </optgroup>
                  <optgroup label="Pass">
                    <option value="Pass (DOA)">Pass (DOA)</option>
                    <option value="Pass (Pre-LOI)">Pass (Pre-LOI)</option>
                    <option value="Pass (Post-LOI)">Pass (Post-LOI)</option>
                  </optgroup>
                  <optgroup label="Other">
                    <option value="Hold">Hold</option>
                  </optgroup>
                </select>
              </IntakeField>

              {/* Revenue */}
              <IntakeField label="Revenue ($M) *" required={!edited.revenue}>
                <input className="input" type="number" step="0.1"
                  value={edited.revenue ? (edited.revenue / 1e6).toFixed(1) : ''}
                  onChange={e => updateField('revenue', e.target.value ? parseFloat(e.target.value) * 1e6 : null)}
                  placeholder="e.g. 18.5" />
              </IntakeField>

              {/* EBITDA */}
              <IntakeField label="EBITDA ($M) *" required={!edited.ebitda}>
                <input className="input" type="number" step="0.1"
                  value={edited.ebitda ? (edited.ebitda / 1e6).toFixed(1) : ''}
                  onChange={e => updateField('ebitda', e.target.value ? parseFloat(e.target.value) * 1e6 : null)}
                  placeholder="e.g. 4.2" />
              </IntakeField>

              {/* Source Contact */}
              <IntakeField label="Source Contact">
                {selectedContact ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '7px' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>{selectedContact.first_name} {selectedContact.last_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{selectedContact.firm || selectedContact.title}</div>
                    </div>
                    <button onClick={() => { setSelectedContact(null); setContactSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div ref={searchRef} style={{ position: 'relative' }}>
                    <div style={{ position: 'relative' }}>
                      <Search size={12} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        className="input"
                        placeholder={edited.banker_name ? `Search for "${edited.banker_name}" or firm...` : 'Search by name or firm...'}
                        value={contactSearch}
                        onChange={e => { setContactSearch(e.target.value); setShowContactSearch(true) }}
                        onFocus={() => setShowContactSearch(true)}
                        style={{ paddingLeft: '30px' }}
                      />
                    </div>
                    {showContactSearch && (contactResults.length > 0 || contactSearch.length > 2) && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                        {contactResults.length > 0 ? contactResults.map(c => (
                          <button key={c.id} onClick={() => { setSelectedContact(c); setShowContactSearch(false); setContactSearch('') }}
                            style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.firm || c.title}</div>
                          </button>
                        )) : (
                          <div style={{ padding: '10px 12px' }}>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>No contacts found for "{contactSearch}"</div>
                            <button className="btn btn-ghost" onClick={() => { setShowAddContact(true); setShowContactSearch(false) }} style={{ fontSize: '11px', padding: '4px 10px' }}>
                              <Plus size={11} /> Add as new contact
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <button className="btn btn-ghost" onClick={() => setShowAddContact(true)} style={{ fontSize: '11px', padding: '4px 10px', marginTop: '6px' }}>
                      <Plus size={11} /> Add new contact
                    </button>
                  </div>
                )}
              </IntakeField>
            </div>

            {/* Add new contact form */}
            {showAddContact && (
              <div className="card" style={{ padding: '20px', marginBottom: '16px', border: '1px solid var(--orange)', background: 'rgba(237,117,32,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div className="label">Banker not found — add to contacts</div>
                  <button onClick={() => setShowAddContact(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div><label className="label">First Name *</label><input className="input" value={newContactForm.first_name} onChange={e => setNewContactForm(p => ({ ...p, first_name: e.target.value }))} /></div>
                  <div><label className="label">Last Name *</label><input className="input" value={newContactForm.last_name} onChange={e => setNewContactForm(p => ({ ...p, last_name: e.target.value }))} /></div>
                  <div style={{ position: 'relative' }}><label className="label">Firm</label><FirmSearch value={newContactForm.firm} onChange={v => setNewContactForm(p => ({ ...p, firm: v }))} supabase={supabase} /></div>
                  <div><label className="label">Title</label><input className="input" value={newContactForm.title} onChange={e => setNewContactForm(p => ({ ...p, title: e.target.value }))} /></div>
                  <div><label className="label">Email</label><input className="input" type="email" value={newContactForm.email} onChange={e => setNewContactForm(p => ({ ...p, email: e.target.value }))} /></div>
                  <div><label className="label">Phone</label><input className="input" value={newContactForm.phone} onChange={e => setNewContactForm(p => ({ ...p, phone: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
                  <button className="btn btn-primary" onClick={addNewContact} disabled={!newContactForm.first_name || !newContactForm.last_name}>
                    <Plus size={13} /> Add Contact
                  </button>
                </div>
              </div>
            )}

            {/* AI Summary */}
            {edited.cim_summary && (
              <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
                <div className="label" style={{ marginBottom: '10px' }}>AI Summary</div>
                <textarea
                  className="input"
                  rows={5}
                  value={edited.cim_summary}
                  onChange={e => updateField('cim_summary', e.target.value)}
                  style={{ resize: 'vertical', fontSize: '13px', lineHeight: 1.7 }}
                />
              </div>
            )}

            {/* Duplicate warning */}
            {duplicateDeals.length > 0 && (
              <div style={{ marginBottom: '16px', padding: '16px', background: 'rgba(237,117,32,0.06)', border: '1px solid rgba(237,117,32,0.25)', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--orange)', marginBottom: '10px' }}>
                  ⚠ Possible duplicate — {duplicateDeals.length} similar deal{duplicateDeals.length > 1 ? 's' : ''} already exist{duplicateDeals.length === 1 ? 's' : ''}:
                </div>
                {duplicateDeals.map(d => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '6px' }}>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>{d.company_name}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>{d.stage} · {d.status}</span>
                    </div>
                    <Link href={`/deals/${d.id}`} style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                      View deal →
                    </Link>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button className="btn btn-ghost" onClick={() => setDuplicateDeals([])} style={{ fontSize: '12px' }}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={() => { setIgnoreDuplicate(true); handleSave(true) }} style={{ fontSize: '12px', background: 'var(--orange)' }}>
                    Save anyway — it's a different deal
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-ghost" onClick={reset}>Start over</button>
              <button
                className="btn btn-primary"
                onClick={() => handleSave(false)}
                disabled={missingFields.length > 0}
                title={missingFields.length > 0 ? `Fill in: ${missingFields.map(f => f.label).join(', ')}` : ''}
              >
                <Check size={14} /> Save as deal
              </button>
            </div>
          </div>
        )}

        {/* SAVING */}
        {stage === 'saving' && (
          <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Saving deal...</div>
          </div>
        )}

        {/* DONE */}
        {stage === 'done' && dealId && (
          <div className="card fade-in" style={{ padding: '40px', textAlign: 'center' }}>
            <Check size={40} style={{ color: 'var(--green)', marginBottom: '16px' }} />
            <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Deal created</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              {edited?.company_name} added to pipeline as "Reviewing"
              {selectedContact && ` · linked to ${selectedContact.first_name} ${selectedContact.last_name}`}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={reset}>Parse another</button>
              <Link href={`/deals/${dealId}`} className="btn btn-primary">
                View deal <ChevronRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

function FirmSearch({ value, onChange, supabase }: { value: string, onChange: (v: string) => void, supabase: any }) {
  const [firmSearch, setFirmSearch] = useState(value)
  const [firmResults, setFirmResults] = useState<string[]>([])
  const [showFirmResults, setShowFirmResults] = useState(false)
  const firmRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setFirmSearch(value) }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (firmRef.current && !firmRef.current.contains(e.target as Node)) setShowFirmResults(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!firmSearch.trim()) { setFirmResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('contacts')
        .select('firm')
        .ilike('firm', `%${firmSearch}%`)
        .not('firm', 'is', null)
        .limit(50)
      const unique = [...new Set((data || []).map((c: any) => c.firm).filter(Boolean))] as string[]
      setFirmResults(unique.slice(0, 8))
      setShowFirmResults(true)
    }, 200)
    return () => clearTimeout(timer)
  }, [firmSearch, supabase])

  return (
    <div ref={firmRef} style={{ position: 'relative' }}>
      <input
        className="input"
        value={firmSearch}
        placeholder="Search or type firm name..."
        onChange={e => { setFirmSearch(e.target.value); onChange(e.target.value) }}
        onFocus={() => firmSearch && setShowFirmResults(true)}
      />
      {showFirmResults && firmResults.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 60, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: '180px', overflow: 'auto' }}>
          {firmResults.map(firm => (
            <button key={firm} onClick={() => { onChange(firm); setFirmSearch(firm); setShowFirmResults(false) }}
              style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)', fontSize: '13px', color: 'var(--text-primary)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {firm}
            </button>
          ))}
          {!firmResults.includes(firmSearch) && firmSearch.length > 1 && (
            <button onClick={() => { onChange(firmSearch); setShowFirmResults(false) }}
              style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-muted)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              + Add "{firmSearch}" as new firm
            </button>
          )}
        </div>
      )}
    </div>
  )
}


function IntakeField({ label, children, required }: { label: string, children: React.ReactNode, required?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '12px', alignItems: 'start', marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: required ? 'var(--orange)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: '8px' }}>
        {label}{required && ' ⚠'}
      </div>
      <div>{children}</div>
    </div>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
