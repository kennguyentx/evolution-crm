'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { Deal, Contact, Interaction, DiligenceItem, DealCapitalAssignment } from '@/types'
import { formatCurrency, formatMultiple, stageClass, contactTypeClass } from '@/types'
import {
  ArrowLeft, Edit2, Check, X, Plus, Phone, Mail,
  DollarSign, FileText, Users, ChevronDown, Trash2
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

const STAGES = ['Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity','Closed (Platform)','Closed (Add-On)','Pass (DOA)','Pass (Pre-LOI)','Pass (Post-LOI)']

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

  const [deal, setDeal] = useState<Deal | null>(null)
  const [contacts, setContacts] = useState<any[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [diligence, setDiligence] = useState<DiligenceItem[]>([])
  const [capital, setCapital] = useState<DealCapitalAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'diligence' | 'contacts' | 'capital' | 'activity'>('overview')
  const [editingStage, setEditingStage] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchAll = useCallback(async () => {
    const [dealRes, contactsRes, interactionsRes, diligenceRes, capitalRes] = await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase.from('contact_deal_links').select('*, contact:contacts(*)').eq('deal_id', dealId),
      supabase.from('interactions').select('*, contact:contacts(first_name, last_name)').eq('deal_id', dealId).order('interaction_date', { ascending: false }),
      supabase.from('diligence_items').select('*').eq('deal_id', dealId).order('category'),
      supabase.from('deal_capital_assignments').select('*, contact:contacts(first_name, last_name, firm)').eq('deal_id', dealId),
    ])
    if (dealRes.data) setDeal(dealRes.data)
    if (contactsRes.data) setContacts(contactsRes.data)
    if (interactionsRes.data) setInteractions(interactionsRes.data)
    if (diligenceRes.data) setDiligence(diligenceRes.data)
    if (capitalRes.data) setCapital(capitalRes.data)
    setLoading(false)
  }, [supabase, dealId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const updateStage = async (stage: string) => {
    await supabase.from('deals').update({ stage }).eq('id', dealId)
    setDeal(prev => prev ? { ...prev, stage: stage as any } : null)
    setEditingStage(false)
  }

  const updateField = async (field: string, value: any) => {
    await supabase.from('deals').update({ [field]: value }).eq('id', dealId)
    setDeal(prev => prev ? { ...prev, [field]: value } : null)
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
    { key: 'overview', label: 'Overview' },
    { key: 'diligence', label: `Diligence ${diligence.length > 0 ? `(${diligencePct}%)` : ''}` },
    { key: 'contacts', label: `Contacts (${contacts.length})` },
    { key: 'capital', label: `Capital (${capital.length})` },
    { key: 'activity', label: `Activity (${interactions.length})` },
  ]

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '16px 28px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <Link href="/deals" style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none',
          marginBottom: '12px',
        }}>
          <ArrowLeft size={12} /> Back to deals
        </Link>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', color: 'var(--text-primary)' }}>
              {deal.company_name}
            </h1>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px' }}>
              {deal.sector && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{deal.sector}</span>}
              {deal.geography && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>· {deal.geography}</span>}
              {deal.deal_type && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>· {deal.deal_type}</span>}
            </div>
          </div>

          {/* Stage selector */}
          <div style={{ position: 'relative' }}>
            <button
              className={`badge ${stageClass(deal.stage)}`}
              style={{ cursor: 'pointer', fontSize: '12px', padding: '4px 12px', border: 'none' }}
              onClick={() => setEditingStage(!editingStage)}
            >
              {deal.stage} <ChevronDown size={11} style={{ display: 'inline', marginLeft: '4px' }} />
            </button>
            {editingStage && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: '8px', padding: '4px', zIndex: 50, minWidth: '140px',
              }}>
                {STAGES.map(s => (
                  <button
                    key={s}
                    onClick={() => updateStage(s)}
                    style={{
                      display: 'block', width: '100%', padding: '7px 12px',
                      background: s === deal.stage ? 'var(--surface-3)' : 'transparent',
                      border: 'none', borderRadius: '5px', cursor: 'pointer',
                      textAlign: 'left', fontSize: '12px', color: 'var(--text-primary)',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Financials row */}
        <div style={{ display: 'flex', gap: '24px', marginTop: '16px' }}>
          {[
            { label: 'EBITDA', value: formatCurrency(deal.ebitda), accent: true },
            { label: 'Revenue', value: formatCurrency(deal.revenue) },
            { label: 'Asking Price', value: formatCurrency(deal.asking_price) },
            { label: 'EV/EBITDA', value: formatMultiple(deal.ev_ebitda_multiple) },
          ].map(({ label, value, accent }) => (
            <div key={label}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{
                fontSize: '16px', fontFamily: 'var(--font-mono)',
                color: accent ? 'var(--accent)' : 'var(--text-primary)',
                marginTop: '2px',
              }}>
                {value}
              </div>
            </div>
          ))}
          {deal.cim_parsed && (
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '11px', color: 'var(--green)' }}>● CIM Parsed</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: '0', padding: '0 28px',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '12px 16px',
              border: 'none', background: 'transparent',
              fontSize: '13px', cursor: 'pointer',
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              fontFamily: 'var(--font-sans)',
              fontWeight: activeTab === tab.key ? 500 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '900px' }}>
            <div className="card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>
                Deal Details
              </div>
              <EditableField label="Source Type" value={deal.source_type || ''} onSave={v => updateField('source_type', v)} />
              <EditableField label="Source" value={deal.source_notes || ''} onSave={v => updateField('source_notes', v)} />
              <EditableField label="Debt Structure" value={deal.debt_structure || ''} onSave={v => updateField('debt_structure', v)} placeholder="e.g. 3.5x senior + 1.5x mezz" />
              <EditableField label="Target Leverage" value={deal.target_leverage || ''} onSave={v => updateField('target_leverage', v)} placeholder="e.g. 4.5x Total" />
              <EditableField label="Equity Structure" value={deal.equity_structure || ''} onSave={v => updateField('equity_structure', v)} />
              <EditableField label="LOI Date" value={deal.loi_date || ''} onSave={v => updateField('loi_date', v)} type="date" />
              <EditableField label="Expected Close" value={deal.expected_close || ''} onSave={v => updateField('expected_close', v)} type="date" />
            </div>

            <div className="card" style={{ padding: '20px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>
                Notes
              </div>
              <EditableField label="Description" value={deal.description || ''} onSave={v => updateField('description', v)} multiline />
              <EditableField label="Notes" value={deal.notes || ''} onSave={v => updateField('notes', v)} multiline />
              {deal.cim_summary && (
                <div style={{ marginTop: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>AI CIM Summary</div>
                  <div style={{
                    fontSize: '12px', color: 'var(--text-secondary)',
                    background: 'var(--surface-2)', borderRadius: '6px',
                    padding: '12px', lineHeight: 1.6,
                  }}>
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
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {completedDiligence} of {diligence.length} items complete
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {diligence.length === 0 && (
                  <button className="btn btn-ghost" onClick={seedDiligence} style={{ fontSize: '12px' }}>
                    Load default checklist
                  </button>
                )}
                <button className="btn btn-primary" style={{ fontSize: '12px' }}
                  onClick={async () => {
                    const item = prompt('New checklist item:')
                    if (!item) return
                    const { data } = await supabase.from('diligence_items').insert({ deal_id: dealId, item, status: 'Pending' }).select().single()
                    if (data) setDiligence(prev => [...prev, data])
                  }}>
                  <Plus size={12} /> Add Item
                </button>
              </div>
            </div>

            {/* Progress bar */}
            {diligence.length > 0 && (
              <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', marginBottom: '20px' }}>
                <div style={{ height: '100%', width: `${diligencePct}%`, background: 'var(--green)', borderRadius: '2px', transition: 'width 0.3s' }} />
              </div>
            )}

            {['financial', 'legal', 'operational', 'management', ''].map(category => {
              const items = diligence.filter(d => (d.category || '') === category)
              if (items.length === 0) return null
              return (
                <div key={category} style={{ marginBottom: '20px' }}>
                  {category && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', paddingLeft: '2px' }}>
                      {category}
                    </div>
                  )}
                  {items.map(item => (
                    <div key={item.id} className="card-2" style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '10px 14px', marginBottom: '6px', cursor: 'pointer',
                    }} onClick={() => toggleDiligenceStatus(item)}>
                      <div style={{
                        width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0,
                        border: `1.5px solid ${
                          item.status === 'Complete' ? 'var(--green)' :
                          item.status === 'In Progress' ? 'var(--accent)' :
                          item.status === 'Waived' ? 'var(--text-muted)' : 'var(--border)'
                        }`,
                        background: item.status === 'Complete' ? 'var(--green)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {item.status === 'Complete' && <Check size={10} color="black" strokeWidth={3} />}
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
              <Link href="/contacts" className="btn btn-ghost" style={{ fontSize: '12px' }}>
                <Plus size={12} /> Link Contact
              </Link>
            </div>
            {contacts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No contacts linked to this deal.</div>
            ) : contacts.map(link => {
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
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* CAPITAL */}
        {activeTab === 'capital' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }}>
                <Plus size={12} /> Add Capital Party
              </button>
            </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {i.interaction_type} · {format(new Date(i.interaction_date), 'MMM d, yyyy')}
                    {i.contact && ` · ${i.contact.first_name} ${i.contact.last_name}`}
                  </div>
                </div>
                {i.summary && <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginTop: '6px' }}>{i.summary}</div>}
                {i.next_steps && <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '6px' }}>→ {i.next_steps}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EditableField({ label, value, onSave, type = 'text', multiline = false, placeholder }: {
  label: string, value: string, onSave: (v: string) => void,
  type?: string, multiline?: boolean, placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)

  const save = () => { onSave(val); setEditing(false) }

  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '10px' }}>
      <div style={{ minWidth: '120px', fontSize: '11px', color: 'var(--text-muted)', paddingTop: '6px' }}>{label}</div>
      {editing ? (
        <div style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          {multiline ? (
            <textarea className="input" value={val} onChange={e => setVal(e.target.value)} rows={3} style={{ resize: 'vertical' }} />
          ) : (
            <input className="input" value={val} type={type} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder={placeholder} />
          )}
          <button className="btn btn-ghost" onClick={save} style={{ padding: '6px' }}><Check size={13} /></button>
          <button className="btn btn-ghost" onClick={() => { setEditing(false); setVal(value) }} style={{ padding: '6px' }}><X size={13} /></button>
        </div>
      ) : (
        <div
          style={{ flex: 1, fontSize: '13px', color: value ? 'var(--text-primary)' : 'var(--text-muted)', padding: '5px 6px', borderRadius: '5px', cursor: 'text', minHeight: '28px' }}
          onClick={() => setEditing(true)}
        >
          {value || <span style={{ fontStyle: 'italic' }}>Click to edit</span>}
        </div>
      )}
    </div>
  )
}
