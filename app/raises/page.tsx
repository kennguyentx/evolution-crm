'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/types'
import { Plus } from 'lucide-react'
import Link from 'next/link'

export default function RaisesPage() {
  const [raises, setRaises] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [deals, setDeals] = useState<any[]>([])
  const [form, setForm] = useState({ name: '', deal_id: '', target_equity: '', target_debt: '', close_date: '', notes: '' })
  const supabase = createClient()

  useEffect(() => {
    const fetch = async () => {
      const [{ data: r }, { data: d }] = await Promise.all([
        supabase.from('capital_raises').select('*, deal:deals(company_name), commitments:lp_commitments(committed_amount, status)').order('created_at', { ascending: false }),
        supabase.from('deals').select('id, company_name').in('stage', ['Pre-LOI','LOI Submitted','Exclusivity']).order('company_name'),
      ])
      if (r) setRaises(r)
      if (d) setDeals(d)
      setLoading(false)
    }
    fetch()
  }, [])

  const createRaise = async () => {
    const payload: any = { name: form.name || null, deal_id: form.deal_id || null, close_date: form.close_date || null, notes: form.notes || null, status: 'Open' }
    if (form.target_equity) payload.target_equity = parseFloat(form.target_equity) * 1e6
    if (form.target_debt) payload.target_debt = parseFloat(form.target_debt) * 1e6
    await supabase.from('capital_raises').insert(payload)
    setShowForm(false)
    setForm({ name: '', deal_id: '', target_equity: '', target_debt: '', close_date: '', notes: '' })
    const { data } = await supabase.from('capital_raises').select('*, deal:deals(company_name), commitments:lp_commitments(committed_amount, status)').order('created_at', { ascending: false })
    if (data) setRaises(data)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Capital Raises</h1>
        <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowForm(!showForm)}>
          <Plus size={14} /> New Raise
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {showForm && (
          <div className="card" style={{ padding: '24px', marginBottom: '24px', maxWidth: '680px', border: '1px solid var(--accent)' }}>
            <div className="label" style={{ marginBottom: '16px' }}>New Capital Raise</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div><label className="label">Name</label><input className="input" placeholder="e.g. DiPonio Acquisition" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="label">Linked Deal</label>
                <select className="select" value={form.deal_id} onChange={e => setForm(p => ({ ...p, deal_id: e.target.value }))}>
                  <option value="">Select deal</option>
                  {deals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
                </select>
              </div>
              <div><label className="label">Target Equity ($M)</label><input className="input" type="number" step="0.1" placeholder="0.0" value={form.target_equity} onChange={e => setForm(p => ({ ...p, target_equity: e.target.value }))} /></div>
              <div><label className="label">Target Debt ($M)</label><input className="input" type="number" step="0.1" placeholder="0.0" value={form.target_debt} onChange={e => setForm(p => ({ ...p, target_debt: e.target.value }))} /></div>
              <div><label className="label">Target Close Date</label><input className="input" type="date" value={form.close_date} onChange={e => setForm(p => ({ ...p, close_date: e.target.value }))} /></div>
              <div><label className="label">Notes</label><input className="input" placeholder="Deal terms, conditions..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createRaise}>Create Raise</button>
            </div>
          </div>
        )}

        {loading ? <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
        : raises.length === 0 ? <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No capital raises yet.</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px', maxWidth: '1100px' }}>
            {raises.map(r => {
              const committed = (r.commitments || []).filter((c: any) => ['Committed','Funded'].includes(c.status)).reduce((s: number, c: any) => s + (c.committed_amount || 0), 0)
              const total_target = (r.target_equity || 0) + (r.target_debt || 0)
              const pct = total_target > 0 ? Math.min(100, Math.round((committed / total_target) * 100)) : 0
              const commitCount = (r.commitments || []).length

              return (
                <Link key={r.id} href={`/raises/${r.id}`} style={{ textDecoration: 'none' }}>
                  <div className="card" style={{ padding: '20px', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: 700 }}>{r.name || r.deal?.company_name || 'Unnamed Raise'}</div>
                        {r.deal?.company_name && r.name && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{r.deal.company_name}</div>}
                      </div>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: r.status === 'Closed' ? 'rgba(39,174,96,0.1)' : 'var(--accent-muted)', color: r.status === 'Closed' ? 'var(--green)' : 'var(--accent)' }}>{r.status}</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                      {r.target_equity > 0 && <div style={{ background: 'var(--surface-2)', borderRadius: '7px', padding: '10px 12px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Target Equity</div>
                        <div style={{ fontSize: '14px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatCurrency(r.target_equity)}</div>
                      </div>}
                      {r.target_debt > 0 && <div style={{ background: 'var(--surface-2)', borderRadius: '7px', padding: '10px 12px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Target Debt</div>
                        <div style={{ fontSize: '14px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatCurrency(r.target_debt)}</div>
                      </div>}
                    </div>

                    {total_target > 0 && (
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                          <span>{commitCount} commitment{commitCount !== 1 ? 's' : ''}</span>
                          <span>{formatCurrency(committed)} committed ({pct}%)</span>
                        </div>
                        <div style={{ height: '5px', background: 'var(--border)', borderRadius: '999px' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--green)' : 'var(--accent)', borderRadius: '999px', transition: 'width 0.3s' }} />
                        </div>
                      </div>
                    )}

                    {r.close_date && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Target close: {new Date(r.close_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
