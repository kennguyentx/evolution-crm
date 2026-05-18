'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatCurrencyFull as formatCurrency } from '@/types'
import { ArrowLeft, Plus, X, Check, Building2, Edit2, Trash2 } from 'lucide-react'
import Link from 'next/link'

const INVESTOR_TYPES = ['Individual', 'Family Office', 'Institutional', 'Fund of Funds', 'Other']
const ENTITY_TYPES = ['LLC', 'LP', 'Trust', 'Individual', 'Corp', 'Other']
const COMMITMENT_STATUSES = ['Interested', 'Soft Circle', 'Committed', 'Funded', 'Passed']

export default function InvestorPage() {
  const params = useParams()
  const router = useRouter()
  const investorId = params.id as string
  const supabase = createClient()

  const [investor, setInvestor] = useState<any>(null)
  const [entities, setEntities] = useState<any[]>([])
  const [investments, setInvestments] = useState<any[]>([])
  const [commitments, setCommitments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview'|'entities'|'investments'|'commitments'>('overview')
  const [portfolioCompanies, setPortfolioCompanies] = useState<any[]>([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Editing investor profile
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')

  // Entity form
  const [showEntityForm, setShowEntityForm] = useState(false)
  const [entityForm, setEntityForm] = useState({ name: '', entity_type: 'LLC', notes: '' })
  const [editingEntity, setEditingEntity] = useState<any>(null)

  // Investment form
  const [showInvestmentForm, setShowInvestmentForm] = useState(false)
  const [investmentForm, setInvestmentForm] = useState({ entity_id: '', portfolio_company_id: '', invested_amount: '', investment_date: '', notes: '' })
  const [editingInvestment, setEditingInvestment] = useState<any>(null)

  const fetchAll = useCallback(async () => {
    const [invRes, entitiesRes, investmentsRes, commitmentsRes, pcRes] = await Promise.all([
      supabase.from('investors').select('*').eq('id', investorId).single(),
      supabase.from('investment_entities').select('*').eq('investor_id', investorId).order('name'),
      supabase.from('lp_investments').select('*, entity:investment_entities(name), portfolio_company:portfolio_companies(name), deal:deals(company_name)').eq('investor_id', investorId).order('investment_date', { ascending: false }),
      supabase.from('lp_commitments').select('*, entity:investment_entities(name), raise:capital_raises(name, deal:deals(company_name))').eq('investor_id', investorId).order('created_at', { ascending: false }),
      supabase.from('portfolio_companies').select('id, name').order('name'),
    ])
    if (invRes.data) setInvestor(invRes.data)
    if (entitiesRes.data) setEntities(entitiesRes.data)
    if (investmentsRes.data) setInvestments(investmentsRes.data)
    if (commitmentsRes.data) setCommitments(commitmentsRes.data)
    if (pcRes.data) setPortfolioCompanies(pcRes.data)
    setLoading(false)
  }, [supabase, investorId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const updateInvestor = async (field: string, value: any) => {
    await supabase.from('investors').update({ [field]: value }).eq('id', investorId)
    setInvestor((p: any) => ({ ...p, [field]: value }))
    setEditingField(null)
  }

  const deleteInvestor = async () => {
    await supabase.from('lp_investments').delete().eq('investor_id', investorId)
    await supabase.from('lp_commitments').delete().eq('investor_id', investorId)
    await supabase.from('investment_entities').delete().eq('investor_id', investorId)
    await supabase.from('investors').delete().eq('id', investorId)
    router.push('/investors')
  }

  const startEdit = (field: string, val: string) => { setEditingField(field); setEditVal(val || '') }
  const saveEdit = (field: string) => updateInvestor(field, editVal)

  const createEntity = async () => {
    if (!entityForm.name) return
    await supabase.from('investment_entities').insert({ name: entityForm.name, entity_type: entityForm.entity_type, notes: entityForm.notes || null, investor_id: investorId })
    setShowEntityForm(false)
    setEntityForm({ name: '', entity_type: 'LLC', notes: '' })
    fetchAll()
  }

  const updateEntity = async (id: string, data: any) => {
    await supabase.from('investment_entities').update(data).eq('id', id)
    setEditingEntity(null)
    fetchAll()
  }

  const deleteEntity = async (id: string) => {
    await supabase.from('investment_entities').delete().eq('id', id)
    fetchAll()
  }

  const saveInvestment = async () => {
    const payload: any = {
      investor_id: investorId,
      entity_id: investmentForm.entity_id || null,
      portfolio_company_id: investmentForm.portfolio_company_id || null,
      investment_date: investmentForm.investment_date || null,
      notes: investmentForm.notes || null,
    }
    if (investmentForm.invested_amount) payload.invested_amount = parseFloat(investmentForm.invested_amount) * 1e6
    if (editingInvestment) {
      await supabase.from('lp_investments').update(payload).eq('id', editingInvestment.id)
    } else {
      await supabase.from('lp_investments').insert(payload)
    }
    setShowInvestmentForm(false)
    setEditingInvestment(null)
    setInvestmentForm({ entity_id: '', portfolio_company_id: '', invested_amount: '', investment_date: '', notes: '' })
    fetchAll()
  }

  const deleteInvestment = async (id: string) => {
    await supabase.from('lp_investments').delete().eq('id', id)
    fetchAll()
  }

  const updateCommitment = async (id: string, data: any) => {
    await supabase.from('lp_commitments').update(data).eq('id', id)
    fetchAll()
  }

  const deleteCommitment = async (id: string) => {
    await supabase.from('lp_commitments').delete().eq('id', id)
    fetchAll()
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>
  if (!investor) return <div style={{ padding: '40px', color: 'var(--red)' }}>Investor not found.</div>

  const totalInvested = investments.reduce((s, i) => s + (i.invested_amount || 0), 0)
  const totalCommitted = commitments.filter(c => ['Committed','Funded'].includes(c.status)).reduce((s, c) => s + (c.committed_amount || 0), 0)

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'entities', label: `Entities (${entities.length})` },
    { key: 'investments', label: `Investments (${investments.length})` },
    { key: 'commitments', label: `Commitments (${commitments.length})` },
  ]

  const InlineEdit = ({ field, value, label, type = 'text' }: { field: string, value: string, label: string, type?: string }) => (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
      <div style={{ minWidth: '80px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      {editingField === field ? (
        <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
          <input className="input" type={type} value={editVal} onChange={e => setEditVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEdit(field); if (e.key === 'Escape') setEditingField(null) }} autoFocus style={{ fontSize: '13px' }} />
          <button className="btn btn-ghost" onClick={() => saveEdit(field)} style={{ padding: '5px' }}><Check size={13} /></button>
          <button className="btn btn-ghost" onClick={() => setEditingField(null)} style={{ padding: '5px' }}><X size={13} /></button>
        </div>
      ) : (
        <div style={{ flex: 1, fontSize: '13px', color: value ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}
          onClick={() => startEdit(field, value)}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          {value || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Click to edit</span>}
          <Edit2 size={11} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        </div>
      )}
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <Link href="/investors" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none', marginBottom: '10px' }}>
          <ArrowLeft size={12} /> Investors
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {editingField === 'name' ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="input" value={editVal.split('|')[0] || ''} placeholder="First" onChange={e => setEditVal(`${e.target.value}|${editVal.split('|')[1] || ''}`)} style={{ fontSize: '18px', fontWeight: 700, width: '140px' }} autoFocus />
              <input className="input" value={editVal.split('|')[1] || ''} placeholder="Last" onChange={e => setEditVal(`${editVal.split('|')[0] || ''}|${e.target.value}`)} style={{ fontSize: '18px', fontWeight: 700, width: '160px' }} />
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => { const [f, l] = editVal.split('|'); updateInvestor('first_name', f); setTimeout(() => updateInvestor('last_name', l), 100); setEditingField(null) }}>Save</button>
              <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => setEditingField(null)}>Cancel</button>
            </div>
          ) : (
            <h1 style={{ fontSize: '22px', fontWeight: 700, cursor: 'pointer', borderBottom: '1px dashed transparent' }}
              onClick={() => startEdit('name', `${investor.first_name}|${investor.last_name}`)}
              onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--text-muted)')}
              onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}>
              {investor.first_name} {investor.last_name}
            </h1>
          )}
          <button onClick={() => setShowDeleteConfirm(true)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--red)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}>
            <Trash2 size={13} /> Delete investor
          </button>
        </div>
        <div style={{ display: 'flex', gap: '28px', marginTop: '14px' }}>
          {[
            { label: 'Total Deployed', value: formatCurrency(totalInvested), accent: true },
            { label: 'Committed (Open)', value: formatCurrency(totalCommitted) },
            { label: 'Investments', value: String(investments.length) },
            { label: 'Entities', value: String(entities.length) },
          ].map(({ label, value, accent }: any) => (
            <div key={label}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ fontSize: '16px', fontFamily: label.includes('Deploy') || label.includes('Commit') ? 'var(--font-mono)' : 'inherit', color: accent ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 600, marginTop: '2px' }}>{value || '—'}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', padding: '0 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)} style={{ padding: '11px 16px', border: 'none', background: 'transparent', fontSize: '13px', cursor: 'pointer', color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent', fontFamily: 'var(--font-sans)', fontWeight: activeTab === tab.key ? 600 : 400 }}>
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>

        {/* OVERVIEW — editable profile */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '900px' }}>
            <div className="card" style={{ padding: '20px' }}>
              <div className="label" style={{ marginBottom: '16px' }}>Profile</div>
              <InlineEdit field="firm" value={investor.firm || ''} label="Firm" />
              <InlineEdit field="email" value={investor.email || ''} label="Email" type="email" />
              <InlineEdit field="phone" value={investor.phone || ''} label="Phone" />
              <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ minWidth: '80px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Type</div>
                  <select className="select" value={investor.investor_type || 'Individual'} onChange={e => updateInvestor('investor_type', e.target.value)} style={{ fontSize: '12px', padding: '4px 8px', width: 'auto' }}>
                    {INVESTOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px' }}>Notes</div>
                {editingField === 'notes' ? (
                  <div>
                    <textarea className="input" rows={3} value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus style={{ resize: 'vertical', fontSize: '13px' }} />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <button className="btn btn-primary" onClick={() => saveEdit('notes')} style={{ fontSize: '11px' }}><Check size={11} /> Save</button>
                      <button className="btn btn-ghost" onClick={() => setEditingField(null)} style={{ fontSize: '11px' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: investor.notes ? 'var(--text-secondary)' : 'var(--text-muted)', cursor: 'pointer', padding: '6px', borderRadius: '4px', lineHeight: 1.6, fontStyle: investor.notes ? 'normal' : 'italic' }}
                    onClick={() => startEdit('notes', investor.notes || '')}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    {investor.notes || 'Click to add notes...'}
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ padding: '20px' }}>
              <div className="label" style={{ marginBottom: '14px' }}>Investment Breakdown</div>
              {investments.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No investments recorded yet</div>
              ) : (
                <>
                  {investments.map(inv => (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '13px', paddingBottom: '8px', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{inv.portfolio_company?.name || inv.deal?.company_name || 'Evolution Strategy Investments, LLC'}</div>
                        {inv.entity?.name && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>via {inv.entity.name}</div>}
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>{formatCurrency(inv.invested_amount)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: '2px solid var(--border)' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Total</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(totalInvested)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ENTITIES */}
        {activeTab === 'entities' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ marginBottom: '16px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowEntityForm(!showEntityForm)}>
                <Plus size={12} /> New Entity
              </button>
            </div>
            {showEntityForm && (
              <div className="card" style={{ padding: '20px', marginBottom: '16px', border: '1px solid var(--accent)' }}>
                <div className="label" style={{ marginBottom: '14px' }}>New Investment Entity</div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label className="label">Entity Name *</label><input className="input" placeholder="e.g. Smith Family Partners LLC" value={entityForm.name} onChange={e => setEntityForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div><label className="label">Type</label>
                    <select className="select" value={entityForm.entity_type} onChange={e => setEntityForm(p => ({ ...p, entity_type: e.target.value }))}>
                      {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div><label className="label">Notes</label><input className="input" placeholder="EIN, address, contact..." value={entityForm.notes} onChange={e => setEntityForm(p => ({ ...p, notes: e.target.value }))} /></div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowEntityForm(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={createEntity} disabled={!entityForm.name}><Check size={13} /> Create</button>
                </div>
              </div>
            )}
            {entities.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No entities yet.</div>
            : entities.map(entity => (
              <div key={entity.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px' }}>
                {editingEntity?.id === entity.id ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                    <input className="input" value={editingEntity.name} onChange={e => setEditingEntity((p: any) => ({ ...p, name: e.target.value }))} placeholder="Entity name" style={{ fontSize: '13px' }} />
                    <select className="select" value={editingEntity.entity_type} onChange={e => setEditingEntity((p: any) => ({ ...p, entity_type: e.target.value }))}>
                      {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input className="input" value={editingEntity.notes || ''} onChange={e => setEditingEntity((p: any) => ({ ...p, notes: e.target.value }))} placeholder="Notes" style={{ fontSize: '13px', gridColumn: 'span 2' }} />
                    <div style={{ display: 'flex', gap: '8px', gridColumn: 'span 2' }}>
                      <button className="btn btn-ghost" onClick={() => setEditingEntity(null)}>Cancel</button>
                      <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => updateEntity(entity.id, { name: editingEntity.name, entity_type: editingEntity.entity_type, notes: editingEntity.notes || null })}>
                        <Check size={13} /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '7px', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Building2 size={14} style={{ color: 'var(--accent)' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{entity.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{entity.entity_type}{entity.notes ? ` · ${entity.notes}` : ''}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => setEditingEntity({ ...entity })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}><Edit2 size={13} /></button>
                      <button onClick={() => { if (confirm(`Delete ${entity.name}?`)) deleteEntity(entity.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}><X size={13} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* INVESTMENTS */}
        {activeTab === 'investments' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ marginBottom: '16px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => { setShowInvestmentForm(!showInvestmentForm); setEditingInvestment(null); setInvestmentForm({ entity_id: '', portfolio_company_id: '', invested_amount: '', investment_date: '', notes: '' }) }}>
                <Plus size={12} /> Add Investment
              </button>
            </div>

            {(showInvestmentForm) && (
              <div className="card" style={{ padding: '20px', marginBottom: '16px', border: '1px solid var(--accent)' }}>
                <div className="label" style={{ marginBottom: '14px' }}>{editingInvestment ? 'Edit Investment' : 'Add Investment'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label className="label">Portfolio Company</label>
                    <select className="select" value={investmentForm.portfolio_company_id} onChange={e => setInvestmentForm(p => ({ ...p, portfolio_company_id: e.target.value }))}>
                      <option value="">Select company</option>
                      {portfolioCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Entity Invested Through</label>
                    <select className="select" value={investmentForm.entity_id} onChange={e => setInvestmentForm(p => ({ ...p, entity_id: e.target.value }))}>
                      <option value="">Direct</option>
                      {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Amount Invested ($M)</label>
                    <input className="input" type="number" step="0.001" placeholder="0.000" value={investmentForm.invested_amount} onChange={e => setInvestmentForm(p => ({ ...p, invested_amount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Investment Date</label>
                    <input className="input" type="date" value={investmentForm.investment_date} onChange={e => setInvestmentForm(p => ({ ...p, investment_date: e.target.value }))} />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="label">Notes</label>
                    <input className="input" placeholder="e.g. 20% co-invest, side letter terms" value={investmentForm.notes} onChange={e => setInvestmentForm(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn btn-ghost" onClick={() => { setShowInvestmentForm(false); setEditingInvestment(null) }}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveInvestment}><Check size={13} /> {editingInvestment ? 'Save Changes' : 'Add'}</button>
                </div>
              </div>
            )}

            {investments.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No investments recorded yet.</div>
            : investments.map(inv => (
              <div key={inv.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{inv.portfolio_company?.name || inv.deal?.company_name || 'Evolution Strategy Investments, LLC'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {inv.entity?.name ? `via ${inv.entity.name}` : 'Direct'}
                    {inv.investment_date ? ` · ${new Date(inv.investment_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}
                    {inv.notes ? ` · ${inv.notes}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 600, color: 'var(--accent)' }}>{formatCurrency(inv.invested_amount)}</div>
                  <button onClick={() => { setEditingInvestment(inv); setShowInvestmentForm(true); setInvestmentForm({ entity_id: inv.entity_id || '', portfolio_company_id: inv.portfolio_company_id || '', invested_amount: inv.invested_amount ? (inv.invested_amount / 1e6).toFixed(3) : '', investment_date: inv.investment_date || '', notes: inv.notes || '' }) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}><Edit2 size={13} /></button>
                  <button onClick={() => { if (confirm('Delete this investment?')) deleteInvestment(inv.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}><X size={13} /></button>
                </div>
              </div>
            ))}

            {investments.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', marginTop: '8px', borderTop: '2px solid var(--border)', background: 'var(--surface-2)', borderRadius: '7px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Total Invested</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(totalInvested)}</span>
              </div>
            )}
          </div>
        )}

        {/* COMMITMENTS */}
        {activeTab === 'commitments' && (
          <div style={{ maxWidth: '700px' }}>
            {commitments.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No commitments. Add from the Capital Raises page.</div>
            : commitments.map(c => (
              <div key={c.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.raise?.name || c.raise?.deal?.company_name || 'Evolution Strategy Investments, LLC'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {c.entity?.name ? `via ${c.entity.name}` : 'Direct'} · {c.commitment_type}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Editable amount */}
                    <input
                      type="number"
                      step="0.001"
                      defaultValue={c.committed_amount ? (c.committed_amount / 1e6).toFixed(3) : ''}
                      onBlur={async e => {
                        const val = parseFloat(e.target.value) * 1e6
                        if (!isNaN(val) && val !== c.committed_amount) updateCommitment(c.id, { committed_amount: val })
                      }}
                      style={{ width: '90px', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600, color: 'var(--accent)', background: 'transparent', border: '1px solid var(--border)', borderRadius: '5px', padding: '3px 6px', textAlign: 'right' }}
                    />
                    <select value={c.status} onChange={e => updateCommitment(c.id, { status: e.target.value })} style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid var(--border)', borderRadius: '5px', background: 'var(--surface)', cursor: 'pointer' }}>
                      {COMMITMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => { if (confirm('Delete this commitment?')) deleteCommitment(c.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}><X size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ padding: '28px', maxWidth: '400px', width: '90%' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Delete this investor?</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
              This will permanently delete <strong>{investor.first_name} {investor.last_name}</strong> and all their investments, entities, and commitments.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteInvestor}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
