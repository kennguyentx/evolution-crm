'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/types'
import { TrendingUp, TrendingDown, Building2 } from 'lucide-react'
import Link from 'next/link'

export default function PortfolioPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [latestFinancials, setLatestFinancials] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      const { data: cos } = await supabase.from('portfolio_companies').select('*').eq('status', 'Active').order('name')
      if (cos) {
        setCompanies(cos)
        const ids = cos.map((c: any) => c.id)
        const { data: fins } = await supabase.from('portfolio_financials').select('*').in('company_id', ids).order('period_end', { ascending: false })
        if (fins) {
          const latest: Record<string, any> = {}
          fins.forEach((f: any) => { if (!latest[f.company_id]) latest[f.company_id] = f })
          setLatestFinancials(latest)
        }
      }
      setLoading(false)
    }
    fetchData()
  }, [])

  const totalEbitda = Object.values(latestFinancials).reduce((s: number, f: any) => s + (f?.ebitda || 0), 0)
  const totalRevenue = Object.values(latestFinancials).reduce((s: number, f: any) => s + (f?.revenue || 0), 0)

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Portfolio</h1>
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

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {companies.map((company: any) => {
            const fin = latestFinancials[company.id]
            const ebitdaVsBudget = fin?.ebitda && fin?.ebitda_budget ? ((fin.ebitda - fin.ebitda_budget) / fin.ebitda_budget) * 100 : null
            const ebitdaVsPY = fin?.ebitda && fin?.ebitda_py ? ((fin.ebitda - fin.ebitda_py) / fin.ebitda_py) * 100 : null
            const margin = fin?.revenue && fin?.ebitda ? (fin.ebitda / fin.revenue) * 100 : null

            return (
              <Link key={company.id} href={`/portfolio/${company.id}`} style={{ textDecoration: 'none' }}>
                <div className="card" style={{ padding: '20px', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{company.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{company.sector}{company.geography ? ` · ${company.geography}` : ''}</div>
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
                        {fin.period_end && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{new Date(fin.period_end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>}
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
