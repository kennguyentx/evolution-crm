'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Deal, DealStage } from '@/types'
import { formatCurrency, stageClass } from '@/types'
import { Plus, Search, ChevronUp, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import NewDealModal from '@/components/deals/NewDealModal'
import UndoToast, { type UndoEntry } from '@/components/layout/UndoToast'

const ALL_STAGES: DealStage[] = ['Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity','Closed (Platform)','Closed (Add-On)','Pass (DOA)','Pass (Pre-LOI)','Pass (Post-LOI)','Hold']

const STAGE_GROUPS: Record<string, DealStage[]> = {
  pipeline: ['Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity'],
  closed:   ['Closed (Platform)','Closed (Add-On)'],
  passed:   ['Pass (DOA)','Pass (Pre-LOI)','Pass (Post-LOI)'],
  hold:     ['Hold'],
}

type SortField = 'company_name'|'sector'|'geography'|'ebitda'|'revenue'|'stage'|'created_at'
type SortDir   = 'asc'|'desc'
type GroupFilter = 'all'|'pipeline'|'closed'|'passed'|'hold'

const PAGE_SIZE = 100

function SortHeader({ label, field, current, dir, onSort, align='left' }: {
  label:string; field:SortField; current:SortField; dir:SortDir; onSort:(f:SortField)=>void; align?:'left'|'right'
}) {
  const active = current === field
  return (
    <div onClick={() => onSort(field)} style={{ display:'flex', alignItems:'center', gap:'4px', cursor:'pointer', userSelect:'none', justifyContent: align==='right'?'flex-end':'flex-start', color: active?'var(--accent)':'var(--text-muted)' }}>
      {label}
      {active ? (dir==='asc'?<ChevronUp size={11}/>:<ChevronDown size={11}/>) : <ChevronDown size={11} style={{opacity:0.3}}/>}
    </div>
  )
}

export default function DealsPage() {
  const [deals, setDeals]         = useState<Deal[]>([])
  const [total, setTotal]         = useState(0)
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({})
  const [loading, setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset]       = useState(0)
  const [hasMore, setHasMore]     = useState(false)
  const [search, setSearch]       = useState('')
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [showNewDeal, setShowNewDeal] = useState(false)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const supabase = createClient()

  // Fetch total count + per-group counts
  const fetchCounts = useCallback(async () => {
    const { count: totalCount } = await supabase
      .from('deals').select('*', { count: 'exact', head: true })
    if (totalCount !== null) setTotal(totalCount)

    const counts: Record<string, number> = {}
    await Promise.all(Object.entries(STAGE_GROUPS).map(async ([group, stages]) => {
      const { count } = await supabase
        .from('deals').select('*', { count: 'exact', head: true }).in('stage', stages)
      counts[group] = count || 0
    }))
    setGroupCounts(counts)
  }, [supabase])

  useEffect(() => { fetchCounts() }, [fetchCounts])

  const buildQuery = useCallback((field = sortField, dir = sortDir, from = 0) => {
    const dbCol: Record<string, string> = {
      company_name: 'company_name', sector: 'sector', geography: 'geography',
      ebitda: 'ebitda', revenue: 'revenue', stage: 'stage',
      created_at: 'sourced_date',
    }
    const col = dbCol[field] || 'created_at'
    const asc = dir === 'asc'

    let q = supabase.from('deals').select('*')
      .order(col, { ascending: asc, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1)

    if (col !== 'created_at') q = (q as any).order('created_at', { ascending: false })

    // Stage group filter takes priority over individual stage filter
    if (groupFilter !== 'all') {
      q = q.in('stage', STAGE_GROUPS[groupFilter])
    } else if (stageFilter !== 'all') {
      q = q.eq('stage', stageFilter)
    }

    return q
  }, [supabase, groupFilter, stageFilter, sortField, sortDir])

  const fetchDeals = useCallback(async (field = sortField, dir = sortDir) => {
    setLoading(true)
    setOffset(0)
    const { data } = await buildQuery(field, dir, 0)
    if (data) {
      setDeals(data)
      setOffset(data.length)
      setHasMore(data.length === PAGE_SIZE)
    }
    setLoading(false)
  }, [buildQuery, sortField, sortDir])

  const loadMore = async () => {
    setLoadingMore(true)
    const { data } = await buildQuery(sortField, sortDir, offset)
    if (data) {
      setDeals(prev => [...prev, ...data])
      setOffset(prev => prev + data.length)
      setHasMore(data.length === PAGE_SIZE)
    }
    setLoadingMore(false)
  }

  useEffect(() => { fetchDeals() }, [groupFilter, stageFilter, sortField, sortDir])

  const handleSort = (field: SortField) => {
    const newDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : (field === 'ebitda' || field === 'revenue' ? 'desc' : 'asc')
    setSortField(field)
    setSortDir(newDir)
  }

  const pushUndo   = (entry: Omit<UndoEntry,'id'>) => { const id = Math.random().toString(36).slice(2); setUndoStack(prev => [{ ...entry, id }, ...prev].slice(0,3)) }
  const handleUndo = async (id: string) => { const e = undoStack.find(x => x.id===id); if (e) { await e.undo(); fetchDeals(); fetchCounts() } setUndoStack(prev => prev.filter(x => x.id!==id)) }
  const handleDismiss = (id: string) => setUndoStack(prev => prev.filter(x => x.id!==id))

  const filtered = deals.filter(d =>
    d.company_name.toLowerCase().includes(search.toLowerCase()) ||
    (d.sector||'').toLowerCase().includes(search.toLowerCase()) ||
    (d.geography||'').toLowerCase().includes(search.toLowerCase())
  )

  const totalEbitda = filtered.reduce((s,d) => s+(d.ebitda||0), 0)
  const hdr: React.CSSProperties = { fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600 }

  const groupLabels: Record<string, string> = {
    pipeline: 'Active Pipeline',
    closed:   'Closed',
    passed:   'Passed',
    hold:     'Hold',
  }

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <div style={{ padding:'20px 28px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'16px', flexShrink:0, background:'var(--surface)' }}>
        <h1 style={{ fontSize:'20px', fontWeight:700 }}>Deals</h1>
        <button className="btn btn-primary" onClick={() => setShowNewDeal(true)}><Plus size={14}/> New Deal</button>
        <div style={{ marginLeft:'auto', fontSize:'12px', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:'16px' }}>
          <span>{total.toLocaleString()} total</span>
          {groupCounts.pipeline ? <span>{groupCounts.pipeline.toLocaleString()} in pipeline</span> : null}
          {groupCounts.passed   ? <span>{groupCounts.passed.toLocaleString()} passed</span>      : null}
          {groupCounts.closed   ? <span>{groupCounts.closed.toLocaleString()} closed</span>      : null}
          {totalEbitda > 0 && <span>· {formatCurrency(totalEbitda)} EBITDA shown</span>}
        </div>
      </div>

      {/* Group filter chips */}
      <div style={{ padding:'12px 28px', display:'flex', gap:'8px', flexWrap:'wrap', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface)' }}>
        {(['all', 'pipeline', 'closed', 'passed', 'hold'] as GroupFilter[]).map(g => (
          <button key={g} onClick={() => { setGroupFilter(g); setStageFilter('all') }}
            style={{ padding:'4px 10px', borderRadius:'999px', border:`1px solid ${groupFilter===g?'var(--accent)':'var(--border)'}`, background: groupFilter===g?'var(--accent-muted)':'transparent', cursor:'pointer', fontSize:'11px', color: groupFilter===g?'var(--accent)':'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500 }}>
            {g === 'all' ? `All  ${total.toLocaleString()}` : `${groupLabels[g]}  ${(groupCounts[g]||0).toLocaleString()}`}
          </button>
        ))}
      </div>

      {/* Search + stage filter */}
      <div style={{ padding:'10px 28px', borderBottom:'1px solid var(--border)', display:'flex', gap:'12px', alignItems:'center', flexShrink:0 }}>
        <div style={{ position:'relative', flex:'0 0 280px' }}>
          <Search size={13} style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
          <input className="input" placeholder="Search company, sector..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft:'30px' }}/>
        </div>
        <select className="select" style={{ width:'160px' }} value={stageFilter} onChange={e => { setStageFilter(e.target.value); setGroupFilter('all') }}>
          <option value="all">All Stages</option>
          {ALL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table header */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 100px 110px 140px 90px', padding:'8px 28px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface)' }}>
        {([['company_name','Company','left'],['sector','Sector','left'],['geography','Geography','left'],['ebitda','EBITDA','right'],['revenue','Revenue','right'],['stage','Stage','left'],['created_at','Added','left']] as [SortField,string,'left'|'right'][]).map(([field,label,align]) => (
          <div key={field} style={{ ...hdr, paddingLeft: field==='stage'?'12px':0 }}>
            <SortHeader label={label} field={field} current={sortField} dir={sortDir} onSort={handleSort} align={align}/>
          </div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex:1, overflow:'auto' }}>
        {loading ? <div style={{ padding:'40px 28px', color:'var(--text-muted)' }}>Loading...</div>
        : filtered.length===0 ? <div style={{ padding:'60px 28px', textAlign:'center', color:'var(--text-muted)' }}>No deals found.</div>
        : (
          <>
            {filtered.map(deal => (
              <Link key={deal.id} href={`/deals/${deal.id}`} style={{ textDecoration:'none', color:'inherit' }}>
                <div className="table-row" style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 100px 110px 140px 90px', padding:'12px 28px' }}>
                  <div>
                    <div style={{ fontWeight:500, color:'var(--text-primary)', fontSize:'13px' }}>{deal.company_name}</div>
                    {deal.source_notes && <div style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:'2px' }}>{deal.source_notes}</div>}
                  </div>
                  <div style={{ fontSize:'12px', color:'var(--text-secondary)', alignSelf:'center' }}>{deal.sector||'—'}</div>
                  <div style={{ fontSize:'12px', color:'var(--text-secondary)', alignSelf:'center' }}>{deal.geography||'—'}</div>
                  <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--accent)', alignSelf:'center' }}>{formatCurrency(deal.ebitda)}</div>
                  <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-secondary)', alignSelf:'center' }}>{formatCurrency(deal.revenue)}</div>
                  <div style={{ alignSelf:'center', paddingLeft:'12px' }}><span className={`badge ${stageClass(deal.stage)}`}>{deal.stage}</span></div>
                  <div style={{ fontSize:'11px', color:'var(--text-muted)', alignSelf:'center', fontFamily:'var(--font-mono)' }}>
                    {(() => { const d = (deal as any).sourced_date || deal.created_at; return d ? new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }) : '—' })()}
                  </div>
                </div>
              </Link>
            ))}
            {hasMore && (
              <div style={{ padding:'20px 28px', textAlign:'center' }}>
                <button className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Load more (${filtered.length.toLocaleString()} of ${groupFilter !== 'all' ? (groupCounts[groupFilter]||0).toLocaleString() : total.toLocaleString()})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showNewDeal && <NewDealModal onClose={() => setShowNewDeal(false)} onCreated={() => { setShowNewDeal(false); fetchDeals(); fetchCounts() }}/>}
      <UndoToast stack={undoStack} onUndo={handleUndo} onDismiss={handleDismiss}/>
    </div>
  )
}
