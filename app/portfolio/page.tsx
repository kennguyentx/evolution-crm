'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/types'
import { TrendingUp, TrendingDown, Building2, Plus, X, Check } from 'lucide-react'
import Link from 'next/link'
import { useIsMobile } from '@/hooks/useIsMobile'

export default function PortfolioPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [latestFinancials, setLatestFinancials] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)

  // Add-company modal
  const [showAdd, setShowAdd] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newCo, setNewCo] = useState({
    name: '', sector: '', geography: '', acquisition_date: '', deal_type: 'Platform',
  })

  const supabase = createClient()
  const isMobile = useIsMobile()

  const fetchData = useCallback(async () => {
    const { data: cos } = await supabase
      .from('portfolio_companies')
      .select('*')
      .eq('status', 'Active')
      .order('name')
    if (cos) {
      setCompanies(cos)
      const ids = cos.map((c: any) => c.id)
      if (ids.length > 0) {
        const { data: fins } = await supabase
          .from('portfolio_financials')
          .select('*')
          .in('company_id', ids)
          .order('period_end', { ascending: false })
        if (fins) {
          const latest: Record<string, any> = {}
          fins.forEach((f: any) => { if (!latest[f.company_id]) latest[f.company_id] = f })
          setLatestFinancials(latest)
        }
      }
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  const addCompany = async () => {
    if (!newCo.name.trim()) return
    setAdding(true)
    await supabase.from('portfolio_companies').insert({
      name: newCo.name.trim(),
      sector: newCo.sector.trim() || null,
      geography: newCo.geography.trim() || null,
      deal_type: newCo.deal_type || null,
      acquisition_date: newCo.acquisition_date || null,
      status: 'Active',
    })
    setNewCo({ name: '', sector: '', geography: '', acquisition_date: '', deal_type: 'Platform' })
    setShowAdd(false)
    setAdding(false)
    await fetchData()
  }

  const totalEbitda  = Object.values(latestFinancials).reduce((s: number, f: any) => s + (f?.ebitda   || 0), 0)
  const totalRevenue = Object.values(latestFinancials).reduce((s: number, f: any) => s + (f?.revenue  || 0), 0)

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '14px 16px' : '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Portfolio</h1>
        <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowAdd(true)}>
          <Plus size={13} /> New Company
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '28px' }}>
          {totalRevenue > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Revenue</div>
              <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatCurrency(totalRevenue)}</div>
            </div>
          )}
          {totalEbitda > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total EBITDA</div>
              <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatCurrency(totalEbitda)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Add Company Modal */}
      {showAdd && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}
        >
          <div className="card" style={{ width: '440px', padding: '24px', position: 'relative' }}>
            <button
              onClick={() => setShowAdd(false)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              <X size={16} />
            </button>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px' }}>Add Portfolio Company</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="label">Company Name *</label>
                <input
                  className="input"
                  autoFocus
                  value={newCo.name}
                  onChange={e => setNewCo(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Sentry Safety"
                  onKeyDown={e => { if (e.key === 'Enter') addCompany() }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="label">Sector</label>
                  <input className="input" value={newCo.sector} onChange={e => setNewCo(p => ({ ...p, sector: e.target.value }))} placeholder="e.g. Safety Services" />
                </div>
                <div>
                  <label className="label">Geography</label>
                  <input className="input" value={newCo.geography} onChange={e => setNewCo(p => ({ ...p, geography: e.target.value }))} placeholder="e.g. Texas" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="label">Type</label>
                  <select className="select" value={newCo.deal_type} onChange={e => setNewCo(p => ({ ...p, deal_type: e.target.value }))}>
                    <option value="Platform">Platform</option>
                    <option value="Add-On">Add-On</option>
                  </select>
                </div>
                <div>
                  <label className="label">Acquisition Date</label>
                  <input className="input" type="date" value={newCo.acquisition_date} onChange={e => setNewCo(p => ({ ...p, acquisition_date: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={!newCo.name.trim() || adding}
                  onClick={addCompany}
                >
                  <Check size={13} /> {adding ? 'Adding...' : 'Add Company'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Company grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '16px' : '24px 28px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {companies.map((company: any) => {
            const fin = latestFinancials[company.id]
            const ebitdaVsBudget = fin?.ebitda && fin?.ebitda_budget ? ((fin.ebitda - fin.ebitda_budget) / fin.ebitda_budget) * 100 : null
            const ebitdaVsPY    = fin?.ebitda && fin?.ebitda_py    ? ((fin.ebitda - fin.ebitda_py)    / fin.ebitda_py)    * 100 : null
            const margin        = fin?.revenue && fin?.ebitda      ? (fin.ebitda / fin.revenue) * 100 : null

            return (
              <Link key={company.id} href={`/portfolio/${company.id}`} style={{ textDecoration: 'none' }}>
                <div
                  className="card"
                  style={{ padding: '20px', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{company.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {company.sector}{company.geography ? ` · ${company.geography}` : ''}
                        {company.deal_type && <span style={{ marginLeft: '6px', background: 'var(--surface-2)', borderRadius: '4px', padding: '1px 6px', fontSize: '10px' }}>{company.deal_type}</span>}
                      </div>
                    </div>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Building2 size={16} style={{ color: 'var(--accent)' }} />
                    </div>
                  </div>

                  {fin ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                        <div style={{ background: 'var(--surface-2)', borderRadius: '7px', padding: '10px 12px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' }}>Revenue</div>
                          <div style={{ fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatCurrency(fin.revenue)}</div>
                        </div>
                        <div style={{ background: 'var(--surface-2)', borderRadius: '7px', padding: '10px 12px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' }}>EBITDA</div>
                          <div style={{ fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatCurrency(fin.ebitda)}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {margin !== null && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Margin: <strong>{margin.toFixed(1)}%</strong></div>}
                        {ebitdaVsBudget !== null && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: ebitdaVsBudget >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {ebitdaVsBudget >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                            {Math.abs(ebitdaVsBudget).toFixed(1)}% vs budget
                          </div>
                        )}
                        {ebitdaVsPY !== null && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: ebitdaVsPY >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {ebitdaVsPY >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                            {Math.abs(ebitdaVsPY).toFixed(1)}% vs PY
                          </div>
                        )}
                        {fin.period_end && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                            {new Date(fin.period_end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No financials entered yet — click to add</div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
