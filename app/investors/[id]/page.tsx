'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/types'
import { ArrowLeft, Plus, X, Check, Building2 } from 'lucide-react'
import Link from 'next/link'

export default function InvestorPage() {
  const params = useParams()
  const investorId = params.id as string
  const supabase = createClient()

  const [investor, setInvestor] = useState<any>(null)
  const [entities, setEntities] = useState<any[]>([])
  const [investments, setInvestments] = useState<any[]>([])
  const [commitments, setCommitments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview'|'entities'|'investments'|'commitments'>('overview')
  const [portfolioCompanies, setPortfolioCompanies] = useState<any[]>([])

  // Entity form
  const [showEntityForm, setShowEntityForm] = useState(false)
  const [entityForm, setEntityForm] = useState({ name: '', entity_type: 'LLC', notes: '' })

  // Investment form
  const [showInvestmentForm, setShowInvestmentForm] = useState(false)
  const [investmentForm, setInvestmentForm] = useState({ entity_id: '', portfolio_company_id: '', invested_amount: '', investment_date: '', notes: '' })

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

  const createEntity = async () => {
    if (!entityForm.name) return
    const { data: entity } = await supabase.from('investment_entities').insert({
      name: entityForm.name,
      entity_type: entityForm.entity_type,
      notes: entityForm.notes || null,
      investor_id: investorId,
    }).select().single()
    setShowEntityForm(false)
    setEntityForm({ name: '', entity_type: 'LLC', notes: '' })
    fetchAll()
  }

  const addInvestment = async () => {
    const payload: any = {
      investor_id: investorId,
      entity_id: investmentForm.entity_id || null,
      portfolio_company_id: investmentForm.portfolio_company_id || null,
      investment_date: investmentForm.investment_date || null,
      notes: investmentForm.notes || null,
    }
    if (investmentForm.invested_amount) payload.invested_amount = parseFloat(investmentForm.invested_amount) * 1e6
    await supabase.from('lp_investments').insert(payload)
    setShowInvestmentForm(false)
    setInvestmentForm({ entity_id: '', portfolio_company_id: '', invested_amount: '', investment_date: '', notes: '' })
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

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <Link href="/investors" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none', marginBottom: '10px' }}>
          <ArrowLeft size={12} /> Investors
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700 }}>{investor.first_name} {investor.last_name}</h1>
          {investor.firm && <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{investor.firm}</span>}
          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{investor.investor_type}</span>
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

        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '900px' }}>
            <div className="card" style={{ padding: '20px' }}>
              <div className="label" style={{ marginBottom: '14px' }}>Contact Info</div>
              {investor.email && <div style={{ fontSize: '13px', marginBottom: '8px' }}><span style={{ color: 'var(--text-muted)', fontSize: '11px', marginRight: '8px', textTransform: 'uppercase' }}>Email</span>{investor.email}</div>}
              {investor.phone && <div style={{ fontSize: '13px', marginBottom: '8px' }}><span style={{ color: 'var(--text-muted)', fontSize: '11px', marginRight: '8px', textTransform: 'uppercase' }}>Phone</span>{investor.phone}</div>}
              {investor.notes && <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: 1.6 }}>{investor.notes}</div>}
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
                        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{inv.portfolio_company?.name || inv.deal?.company_name || 'Unknown'}</div>
                        {inv.entity?.name && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>via {inv.entity.name}</div>}
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>{formatCurrency(inv.invested_amount)}</span>
                    </div>
                  ))}
                  {/* Total */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: '2px solid var(--border)' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Total Invested</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(investments.reduce((s, i) => s + (i.invested_amount || 0), 0))}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

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
                      {['LLC','LP','Trust','Individual','Corp','Other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div><label className="label">Notes</label><input className="input" placeholder="EIN, address, contact..." value={entityForm.notes} onChange={e => setEntityForm(p => ({ ...p, notes: e.target.value }))} /></div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowEntityForm(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={createEntity} disabled={!entityForm.name}><Check size={13} /> Create Entity</button>
                </div>
              </div>
            )}
            {entities.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No entities yet — add investment vehicles above.</div>
            ) : entities.map(entity => (
              <div key={entity.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '7px', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Building2 size={14} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{entity.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{entity.entity_type}{entity.notes ? ` · ${entity.notes}` : ''}</div>
                  </div>
                </div>
                <button onClick={async () => { await supabase.from('investment_entities').delete().eq('id', entity.id); fetchAll() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'investments' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ marginBottom: '16px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowInvestmentForm(!showInvestmentForm)}>
                <Plus size={12} /> Add Investment
              </button>
            </div>
            {showInvestmentForm && (
              <div className="card" style={{ padding: '20px', marginBottom: '16px', border: '1px solid var(--accent)' }}>
                <div className="label" style={{ marginBottom: '14px' }}>Add Investment</div>
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
                    <input className="input" type="number" step="0.1" placeholder="0.0" value={investmentForm.invested_amount} onChange={e => setInvestmentForm(p => ({ ...p, invested_amount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Investment Date</label>
                    <input className="input" type="date" value={investmentForm.investment_date} onChange={e => setInvestmentForm(p => ({ ...p, investment_date: e.target.value }))} />
                  </div>
                </div>
                <div><label className="label">Notes</label><input className="input" placeholder="e.g. 20% co-invest, side letter terms" value={investmentForm.notes} onChange={e => setInvestmentForm(p => ({ ...p, notes: e.target.value }))} /></div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowInvestmentForm(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={addInvestment}><Check size={13} /> Save</button>
                </div>
              </div>
            )}
            {investments.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No investments recorded yet.</div>
            ) : investments.map(inv => (
              <div key={inv.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{inv.portfolio_company?.name || inv.deal?.company_name || 'Unknown'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {inv.entity?.name ? `via ${inv.entity.name}` : 'Direct'}
                    {inv.investment_date ? ` · ${new Date(inv.investment_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}
                    {inv.notes ? ` · ${inv.notes}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 600, color: 'var(--accent)' }}>{formatCurrency(inv.invested_amount)}</div>
                  <button onClick={async () => { if (confirm('Delete this investment?')) { await supabase.from('lp_investments').delete().eq('id', inv.id); fetchAll() } }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'commitments' && (
          <div style={{ maxWidth: '700px' }}>
            {commitments.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No commitments yet. Add from the Capital Raises page.</div>
            ) : commitments.map(c => (
              <div key={c.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.raise?.name || c.raise?.deal?.company_name || 'Unknown Raise'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {c.entity?.name ? `via ${c.entity.name}` : 'Direct'} · {c.commitment_type}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--accent)' }}>{formatCurrency(c.committed_amount)}</div>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: c.status === 'Funded' ? 'rgba(39,174,96,0.1)' : c.status === 'Committed' ? 'var(--accent-muted)' : 'var(--surface-2)', color: c.status === 'Funded' ? 'var(--green)' : c.status === 'Committed' ? 'var(--accent)' : 'var(--text-muted)' }}>{c.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
