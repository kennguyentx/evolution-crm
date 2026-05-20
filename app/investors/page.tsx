'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrencyFull as formatCurrency } from '@/types'
import { Plus, Search, X, Check } from 'lucide-react'
import Link from 'next/link'
import { useIsMobile } from '@/hooks/useIsMobile'

const INVESTOR_TYPES = ['Individual', 'Family Office', 'Institutional', 'Fund of Funds', 'Other']

export default function InvestorsPage() {
  const [investors, setInvestors] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [sortField, setSortField] = useState<'name'|'totalInvested'|'totalCommitted'|'dealCount'>('name')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    first_name: '', last_name: '', firm: '', email: '',
    phone: '', investor_type: 'Individual', notes: ''
  })
  const supabase = createClient()
  const isMobile = useIsMobile()

  const fetchInvestors = async () => {
    const [{ data }, { data: entityData }] = await Promise.all([
      supabase
        .from('investors')
        .select('*, investments:lp_investments(invested_amount), commitments:lp_commitments(committed_amount, status)')
        .eq('status', 'Active')
        .order('last_name'),
      supabase
        .from('investment_entities')
        .select('id, name, entity_type, investor_id')
        .order('name'),
    ])

    if (data) {
      const entitiesByInvestor: Record<string, any[]> = {}
      ;(entityData || []).forEach((e: any) => {
        if (!entitiesByInvestor[e.investor_id]) entitiesByInvestor[e.investor_id] = []
        entitiesByInvestor[e.investor_id].push(e)
      })
      const enriched = data.map(inv => ({
        ...inv,
        totalInvested: (inv.investments || []).reduce((s: number, i: any) => s + (i.invested_amount || 0), 0),
        totalCommitted: (inv.commitments || []).filter((c: any) => ['Committed','Funded'].includes(c.status)).reduce((s: number, c: any) => s + (c.committed_amount || 0), 0),
        dealCount: (inv.investments || []).length,
        entities: entitiesByInvestor[inv.id] || [],
      }))
      setInvestors(enriched)
    }
    setLoading(false)
  }

  useEffect(() => { fetchInvestors() }, [])

  const createInvestor = async () => {
    if (!form.first_name || !form.last_name) return
    setSaving(true)
    await supabase.from('investors').insert({
      first_name: form.first_name,
      last_name: form.last_name,
      firm: form.firm || null,
      email: form.email || null,
      phone: form.phone || null,
      investor_type: form.investor_type,
      notes: form.notes || null,
    })
    setSaving(false)
    setShowForm(false)
    setForm({ first_name: '', last_name: '', firm: '', email: '', phone: '', investor_type: 'Individual', notes: '' })
    fetchInvestors()
  }

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir(field === 'name' ? 'asc' : 'desc') }
  }

  const sorted = [...investors].sort((a, b) => {
    let av: any, bv: any
    if (sortField === 'name') { av = a.last_name; bv = b.last_name }
    else { av = a[sortField]; bv = b[sortField] }
    const cmp = av > bv ? 1 : av < bv ? -1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const filtered = sorted.filter(i =>
    `${i.first_name} ${i.last_name} ${i.firm || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  const totalDeployed = investors.reduce((s, i) => s + i.totalInvested, 0)
  const totalCommitted = investors.reduce((s, i) => s + i.totalCommitted, 0)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: isMobile ? '12px 16px' : '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 700 }}>Investors</h1>
          <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowForm(!showForm)}>
            <Plus size={14} /> Add Investor
          </button>
          {!isMobile && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '28px' }}>
              {totalDeployed > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Deployed</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatCurrency(totalDeployed)}</div>
                </div>
              )}
              {totalCommitted > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Committed Pipeline</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatCurrency(totalCommitted)}</div>
                </div>
              )}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Investors</div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{investors.length}</div>
              </div>
            </div>
          )}
          {isMobile && (
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
              {investors.length} investors
            </div>
          )}
        </div>
        {isMobile && (totalDeployed > 0 || totalCommitted > 0) && (
          <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
            {totalDeployed > 0 && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Deployed</div>
                <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatCurrency(totalDeployed)}</div>
              </div>
            )}
            {totalCommitted > 0 && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Committed</div>
                <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatCurrency(totalCommitted)}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add investor form */}
      {showForm && (
        <div style={{ padding: isMobile ? '16px' : '20px 28px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', flexShrink: 0 }}>
          <div style={{ maxWidth: '700px' }}>
            <div className="label" style={{ marginBottom: '14px' }}>New Investor</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '10px', marginBottom: '10px' }}>
              <div><label className="label">First Name *</label><input className="input" value={form.first_name} onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))} /></div>
              <div><label className="label">Last Name *</label><input className="input" value={form.last_name} onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))} /></div>
              <div><label className="label">Firm</label><input className="input" placeholder="Family office, fund..." value={form.firm} onChange={e => setForm(p => ({ ...p, firm: e.target.value }))} /></div>
              <div><label className="label">Type</label>
                <select className="select" value={form.investor_type} onChange={e => setForm(p => ({ ...p, investor_type: e.target.value }))}>
                  {INVESTOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div style={{ gridColumn: isMobile ? 'span 2' : 'span 2' }}><label className="label">Notes</label><input className="input" placeholder="Background, relationship..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createInvestor} disabled={saving || !form.first_name || !form.last_name}>
                <Check size={13} /> {saving ? 'Saving...' : 'Create Investor'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: isMobile ? '10px 16px' : '10px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ position: 'relative', maxWidth: isMobile ? '100%' : '320px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search investors..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '30px' }} />
        </div>
      </div>

      <div style={{ display: isMobile ? 'none' : 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '8px 28px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {[
          { key: 'name', label: 'Investor', align: 'left' },
          { key: 'totalInvested', label: 'Deployed', align: 'right' },
          { key: 'totalCommitted', label: 'Committed', align: 'right' },
          { key: 'dealCount', label: 'Investments', align: 'right' },
        ].map(({ key, label, align }) => (
          <div key={key} onClick={() => toggleSort(key as any)} style={{ textAlign: align as any, cursor: 'pointer', userSelect: 'none', color: sortField === key ? 'var(--accent)' : 'var(--text-muted)' }}>
            {label} {sortField === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </div>
        ))}
        <div></div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? <div style={{ padding: '40px 28px', color: 'var(--text-muted)' }}>Loading...</div>
        : filtered.length === 0 ? (
          <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)' }}>
            {investors.length === 0 ? 'No investors yet — add your first one above.' : 'No investors found.'}
          </div>
        ) : (
          <>
            {filtered.map(inv => (
              <Link key={inv.id} href={`/investors/${inv.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                {isMobile ? (
                  <div className="table-row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>{inv.first_name} {inv.last_name}</div>
                    {inv.firm && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{inv.firm}</div>}
                    <div style={{ display: 'flex', gap: '16px', marginTop: '6px' }}>
                      {inv.totalInvested > 0 && <div style={{ fontSize: '11px' }}><span style={{ color: 'var(--text-muted)' }}>Deployed: </span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>{formatCurrency(inv.totalInvested)}</span></div>}
                      {inv.totalCommitted > 0 && <div style={{ fontSize: '11px' }}><span style={{ color: 'var(--text-muted)' }}>Committed: </span><span style={{ fontFamily: 'var(--font-mono)' }}>{formatCurrency(inv.totalCommitted)}</span></div>}
                    </div>
                  </div>
                ) : (
                  <div className="table-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '8px 28px', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '13px' }}>{inv.first_name} {inv.last_name}</div>
                      {inv.firm && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{inv.firm}</div>
                      )}
                      {inv.entities && inv.entities.length > 0 && (
                        <div style={{ marginTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {inv.entities.map((e: any) => (
                            <span key={e.id} style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px', padding: '1px 6px' }}>
                              {e.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: inv.totalInvested > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{inv.totalInvested > 0 ? formatCurrency(inv.totalInvested) : '—'}</div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>{inv.totalCommitted > 0 ? formatCurrency(inv.totalCommitted) : '—'}</div>
                    <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-secondary)' }}>{inv.dealCount > 0 ? inv.dealCount : '—'}</div>
                    <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--accent)' }}>View →</div>
                  </div>
                )}
              </Link>
            ))}

            {/* Grand total row */}
            {isMobile ? (
              <div style={{ padding: '12px 16px', borderTop: '2px solid var(--border)', background: 'var(--surface-2)', position: 'sticky', bottom: 0 }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  Total — {filtered.length} investors
                </div>
                <div style={{ display: 'flex', gap: '20px' }}>
                  {filtered.reduce((s, i) => s + i.totalInvested, 0) > 0 && (
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deployed</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--accent)' }}>
                        {formatCurrency(filtered.reduce((s, i) => s + i.totalInvested, 0))}
                      </div>
                    </div>
                  )}
                  {filtered.reduce((s, i) => s + i.totalCommitted, 0) > 0 && (
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Committed</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatCurrency(filtered.reduce((s, i) => s + i.totalCommitted, 0))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '14px 28px', alignItems: 'center', borderTop: '2px solid var(--border)', background: 'var(--surface-2)', position: 'sticky', bottom: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Total ({filtered.length} investors)
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--accent)' }}>
                  {formatCurrency(filtered.reduce((s, i) => s + i.totalInvested, 0))}
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formatCurrency(filtered.reduce((s, i) => s + i.totalCommitted, 0))}
                </div>
                <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {filtered.reduce((s, i) => s + i.dealCount, 0)}
                </div>
                <div></div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
