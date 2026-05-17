'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/types'
import { ArrowLeft, Plus, X, Check, Search } from 'lucide-react'
import Link from 'next/link'

const STATUSES = ['Interested', 'Soft Circle', 'Committed', 'Funded', 'Passed']
const STATUS_COLORS: Record<string, string> = {
  'Funded': 'var(--green)', 'Committed': 'var(--accent)',
  'Soft Circle': '#d4a017', 'Interested': 'var(--text-muted)', 'Passed': 'var(--red)'
}

export default function RaiseDetailPage() {
  const params = useParams()
  const raiseId = params.id as string
  const supabase = createClient()

  const [raise, setRaise] = useState<any>(null)
  const [commitments, setCommitments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
  const [selectedContact, setSelectedContact] = useState<any>(null)
  const [entities, setEntities] = useState<any[]>([])
  const [form, setForm] = useState({ entity_id: '', committed_amount: '', commitment_type: 'equity', status: 'Interested', committed_date: '', notes: '' })

  const fetchAll = useCallback(async () => {
    const [raiseRes, commitmentsRes] = await Promise.all([
      supabase.from('capital_raises').select('*, deal:deals(id, company_name, stage)').eq('id', raiseId).single(),
      supabase.from('lp_commitments').select('*, investor:investors(first_name, last_name, firm), entity:investment_entities(name)').eq('raise_id', raiseId).order('committed_amount', { ascending: false }),
    ])
    if (raiseRes.data) setRaise(raiseRes.data)
    if (commitmentsRes.data) setCommitments(commitmentsRes.data)
    setLoading(false)
  }, [supabase, raiseId])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    if (!contactSearch.trim()) { setContactResults([]); return }
    const timer = setTimeout(async () => {
      const q = contactSearch.trim()
      const { data } = await supabase.from('investors').select('id, first_name, last_name, firm, investor_type').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`).limit(8)
      setContactResults(data || [])
    }, 250)
    return () => clearTimeout(timer)
  }, [contactSearch])

  useEffect(() => {
    if (!selectedContact) return
    supabase.from('investment_entities').select('*').eq('investor_id', selectedContact.id).then(({ data }) => {
      setEntities(data || [])
    })
  }, [selectedContact])

  const addCommitment = async () => {
    if (!selectedContact) return
    const payload: any = {
      raise_id: raiseId,
      investor_id: selectedContact.id,
      entity_id: form.entity_id || null,
      commitment_type: form.commitment_type,
      status: form.status,
      committed_date: form.committed_date || null,
      notes: form.notes || null,
    }
    if (form.committed_amount) payload.committed_amount = parseFloat(form.committed_amount) * 1e6
    await supabase.from('lp_commitments').insert(payload)
    setShowForm(false)
    setSelectedContact(null)
    setContactSearch('')
    setEntities([])
    setForm({ entity_id: '', committed_amount: '', commitment_type: 'equity', status: 'Interested', committed_date: '', notes: '' })
    fetchAll()
  }

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('lp_commitments').update({ status }).eq('id', id)
    setCommitments(prev => prev.map(c => c.id === id ? { ...c, status } : c))
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>
  if (!raise) return <div style={{ padding: '40px', color: 'var(--red)' }}>Raise not found.</div>

  const total_target = (raise.target_equity || 0) + (raise.target_debt || 0)
  const committed = commitments.filter(c => ['Committed','Funded'].includes(c.status)).reduce((s, c) => s + (c.committed_amount || 0), 0)
  const funded = commitments.filter(c => c.status === 'Funded').reduce((s, c) => s + (c.committed_amount || 0), 0)
  const pct = total_target > 0 ? Math.min(100, Math.round((committed / total_target) * 100)) : 0

  const byStatus = STATUSES.map(s => ({ status: s, items: commitments.filter(c => c.status === s) })).filter(g => g.items.length > 0)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <Link href="/raises" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none', marginBottom: '10px' }}>
          <ArrowLeft size={12} /> Capital Raises
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700 }}>{raise.name || raise.deal?.company_name || 'Unnamed Raise'}</h1>
          {raise.deal && <Link href={`/deals/${raise.deal.id}`} style={{ fontSize: '12px', color: 'var(--accent)', textDecoration: 'none' }}>{raise.deal.company_name} →</Link>}
          <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '999px', background: raise.status === 'Closed' ? 'rgba(39,174,96,0.1)' : 'var(--accent-muted)', color: raise.status === 'Closed' ? 'var(--green)' : 'var(--accent)' }}>{raise.status}</span>
        </div>

        <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
          {[
            { label: 'Target Equity', value: formatCurrency(raise.target_equity) },
            { label: 'Target Debt', value: formatCurrency(raise.target_debt) },
            { label: 'Committed', value: formatCurrency(committed), accent: true },
            { label: 'Funded', value: formatCurrency(funded) },
            { label: '% Committed', value: pct + '%' },
          ].filter(({ value }) => value !== formatCurrency(0) && value !== '0%').map(({ label, value, accent }: any) => (
            <div key={label}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ fontSize: '16px', fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 600, marginTop: '2px' }}>{value}</div>
            </div>
          ))}
        </div>

        {total_target > 0 && (
          <div style={{ marginTop: '14px', maxWidth: '500px' }}>
            <div style={{ height: '6px', background: 'var(--border)', borderRadius: '999px' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--green)' : 'var(--accent)', borderRadius: '999px', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        <div style={{ marginBottom: '20px' }}>
          <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowForm(!showForm)}>
            <Plus size={12} /> Add Commitment
          </button>
        </div>

        {showForm && (
          <div className="card" style={{ padding: '24px', marginBottom: '24px', maxWidth: '680px', border: '1px solid var(--accent)' }}>
            <div className="label" style={{ marginBottom: '16px' }}>Add LP Commitment</div>

            {/* Contact search */}
            <div style={{ marginBottom: '14px' }}>
              <label className="label">Investor *</label>
              {selectedContact ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '7px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{selectedContact.first_name} {selectedContact.last_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{selectedContact.firm}</div>
                  </div>
                  <button onClick={() => { setSelectedContact(null); setContactSearch(''); setEntities([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={13} /></button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={12} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input className="input" placeholder="Search by name or firm..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} style={{ paddingLeft: '30px' }} />
                  </div>
                  {contactResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                      {contactResults.map(c => (
                        <button key={c.id} onClick={() => { setSelectedContact(c); setContactSearch(''); setContactResults([]) }}
                          style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.firm || c.investor_type}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {entities.length > 0 && (
                <div>
                  <label className="label">Investing Entity</label>
                  <select className="select" value={form.entity_id} onChange={e => setForm(p => ({ ...p, entity_id: e.target.value }))}>
                    <option value="">Direct</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Amount ($M)</label>
                <input className="input" type="number" step="0.1" placeholder="0.0" value={form.committed_amount} onChange={e => setForm(p => ({ ...p, committed_amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">Type</label>
                <select className="select" value={form.commitment_type} onChange={e => setForm(p => ({ ...p, commitment_type: e.target.value }))}>
                  <option value="equity">Equity</option>
                  <option value="debt">Debt</option>
                  <option value="mezz">Mezz</option>
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Commitment Date</label>
                <input className="input" type="date" value={form.committed_date} onChange={e => setForm(p => ({ ...p, committed_date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" placeholder="Terms, conditions..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addCommitment} disabled={!selectedContact}><Check size={13} /> Add Commitment</button>
            </div>
          </div>
        )}

        {/* Commitments grouped by status */}
        {commitments.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No commitments yet. Add your first LP above.</div>
        ) : byStatus.map(({ status, items }) => (
          <div key={status} style={{ marginBottom: '24px', maxWidth: '700px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: STATUS_COLORS[status], textTransform: 'uppercase', letterSpacing: '0.06em' }}>{status}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{items.length} · {formatCurrency(items.reduce((s, c) => s + (c.committed_amount || 0), 0))}</span>
            </div>
            {items.map(c => (
              <div key={c.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.investor?.first_name} {c.investor?.last_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {c.entity?.name ? `via ${c.entity.name}` : 'Direct'}
                    {c.investor?.firm ? ` · ${c.investor.firm}` : ''}
                    {c.commitment_type !== 'equity' ? ` · ${c.commitment_type}` : ''}
                    {c.notes ? ` · ${c.notes}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 600, color: 'var(--accent)' }}>{formatCurrency(c.committed_amount)}</div>
                  <select value={c.status} onChange={e => updateStatus(c.id, e.target.value)} style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid var(--border)', borderRadius: '5px', background: 'var(--surface)', cursor: 'pointer', color: STATUS_COLORS[c.status] }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
