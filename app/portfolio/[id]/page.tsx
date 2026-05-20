'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/types'
import { ArrowLeft, Plus, TrendingUp, TrendingDown, Zap, Check, Upload, AlertCircle, Pencil, X } from 'lucide-react'
import Link from 'next/link'
import { useDropzone } from 'react-dropzone'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import DropboxFilesTab from '@/components/deals/DropboxFilesTab'
import { useIsMobile } from '@/hooks/useIsMobile'

export default function PortfolioCompanyPage() {
  const params = useParams()
  const companyId = params.id as string
  const supabase = createClient()
  const isMobile = useIsMobile()

  const [company, setCompany] = useState<any>(null)
  const [financials, setFinancials] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview'|'financials'|'upload'|'analysis'|'documents'>('overview')
  const [showAddPeriod, setShowAddPeriod] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [addons, setAddons] = useState<any[]>([])

  // Company Details inline editing
  const [editingDetails, setEditingDetails] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailEdits, setDetailEdits] = useState<any>({})

  // Upload state
  const [uploadStage, setUploadStage] = useState<'idle'|'parsing'|'review'|'saving'|'done'>('idle')
  const [uploadError, setUploadError] = useState('')
  const [parsedData, setParsedData] = useState<any>(null)
  const [editedData, setEditedData] = useState<any[]|null>(null)

  // Manual entry state
  const [newPeriod, setNewPeriod] = useState({
    period_end: '', period_type: 'monthly',
    revenue: '', ebitda: '', gross_profit: '', net_income: '',
    revenue_budget: '', ebitda_budget: '',
    revenue_py: '', ebitda_py: '',
    backlog: '', ar_balance: '', debt_balance: '', headcount: '',
    commentary: '',
  })

  const fetchData = useCallback(async () => {
    const [{ data: co }, { data: fins }] = await Promise.all([
      supabase.from('portfolio_companies').select('*').eq('id', companyId).single(),
      supabase.from('portfolio_financials').select('*').eq('company_id', companyId).order('period_end', { ascending: true }),
    ])
    if (co) {
      setCompany(co)
      // Find closed add-on deals linked to this portfolio company
      const { data: addonDeals } = await supabase
        .from('deals')
        .select('id, company_name, stage, ebitda, revenue, expected_close')
        .eq('stage', 'Closed (Add-On)')
        .eq('parent_company_id', co.id)
        .order('expected_close', { ascending: false })
      if (addonDeals) setAddons(addonDeals)
    }
    if (fins) setFinancials(fins)
    setLoading(false)
  }, [supabase, companyId])

  useEffect(() => { fetchData() }, [fetchData])

  // File upload handler
  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setUploadStage('parsing')
    setUploadError('')

    try {
      const isSpreadsheet = file.name.match(/\.(xlsx|xls|csv)$/i)
      let base64 = ''
      let csvText = ''

      if (isSpreadsheet) {
        if (file.name.endsWith('.csv')) {
          csvText = await file.text()
        } else {
          // XLSX — use SheetJS to convert to CSV
          const XLSX = await import('xlsx')
          const arrayBuffer = await file.arrayBuffer()
          const workbook = XLSX.read(arrayBuffer, { type: 'array' })
          const sheets = workbook.SheetNames.map(name => {
            const sheet = workbook.Sheets[name]
            return `=== Sheet: ${name} ===\n` + XLSX.utils.sheet_to_csv(sheet)
          })
          csvText = sheets.join('\n\n')
        }
      } else {
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }

      const res = await fetch('/api/portfolio/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, csvText, fileName: file.name, companyName: company?.name }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setParsedData(data)

      // Convert raw dollars to $M for display
      const display: any = { ...data }
      const numFields = ['revenue','ebitda','gross_profit','net_income','revenue_budget','ebitda_budget','revenue_py','ebitda_py','backlog','ar_balance','debt_balance']
      numFields.forEach(f => { if (display[f]) display[f] = (display[f] / 1e6).toFixed(2) })
      setEditedData(display)
      setUploadStage('review')
    } catch (err: any) {
      setUploadError(err.message || 'Parse failed')
      setUploadStage('idle')
    }
  }, [company])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'], 'text/csv': ['.csv'] },
    maxFiles: 1,
    disabled: uploadStage !== 'idle',
  })

  const saveUploadedPeriod = async () => {
    if (!editedData?.length) return
    setUploadStage('saving')
    const numFields = ['revenue','ebitda','gross_profit','net_income','revenue_budget','ebitda_budget','revenue_py','ebitda_py','backlog','ar_balance','debt_balance']
    const payloads = editedData.filter((p: any) => p.period_end).map((p: any) => {
      const payload: any = { company_id: companyId, period_end: p.period_end, period_type: p.period_type || 'monthly', commentary: p.commentary || null }
      numFields.forEach(f => { if (p[f]) payload[f] = parseFloat(p[f]) * 1e6 })
      if (p.headcount) payload.headcount = parseInt(p.headcount)
      return payload
    })
    if (payloads.length > 0) await supabase.from('portfolio_financials').insert(payloads)
    setUploadStage('done')
    fetchData()
  }

  const resetUpload = () => { setUploadStage('idle'); setParsedData(null); setEditedData(null); setUploadError('') }

  const saveManualPeriod = async () => {
    const payload: any = { company_id: companyId, period_end: newPeriod.period_end, period_type: newPeriod.period_type, commentary: newPeriod.commentary || null }
    const numFields = ['revenue','ebitda','gross_profit','net_income','revenue_budget','ebitda_budget','revenue_py','ebitda_py','backlog','ar_balance','debt_balance']
    numFields.forEach(f => { if ((newPeriod as any)[f]) payload[f] = parseFloat((newPeriod as any)[f]) * 1e6 })
    if (newPeriod.headcount) payload.headcount = parseInt(newPeriod.headcount)
    await supabase.from('portfolio_financials').insert(payload)
    setShowAddPeriod(false)
    setNewPeriod({ period_end: '', period_type: 'monthly', revenue: '', ebitda: '', gross_profit: '', net_income: '', revenue_budget: '', ebitda_budget: '', revenue_py: '', ebitda_py: '', backlog: '', ar_balance: '', debt_balance: '', headcount: '', commentary: '' })
    fetchData()
  }

  const runAnalysis = async () => {
    if (!financials.length) return
    setAnalyzing(true)
    setAnalysis('')
    const finSummary = financials.slice(-8).map(f => ({
      period: f.period_end,
      revenue: f.revenue, ebitda: f.ebitda,
      margin: f.revenue && f.ebitda ? ((f.ebitda / f.revenue) * 100).toFixed(1) + '%' : null,
      vs_budget: f.ebitda && f.ebitda_budget ? ((f.ebitda - f.ebitda_budget) / f.ebitda_budget * 100).toFixed(1) + '%' : null,
      vs_py: f.ebitda && f.ebitda_py ? ((f.ebitda - f.ebitda_py) / f.ebitda_py * 100).toFixed(1) + '%' : null,
      backlog: f.backlog, commentary: f.commentary,
    }))
    try {
      const res = await fetch('/api/portfolio/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: company.name, sector: company.sector, financials: finSummary }) })
      const data = await res.json()
      setAnalysis(data.analysis || 'No analysis generated.')
    } catch { setAnalysis('Analysis failed.') }
    setAnalyzing(false)
  }

  const openDetailEdit = () => {
    setDetailEdits({
      name:                 company.name || '',
      sector:               company.sector || '',
      geography:            company.geography || '',
      deal_type:            company.deal_type || '',
      acquisition_date:     company.acquisition_date || '',
      acquisition_revenue:  company.acquisition_revenue  != null ? (company.acquisition_revenue  / 1e6).toFixed(2) : '',
      acquisition_ebitda:   company.acquisition_ebitda   != null ? (company.acquisition_ebitda   / 1e6).toFixed(2) : '',
      acquisition_ev:       company.acquisition_ev       != null ? (company.acquisition_ev       / 1e6).toFixed(2) : '',
    })
    setEditingDetails(true)
  }

  const saveDetails = async () => {
    setSavingDetails(true)
    const payload: any = {
      name:             detailEdits.name?.trim() || company.name,
      sector:           detailEdits.sector?.trim()   || null,
      geography:        detailEdits.geography?.trim() || null,
      deal_type:        detailEdits.deal_type?.trim() || null,
      acquisition_date: detailEdits.acquisition_date || null,
      acquisition_revenue: detailEdits.acquisition_revenue !== '' ? parseFloat(detailEdits.acquisition_revenue) * 1e6 : null,
      acquisition_ebitda:  detailEdits.acquisition_ebitda  !== '' ? parseFloat(detailEdits.acquisition_ebitda)  * 1e6 : null,
      acquisition_ev:      detailEdits.acquisition_ev       !== '' ? parseFloat(detailEdits.acquisition_ev)       * 1e6 : null,
    }
    await supabase.from('portfolio_companies').update(payload).eq('id', companyId)
    setCompany((prev: any) => prev ? { ...prev, ...payload } : prev)
    setEditingDetails(false)
    setSavingDetails(false)
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>
  if (!company) return <div style={{ padding: '40px', color: 'var(--red)' }}>Company not found.</div>

  const latest = financials[financials.length - 1]
  const margin = latest?.revenue && latest?.ebitda ? (latest.ebitda / latest.revenue) * 100 : null
  const ebitdaVsBudget = latest?.ebitda && latest?.ebitda_budget ? ((latest.ebitda - latest.ebitda_budget) / latest.ebitda_budget) * 100 : null
  const ebitdaVsPY = latest?.ebitda && latest?.ebitda_py ? ((latest.ebitda - latest.ebitda_py) / latest.ebitda_py) * 100 : null

  const chartData = financials.map(f => ({
    period: new Date(f.period_end).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    Revenue: f.revenue ? +(f.revenue / 1e6).toFixed(2) : null,
    EBITDA: f.ebitda ? +(f.ebitda / 1e6).toFixed(2) : null,
    Budget: f.ebitda_budget ? +(f.ebitda_budget / 1e6).toFixed(2) : null,
  }))

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'financials', label: `Financials (${financials.length})` },
    { key: 'upload', label: 'Upload Financials' },
    { key: 'analysis', label: 'AI Analysis' },
    { key: 'documents', label: 'Documents' },
  ]

  const FieldInput = ({ label, fieldKey, type = 'number' }: { label: string, fieldKey: string, type?: string }) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type={type} step="0.01" placeholder={type === 'number' ? '0.00' : ''} value={(editedData as any)?.[fieldKey] || ''} onChange={e => setEditedData((p: any) => ({ ...p, [fieldKey]: e.target.value }))} />
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '12px 16px' : '16px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <Link href="/portfolio" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none', marginBottom: '10px' }}>
          <ArrowLeft size={12} /> Portfolio
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700 }}>{company.name}</h1>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{company.sector}{company.geography ? ` · ${company.geography}` : ''}</span>
        </div>
        {latest && (
          <div style={{ display: 'flex', gap: '28px', marginTop: '14px', flexWrap: 'wrap' }}>
            {[
              { label: 'Revenue', value: formatCurrency(latest.revenue) },
              { label: 'EBITDA', value: formatCurrency(latest.ebitda), accent: true },
              ...(margin !== null ? [{ label: 'Margin', value: margin.toFixed(1) + '%' }] : []),
              ...(ebitdaVsBudget !== null ? [{ label: 'vs Budget', value: (ebitdaVsBudget > 0 ? '+' : '') + ebitdaVsBudget.toFixed(1) + '%', color: ebitdaVsBudget >= 0 ? 'var(--green)' : 'var(--red)' }] : []),
              ...(ebitdaVsPY !== null ? [{ label: 'vs PY', value: (ebitdaVsPY > 0 ? '+' : '') + ebitdaVsPY.toFixed(1) + '%', color: ebitdaVsPY >= 0 ? 'var(--green)' : 'var(--red)' }] : []),
            ].map(({ label, value, accent, color }: any) => (
              <div key={label}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                <div style={{ fontSize: '16px', fontFamily: 'var(--font-mono)', color: color || (accent ? 'var(--accent)' : 'var(--text-primary)'), fontWeight: 600, marginTop: '2px' }}>{value}</div>
              </div>
            ))}
            {latest.period_end && <div style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)', alignSelf: 'flex-end', paddingBottom: '2px' }}>As of {new Date(latest.period_end).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '0 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)} style={{ padding: '11px 16px', border: 'none', background: 'transparent', fontSize: '13px', cursor: 'pointer', color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent', fontFamily: 'var(--font-sans)', fontWeight: activeTab === tab.key ? 600 : 400 }}>{tab.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ maxWidth: '900px' }}>
            {chartData.length > 1 ? (
              <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
                <div className="label" style={{ marginBottom: '16px' }}>Revenue & EBITDA Trend ($M)</div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => '$' + v + 'M'} />
                    <Tooltip formatter={(v: any) => '$' + v + 'M'} contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="Revenue" stroke="#6b7280" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="EBITDA" stroke="#4F284B" strokeWidth={2.5} dot={{ fill: '#4F284B', r: 3 }} />
                    <Line type="monotone" dataKey="Budget" stroke="#ED7520" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', marginBottom: '20px' }}>
                Upload financials or add periods to see trend charts
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
              <div className="card" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div className="label">Company Details</div>
                  {!editingDetails ? (
                    <button
                      onClick={openDetailEdit}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', padding: '3px 6px', borderRadius: '4px' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                      <Pencil size={11} /> Edit
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => setEditingDetails(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px' }}><X size={13} /></button>
                      <button
                        onClick={saveDetails}
                        disabled={savingDetails}
                        className="btn btn-primary"
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                      >
                        <Check size={11} /> {savingDetails ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>

                {editingDetails ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label className="label">Name</label>
                        <input className="input" value={detailEdits.name || ''} onChange={e => setDetailEdits((p: any) => ({ ...p, name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Type</label>
                        <select className="select" value={detailEdits.deal_type || ''} onChange={e => setDetailEdits((p: any) => ({ ...p, deal_type: e.target.value }))}>
                          <option value="">—</option>
                          <option value="Platform">Platform</option>
                          <option value="Add-On">Add-On</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label className="label">Sector</label>
                        <input className="input" value={detailEdits.sector || ''} onChange={e => setDetailEdits((p: any) => ({ ...p, sector: e.target.value }))} placeholder="e.g. Safety Services" />
                      </div>
                      <div>
                        <label className="label">Geography</label>
                        <input className="input" value={detailEdits.geography || ''} onChange={e => setDetailEdits((p: any) => ({ ...p, geography: e.target.value }))} placeholder="e.g. Texas" />
                      </div>
                    </div>
                    <div>
                      <label className="label">Acquisition Date</label>
                      <input className="input" type="date" value={detailEdits.acquisition_date || ''} onChange={e => setDetailEdits((p: any) => ({ ...p, acquisition_date: e.target.value }))} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                      <div>
                        <label className="label">Entry Revenue ($M)</label>
                        <input className="input" type="number" step="0.1" placeholder="0.0" value={detailEdits.acquisition_revenue || ''} onChange={e => setDetailEdits((p: any) => ({ ...p, acquisition_revenue: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Entry EBITDA ($M)</label>
                        <input className="input" type="number" step="0.1" placeholder="0.0" value={detailEdits.acquisition_ebitda || ''} onChange={e => setDetailEdits((p: any) => ({ ...p, acquisition_ebitda: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Entry EV ($M)</label>
                        <input className="input" type="number" step="0.1" placeholder="0.0" value={detailEdits.acquisition_ev || ''} onChange={e => setDetailEdits((p: any) => ({ ...p, acquisition_ev: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {[
                      { label: 'Sector',        value: company.sector },
                      { label: 'Geography',     value: company.geography },
                      { label: 'Deal Type',     value: company.deal_type },
                      { label: 'Acquired',      value: company.acquisition_date ? new Date(company.acquisition_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null },
                      { label: 'Entry Revenue', value: company.acquisition_revenue ? formatCurrency(company.acquisition_revenue) : null },
                      { label: 'Entry EBITDA',  value: company.acquisition_ebitda  ? formatCurrency(company.acquisition_ebitda)  : null },
                      { label: 'Entry EV',      value: company.acquisition_ev      ? formatCurrency(company.acquisition_ev)      : null },
                      { label: 'Employees',     value: latest?.headcount ? latest.headcount.toLocaleString() : null },
                    ].filter(r => r.value).map(({ label, value }) => (
                      <div key={label} style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ minWidth: '100px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: '1px' }}>{label}</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{value}</div>
                      </div>
                    ))}
                    {/* Placeholder when nothing is set */}
                    {!company.sector && !company.geography && !company.acquisition_date && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No details yet — click Edit to add</div>
                    )}
                  </>
                )}

                {/* Add-on deals */}
                {addons.length > 0 && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Add-Ons ({addons.length})</div>
                    {addons.map(deal => (
                      <Link key={deal.id} href={`/deals/${deal.id}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--surface-2)', borderRadius: '6px', marginBottom: '5px', border: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                        <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>{deal.company_name}</div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          {deal.ebitda && <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatCurrency(deal.ebitda)}</span>}
                          {deal.expected_close && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{new Date(deal.expected_close).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                          <span style={{ fontSize: '10px', color: 'var(--green)' }}>→</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              {latest?.commentary && (
                <div className="card" style={{ padding: '20px' }}>
                  <div className="label" style={{ marginBottom: '10px' }}>Latest Commentary</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{latest.commentary}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '10px' }}>{new Date(latest.period_end).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* UPLOAD FINANCIALS */}
        {activeTab === 'upload' && (
          <div style={{ maxWidth: '680px' }}>
            {uploadStage === 'idle' && (
              <>
                <div {...getRootProps()} style={{ border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '12px', padding: '60px 40px', textAlign: 'center', cursor: 'pointer', background: isDragActive ? 'var(--accent-muted)' : 'var(--surface)', transition: 'all 0.2s', marginBottom: '16px' }}>
                  <input {...getInputProps()} />
                  <Upload size={32} style={{ color: isDragActive ? 'var(--accent)' : 'var(--text-muted)', display: 'block', margin: '0 auto 16px' }} />
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Drop P&L or financial report here</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>PDF, Excel (.xlsx), or CSV · Claude will extract revenue, EBITDA, margins, and more</div>
                </div>
                {uploadError && (
                  <div style={{ display: 'flex', gap: '10px', padding: '12px 16px', background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '8px', fontSize: '13px', color: 'var(--red)' }}>
                    <AlertCircle size={15} style={{ flexShrink: 0 }} /> {uploadError}
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '8px' }}>
                  <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => { setShowAddPeriod(true); setActiveTab('financials') }}>
                    <Plus size={12} /> Or enter manually
                  </button>
                </div>
              </>
            )}

            {uploadStage === 'parsing' && (
              <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
                <Zap size={32} style={{ color: 'var(--accent)', display: 'block', margin: '0 auto 16px' }} />
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>Parsing financials...</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Claude is reading and extracting financial data</div>
              </div>
            )}

            {uploadStage === 'review' && editedData && (
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Review extracted data</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>{editedData.length} period{editedData.length !== 1 ? 's' : ''} found — edit any field before saving</div>

                {editedData.map((period: any, idx: number) => (
                  <div key={idx} className="card" style={{ padding: '20px', marginBottom: '16px', borderLeft: '3px solid var(--accent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                      <div className="label">Period {idx + 1}</div>
                      <button onClick={() => setEditedData((prev: any) => prev.filter((_: any, i: number) => i !== idx))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px' }}>Remove</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                      <div>
                        <label className="label">Period End Date *</label>
                        <input className="input" type="date" value={period.period_end || ''} onChange={e => setEditedData((prev: any) => prev.map((p: any, i: number) => i === idx ? { ...p, period_end: e.target.value } : p))} />
                      </div>
                      <div>
                        <label className="label">Type</label>
                        <select className="select" value={period.period_type || 'monthly'} onChange={e => setEditedData((prev: any) => prev.map((p: any, i: number) => i === idx ? { ...p, period_type: e.target.value } : p))}>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="annual">Annual</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                      {[
                        { label: 'Revenue', key: 'revenue' },
                        { label: 'EBITDA', key: 'ebitda' },
                        { label: 'Gross Profit', key: 'gross_profit' },
                        { label: 'Net Income', key: 'net_income' },
                        { label: 'Rev Budget', key: 'revenue_budget' },
                        { label: 'EBITDA Budget', key: 'ebitda_budget' },
                        { label: 'Rev PY', key: 'revenue_py' },
                        { label: 'EBITDA PY', key: 'ebitda_py' },
                      ].map(({ label, key }) => (
                        <div key={key}>
                          <label className="label" style={{ fontSize: '9px' }}>{label}</label>
                          <input className="input" type="number" step="0.01" placeholder="0.00" style={{ fontSize: '12px', padding: '5px 8px' }}
                            value={period[key] || ''}
                            onChange={e => setEditedData((prev: any) => prev.map((p: any, i: number) => i === idx ? { ...p, [key]: e.target.value } : p))} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button className="btn btn-ghost" onClick={resetUpload}>Start over</button>
                  <button className="btn btn-primary" onClick={saveUploadedPeriod} disabled={!editedData.some((p: any) => p.period_end)}>
                    <Check size={13} /> Save {editedData.length} Period{editedData.length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            )}

            {uploadStage === 'saving' && (
              <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Saving...</div>
              </div>
            )}

            {uploadStage === 'done' && (
              <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
                <Check size={40} style={{ color: 'var(--green)', display: 'block', margin: '0 auto 16px' }} />
                <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Period saved</div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px' }}>
                  <button className="btn btn-ghost" onClick={resetUpload}>Upload another</button>
                  <button className="btn btn-primary" onClick={() => setActiveTab('overview')}>View overview</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* FINANCIALS TABLE */}
        {activeTab === 'financials' && (
          <div style={{ maxWidth: '900px' }}>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start', marginBottom: '16px' }}>
              <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => setActiveTab('upload')}>
                <Upload size={12} /> Upload PDF
              </button>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowAddPeriod(!showAddPeriod)}>
                <Plus size={13} /> Add Manually
              </button>
            </div>

            {showAddPeriod && (
              <div className="card" style={{ padding: '20px', marginBottom: '20px', border: '1px solid var(--accent)' }}>
                <div className="label" style={{ marginBottom: '16px' }}>New Financial Period</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div><label className="label">Period End Date *</label><input className="input" type="date" value={newPeriod.period_end} onChange={e => setNewPeriod(p => ({ ...p, period_end: e.target.value }))} /></div>
                  <div><label className="label">Period Type</label>
                    <select className="select" value={newPeriod.period_type} onChange={e => setNewPeriod(p => ({ ...p, period_type: e.target.value }))}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: '14px' }}>
                  <div className="label" style={{ marginBottom: '10px' }}>Actuals ($M)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    {['revenue','ebitda','gross_profit','net_income'].map(f => (
                      <div key={f}><label className="label" style={{ textTransform: 'capitalize' }}>{f.replace('_',' ')}</label><input className="input" type="number" step="0.1" placeholder="0.0" value={(newPeriod as any)[f]} onChange={e => setNewPeriod(p => ({ ...p, [f]: e.target.value }))} /></div>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: '14px' }}>
                  <div className="label" style={{ marginBottom: '10px' }}>Budget & Prior Year ($M)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    {['revenue_budget','ebitda_budget','revenue_py','ebitda_py'].map(f => (
                      <div key={f}><label className="label" style={{ textTransform: 'capitalize' }}>{f.replace(/_/g,' ')}</label><input className="input" type="number" step="0.1" placeholder="0.0" value={(newPeriod as any)[f]} onChange={e => setNewPeriod(p => ({ ...p, [f]: e.target.value }))} /></div>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: '14px' }}>
                  <div className="label" style={{ marginBottom: '10px' }}>Operations</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    {[{key:'backlog',label:'Backlog ($M)'},{key:'ar_balance',label:'AR ($M)'},{key:'debt_balance',label:'Debt ($M)'},{key:'headcount',label:'Headcount'}].map(({key,label}) => (
                      <div key={key}><label className="label">{label}</label><input className="input" type="number" step={key==='headcount'?'1':'0.1'} placeholder="0" value={(newPeriod as any)[key]} onChange={e => setNewPeriod(p => ({ ...p, [key]: e.target.value }))} /></div>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: '14px' }}><label className="label">Commentary</label><textarea className="input" rows={3} style={{ resize: 'vertical' }} value={newPeriod.commentary} onChange={e => setNewPeriod(p => ({ ...p, commentary: e.target.value }))} /></div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start', marginTop: '16px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowAddPeriod(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveManualPeriod} disabled={!newPeriod.period_end}><Check size={13} /> Save Period</button>
                </div>
              </div>
            )}

            {financials.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No financials yet — upload a PDF or add manually.</div>
            ) : (
              <div className="card" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>
                      {['Period','Revenue','EBITDA','Margin','vs Budget','vs PY','Backlog','Headcount',''].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: h==='Period'?'left':'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...financials].reverse().map(f => {
                      const m = f.revenue && f.ebitda ? (f.ebitda/f.revenue*100).toFixed(1)+'%' : '—'
                      const vb = f.ebitda && f.ebitda_budget ? ((f.ebitda-f.ebitda_budget)/f.ebitda_budget*100) : null
                      const vpy = f.ebitda && f.ebitda_py ? ((f.ebitda-f.ebitda_py)/f.ebitda_py*100) : null
                      return (
                        <tr key={f.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 500 }}>{new Date(f.period_end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(f.revenue)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>{formatCurrency(f.ebitda)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>{m}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: vb===null?'inherit':vb>=0?'var(--green)':'var(--red)' }}>{vb===null?'—':(vb>0?'+':'')+vb.toFixed(1)+'%'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', color: vpy===null?'inherit':vpy>=0?'var(--green)':'var(--red)' }}>{vpy===null?'—':(vpy>0?'+':'')+vpy.toFixed(1)+'%'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{f.backlog?formatCurrency(f.backlog):'—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>{f.headcount?f.headcount.toLocaleString():'—'}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <button onClick={async () => { if (confirm('Delete this period?')) { await supabase.from('portfolio_financials').delete().eq('id', f.id); fetchData() } }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px' }}>✕</button>
                        </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* AI ANALYSIS */}
        {activeTab === 'analysis' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '16px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={runAnalysis} disabled={analyzing || financials.length === 0}>
                <Zap size={13} /> {analyzing ? 'Analyzing...' : 'Run Analysis'}
              </button>
            </div>
            {financials.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Add financials first before running analysis.</div>}
            {analyzing && (
              <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
                <Zap size={24} style={{ color: 'var(--accent)', display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Analyzing financial trends...</div>
              </div>
            )}
            {analysis && (
              <div className="card" style={{ padding: '24px' }}>
                <div className="label" style={{ marginBottom: '14px' }}>AI Financial Analysis — {company.name}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{analysis}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'documents' && (
          <div style={{ maxWidth: '700px' }}>
            <DropboxFilesTab
              dealId={companyId}
              companyName={company.name}
              dropboxPath={company.dropbox_path}
              onPathSaved={async (path) => {
                await supabase.from('portfolio_companies').update({ dropbox_path: path }).eq('id', companyId)
                setCompany((prev: any) => prev ? { ...prev, dropbox_path: path } : prev)
              }}
              table="portfolio_companies"
            />
          </div>
        )}
      </div>
    </div>
  )
}
