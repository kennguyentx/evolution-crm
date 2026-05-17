'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/types'
import { Plus, Search, Users } from 'lucide-react'
import Link from 'next/link'

export default function InvestorsPage() {
  const [investors, setInvestors] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetch = async () => {
      // Get all LP contacts with their investment totals
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, firm, email, phone')
        .eq('contact_type', 'lp')
        .order('last_name')

      if (contacts) {
        // Get investment totals for each
        const enriched = await Promise.all(contacts.map(async c => {
          const [{ data: investments }, { data: commitments }] = await Promise.all([
            supabase.from('lp_investments').select('invested_amount, current_value, distributions_received').eq('contact_id', c.id),
            supabase.from('lp_commitments').select('committed_amount, status').eq('contact_id', c.id),
          ])
          const totalInvested = (investments || []).reduce((s, i) => s + (i.invested_amount || 0), 0)
          const totalCommitted = (commitments || []).filter(c => ['Committed','Funded'].includes(c.status)).reduce((s, c) => s + (c.committed_amount || 0), 0)
          const dealCount = (investments || []).length
          return { ...c, totalInvested, totalCommitted, dealCount }
        }))
        setInvestors(enriched)
      }
      setLoading(false)
    }
    fetch()
  }, [])

  const filtered = investors.filter(i =>
    `${i.first_name} ${i.last_name} ${i.firm}`.toLowerCase().includes(search.toLowerCase())
  )

  const totalDeployed = investors.reduce((s, i) => s + i.totalInvested, 0)
  const totalCommitted = investors.reduce((s, i) => s + i.totalCommitted, 0)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Investors</h1>
        <Link href="/investors/new" className="btn btn-primary" style={{ fontSize: '12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Plus size={14} /> Add Investor
        </Link>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '28px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Deployed</div>
            <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatCurrency(totalDeployed)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Committed Pipeline</div>
            <div style={{ fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatCurrency(totalCommitted)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Investors</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{investors.length}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '10px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ position: 'relative', maxWidth: '320px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search investors..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '30px' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '8px 28px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div>Investor</div><div style={{ textAlign: 'right' }}>Deployed</div><div style={{ textAlign: 'right' }}>Committed</div><div style={{ textAlign: 'right' }}>Deals</div><div></div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? <div style={{ padding: '40px 28px', color: 'var(--text-muted)' }}>Loading...</div>
        : filtered.length === 0 ? <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)' }}>No investors found. Add LP contacts first.</div>
        : filtered.map(inv => (
          <Link key={inv.id} href={`/investors/${inv.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="table-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '12px 28px', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: '13px' }}>{inv.first_name} {inv.last_name}</div>
                {inv.firm && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{inv.firm}</div>}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: inv.totalInvested > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{inv.totalInvested > 0 ? formatCurrency(inv.totalInvested) : '—'}</div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>{inv.totalCommitted > 0 ? formatCurrency(inv.totalCommitted) : '—'}</div>
              <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-secondary)' }}>{inv.dealCount > 0 ? inv.dealCount : '—'}</div>
              <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--accent)' }}>View →</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
