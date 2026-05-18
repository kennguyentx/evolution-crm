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
type SortField = 'company_name'|'sector'|'geography'|'ebitda'|'revenue'|'stage'|'created_at'
type SortDir = 'asc'|'desc'

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
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('Active')
  const [showNewDeal, setShowNewDeal] = useState(false)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const supabase = createClient()

  const fetchDeals = useCallback(async (field = sortField, dir = sortDir) => {
    // Map UI sort field to DB column
    const dbCol: Record<string, string> = {
      company_name: 'company_name',
      sector: 'sector',
      geography: 'geography',
      ebitda: 'ebitda',
      revenue: 'revenue',
      stage: 'stage',
      created_at: 'sourced_date', // prefer sourced_date for date sort
    }
    const col = dbCol[field] || 'created_at'
    const asc = dir === 'asc'

    let query = supabase.from('deals').select('*').order(col, { ascending: asc, nullsFirst: false })
    // secondary sort by created_at for stable ordering
    if (col !== 'created_at') query = (query as any).order('created_at', { ascending: false })
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (stageFilter !== 'all') query = query.eq('stage', stageFilter)
    const { data } = await query
    if (data) setDeals(data)
    setLoading(false)
  }, [supabase, statusFilter, stageFilter, sortField, sortDir])

  useEffect(() => { fetchDeals() }, [fetchDeals])

  const handleSort = (field: SortField) => {
    const newDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : (field === 'ebitda' || field === 'revenue' ? 'desc' : 'asc')
    setSortField(field)
    setSortDir(newDir)
    fetchDeals(field, newDir)
  }

  const pushUndo = (entry: Omit<UndoEntry,'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setUndoStack(prev => [{ ...entry, id }, ...prev].slice(0,3))
  }
  const handleUndo = async (id: string) => {
    const entry = undoStack.find(e => e.id===id)
    if (entry) { await entry.undo(); fetchDeals() }
    setUndoStack(prev => prev.filter(e => e.id!==id))
  }
  const handleDismiss = (id: string) => setUndoStack(prev => prev.filter(e => e.id!==id))

  const filtered = deals.filter(d =>
    d.company_name.toLowerCase().includes(search.toLowerCase()) ||
    (d.sector||'').toLowerCase().includes(search.toLowerCase()) ||
    (d.geography||'').toLowerCase().includes(search.toLowerCase())
  )

  // Server handles ordering — filtered preserves server sort order
  const sorted = filtered

  const totalEbitda = filtered.reduce((s,d) => s+(d.ebitda||0), 0)
  const hdr: React.CSSProperties = { fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600 }

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'20px 28px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'16px', flexShrink:0, background:'var(--surface)' }}>
        <h1 style={{ fontSize:'20px', fontWeight:700 }}>Deals</h1>
        <button className="btn btn-primary" onClick={() => setShowNewDeal(true)}><Plus size={14}/> New Deal</button>
        <div style={{ marginLeft:'auto', fontSize:'12px', color:'var(--text-muted)' }}>
          {filtered.length} deal{filtered.length!==1?'s':''}
          {totalEbitda>0 && ` · ${formatCurrency(totalEbitda)} total EBITDA`}
        </div>
      </div>

      <div style={{ padding:'14px 28px', borderBottom:'1px solid var(--border)', display:'flex', gap:'12px', alignItems:'center', flexShrink:0 }}>
        <div style={{ position:'relative', flex:'0 0 280px' }}>
          <Search size={13} style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
          <input className="input" placeholder="Search company, sector..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft:'30px' }}/>
        </div>
        <select className="select" style={{ width:'140px' }} value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
          <option value="all">All Stages</option>
          {ALL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" style={{ width:'120px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="Active">Active</option>
          <option value="Dead">Dead</option>
          <option value="Closed">Closed</option>
          <option value="all">All Status</option>
        </select>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 100px 110px 140px 90px', padding:'8px 28px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface)' }}>
        {([['company_name','Company','left'],['sector','Sector','left'],['geography','Geography','left'],['ebitda','EBITDA','right'],['revenue','Revenue','right'],['stage','Stage','left'],['created_at','Added','left']] as [SortField,string,'left'|'right'][]).map(([field,label,align]) => (
          <div key={field} style={{ ...hdr, paddingLeft: field==='stage'?'12px':0 }}>
            <SortHeader label={label} field={field} current={sortField} dir={sortDir} onSort={handleSort} align={align}/>
          </div>
        ))}
      </div>

      <div style={{ flex:1, overflow:'auto' }}>
        {loading ? <div style={{ padding:'40px 28px', color:'var(--text-muted)' }}>Loading...</div>
        : sorted.length===0 ? <div style={{ padding:'60px 28px', textAlign:'center', color:'var(--text-muted)' }}>No deals found.</div>
        : sorted.map(deal => (
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
      </div>

      {showNewDeal && <NewDealModal onClose={() => setShowNewDeal(false)} onCreated={() => { setShowNewDeal(false); fetchDeals() }}/>}
      <UndoToast stack={undoStack} onUndo={handleUndo} onDismiss={handleDismiss}/>
    </div>
  )
}
