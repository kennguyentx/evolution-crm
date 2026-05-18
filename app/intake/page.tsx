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

interface ParsedContact {
  name: string
  firm: string | null
  role: string
  title?: string | null
  email?: string | null
  phone?: string | null
}

interface ExtractedContact extends ParsedContact {
  crmContact?: any       // linked CRM contact record
  skip?: boolean         // user chose not to link
  searchQuery?: string
  searchResults?: any[]
  showSearch?: boolean
  showAddForm?: boolean
  addForm?: { first_name: string; last_name: string; firm: string; title: string; email: string; phone: string }
}

interface ParsedDeal {
  company_name: string
  sector: string
  geography: string
  deal_type: string
  stage: string
  revenue: number | null
  ebitda: number | null
  cim_summary: string
  contacts: ParsedContact[]
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
  const [contacts, setContacts] = useState<ExtractedContact[]>([])

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

  const updateContact = (idx: number, patch: Partial<ExtractedContact>) => {
    setContacts(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }

  const searchForContact = async (idx: number, query: string) => {
    updateContact(idx, { searchQuery: query, showSearch: true })
    if (!query.trim()) { updateContact(idx, { searchResults: [] }); return }
    const parts = query.trim().split(' ').filter(Boolean)
    let results: any[] = []
    if (parts.length >= 2) {
      const [firstRes, lastRes] = await Promise.all([
        supabase.from('contacts').select('id, first_name, last_name, firm, title').ilike('first_name', `%${parts[0]}%`).limit(100),
        supabase.from('contacts').select('id, first_name, last_name, firm, title').ilike('last_name', `%${parts[parts.length - 1]}%`).limit(100),
      ])
      const firstIds = new Set((firstRes.data || []).map((c: any) => c.id))
      results = (lastRes.data || []).filter((c: any) => firstIds.has(c.id))
      const { data: firmData } = await supabase.from('contacts').select('id, first_name, last_name, firm, title').ilike('firm', `%${query.trim()}%`).limit(8)
      const seen = new Set(results.map((c: any) => c.id))
      ;(firmData || []).forEach((c: any) => { if (!seen.has(c.id)) { results.push(c); seen.add(c.id) } })
    } else {
      const { data } = await supabase.from('contacts')
        .select('id, first_name, last_name, firm, title')
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,firm.ilike.%${query}%`)
        .limit(8)
      results = data || []
    }
    updateContact(idx, { searchResults: results.slice(0, 8) })
  }

  const autoLinkContact = async (idx: number, parsedContact: ParsedContact) => {
    if (!parsedContact.name) return
    const parts = parsedContact.name.split(' ')
    const { data } = await supabase.from('contacts')
      .select('id, first_name, last_name, firm, title')
      .or(`first_name.ilike.%${parts[0]}%,last_name.ilike.%${parts[parts.length - 1]}%`)
      .limit(5)
    const nameParts = parsedContact.name.split(' ')
    const defaultForm = {
      first_name: nameParts[0] || '',
      last_name: nameParts.slice(1).join(' ') || '',
      firm: parsedContact.firm || '',
      title: parsedContact.title || '',
      email: parsedContact.email || '',
      phone: parsedContact.phone || '',
    }
    if (data && data.length === 1) {
      updateContact(idx, { crmContact: data[0] })
    } else if (data && data.length > 1) {
      updateContact(idx, { searchResults: data, showSearch: true, searchQuery: parsedContact.name, addForm: defaultForm })
    } else {
      updateContact(idx, { showAddForm: true, addForm: defaultForm })
    }
  }

  const addNewContact = async (idx: number, contactType: string) => {
    const c = contacts[idx]
    if (!c.addForm?.first_name || !c.addForm?.last_name) return
    const { data } = await supabase.from('contacts').insert({
      first_name: c.addForm.first_name,
      last_name: c.addForm.last_name,
      firm: c.addForm.firm || null,
      title: c.addForm.title || null,
      email: c.addForm.email || null,
      phone: c.addForm.phone || null,
      contact_type: contactType,
    }).select().single()
    if (data) {
      updateContact(idx, { crmContact: data, showAddForm: false, showSearch: false })
      // Sync to Constant Contact (best-effort, non-blocking)
      fetch('/api/constant-contact/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: c.addForm.first_name,
          last_name: c.addForm.last_name,
          email: c.addForm.email || null,
          phone: c.addForm.phone || null,
          firm: c.addForm.firm || null,
          title: c.addForm.title || null,
        }),
      }).catch(() => {})
    }
  }

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setFileName(file.name)
    setStage('uploading')
    setError(null)

    try {
      // Get a signed upload URL from server (auto-creates Storage bucket if needed)
      const urlRes = await fetch('/api/intake/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      })
      if (!urlRes.ok) throw new Error(`Upload setup failed: ${(await urlRes.json()).error}`)
      const { signedUploadUrl, storagePath } = await urlRes.json()

      // PUT directly to Supabase Storage — bypasses Vercel's 4.5MB body limit
      const uploadRes = await fetch(signedUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      })
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`)

      setStage('parsing')

      const res = await fetch('/api/intake/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath, fileName: file.name }),
      })

      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setParsed(data)
      setEdited({ ...data, stage: data.stage || 'Teaser' })

      // Initialize contacts state
      const parsedContacts: ParsedContact[] = Array.isArray(data.contacts) ? data.contacts : []
      const initialContacts: ExtractedContact[] = parsedContacts.map(c => ({
        ...c,
        searchQuery: c.name,
        searchResults: [],
        showSearch: false,
        showAddForm: false,
        addForm: {
          first_name: c.name.split(' ')[0] || '',
          last_name: c.name.split(' ').slice(1).join(' ') || '',
          firm: c.firm || '',
          title: c.title || '',
          email: c.email || '',
          phone: c.phone || '',
        },
      }))
      setContacts(initialContacts)

      // Auto-link each contact
      initialContacts.forEach((_, i) => autoLinkContact(i, parsedContacts[i]))

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

  const handleSave = async (force = false) => {
    if (!edited) return

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

    const firstBanker = contacts.find(c => c.role === 'Source / Banker' && c.crmContact)
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
      source_notes: firstBanker?.crmContact?.firm || contacts.find(c => c.role === 'Source / Banker')?.firm || null,
    }).select().single()

    if (error) {
      setError(error.message)
      setStage('review')
      return
    }

    // Link all matched contacts to deal
    const linkedContacts = contacts.filter(c => c.crmContact && !c.skip)
    if (linkedContacts.length > 0 && data) {
      await Promise.all(linkedContacts.map(c =>
        supabase.from('contact_deal_links').insert({
          contact_id: c.crmContact.id,
          deal_id: data.id,
          role: c.role,
        })
      ))
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
    setContacts([])
    setDuplicateDeals([])
    setIgnoreDuplicate(false)
  }

  const linkedCount = contacts.filter(c => c.crmContact && !c.skip).length

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Teaser / CIM Intake</h1>
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
            <Upload size={32} style={{ color: isDragActive ? 'var(--accent)' : 'var(--text-muted)', display: 'block', margin: '0 auto 16px' }} />
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Drop teaser or CIM here
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>PDF files only</div>
          </div>
        )}

        {/* PARSING */}
        {(stage === 'uploading' || stage === 'parsing') && (
          <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
            <Zap size={32} style={{ color: 'var(--accent)', display: 'block', margin: '0 auto 16px' }} />
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

              <IntakeField label="Company *" required={!edited.company_name}>
                <input className="input" value={edited.company_name || ''} onChange={e => updateField('company_name', e.target.value)} placeholder="Company name" />
              </IntakeField>

              <IntakeField label="Sector *" required={!edited.sector}>
                <select className="select" value={edited.sector || ''} onChange={e => updateField('sector', e.target.value)}>
                  <option value="">Select sector</option>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </IntakeField>

              <IntakeField label="Geography *" required={!edited.geography}>
                <input className="input" value={edited.geography || ''} onChange={e => updateField('geography', e.target.value)} placeholder="e.g. Michigan, Texas" />
              </IntakeField>

              <IntakeField label="Deal Type *" required={!edited.deal_type}>
                <select className="select" value={edited.deal_type || ''} onChange={e => updateField('deal_type', e.target.value)}>
                  <option value="">Select type</option>
                  <option value="platform">Platform</option>
                  <option value="add-on">Add-On</option>
                  <option value="recap">Recap</option>
                  <option value="growth">Growth</option>
                </select>
              </IntakeField>

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

              <IntakeField label="Revenue ($M) *" required={!edited.revenue}>
                <input className="input" type="number" step="0.1"
                  value={edited.revenue ? (edited.revenue / 1e6).toFixed(1) : ''}
                  onChange={e => updateField('revenue', e.target.value ? parseFloat(e.target.value) * 1e6 : null)}
                  placeholder="e.g. 18.5" />
              </IntakeField>

              <IntakeField label="EBITDA ($M) *" required={!edited.ebitda}>
                <input className="input" type="number" step="0.1"
                  value={edited.ebitda ? (edited.ebitda / 1e6).toFixed(1) : ''}
                  onChange={e => updateField('ebitda', e.target.value ? parseFloat(e.target.value) * 1e6 : null)}
                  placeholder="e.g. 4.2" />
              </IntakeField>
            </div>

            {/* Contacts */}
            {contacts.length > 0 && (
              <div className="card" style={{ padding: '24px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div className="label">Contacts Found ({contacts.length})</div>
                  {linkedCount > 0 && <div style={{ fontSize: '11px', color: 'var(--green)' }}>{linkedCount} linked to CRM</div>}
                </div>

                {contacts.map((c, idx) => (
                  <ContactRow
                    key={idx}
                    contact={c}
                    onUpdate={patch => updateContact(idx, patch)}
                    onSearch={q => searchForContact(idx, q)}
                    onLinkCrm={crm => updateContact(idx, { crmContact: crm, showSearch: false, showAddForm: false })}
                    onAddNew={type => addNewContact(idx, type)}
                    supabase={supabase}
                  />
                ))}
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
                  <button className="btn btn-ghost" onClick={() => setDuplicateDeals([])} style={{ fontSize: '12px' }}>Cancel</button>
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
            <Check size={40} style={{ color: 'var(--green)', display: 'block', margin: '0 auto 16px' }} />
            <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Deal created</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              {edited?.company_name} added to pipeline
              {linkedCount > 0 && ` · ${linkedCount} contact${linkedCount > 1 ? 's' : ''} linked`}
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

// ── ContactRow ────────────────────────────────────────────────────────────────

function ContactRow({ contact, onUpdate, onSearch, onLinkCrm, onAddNew, supabase }: {
  contact: ExtractedContact
  onUpdate: (patch: Partial<ExtractedContact>) => void
  onSearch: (q: string) => void
  onLinkCrm: (crm: any) => void
  onAddNew: (type: string) => void
  supabase: any
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        onUpdate({ showSearch: false })
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const roleBadgeColor: Record<string, string> = {
    'Source / Banker': 'var(--accent)',
    'Management': 'var(--green)',
    'Advisor': '#7c6fcd',
    'Lender': '#d4a017',
    'Other': 'var(--text-muted)',
  }

  const contactTypeForRole: Record<string, string> = {
    'Source / Banker': 'banker',
    'Management': 'management',
    'Advisor': 'advisor',
    'Lender': 'lender',
    'Other': 'other',
  }

  if (contact.skip) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', marginBottom: '8px', opacity: 0.4, fontSize: '12px', color: 'var(--text-muted)' }}>
        <span>{contact.name} · skipped</span>
        <button onClick={() => onUpdate({ skip: false })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--accent)' }}>Undo</button>
      </div>
    )
  }

  return (
    <div ref={rowRef} style={{ marginBottom: '12px', padding: '12px', background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      {/* Contact header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: contact.crmContact ? '0' : '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{contact.name}</span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: roleBadgeColor[contact.role] || 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {contact.role}
            </span>
          </div>
          {contact.firm && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{contact.firm}{contact.title ? ` · ${contact.title}` : ''}</div>}
        </div>
        <button onClick={() => onUpdate({ skip: true })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }}>
          <X size={13} />
        </button>
      </div>

      {/* Linked CRM contact */}
      {contact.crmContact ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
          <Check size={12} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: 'var(--green)' }}>
            Linked to {contact.crmContact.first_name} {contact.crmContact.last_name}
            {contact.crmContact.firm ? ` · ${contact.crmContact.firm}` : ''}
          </span>
          <button onClick={() => onUpdate({ crmContact: undefined, showSearch: false })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            Change
          </button>
        </div>
      ) : (
        <>
          {/* Search / add form */}
          {!contact.showAddForm ? (
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', zIndex: 1 }} />
              <input
                className="input"
                placeholder={`Search CRM for ${contact.name}...`}
                value={contact.searchQuery || ''}
                onChange={e => onSearch(e.target.value)}
                onFocus={() => onUpdate({ showSearch: true })}
                style={{ paddingLeft: '28px', fontSize: '12px' }}
              />
              {contact.showSearch && ((contact.searchResults || []).length > 0 || (contact.searchQuery || '').length > 2) && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                  {(contact.searchResults || []).length > 0 ? (contact.searchResults || []).map((r: any) => (
                    <button key={r.id} onClick={() => onLinkCrm(r)}
                      style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ fontSize: '12px', fontWeight: 500 }}>{r.first_name} {r.last_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.firm || r.title}</div>
                    </button>
                  )) : (
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>No results — add to CRM?</div>
                      <button className="btn btn-ghost" onClick={() => onUpdate({ showAddForm: true, showSearch: false })} style={{ fontSize: '11px', padding: '4px 10px' }}>
                        <Plus size={11} /> Add {contact.name}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button className="btn btn-ghost" onClick={() => onUpdate({ showAddForm: true })} style={{ fontSize: '11px', padding: '3px 8px', marginTop: '5px' }}>
                <Plus size={11} /> Add to CRM
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <div>
                  <label className="label" style={{ fontSize: '10px' }}>First *</label>
                  <input className="input" style={{ fontSize: '12px' }} value={contact.addForm?.first_name || ''} onChange={e => onUpdate({ addForm: { ...contact.addForm!, first_name: e.target.value } })} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '10px' }}>Last *</label>
                  <input className="input" style={{ fontSize: '12px' }} value={contact.addForm?.last_name || ''} onChange={e => onUpdate({ addForm: { ...contact.addForm!, last_name: e.target.value } })} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '10px' }}>Firm</label>
                  <FirmSearch value={contact.addForm?.firm || ''} onChange={v => onUpdate({ addForm: { ...contact.addForm!, firm: v } })} supabase={supabase} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '10px' }}>Title</label>
                  <input className="input" style={{ fontSize: '12px' }} value={contact.addForm?.title || ''} onChange={e => onUpdate({ addForm: { ...contact.addForm!, title: e.target.value } })} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '10px' }}>Email</label>
                  <input className="input" style={{ fontSize: '12px' }} type="email" value={contact.addForm?.email || ''} onChange={e => onUpdate({ addForm: { ...contact.addForm!, email: e.target.value } })} />
                </div>
                <div>
                  <label className="label" style={{ fontSize: '10px' }}>Phone</label>
                  <input className="input" style={{ fontSize: '12px' }} value={contact.addForm?.phone || ''} onChange={e => onUpdate({ addForm: { ...contact.addForm!, phone: e.target.value } })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-ghost" onClick={() => onUpdate({ showAddForm: false })} style={{ fontSize: '11px', padding: '4px 10px' }}>Cancel</button>
                <button className="btn btn-primary" onClick={() => onAddNew(contactTypeForRole[contact.role] || 'other')}
                  disabled={!contact.addForm?.first_name || !contact.addForm?.last_name}
                  style={{ fontSize: '11px', padding: '4px 10px' }}>
                  <Check size={11} /> Add to CRM
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── FirmSearch ────────────────────────────────────────────────────────────────

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
      const unique = Array.from(new Set((data || []).map((c: any) => c.firm).filter(Boolean))) as string[]
      setFirmResults(unique.slice(0, 8))
      setShowFirmResults(true)
    }, 200)
    return () => clearTimeout(timer)
  }, [firmSearch, supabase])

  return (
    <div ref={firmRef} style={{ position: 'relative' }}>
      <input
        className="input"
        style={{ fontSize: '12px' }}
        value={firmSearch}
        placeholder="Search or type firm..."
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

// ── IntakeField ───────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
