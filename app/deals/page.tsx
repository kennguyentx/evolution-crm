'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Deal, DealStage } from '@/types'
import { formatCurrency, formatMultiple, stageClass } from '@/types'
import { Plus, Search, SlidersHorizontal, ArrowUpDown } from 'lucide-react'
import Link from 'next/link'
import NewDealModal from '@/components/deals/NewDealModal'
import { format } from 'date-fns'

const ALL_STAGES: DealStage[] = ['Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity','Closed (Platform)','Closed (Add-On)','Pass (DOA)','Pass (Pre-LOI)','Pass (Post-LOI)','Hold']

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('Active')
  const [showNewDeal, setShowNewDeal] = useState(false)
  const supabase = createClient()

  const fetchDeals = useCallback(async () => {
    let query = supabase.from('deals').select('*').order('updated_at', { ascending: false })
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (stageFilter !== 'all') query = query.eq('stage', stageFilter)
    const { data } = await query
    if (data) setDeals(data)
    setLoading(false)
  }, [supabase, statusFilter, stageFilter])

  useEffect(() => { fetchDeals() }, [fetchDeals])

  const filtered = deals.filter(d =>
    d.company_name.toLowerCase().includes(search.toLowerCase()) ||
    (d.sector || '').toLowerCase().includes(search.toLowerCase()) ||
    (d.geography || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalEbitda = filtered.reduce((s, d) => s + (d.ebitda || 0), 0)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '20px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexShrink: 0,
      }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px' }}>Deals</h1>
        <button className="btn btn-primary" onClick={() => setShowNewDeal(true)}>
          <Plus size={14} /> New Deal
        </button>
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
          {filtered.length} deal{filtered.length !== 1 ? 's' : ''}
          {totalEbitda > 0 && ` · ${formatCurrency(totalEbitda)} total EBITDA`}
        </div>
      </div>

      {/* Filters */}
      <div style={{
        padding: '14px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <div style={{ position: 'relative', flex: '0 0 280px' }}>
          <Search size={13} style={{
            position: 'absolute', left: '10px', top: '50%',
            transform: 'translateY(-50%)', color: 'var(--text-muted)'
          }} />
          <input
            className="input"
            placeholder="Search company, sector..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '30px' }}
          />
        </div>

        <select className="select" style={{ width: '140px' }} value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
          <option value="all">All Stages</option>
          {ALL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select className="select" style={{ width: '120px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="Active">Active</option>
          <option value="Dead">Dead</option>
          <option value="Closed">Closed</option>
          <option value="all">All Status</option>
        </select>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr 100px 100px 100px 110px',
        padding: '8px 28px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div>Company</div>
        <div>Sector</div>
        <div>Geography</div>
        <div style={{ textAlign: 'right' }}>EBITDA</div>
        <div style={{ textAlign: 'right' }}>Revenue</div>
        <div style={{ textAlign: 'right' }}>EV/E</div>
        <div>Stage</div>
      </div>

      {/* Table rows */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px 28px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No deals found.
          </div>
        ) : filtered.map(deal => (
          <Link
            key={deal.id}
            href={`/deals/${deal.id}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div
              className="table-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 100px 100px 100px 110px',
                padding: '12px 28px',
              }}
            >
              <div>
                <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '13px' }}>
                  {deal.company_name}
                </div>
                {deal.source_notes && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {deal.source_notes}
                  </div>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                {deal.sector || '—'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                {deal.geography || '—'}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent)', alignSelf: 'center' }}>
                {formatCurrency(deal.ebitda)}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                {formatCurrency(deal.revenue)}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                {formatMultiple(deal.ev_ebitda_multiple)}
              </div>
              <div style={{ alignSelf: 'center' }}>
                <span className={`badge ${stageClass(deal.stage)}`}>{deal.stage}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {showNewDeal && (
        <NewDealModal
          onClose={() => setShowNewDeal(false)}
          onCreated={() => { setShowNewDeal(false); fetchDeals() }}
        />
      )}
    </div>
  )
}
