'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { Deal, Interaction, DiligenceItem, DealCapitalAssignment } from '@/types'
import { formatCurrency, stageClass, contactTypeClass } from '@/types'
import { ArrowLeft, Check, X, Plus, Phone, Mail, ChevronDown, Search, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

const STAGES = ['Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity','Closed (Platform)','Closed (Add-On)','Pass (DOA)','Pass (Pre-LOI)','Pass (Post-LOI)','Hold']

const DEFAULT_DILIGENCE = [
  { category: 'financial', item: 'Audited financials (3 years)' },
  { category: 'financial', item: 'QoE / quality of earnings review' },
  { category: 'financial', item: 'Working capital analysis' },
  { category: 'legal', item: 'Corporate structure & ownership' },
  { category: 'legal', item: 'Material contracts review' },
  { category: 'legal', item: 'Litigation / contingent liabilities' },
  { category: 'operational', item: 'Customer concentration' },
  { category: 'operational', item: 'Backlog & pipeline review' },
  { category: 'operational', item: 'Key personnel / management assessment' },
  { category: 'operational', item: 'Equipment & fleet inventory' },
]

export default function DealDetailPage() {
  const params = useParams()
  const router = useRouter()
  const dealId = params.id as string
  const supabase = createClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const [deal, setDeal] = useState<Deal | null>(null)
  const [linkedContacts, setLinkedContacts] = useState<any[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [diligence, setDiligence] = useState<DiligenceItem[]>([])
  const [capital, setCapital] = useState<DealCapitalAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview'|'diligence'|'contacts'|'capital'|'activity'>('overview')
  const [editingStage, setEditingStage] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
  const [showContactSearch, setShowContactSearch] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const fetchAll = useCallback(async () => {
    const [dealRes, linksRes, interactionsRes, diligenceRes, capitalRes] = await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase.from('contact_deal_links').select('*, contact:contacts(*)').eq('deal_id', dealId),
      supabase.from('interactions').select('*, contact:contacts(first_name, last_name)').eq('deal_id', dealId).order('interaction_date', { ascending: false }),
      supabase.from('diligence_items').select('*').eq('deal_id', dealId).order('category'),
      supabase.from('deal_capital_assignments').select('*, contact:contacts(first_name, last_name, firm)').eq('deal_id', dealId),
    ])
    if (dealRes.data) setDeal(dealRes.data)
    if (linksRes.data) setLinkedContacts(linksRes.data)
    if (interactionsRes.data) setInteractions(interactionsRes.data)
    if (diligenceRes.data) setDiligence(diligenceRes.data)
    if (capitalRes.data) setCapital(capitalRes.data)
    setLoading(false)
  }, [supabase, dealId])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowContactSearch(false)
        setContactSearch('')
        setContactResults([])
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!contactSearch.trim()) { setContactResults([]); return }
    const timer = setTimeout(async () => {
      const q = contactSearch.trim()
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, firm, title, contact_type')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`)
        .limit(8)
      setContactResults(data || [])
    }, 250)
    return () => clearTimeout(timer)
  }, [contactSearch])

  const updateStage = async (stage: string) => {
    await supabase.from('deals').update({ stage }).eq('id', dealId)
    setDeal(prev => prev ? { ...prev, stage: stage as any } : null)
    setEditingStage(false)
  }

  const updateField = async (field: string, value: any) => {
    await supabase.from('deals').update({ [field]: value }).eq('id', dealId)
    setDeal(prev => prev ? { ...prev, [field]: value } : null)
  }

  const linkContact = async (contact: any) => {
    const alreadyLinked = linkedContacts.find(l => l.contact_id === contact.id)
    if (alreadyLinked) { setShowContactSearch(false); return }
    const { data } = await supabase.from('contact_deal_links').insert({
      contact_id: contact.id,
      deal_id: dealId,
      role: 'Source / Banker',
    }).select('*, contact:contacts(*)').single()
    if (data) setLinkedContacts(prev => [...prev, data])
    setShowContactSearch(false)
    setContactSearch('')
    setContactResults([])
  }

  const unlinkContact = async (linkId: string) => {
    await supabase.from('contact_deal_links').delete().eq('id', linkId)
    setLinkedContacts(prev => prev.filter(l => l.id !== linkId))
  }

  const deleteDeal = async () => {
    await supabase.from('diligence_items').delete().eq('deal_id', dealId)
    await supabase.from('contact_deal_links').delete().eq('deal_id', dealId)
    await supabase.from('interactions').delete().eq('deal_id', dealId)
    await supabase.from('deal_capital_assignments').delete().eq('deal_id', dealId)
    await supabase.from('deals').delete().eq('id', dealId)
    router.push('/deals')
  }

  const seedDiligence = async () => {
    const items = DEFAULT_DILIGENCE.map(d => ({ ...d, deal_id: dealId, status: 'Pending' }))
    const { data } = await supabase.from('diligence_items').insert(items).select()
    if (data) setDiligence(prev => [...prev, ...data])
  }

  const toggleDiligenceStatus = async (item: DiligenceItem) => {
    const next = item.status === 'Pending' ? 'In Progress'
      : item.status === 'In Progress' ? 'Complete'
      : item.status === 'Complete' ? 'Waived' : 'Pending'
    await supabase.from('diligence_items').update({ status: next }).eq('id', item.id)
    setDiligence(prev => prev.map(d => d.id === item.id ? { ...d, status: next } : d))
  }

  const addInteraction = async () => {
    const summary = prompt('Interaction summary:')
    if (!summary) return
    const { data } = await supabase.from('interactions').insert({
      deal_id: dealId,
      interaction_type: 'call',
      summary,
      interaction_date: new Date().toISOString(),
    }).select().single()
    if (data) setInteractions(prev => [data, ...prev])
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>
  if (!deal) return <div style={{ padding: '40px', color: 'var(--red)' }}>Deal not found.</div>

  const completedDiligence = diligence.filter(d => d.status === 'Complete' || d.status === 'Waived').length
  const diligencePct = diligence.length > 0 ? Math.round((completedDiligence / diligence.length) * 100) : 0

  const tabs = [
    { key: 'overview',   label: 'Overview' },
    { key: 'diligence',  label: `Diligence${diligence.length > 0 ? ` (${diligencePct}%)` : ''}` },
    { key: 'contacts',   label: `Contacts (${linkedContacts.length})` },
    { key: 'capital',    label: `Capital (${capital.length})` },
    { key: 'activity',   label: `Activity (${interactions.length})` },
  ]

  const sourceContacts = linkedContacts.filter(l => l.role === 'Source / Banker')

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* HEADER */}
      <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <Link href="/deals" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none', marginBottom: '10px' }}>
          <ArrowLeft size={12} /> Back to deals
        </Link>

        {/* Top row: name + stage selector (inline, not far right) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <EditableInline
            value={deal.company_name}
            onSave={v => updateField('company_name', v)}
            style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}
          />

          {/* Stage selector — right next to the name */}
          <div style={{ position: 'relative' }}>
            <button
              className={`badge ${stageClass(deal.stage)}`}
              style={{ cursor: 'pointer', fontSize: '12px', padding: '4px 12px', border: '1px solid currentColor', background: 'transparent' }}
              onClick={() => setEditingStage(!editingStage)}
            >
              {deal.stage} <ChevronDown size={11} style={{ display: 'inline', marginLeft: '4px' }} />
            </button>
            {editingStage && (
              <div style={{
                position: 'absolute', left: 0, top: '100%', marginTop: '4px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '8px', padding: '4px', zIndex: 50, minWidth: '160px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              }}>
                {STAGES.map(s => (
                  <button key={s} onClick={() => updateStage(s)} style={{
                    display: 'block', width: '100%', padding: '7px 12px',
                    background: s === deal.stage ? 'var(--accent-light)' : 'transparent',
                    border: 'none', borderRadius: '5px', cursor: 'pointer',
                    textAlign: 'left', fontSize: '12px',
                    color: s === deal.stage ? 'var(--accent)' : 'var(--text-primary)',
                    fontWeight: s === deal.stage ? 600 : 400,
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Deal type — platform or add-on */}
          <select
            className="select"
            value={deal.deal_type || 'platform'}
            onChange={e => updateField('deal_type', e.target.value)}
            style={{ width: 'auto', fontSize: '12px', padding: '3px 10px' }}
          >
            <option value="platform">Platform</option>
            <option value="add-on">Add-On</option>
            <option value="recap">Recap</option>
            <option value="growth">Growth</option>
          </select>

          {deal.cim_parsed && (
            <span style={{ fontSize: '11px', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              ● CIM Parsed
            </span>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--red)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
          >
            <Trash2 size={14} /> Delete deal
          </button>
        </div>

        {/* Sub-row: sector, geography */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
          {deal.sector && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{deal.sector}</span>}
          {deal.geography && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>· {deal.geography}</span>}
        </div>

        {/* Financials — Revenue first, then EBITDA */}
        <div style={{ display: 'flex', gap: '28px', marginTop: '14px' }}>
          {[
            { label: 'Revenue',  value: formatCurrency(deal.revenue) },
            { label: 'EBITDA',   value: formatCurrency(deal.ebitda), accent: true },
          ].map(({ label, value, accent }: any) => (
            <div key={label}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ fontSize: '16px', fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent)' : 'var(--text-primary)', marginTop: '2px' }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', padding: '0 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)} style={{
            padding: '11px 16px', border: 'none', background: 'transparent',
            fontSize: '13px', cursor: 'pointer',
            color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
            fontFamily: 'var(--font-sans)', fontWeight: activeTab === tab.key ? 600 : 400,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '900px' }}>

            {/* Left card — Deal Details */}
            <div className="card" style={{ padding: '20px' }}>
              <div className="label" style={{ marginBottom: '16px' }}>Deal Details</div>

              {/* Source contacts */}
              <div style={{ marginBottom: '14px' }}>
                <div className="label" style={{ marginBottom: '8px' }}>Source Contact(s)</div>
                {sourceContacts.map(link => (
                  <div key={link.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', background: 'var(--surface-2)',
                    borderRadius: '6px', marginBottom: '6px',
                    border: '1px solid var(--border)',
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>
                        {link.contact.first_name} {link.contact.last_name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
                        {link.contact.firm || link.contact.title || '—'}
                      </div>
                    </div>
                    <button onClick={() => unlinkContact(link.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}

                {/* Contact search */}
                <div ref={searchRef} style={{ position: 'relative', marginTop: '4px' }}>
                  {showContactSearch ? (
                    <div>
                      <div style={{ position: 'relative' }}>
                        <Search size={12} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input
                          className="input"
                          autoFocus
                          placeholder="Search contacts..."
                          value={contactSearch}
                          onChange={e => setContactSearch(e.target.value)}
                          style={{ paddingLeft: '28px', fontSize: '12px', padding: '6px 8px 6px 28px' }}
                        />
                      </div>
                      {contactResults.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px',
                          background: 'var(--surface)', border: '1px solid var(--border)',
                          borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                          maxHeight: '200px', overflow: 'auto',
                        }}>
                          {contactResults.map(c => (
                            <button key={c.id} onClick={() => linkContact(c)} style={{
                              display: 'block', width: '100%', padding: '9px 12px',
                              background: 'transparent', border: 'none', cursor: 'pointer',
                              textAlign: 'left', borderBottom: '1px solid var(--border-subtle)',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                                {c.first_name} {c.last_name}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {c.firm || c.title || c.contact_type}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => setShowContactSearch(true)} style={{ fontSize: '11px', padding: '4px 10px' }}>
                      <Plus size={11} /> Add source contact
                    </button>
                  )}
                </div>
              </div>

              <EditableField label="LOI Date"    value={deal.loi_date || ''}       onSave={v => updateField('loi_date', v)}        type="date" />
              <EditableField label="Entry Date"  value={deal.expected_close || ''}  onSave={v => updateField('expected_close', v)}  type="date" />
              <EditableField label="Geography"   value={deal.geography || ''}       onSave={v => updateField('geography', v)} />
              <EditableField label="Sector"      value={deal.sector || ''}          onSave={v => updateField('sector', v)} />
            </div>

            {/* Right card — Notes */}
            <div className="card" style={{ padding: '20px' }}>
              <div className="label" style={{ marginBottom: '16px' }}>Notes</div>
              <EditableField label="Description" value={deal.description || ''} onSave={v => updateField('description', v)} multiline />
              <EditableField label="Notes"       value={deal.notes || ''}       onSave={v => updateField('notes', v)}        multiline />
              {deal.cim_summary && (
                <div style={{ marginTop: '16px' }}>
                  <div className="label" style={{ marginBottom: '6px' }}>AI CIM Summary</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--surface-2)', borderRadius: '6px', padding: '12px', lineHeight: 1.7 }}>
                    {deal.cim_summary}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DILIGENCE */}
        {activeTab === 'diligence' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{completedDiligence} of {diligence.length} complete</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {diligence.length === 0 && (
                  <button className="btn btn-ghost" onClick={seedDiligence} style={{ fontSize: '12px' }}>Load default checklist</button>
                )}
                <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={async () => {
                  const item = prompt('New checklist item:')
                  if (!item) return
                  const { data } = await supabase.from('diligence_items').insert({ deal_id: dealId, item, status: 'Pending' }).select().single()
                  if (data) setDiligence(prev => [...prev, data])
                }}>
                  <Plus size={12} /> Add Item
                </button>
              </div>
            </div>
            {diligence.length > 0 && (
              <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', marginBottom: '20px' }}>
                <div style={{ height: '100%', width: `${diligencePct}%`, background: 'var(--accent)', borderRadius: '2px', transition: 'width 0.3s' }} />
              </div>
            )}
            {['financial','legal','operational','management',''].map(category => {
              const items = diligence.filter(d => (d.category || '') === category)
              if (items.length === 0) return null
              return (
                <div key={category} style={{ marginBottom: '20px' }}>
                  {category && <div className="label" style={{ marginBottom: '8px' }}>{category}</div>}
                  {items.map(item => (
                    <div key={item.id} className="card-2" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', marginBottom: '6px', cursor: 'pointer' }} onClick={() => toggleDiligenceStatus(item)}>
                      <div style={{
                        width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0,
                        border: `1.5px solid ${item.status === 'Complete' ? 'var(--green)' : item.status === 'In Progress' ? 'var(--accent)' : item.status === 'Waived' ? 'var(--text-muted)' : 'var(--border)'}`,
                        background: item.status === 'Complete' ? 'var(--green)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {item.status === 'Complete' && <Check size={10} color="white" strokeWidth={3} />}
                      </div>
                      <div style={{ flex: 1, fontSize: '13px', color: item.status === 'Waived' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: item.status === 'Waived' ? 'line-through' : 'none' }}>
                        {item.item}
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.status}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* CONTACTS */}
        {activeTab === 'contacts' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <div ref={searchRef} style={{ position: 'relative' }}>
                {showContactSearch ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                      <Search size={12} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input className="input" autoFocus placeholder="Search contacts..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} style={{ paddingLeft: '28px', width: '220px', fontSize: '12px' }} />
                    </div>
                    {contactResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', minWidth: '240px' }}>
                        {contactResults.map(c => (
                          <button key={c.id} onClick={() => linkContact(c)} style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.firm || c.title}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowContactSearch(true)}>
                    <Plus size={12} /> Link Contact
                  </button>
                )}
              </div>
            </div>
            {linkedContacts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No contacts linked to this deal.</div>
            ) : linkedContacts.map(link => {
              const c = link.contact
              return (
                <div key={link.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '13px' }}>{c.first_name} {c.last_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {c.title}{c.firm ? ` · ${c.firm}` : ''}{link.role ? ` · ${link.role}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className={`badge type-${c.contact_type}`}>{c.contact_type}</span>
                    {c.email && <a href={`mailto:${c.email}`} style={{ color: 'var(--text-muted)' }}><Mail size={13} /></a>}
                    {c.phone && <a href={`tel:${c.phone}`} style={{ color: 'var(--text-muted)' }}><Phone size={13} /></a>}
                    <button onClick={() => unlinkContact(link.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={13} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* CAPITAL */}
        {activeTab === 'capital' && (
          <div style={{ maxWidth: '700px' }}>
            {capital.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No LP or lender assignments yet.</div>
            ) : capital.map(a => (
              <div key={a.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', alignItems: 'center', gap: '12px' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13px' }}>{a.contact?.first_name} {a.contact?.last_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.contact?.firm}</div>
                </div>
                <span className="badge type-lender" style={{ justifySelf: 'start' }}>{a.role}</span>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent)', textAlign: 'right' }}>
                  {a.committed_amount ? formatCurrency(a.committed_amount) : '—'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>{a.status}</div>
              </div>
            ))}
          </div>
        )}

        {/* ACTIVITY */}
        {activeTab === 'activity' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={addInteraction}>
                <Plus size={12} /> Log Interaction
              </button>
            </div>
            {interactions.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No interactions logged yet.</div>
            ) : interactions.map(i => (
              <div key={i.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {i.interaction_type} · {format(new Date(i.interaction_date), 'MMM d, yyyy')}
                  {(i as any).contact && ` · ${(i as any).contact.first_name} ${(i as any).contact.last_name}`}
                </div>
                {i.summary && <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginTop: '6px' }}>{i.summary}</div>}
                {i.next_steps && <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '6px' }}>→ {i.next_steps}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ padding: '28px', maxWidth: '400px', width: '90%' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Delete this deal?</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
              This will permanently delete <strong>{deal.company_name}</strong> and all associated diligence, contacts, and activity. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteDeal}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EditableField({ label, value, onSave, type = 'text', multiline = false, placeholder }: {
  label: string, value: string, onSave: (v: string) => void,
  type?: string, multiline?: boolean, placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)

  useEffect(() => { setVal(value) }, [value])

  const save = () => { onSave(val); setEditing(false) }

  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '10px' }}>
      <div style={{ minWidth: '100px', fontSize: '11px', color: 'var(--text-muted)', paddingTop: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {editing ? (
        <div style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          {multiline ? (
            <textarea className="input" value={val} onChange={e => setVal(e.target.value)} rows={3} style={{ resize: 'vertical', fontSize: '13px' }} />
          ) : (
            <input className="input" value={val} type={type} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder={placeholder} style={{ fontSize: '13px' }} />
          )}
          <button className="btn btn-ghost" onClick={save} style={{ padding: '6px' }}><Check size={13} /></button>
          <button className="btn btn-ghost" onClick={() => { setEditing(false); setVal(value) }} style={{ padding: '6px' }}><X size={13} /></button>
        </div>
      ) : (
        <div style={{ flex: 1, fontSize: '13px', color: value ? 'var(--text-primary)' : 'var(--text-muted)', padding: '5px 6px', borderRadius: '5px', cursor: 'text', minHeight: '28px' }} onClick={() => setEditing(true)}>
          {value || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Click to edit</span>}
        </div>
      )}
    </div>
  )
}

function EditableInline({ value, onSave, style }: { value: string, onSave: (v: string) => void, style?: any }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  useEffect(() => { setVal(value) }, [value])
  const save = () => { if (val.trim()) { onSave(val); setEditing(false) } }
  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input
        autoFocus
        className="input"
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        style={{ fontSize: '22px', fontWeight: 700, padding: '4px 8px', width: '320px' }}
      />
      <button className="btn btn-primary" onClick={save} style={{ padding: '4px 10px', fontSize: '12px' }}>Save</button>
      <button className="btn btn-ghost" onClick={() => setEditing(false)} style={{ padding: '4px 10px', fontSize: '12px' }}>Cancel</button>
    </div>
  )
  return (
    <h1
      style={{ ...style, cursor: 'pointer', borderBottom: '1px dashed transparent', display: 'inline-block' }}
      onClick={() => setEditing(true)}
      title="Click to edit name"
      onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--text-muted)')}
      onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
    >
      {value}
    </h1>
  )
}
