'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Check, AlertCircle, ChevronRight, Search, Plus, X, FileText, FileSearch, FileCheck, Loader2, AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import { useIsMobile } from '@/hooks/useIsMobile'

// ── Types ─────────────────────────────────────────────────────────────────────

type DocType = 'teaser' | 'cim' | 'nda'

interface ParsedContact {
  name: string; firm: string | null; role: string; title?: string | null; email?: string | null; phone?: string | null
}
interface ExtractedContact extends ParsedContact {
  crmContact?: any; skip?: boolean; searchQuery?: string; searchResults?: any[]
  showSearch?: boolean; showAddForm?: boolean
  addForm?: { first_name: string; last_name: string; firm: string; title: string; email: string; phone: string }
  mergeCandidate?: any; mergeCandidates?: any[]; showMergePrompt?: boolean
}
interface ParsedDeal {
  company_name: string; sector: string; geography: string; deal_type: string; stage: string
  revenue: number | null; ebitda: number | null; cim_summary: string; contacts: ParsedContact[]
}

const SECTORS = [
  'Underground Utilities','Electrical Contracting','Civil / Public Works','Commercial Landscaping',
  'Fiber Optics','HVAC','Plumbing','Industrial Services','Environmental Services','Construction & Engineering',
]

// ── Deal Selector (shared between CIM and NDA flows) ─────────────────────────

function DealSelector({ onSelect }: { onSelect: (deal: any) => void }) {
  const supabase = createClient()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('deals').select('id, company_name, stage, sector, deal_type, parent_portco').ilike('company_name', `%${query}%`).in('stage', ['Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity']).order('updated_at', { ascending: false }).limit(8)
      setResults(data || [])
      setOpen(true)
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          className="input" placeholder="Search deals by company name…"
          value={query} onChange={e => { setQuery(e.target.value); setOpen(true) }}
          style={{ paddingLeft: '30px' }}
        />
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '3px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          {results.map(d => (
            <button key={d.id} onClick={() => { onSelect(d); setQuery(d.company_name); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>{d.company_name}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{d.stage}{d.sector ? ` · ${d.sector}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── FileDropZone (reusable) ───────────────────────────────────────────────────

function FileDropZone({ accept, onFile, file, onClear, hint, getRootProps: externalGetRootProps, getInputProps: externalGetInputProps, isDragActive: externalIsDragActive }: {
  accept: Record<string, string[]>; onFile: (f: File) => void; file: File | null; onClear: () => void; hint: string
  getRootProps?: () => any; getInputProps?: () => any; isDragActive?: boolean
}) {
  const onDrop = useCallback((accepted: File[]) => { if (accepted[0]) onFile(accepted[0]) }, [onFile])
  const internal = useDropzone({ onDrop, accept, maxFiles: 1, disabled: !!externalGetRootProps })
  const getRootProps  = externalGetRootProps  ?? internal.getRootProps
  const getInputProps = externalGetInputProps ?? internal.getInputProps
  const isDragActive  = externalIsDragActive  ?? internal.isDragActive

  if (file) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)' }}>
      <FileText size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <span style={{ fontSize: '13px', flex: 1, wordBreak: 'break-all' }}>{file.name}</span>
      <button onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={14} /></button>
    </div>
  )

  return (
    <div {...getRootProps()} style={{
      border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: '10px', padding: '28px 20px', textAlign: 'center',
      cursor: 'pointer', background: isDragActive ? 'var(--accent-muted)' : 'var(--surface)',
      transition: 'all 0.15s',
    }}>
      <input {...getInputProps()} />
      <Upload size={24} style={{ color: isDragActive ? 'var(--accent)' : 'var(--text-muted)', display: 'block', margin: '0 auto 10px' }} />
      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{hint}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── CIM Flow ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function CIMFlow() {
  const supabase = createClient()
  const isMobile = useIsMobile()
  const [selectedDeal, setSelectedDeal] = useState<any>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pastedText, setPastedText] = useState('')
  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [updating, setUpdating] = useState(false)
  const [updated, setUpdated] = useState(false)
  const [cimDealType, setCimDealType] = useState<'platform'|'add-on'>('platform')
  const [cimPortco, setCimPortco] = useState('')
  const [portcos, setPortcos] = useState<{id:string;name:string}[]>([])

  useEffect(() => {
    supabase.from('portfolio_companies').select('id, name').eq('status', 'Active').order('name')
      .then(({ data }) => setPortcos(data || []))
  }, [])

  const analyze = async () => {
    if (!selectedDeal) return
    if (!file && !pastedText.trim()) return
    setAnalyzing(true); setError(null); setResult(null)

    const fd = new FormData()
    if (file) fd.append('file', file)
    else fd.append('text', pastedText)
    fd.append('deal_id', selectedDeal.id)

    try {
      const res = await fetch('/api/cim-analyze', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const updateDeal = async () => {
    if (!result || !selectedDeal) return
    setUpdating(true)
    const patch: any = {}
    if (result.company_name) patch.company_name = result.company_name
    if (result.sector)       patch.sector       = result.sector
    if (result.geography)    patch.geography    = result.geography
    if (result.revenue)      patch.revenue      = result.revenue
    if (result.ebitda)       patch.ebitda       = result.ebitda
    if (result.description)  patch.description  = result.description
    // Always use the explicitly-selected deal type (overrides Claude's guess)
    patch.deal_type   = cimDealType
    patch.parent_portco = cimDealType === 'add-on' && cimPortco ? cimPortco : null
    await supabase.from('deals').update(patch).eq('id', selectedDeal.id)
    setUpdated(true)
    setUpdating(false)
  }

  const discrepancies = result?.cross_reference?.discrepancies || []
  const highDiscrep   = discrepancies.filter((d: any) => d.significance === 'high').length

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: 'flex-start' }}>
      {/* Left panel */}
      <div style={{ width: isMobile ? '100%' : '280px', minWidth: isMobile ? undefined : '280px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>1. Select deal</div>
          <DealSelector onSelect={d => { setSelectedDeal(d); setCimDealType(d.deal_type === 'add-on' ? 'add-on' : 'platform'); setCimPortco(d.parent_portco || '') }} />
          {selectedDeal && (
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Check size={12} style={{ color: 'var(--green)' }} />
              <span style={{ fontSize: '11px', color: 'var(--green)' }}>{selectedDeal.company_name} — {selectedDeal.stage}</span>
              <Link href={`/deals/${selectedDeal.id}`} style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--accent)', textDecoration: 'none' }}>
                <ExternalLink size={11} />
              </Link>
            </div>
          )}
        </div>

        {/* Deal type / portco card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px', opacity: selectedDeal ? 1 : 0.5, pointerEvents: selectedDeal ? 'auto' : 'none' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>2. Deal type</div>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            {(['platform', 'add-on'] as const).map(t => (
              <button key={t} onClick={() => { setCimDealType(t); if (t === 'platform') setCimPortco('') }}
                style={{ flex: 1, padding: '5px 0', fontSize: '11px', fontWeight: cimDealType === t ? 600 : 400, borderRadius: '5px', border: '1px solid var(--border)', cursor: 'pointer', background: cimDealType === t ? 'var(--accent)' : 'transparent', color: cimDealType === t ? '#fff' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                {t === 'platform' ? 'Platform' : 'Add-on'}
              </button>
            ))}
          </div>
          {cimDealType === 'add-on' && (
            <select className="select" style={{ width: '100%', fontSize: '11px' }} value={cimPortco} onChange={e => setCimPortco(e.target.value)}>
              <option value="">Select portfolio company…</option>
              {portcos.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          )}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px', opacity: selectedDeal ? 1 : 0.5, pointerEvents: selectedDeal ? 'auto' : 'none' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>3. Upload CIM</div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {(['upload', 'paste'] as const).map(m => (
              <button key={m} onClick={() => setInputMode(m)} style={{ flex: 1, padding: '5px', borderRadius: '6px', border: '1px solid var(--border)', background: inputMode === m ? 'var(--accent)' : 'transparent', color: inputMode === m ? 'white' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}>
                {m === 'upload' ? 'Upload' : 'Paste'}
              </button>
            ))}
          </div>
          {inputMode === 'upload' ? (
            <FileDropZone
              accept={{ 'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }}
              onFile={setFile} file={file} onClear={() => setFile(null)}
              hint="Drop PDF or Word file"
            />
          ) : (
            <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} placeholder="Paste CIM text…" style={{ width: '100%', minHeight: '100px', padding: '8px', borderRadius: '7px', border: '1px solid var(--border)', fontSize: '11px', resize: 'vertical', fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
          )}

          {error && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '8px', display: 'flex', gap: '5px' }}><AlertCircle size={12} />{error}</div>}

          <button onClick={analyze} disabled={analyzing || !selectedDeal || (!file && !pastedText.trim())} className="btn btn-primary"
            style={{ width: '100%', marginTop: '10px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            {analyzing ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />Analyzing…</> : 'Analyze CIM'}
          </button>
        </div>
      </div>

      {/* Right panel — results */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {analyzing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '40px 0', color: 'var(--text-muted)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Analyzing CIM…</div>
              <div style={{ fontSize: '12px', marginTop: '2px' }}>Extracting data and cross-referencing with teaser and NDA</div>
            </div>
          </div>
        )}

        {!analyzing && !result && (
          <div style={{ padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            Select a deal and upload the CIM. Claude will extract key data and compare it against the teaser and any NDA on file.
          </div>
        )}

        {result && !analyzing && (
          <div>
            {/* Header + update button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700 }}>{result.company_name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {result.sector}{result.geography ? ` · ${result.geography}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {highDiscrep > 0 && (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: '20px', padding: '3px 10px' }}>
                    {highDiscrep} discrepancy
                  </span>
                )}
                {!updated ? (
                  <button onClick={updateDeal} disabled={updating} className="btn btn-primary" style={{ fontSize: '12px', display: 'flex', gap: '5px', alignItems: 'center' }}>
                    {updating ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />}
                    Update deal record
                  </button>
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--green)', display: 'flex', gap: '5px', alignItems: 'center' }}><Check size={12} />Deal updated</span>
                )}
                <Link href={`/deals/${selectedDeal?.id}`} className="btn btn-ghost" style={{ fontSize: '12px', display: 'flex', gap: '5px', alignItems: 'center' }}>
                  View deal <ExternalLink size={11} />
                </Link>
              </div>
            </div>

            {/* Financials */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
              {[
                { label: 'Revenue', value: result.revenue ? `$${(result.revenue/1e6).toFixed(1)}M` : '—' },
                { label: 'EBITDA',  value: result.ebitda  ? `$${(result.ebitda /1e6).toFixed(1)}M` : '—' },
                { label: 'Margin',  value: result.ebitda_margin ? `${result.ebitda_margin.toFixed(1)}%` : '—' },
                { label: 'Rev Growth', value: result.revenue_growth ? `${result.revenue_growth.toFixed(1)}%` : '—' },
                { label: 'Ask Price', value: result.asking_price ? `$${(result.asking_price/1e6).toFixed(1)}M` : '—' },
                { label: 'Ask Multiple', value: result.asking_multiple ? `${result.asking_multiple}x` : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '4px' }}>{label}</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Cross-reference discrepancies */}
            {discrepancies.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  Cross-reference vs teaser ({discrepancies.length} item{discrepancies.length !== 1 ? 's' : ''})
                </div>
                {[...discrepancies].sort((a: any, b: any) => { const o: Record<string,number> = { high: 0, medium: 1, low: 2 }; return (o[a.significance] ?? 3) - (o[b.significance] ?? 3) }).map((d: any, i: number) => (
                  <div key={i} style={{ border: `1px solid ${d.significance === 'high' ? '#ef4444' : d.significance === 'medium' ? '#f59e0b' : 'var(--border)'}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '8px', background: d.significance === 'high' ? 'rgba(239,68,68,0.04)' : d.significance === 'medium' ? 'rgba(245,158,11,0.04)' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: d.significance === 'high' ? '#ef4444' : d.significance === 'medium' ? '#f59e0b' : 'var(--text-muted)' }}>{d.significance}</span>
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>{d.field}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                      <div><div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>Teaser</div><div style={{ color: 'var(--text-secondary)' }}>{d.teaser_value || '—'}</div></div>
                      <div><div style={{ fontSize: '10px', color: 'var(--accent)', marginBottom: '2px' }}>CIM</div><div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{d.cim_value || '—'}</div></div>
                    </div>
                    {d.note && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>{d.note}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* NDA match note */}
            {result.cross_reference?.nda_note && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '12px', background: result.cross_reference.nda_match ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)', border: `1px solid ${result.cross_reference.nda_match ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                <strong>NDA: </strong>{result.cross_reference.nda_note}
              </div>
            )}

            {/* Overall assessment */}
            {result.cross_reference?.overall && (
              <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontStyle: 'italic', padding: '12px 14px', borderRadius: '8px', background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: '16px' }}>
                {result.cross_reference.overall}
              </div>
            )}

            {/* Description */}
            {result.description && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '6px' }}>Summary</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{result.description}</div>
              </div>
            )}

            {/* Financial summary */}
            {result.financial_summary && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '6px' }}>Financial Summary</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{result.financial_summary}</div>
              </div>
            )}

            {/* Risks + Opportunities */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              {result.key_risks?.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#ef4444', letterSpacing: '0.05em', marginBottom: '8px' }}>Key Risks</div>
                  {result.key_risks.map((r: string, i: number) => (
                    <div key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '7px' }}>
                      <span style={{ color: '#ef4444', flexShrink: 0 }}>·</span>{r}
                    </div>
                  ))}
                </div>
              )}
              {result.growth_opportunities?.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--green)', letterSpacing: '0.05em', marginBottom: '8px' }}>Growth Opportunities</div>
                  {result.growth_opportunities.map((o: string, i: number) => (
                    <div key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '7px' }}>
                      <span style={{ color: 'var(--green)', flexShrink: 0 }}>·</span>{o}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Management team */}
            {result.management_team?.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '8px' }}>Management Team</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {result.management_team.map((m: any, i: number) => (
                    <div key={i} style={{ fontSize: '12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px' }}>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>{m.title ? <span style={{ color: 'var(--text-muted)' }}> · {m.title}</span> : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Source banker */}
            {(result.banker_name || result.banker_firm) && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '10px 14px', background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <strong>Source: </strong>{result.banker_name}{result.banker_firm ? ` · ${result.banker_firm}` : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── NDA Flow (embedded) ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function NDAMarkupItem({ item }: { item: any }) {
  const [open, setOpen] = useState(item.significance === 'high')
  const sigColor = item.significance === 'high' ? '#ef4444' : item.significance === 'medium' ? '#f59e0b' : 'var(--text-muted)'
  return (
    <div style={{ border: `1px solid ${sigColor}`, borderRadius: '8px', marginBottom: '8px', overflow: 'hidden', background: item.significance === 'high' ? 'rgba(239,68,68,0.04)' : item.significance === 'medium' ? 'rgba(245,158,11,0.04)' : 'transparent' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: sigColor, minWidth: '48px' }}>{item.significance}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '80px' }}>{item.section}</span>
        <span style={{ fontSize: '13px', fontWeight: 600, flex: 1 }}>{item.issue}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div><div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Incoming language</div><div style={{ fontSize: '12px', background: 'var(--surface)', borderRadius: '5px', padding: '8px 10px', fontStyle: item.incoming_language === 'Absent' ? 'italic' : 'normal' }}>{item.incoming_language}</div></div>
          <div><div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '4px' }}>Preferred language</div><div style={{ fontSize: '12px', background: 'rgba(79,40,75,0.06)', borderRadius: '5px', padding: '8px 10px' }}>{item.preferred_language}</div></div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{item.note}</div>
        </div>
      )}
    </div>
  )
}

function NDAFlow() {
  const isMobile = useIsMobile()
  const [selectedDeal, setSelectedDeal] = useState<any>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pastedText, setPastedText] = useState('')
  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  const analyze = async () => {
    setAnalyzing(true); setError(null); setResult(null)
    const fd = new FormData()
    if (file) fd.append('file', file)
    else fd.append('text', pastedText)
    if (selectedDeal) { fd.append('deal_id', selectedDeal.id); fd.append('company_name', selectedDeal.company_name) }
    try {
      const res = await fetch('/api/nda-analyze', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const sigOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const sorted = result ? [...(result.markup || [])].sort((a: any, b: any) => (sigOrder[a.significance] ?? 3) - (sigOrder[b.significance] ?? 3)) : []

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: 'flex-start' }}>
      <div style={{ width: isMobile ? '100%' : '280px', minWidth: isMobile ? undefined : '280px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>1. Select deal <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></div>
          <DealSelector onSelect={setSelectedDeal} />
          {selectedDeal && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <Check size={12} style={{ color: 'var(--green)' }} />
              <span style={{ fontSize: '11px', color: 'var(--green)' }}>{selectedDeal.company_name}</span>
            </div>
          )}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>2. Upload NDA</div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {(['upload', 'paste'] as const).map(m => (
              <button key={m} onClick={() => setInputMode(m)} style={{ flex: 1, padding: '5px', borderRadius: '6px', border: '1px solid var(--border)', background: inputMode === m ? 'var(--accent)' : 'transparent', color: inputMode === m ? 'white' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}>
                {m === 'upload' ? 'Upload' : 'Paste'}
              </button>
            ))}
          </div>
          {inputMode === 'upload' ? (
            <FileDropZone
              accept={{ 'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/msword': ['.doc'] }}
              onFile={setFile} file={file} onClear={() => setFile(null)}
              hint="Drop PDF or Word file"
            />
          ) : (
            <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} placeholder="Paste NDA text…" style={{ width: '100%', minHeight: '100px', padding: '8px', borderRadius: '7px', border: '1px solid var(--border)', fontSize: '11px', resize: 'vertical', fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
          )}

          {error && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '8px', display: 'flex', gap: '5px' }}><AlertCircle size={12} />{error}</div>}

          <button onClick={analyze} disabled={analyzing || (!file && !pastedText.trim())} className="btn btn-primary"
            style={{ width: '100%', marginTop: '10px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            {analyzing ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />Analyzing…</> : 'Analyze NDA'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {analyzing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '40px 0', color: 'var(--text-muted)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Analyzing NDA…</div>
              <div style={{ fontSize: '12px', marginTop: '2px' }}>Comparing against your standard template from Best Practices</div>
            </div>
          </div>
        )}

        {!analyzing && !result && (
          <div style={{ padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            Upload or paste an NDA — PDF or Word. Claude will extract key terms and compare against your standard template.
          </div>
        )}

        {result && !analyzing && (
          <div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '18px 20px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700 }}>{result.entity_name || '—'}</div>
                  {selectedDeal && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Linked to {selectedDeal.company_name}</div>}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(result.markup || []).filter((m: any) => m.significance === 'high').length > 0 && (
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: '20px', padding: '3px 10px' }}>
                      {(result.markup || []).filter((m: any) => m.significance === 'high').length} high
                    </span>
                  )}
                  {selectedDeal && <Link href={`/deals/${selectedDeal.id}?tab=nda`} className="btn btn-ghost" style={{ fontSize: '11px' }}>View in deal →</Link>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                {[
                  { label: 'Effective Date', value: result.effective_date || '—' },
                  { label: 'Term', value: result.term || '—' },
                  { label: 'Expiry', value: result.term_expiry || '—' },
                  { label: 'Non-Solicit', value: result.non_solicit ? `Yes — ${result.non_solicit_term || 'see notes'}` : 'None' },
                  { label: 'Financing Sources', value: result.financing_sources_included ? 'Included ✓' : 'Not included ✗', color: result.financing_sources_included ? '#22c55e' : '#ef4444' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '3px' }}>{label}</div>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: color || 'var(--text-primary)' }}>{value}</div>
                  </div>
                ))}
              </div>

              {result.financing_sources_notes && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: result.financing_sources_included ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', borderRadius: '6px', padding: '8px 12px', marginBottom: '10px' }}>
                  <strong>Financing sources: </strong>{result.financing_sources_notes}
                </div>
              )}

              {result.overall_assessment && (
                <div style={{ fontSize: '13px', color: 'var(--text-primary)', borderTop: '1px solid var(--border)', paddingTop: '12px', fontStyle: 'italic' }}>
                  {result.overall_assessment}
                </div>
              )}
            </div>

            {sorted.length > 0 && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '10px' }}>
                  Markup ({sorted.length} item{sorted.length !== 1 ? 's' : ''})
                </div>
                {sorted.map((item: any, i: number) => <NDAMarkupItem key={i} item={item} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Teaser Flow (preserved from original) ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function TeaserFlow() {
  const supabase = createClient()
  const isMobile = useIsMobile()
  const [stage, setStage] = useState<'idle'|'uploading'|'parsing'|'review'|'saving'|'done'>('idle')
  const [parsed, setParsed] = useState<ParsedDeal|null>(null)
  const [edited, setEdited] = useState<ParsedDeal|null>(null)
  const [dealId, setDealId] = useState<string|null>(null)
  const [duplicateDeals, setDuplicateDeals] = useState<any[]>([])
  const [ignoreDuplicate, setIgnoreDuplicate] = useState(false)
  const [error, setError] = useState<string|null>(null)
  const [fileName, setFileName] = useState('')
  const [missingFields, setMissingFields] = useState<{key: keyof ParsedDeal; label: string}[]>([])
  const [contacts, setContacts] = useState<ExtractedContact[]>([])
  const [dropboxFolder, setDropboxFolder] = useState<string|null>(null)
  const [dropboxFolderExisted, setDropboxFolderExisted] = useState(false)
  const [inputMode, setInputMode] = useState<'pdf'|'word'|'paste'>('pdf')
  const [pastedText, setPastedText] = useState('')
  const [wordFile, setWordFile] = useState<File|null>(null)
  const [dropboxError, setDropboxError] = useState<string|null>(null)
  const [extraFiles, setExtraFiles] = useState<{name:string;status:'uploading'|'done'|'error';error?:string}[]>([])
  const [dealType, setDealType] = useState<'platform'|'add-on'>('platform')
  const [parentPortco, setParentPortco] = useState('')
  const [portcos, setPortcos] = useState<{id:string;name:string}[]>([])
  const extraFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('portfolio_companies').select('id, name').eq('status', 'Active').order('name')
      .then(({ data }) => setPortcos(data || []))
  }, [])

  useEffect(() => {
    if (!edited) return
    const required = [
      { key: 'company_name' as const, label: 'Company Name' },
      { key: 'sector' as const, label: 'Sector' },
      { key: 'geography' as const, label: 'Geography' },
      { key: 'deal_type' as const, label: 'Deal Type' },
      { key: 'stage' as const, label: 'Stage' },
      { key: 'revenue' as const, label: 'Revenue' },
      { key: 'ebitda' as const, label: 'EBITDA' },
    ]
    setMissingFields(required.filter(f => {
      const val = edited[f.key]
      if (f.key === 'revenue' || f.key === 'ebitda') return val == null
      return !val
    }))
  }, [edited])

  const updateContact = (idx: number, patch: Partial<ExtractedContact>) =>
    setContacts(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))

  const searchForContact = async (idx: number, query: string) => {
    updateContact(idx, { searchQuery: query, showSearch: true })
    if (!query.trim()) { updateContact(idx, { searchResults: [] }); return }
    const parts = query.trim().split(' ').filter(Boolean)
    let results: any[] = []
    if (parts.length >= 2) {
      const [firstRes, lastRes] = await Promise.all([
        supabase.from('contacts').select('id, first_name, last_name, firm, title').ilike('first_name', `%${parts[0]}%`).limit(100),
        supabase.from('contacts').select('id, first_name, last_name, firm, title').ilike('last_name', `%${parts[parts.length - 1]}%`).limit(100),
      ])
      const firstIds = new Set((firstRes.data || []).map((c: any) => c.id))
      results = (lastRes.data || []).filter((c: any) => firstIds.has(c.id))
    } else {
      const { data } = await supabase.from('contacts').select('id, first_name, last_name, firm, title').or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,firm.ilike.%${query}%`).limit(8)
      results = data || []
    }
    updateContact(idx, { searchResults: results.slice(0, 8) })
  }

  const autoLinkContact = async (idx: number, parsedContact: ParsedContact) => {
    if (!parsedContact.name) return
    const nameParts = parsedContact.name.trim().split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName  = nameParts.slice(1).join(' ') || ''
    const defaultForm = { first_name: firstName, last_name: lastName, firm: parsedContact.firm || '', title: parsedContact.title || '', email: parsedContact.email || '', phone: parsedContact.phone || '' }
    let matches: any[] = []
    if (parsedContact.email) {
      const { data } = await supabase.from('contacts').select('id, first_name, last_name, firm, title, email, phone').ilike('email', parsedContact.email.trim()).limit(3)
      matches = data || []
    }
    if (matches.length === 0 && firstName && lastName) {
      const [firstRes, lastRes] = await Promise.all([
        supabase.from('contacts').select('id, first_name, last_name, firm, title, email, phone').ilike('first_name', `%${firstName}%`).limit(200),
        supabase.from('contacts').select('id, first_name, last_name, firm, title, email, phone').ilike('last_name', `%${lastName}%`).limit(200),
      ])
      const firstIds = new Set((firstRes.data || []).map((c: any) => c.id))
      matches = (lastRes.data || []).filter((c: any) => firstIds.has(c.id))
    }
    if (matches.length === 0 && parsedContact.firm && lastName) {
      const { data } = await supabase.from('contacts').select('id, first_name, last_name, firm, title, email, phone').ilike('firm', `%${parsedContact.firm.trim()}%`).ilike('last_name', `%${lastName}%`).limit(5)
      matches = data || []
    }
    if (matches.length === 0) {
      updateContact(idx, { addForm: defaultForm })
    } else if (matches.length === 1) {
      updateContact(idx, { mergeCandidate: matches[0], showMergePrompt: true, addForm: defaultForm })
    } else {
      updateContact(idx, { mergeCandidates: matches, showMergePrompt: true, addForm: defaultForm })
    }
  }

  const linkExisting   = (idx: number, crm: any) => updateContact(idx, { crmContact: crm, showMergePrompt: false, mergeCandidate: undefined, mergeCandidates: undefined })
  const mergeExisting  = async (idx: number, crm: any) => {
    const c = contacts[idx]; const patch: Record<string, any> = {}
    if (!crm.firm && c.firm) patch.firm = c.firm; if (!crm.title && c.title) patch.title = c.title
    if (!crm.email && c.email) patch.email = c.email; if (!crm.phone && c.phone) patch.phone = c.phone
    if (Object.keys(patch).length > 0) await supabase.from('contacts').update(patch).eq('id', crm.id)
    updateContact(idx, { crmContact: { ...crm, ...patch }, showMergePrompt: false, mergeCandidate: undefined, mergeCandidates: undefined })
  }
  const overwriteExisting = async (idx: number, crm: any) => {
    const c = contacts[idx]; const patch: Record<string, any> = {}
    if (c.firm) patch.firm = c.firm; if (c.title) patch.title = c.title
    if (c.email) patch.email = c.email; if (c.phone) patch.phone = c.phone
    if (Object.keys(patch).length > 0) await supabase.from('contacts').update(patch).eq('id', crm.id)
    updateContact(idx, { crmContact: { ...crm, ...patch }, showMergePrompt: false, mergeCandidate: undefined, mergeCandidates: undefined })
  }
  const addNewContact = async (idx: number, contactType: string) => {
    const c = contacts[idx]
    if (!c.addForm?.first_name || !c.addForm?.last_name) return
    const { data } = await supabase.from('contacts').insert({ first_name: c.addForm.first_name, last_name: c.addForm.last_name, firm: c.addForm.firm || null, title: c.addForm.title || null, email: c.addForm.email || null, phone: c.addForm.phone || null, contact_type: contactType }).select().single()
    if (data) updateContact(idx, { crmContact: data, showAddForm: false, showSearch: false })
  }

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]; if (!file) return
    setFileName(file.name); setStage('uploading'); setError(null)
    try {
      const urlRes = await fetch('/api/intake/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name }) })
      if (!urlRes.ok) throw new Error(`Upload setup failed: ${(await urlRes.json()).error}`)
      const { signedUploadUrl, storagePath } = await urlRes.json()
      const mimeType = /\.docx?$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'
      const uploadRes = await fetch(signedUploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file })
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`)
      setStage('parsing')
      const res = await fetch('/api/intake/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath, fileName: file.name, deal_type: dealType, parent_portco: parentPortco || null }) })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setParsed(data); setEdited({ ...data, stage: data.stage || 'Teaser', deal_type: dealType })
      if (data.dropbox_folder) setDropboxFolder(data.dropbox_folder)
      if (data.dropbox_folder_existed) setDropboxFolderExisted(true)
      if (data.dropbox_error) setDropboxError(data.dropbox_error)
      const parsedContacts: ParsedContact[] = Array.isArray(data.contacts) ? data.contacts : []
      const initialContacts: ExtractedContact[] = parsedContacts.map(c => ({ ...c, searchQuery: c.name, searchResults: [], showSearch: false, showAddForm: false, addForm: { first_name: c.name.split(' ')[0] || '', last_name: c.name.split(' ').slice(1).join(' ') || '', firm: c.firm || '', title: c.title || '', email: c.email || '', phone: c.phone || '' } }))
      setContacts(initialContacts)
      initialContacts.forEach((_, i) => autoLinkContact(i, parsedContacts[i]))
      setStage('review')
    } catch (err: any) {
      setError(err.message || 'Parsing failed'); setStage('idle')
    }
  }, [supabase])

  const uploadExtraFiles = async (files: FileList | null) => {
    if (!files || !dropboxFolder) return
    const newFiles = Array.from(files).map(f => ({ name: f.name, status: 'uploading' as const }))
    setExtraFiles(prev => [...prev, ...newFiles])
    for (let i = 0; i < files.length; i++) {
      const file = files[i]; const idx = extraFiles.length + i
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file)
        })
        const res = await fetch('/api/dropbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dropboxFolder, name: file.name, base64 }) })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setExtraFiles(prev => prev.map((f, j) => j === idx ? { ...f, status: 'done' } : f))
      } catch (err: any) {
        setExtraFiles(prev => prev.map((f, j) => j === idx ? { ...f, status: 'error', error: err.message } : f))
      }
    }
    if (extraFileRef.current) extraFileRef.current.value = ''
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: inputMode === 'word'
      ? { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/msword': ['.doc'] }
      : { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: stage !== 'idle' || inputMode === 'paste',
  })
  const updateField = (key: keyof ParsedDeal, value: any) => setEdited(prev => prev ? { ...prev, [key]: value } : null)
  const linkedCount = contacts.filter(c => c.crmContact && !c.skip).length

  const handleSave = async (force = false) => {
    if (!edited) return
    if (!force && !ignoreDuplicate) {
      const name = edited.company_name?.trim()
      if (name) {
        const { data: existing } = await supabase.from('deals').select('id, company_name, stage, status, created_at').ilike('company_name', `%${name}%`).limit(5)
        if (existing && existing.length > 0) { setDuplicateDeals(existing); return }
      }
    }
    setDuplicateDeals([]); setStage('saving')
    const firstBanker = contacts.find(c => c.role === 'Source / Banker' && c.crmContact)
    const { data, error } = await supabase.from('deals').insert({
      company_name: edited.company_name || 'Unknown Company',
      sector: edited.sector || null, geography: edited.geography || null,
      description: edited.cim_summary || null, deal_type: dealType,
      revenue: edited.revenue, ebitda: edited.ebitda, cim_summary: edited.cim_summary,
      cim_parsed: true, stage: edited.stage || 'Teaser', status: 'Active',
      dropbox_path: dropboxFolder || null, expected_close: new Date().toISOString().split('T')[0],
      parent_portco: (dealType === 'add-on' && parentPortco) ? parentPortco : null,
      source_notes: firstBanker?.crmContact?.firm || contacts.find(c => c.role === 'Source / Banker')?.firm || null,
    }).select().single()
    if (error) { setError(error.message); setStage('review'); return }
    const linkedContacts = contacts.filter(c => c.crmContact && !c.skip)
    if (linkedContacts.length > 0 && data) {
      await Promise.all(linkedContacts.map(c => supabase.from('contact_deal_links').insert({ contact_id: c.crmContact.id, deal_id: data.id, role: c.role })))
    }
    setDealId(data.id); setStage('done')

    // Send deal notification email (non-blocking)
    fetch('/api/deals/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: edited.company_name || 'Unknown Company',
        stage:       edited.stage || 'Teaser',
        status:      'Active',
        sector:      edited.sector      || null,
        geography:   edited.geography   || null,
        revenue:     edited.revenue     ?? null,
        ebitda:      edited.ebitda      ?? null,
        description: edited.cim_summary || null,
        dealId:      data.id,
        isPending:   false,
      }),
    }).catch(() => {})

    // Record in intake queue as approved (non-fatal)
    try {
      await supabase.from('intake_queue').insert({
        source: 'upload',
        doc_type: 'teaser',
        file_name: fileName || 'teaser',
        extracted: { ...edited, contacts: contacts.map(c => ({ name: c.name, firm: c.firm, role: c.role })) },
        status: 'approved',
        deal_id: data.id,
        reviewed_at: new Date().toISOString(),
      })
    } catch { /* non-fatal */ }
  }

  const handlePasteSubmit = async () => {
    if (!pastedText.trim()) return
    setFileName('pasted text'); setStage('parsing'); setError(null)
    try {
      const res = await fetch('/api/intake/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: pastedText, fileName: 'teaser.txt', deal_type: dealType, parent_portco: parentPortco || null }) })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setParsed(data); setEdited({ ...data, stage: data.stage || 'Teaser', deal_type: dealType })
      if (data.dropbox_folder) setDropboxFolder(data.dropbox_folder)
      if (data.dropbox_folder_existed) setDropboxFolderExisted(true)
      if (data.dropbox_error) setDropboxError(data.dropbox_error)
      const parsedContacts: ParsedContact[] = Array.isArray(data.contacts) ? data.contacts : []
      const initialContacts: ExtractedContact[] = parsedContacts.map(c => ({ ...c, searchQuery: c.name, searchResults: [], showSearch: false, showAddForm: false, addForm: { first_name: c.name.split(' ')[0] || '', last_name: c.name.split(' ').slice(1).join(' ') || '', firm: c.firm || '', title: c.title || '', email: c.email || '', phone: c.phone || '' } }))
      setContacts(initialContacts)
      initialContacts.forEach((_, i) => autoLinkContact(i, parsedContacts[i]))
      setStage('review')
    } catch (err: any) {
      setError(err.message || 'Parsing failed'); setStage('idle')
    }
  }

  const reset = () => { setStage('idle'); setParsed(null); setEdited(null); setDealId(null); setError(null); setFileName(''); setContacts([]); setDuplicateDeals([]); setIgnoreDuplicate(false); setDropboxFolder(null); setDropboxFolderExisted(false); setDropboxError(null); setExtraFiles([]); setPastedText('') }

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: 'flex-start' }}>

      {/* Left panel */}
      <div style={{ width: isMobile ? '100%' : '280px', minWidth: isMobile ? undefined : '280px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>Upload Teaser</div>

          {/* Platform / Add-on selector — always visible */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '5px' }}>Deal type</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['platform', 'add-on'] as const).map(t => (
                <button key={t} onClick={() => { setDealType(t); if (t === 'platform') setParentPortco('') }}
                  disabled={stage !== 'idle'}
                  style={{ flex: 1, padding: '5px 0', fontSize: '11px', fontWeight: dealType === t ? 600 : 400, borderRadius: '5px', border: '1px solid var(--border)', cursor: stage === 'idle' ? 'pointer' : 'default', background: dealType === t ? 'var(--accent)' : 'transparent', color: dealType === t ? '#fff' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                  {t === 'platform' ? 'Platform' : 'Add-on'}
                </button>
              ))}
            </div>
            {dealType === 'add-on' && (
              <div style={{ marginTop: '6px' }}>
                <select className="select" style={{ width: '100%', fontSize: '11px' }} value={parentPortco}
                  onChange={e => setParentPortco(e.target.value)} disabled={stage !== 'idle'}>
                  <option value="">Select portfolio company…</option>
                  {portcos.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
                {parentPortco && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Dropbox folder will be named: <strong>{'{Company}'} [{parentPortco}]</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          {stage === 'idle' && (
            <>
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
                {(['pdf', 'word', 'paste'] as const).map(m => (
                  <button key={m} onClick={() => setInputMode(m)} style={{
                    flex: 1, padding: '5px 0', fontSize: '11px', fontWeight: inputMode === m ? 600 : 400,
                    borderRadius: '5px', border: '1px solid var(--border)', cursor: 'pointer',
                    background: inputMode === m ? 'var(--accent)' : 'transparent',
                    color: inputMode === m ? '#fff' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}>
                    {m === 'pdf' ? 'PDF' : m === 'word' ? 'Word' : 'Paste'}
                  </button>
                ))}
              </div>

              {(inputMode === 'pdf' || inputMode === 'word') && (
                <FileDropZone
                  accept={inputMode === 'word'
                    ? { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/msword': ['.doc'] }
                    : { 'application/pdf': ['.pdf'] }}
                  onFile={() => {}}
                  file={null}
                  onClear={() => {}}
                  hint={inputMode === 'word' ? 'Drop .docx / .doc here or click to browse' : 'Drop PDF here or click to browse'}
                  getRootProps={getRootProps}
                  getInputProps={getInputProps}
                  isDragActive={isDragActive}
                />
              )}

              {inputMode === 'paste' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <textarea
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                    placeholder="Paste teaser text here…"
                    rows={8}
                    style={{ width: '100%', fontSize: '12px', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handlePasteSubmit}
                    disabled={!pastedText.trim()}
                    style={{ width: '100%', fontSize: '12px' }}
                  >
                    Parse Teaser
                  </button>
                </div>
              )}
            </>
          )}

          {(stage === 'uploading' || stage === 'parsing') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '20px 0' }}>
              <Loader2 size={22} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
              <div style={{ fontSize: '12px', fontWeight: 600, textAlign: 'center' }}>{stage === 'uploading' ? 'Uploading…' : 'Parsing…'}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>{fileName}</div>
            </div>
          )}

          {(stage === 'review' || stage === 'saving' || stage === 'done') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Check size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{fileName}</span>
              </div>
              {stage !== 'done' && (
                <button className="btn btn-ghost" onClick={reset} style={{ fontSize: '11px', padding: '4px 10px', width: '100%' }}>
                  Start over
                </button>
              )}
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', padding: '8px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '7px', fontSize: '11px', color: '#ef4444' }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: '1px' }} />{error}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — review content */}
      <div style={{ flex: 1, minWidth: 0 }}>
      {stage === 'idle' && (
        <div style={{ padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
          Upload a teaser PDF or Word doc, or paste the text. Claude will extract deal data and contacts automatically and file it to Dropbox.
        </div>
      )}

      {stage === 'review' && edited && (
        <div className="fade-in">
          {dropboxFolderExisted && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '8px', marginBottom: '10px', fontSize: '12px', color: '#b45309' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>A Dropbox folder for <strong>{edited.company_name}</strong> already exists — this company may already be in the pipeline. Review for duplicates before saving.</span>
            </div>
          )}
          {dropboxFolder && (
            <div style={{ padding: '12px 14px', background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.25)', borderRadius: '8px', marginBottom: '14px', fontSize: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--green)', marginBottom: extraFiles.length > 0 ? '10px' : '8px' }}>
                <Check size={14} style={{ flexShrink: 0 }} /> {dropboxFolderExisted ? 'File added to existing Dropbox folder' : 'Teaser saved to Dropbox'} · <strong>{dropboxFolder}</strong>
              </div>
              {extraFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
                  {extraFiles.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: f.status === 'done' ? 'var(--green)' : f.status === 'error' ? '#ef4444' : 'var(--text-muted)' }}>
                      {f.status === 'done' ? <Check size={11} /> : f.status === 'error' ? <X size={11} /> : <span style={{ width: 11 }}>⋯</span>}
                      {f.name}{f.error ? ` — ${f.error}` : ''}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input ref={extraFileRef} type="file" multiple style={{ display: 'none' }} onChange={e => uploadExtraFiles(e.target.files)} />
                <button onClick={() => extraFileRef.current?.click()} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid rgba(5,150,105,0.4)', borderRadius: '5px', background: 'transparent', cursor: 'pointer', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Plus size={11} /> Attach files to Dropbox
                </button>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>NDA, LOI, financials, etc.</span>
              </div>
            </div>
          )}

          {missingFields.length > 0 && (
            <div style={{ display: 'flex', gap: '10px', padding: '12px 16px', background: 'rgba(237,117,32,0.08)', border: '1px solid rgba(237,117,32,0.2)', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: '#f97316' }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div><strong>Missing fields:</strong> {missingFields.map(f => f.label).join(', ')} — please fill in before saving.</div>
            </div>
          )}

          <div className="card" style={{ padding: '24px', marginBottom: '16px' }}>
            <div className="label" style={{ marginBottom: '18px' }}>Deal Information</div>
            <IntakeField label="Company *" required={!edited.company_name}><input className="input" value={edited.company_name || ''} onChange={e => updateField('company_name', e.target.value)} /></IntakeField>
            <IntakeField label="Sector *" required={!edited.sector}><input className="input" list="sector-opts" value={edited.sector || ''} onChange={e => updateField('sector', e.target.value)} /><datalist id="sector-opts">{SECTORS.map(s => <option key={s} value={s} />)}</datalist></IntakeField>
            <IntakeField label="Geography *" required={!edited.geography}><input className="input" value={edited.geography || ''} onChange={e => updateField('geography', e.target.value)} /></IntakeField>
            <IntakeField label="Deal Type *" required={!edited.deal_type}>
              <select className="select" value={edited.deal_type || ''} onChange={e => updateField('deal_type', e.target.value)}>
                <option value="">Select</option><option value="platform">Platform</option><option value="add-on">Add-On</option><option value="recap">Recap</option><option value="growth">Growth</option>
              </select>
            </IntakeField>
            <IntakeField label="Stage *" required={!edited.stage}>
              <select className="select" value={edited.stage || 'Teaser'} onChange={e => updateField('stage', e.target.value)}>
                <optgroup label="Active"><option value="Teaser">Teaser</option><option value="Reviewing">Reviewing</option><option value="Pre-LOI">Pre-LOI</option><option value="LOI Submitted">LOI Submitted</option><option value="Exclusivity">Exclusivity</option></optgroup>
                <optgroup label="Closed"><option value="Closed (Platform)">Closed (Platform)</option><option value="Closed (Add-On)">Closed (Add-On)</option></optgroup>
                <optgroup label="Pass"><option value="Pass (DOA)">Pass (DOA)</option><option value="Pass (Pre-LOI)">Pass (Pre-LOI)</option><option value="Pass (Post-LOI)">Pass (Post-LOI)</option></optgroup>
                <optgroup label="Other"><option value="Hold">Hold</option></optgroup>
              </select>
            </IntakeField>
            <IntakeField label="Revenue ($M) *" required={edited.revenue == null}><input className="input" type="number" step="any" min="0" value={edited.revenue != null ? edited.revenue / 1e6 : ''} onChange={e => updateField('revenue', e.target.value !== '' ? parseFloat(e.target.value) * 1e6 : null)} placeholder="e.g. 18.5" /></IntakeField>
            <IntakeField label="EBITDA ($M) *" required={edited.ebitda == null}><input className="input" type="number" step="any" value={edited.ebitda != null ? edited.ebitda / 1e6 : ''} onChange={e => updateField('ebitda', e.target.value !== '' ? parseFloat(e.target.value) * 1e6 : null)} placeholder="e.g. 4.2" /></IntakeField>
          </div>

          {contacts.length > 0 && (
            <div className="card" style={{ padding: '24px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div className="label">Contacts Found ({contacts.length})</div>
                {linkedCount > 0 && <div style={{ fontSize: '11px', color: 'var(--green)' }}>{linkedCount} linked to CRM</div>}
              </div>
              {contacts.map((c, idx) => (
                <TeaserContactRow key={idx} contact={c} onUpdate={(patch: Partial<ExtractedContact>) => updateContact(idx, patch)} onSearch={(q: string) => searchForContact(idx, q)} onLinkCrm={(crm: any) => updateContact(idx, { crmContact: crm, showSearch: false, showAddForm: false })} onAddNew={(type: string) => addNewContact(idx, type)} onLinkExisting={(crm: any) => linkExisting(idx, crm)} onMerge={(crm: any) => mergeExisting(idx, crm)} onOverwrite={(crm: any) => overwriteExisting(idx, crm)} onAddNew2={() => updateContact(idx, { showMergePrompt: false, showAddForm: true, mergeCandidate: undefined, mergeCandidates: undefined })} supabase={supabase} />
              ))}
            </div>
          )}

          {edited.cim_summary && (
            <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
              <div className="label" style={{ marginBottom: '10px' }}>AI Summary</div>
              <textarea className="input" rows={5} value={edited.cim_summary} onChange={e => updateField('cim_summary', e.target.value)} style={{ resize: 'vertical', fontSize: '13px', lineHeight: 1.7 }} />
            </div>
          )}

          {duplicateDeals.length > 0 && (
            <div style={{ marginBottom: '16px', padding: '16px', background: 'rgba(237,117,32,0.06)', border: '1px solid rgba(237,117,32,0.25)', borderRadius: '8px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f97316', marginBottom: '10px' }}>⚠ Possible duplicate — {duplicateDeals.length} similar deal{duplicateDeals.length > 1 ? 's' : ''} already exist:</div>
              {duplicateDeals.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '6px' }}>
                  <div><span style={{ fontSize: '13px', fontWeight: 500 }}>{d.company_name}</span><span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>{d.stage} · {d.status}</span></div>
                  <Link href={`/deals/${d.id}`} style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>View →</Link>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button className="btn btn-ghost" onClick={() => setDuplicateDeals([])} style={{ fontSize: '12px' }}>Cancel</button>
                <button className="btn btn-primary" onClick={() => { setIgnoreDuplicate(true); handleSave(true) }} style={{ fontSize: '12px', background: '#f97316' }}>Save anyway</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-primary" onClick={() => handleSave(false)} disabled={missingFields.length > 0}>
              <Check size={14} /> Save as deal
            </button>
          </div>
        </div>
      )}

      {stage === 'saving' && <div className="card" style={{ padding: '40px', textAlign: 'center' }}><div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Saving deal…</div></div>}

      {stage === 'done' && dealId && (
        <div className="card fade-in" style={{ padding: '40px', textAlign: 'center' }}>
          <Check size={40} style={{ color: 'var(--green)', display: 'block', margin: '0 auto 16px' }} />
          <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Deal created</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
            {edited?.company_name} added to pipeline{linkedCount > 0 && ` · ${linkedCount} contact${linkedCount > 1 ? 's' : ''} linked`}
          </div>
          <Link href={`/deals/${dealId}`} className="btn btn-primary">View deal <ChevronRight size={13} /></Link>
        </div>
      )}

      </div>{/* end right panel */}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function IntakeField({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '12px', alignItems: 'start', marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: required ? '#f97316' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: '8px' }}>{label}</div>
      <div>{children}</div>
    </div>
  )
}

function TeaserContactRow({ contact, onUpdate, onSearch, onLinkCrm, onAddNew, onLinkExisting, onMerge, onOverwrite, onAddNew2, supabase }: any) {
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (rowRef.current && !rowRef.current.contains(e.target as Node)) onUpdate({ showSearch: false }) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const roleBadgeColor: Record<string, string> = { 'Source / Banker': 'var(--accent)', 'Management': 'var(--green)', 'Advisor': '#7c6fcd', 'Lender': '#d4a017', 'Other': 'var(--text-muted)' }
  const contactTypeForRole: Record<string, string> = { 'Source / Banker': 'banker', 'Management': 'management', 'Advisor': 'advisor', 'Lender': 'lender', 'Other': 'other' }
  if (contact.skip) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', marginBottom: '8px', opacity: 0.4, fontSize: '12px' }}>
      <span>{contact.name} · skipped</span>
      <button onClick={() => onUpdate({ skip: false })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--accent)' }}>Undo</button>
    </div>
  )
  return (
    <div ref={rowRef} style={{ marginBottom: '12px', padding: '12px', background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: contact.crmContact ? '0' : '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{contact.name}</span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: roleBadgeColor[contact.role] || 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{contact.role}</span>
          </div>
          {contact.firm && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{contact.firm}{contact.title ? ` · ${contact.title}` : ''}</div>}
        </div>
        <button onClick={() => onUpdate({ skip: true })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={13} /></button>
      </div>
      {contact.showMergePrompt && !contact.crmContact && (
        <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '7px' }}>
          {contact.mergeCandidate && !contact.mergeCandidates && (() => { const c = contact.mergeCandidate; return (<>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#d97706', marginBottom: '6px' }}>⚠ Possible match in CRM</div>
            <div style={{ fontSize: '12px', marginBottom: '10px' }}><strong>{c.first_name} {c.last_name}</strong>{c.firm ? <span style={{ color: 'var(--text-muted)' }}> · {c.firm}</span> : ''}{c.email ? <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.email}</div> : ''}</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button onClick={() => onLinkExisting(c)} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '5px', background: 'var(--surface)', cursor: 'pointer' }}>Link as-is</button>
              <button onClick={() => onMerge(c)} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid var(--accent)', borderRadius: '5px', background: 'var(--accent-muted)', cursor: 'pointer', color: 'var(--accent)' }}>Merge</button>
              <button onClick={() => onOverwrite(c)} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid #d97706', borderRadius: '5px', background: 'transparent', cursor: 'pointer', color: '#d97706' }}>Overwrite</button>
              <button onClick={onAddNew2} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '5px', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Add as new</button>
            </div>
          </>)})()}
          {contact.mergeCandidates && (<>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#d97706', marginBottom: '8px' }}>⚠ {contact.mergeCandidates.length} possible matches — choose one:</div>
            {contact.mergeCandidates.map((c: any) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '6px' }}>
                <div style={{ fontSize: '12px' }}><strong>{c.first_name} {c.last_name}</strong>{c.firm ? <span style={{ color: 'var(--text-muted)' }}> · {c.firm}</span> : ''}</div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => onLinkExisting(c)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid var(--border)', borderRadius: '4px', background: 'none', cursor: 'pointer' }}>Link</button>
                  <button onClick={() => onMerge(c)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid var(--accent)', borderRadius: '4px', background: 'var(--accent-muted)', cursor: 'pointer', color: 'var(--accent)' }}>Merge</button>
                </div>
              </div>
            ))}
            <button onClick={onAddNew2} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '5px', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Add as new</button>
          </>)}
        </div>
      )}
      {contact.crmContact ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
          <Check size={12} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: 'var(--green)' }}>Linked to {contact.crmContact.first_name} {contact.crmContact.last_name}{contact.crmContact.firm ? ` · ${contact.crmContact.firm}` : ''}</span>
          <button onClick={() => onUpdate({ crmContact: undefined, showSearch: false, showMergePrompt: false, mergeCandidate: undefined, mergeCandidates: undefined })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>Change</button>
        </div>
      ) : (
        !contact.showAddForm && !contact.showMergePrompt ? (
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '5px', fontStyle: 'italic' }}>No CRM match — search to confirm, or add new</div>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', zIndex: 1 }} />
              <input className="input" placeholder={`Search for ${contact.name}…`} value={contact.searchQuery || ''} onChange={e => onSearch(e.target.value)} onFocus={() => onUpdate({ showSearch: true })} style={{ paddingLeft: '28px', fontSize: '12px' }} />
              {contact.showSearch && (contact.searchResults || []).length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                  {(contact.searchResults || []).map((r: any) => (
                    <button key={r.id} onClick={() => onLinkCrm(r)} style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ fontSize: '12px', fontWeight: 500 }}>{r.first_name} {r.last_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.firm || r.title}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => onUpdate({ showAddForm: true })} style={{ fontSize: '11px', padding: '3px 8px', marginTop: '5px' }}><Plus size={11} /> Add to CRM</button>
          </div>
        ) : (
          <div style={{ marginTop: '4px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              {[['First *','first_name'],['Last *','last_name'],['Firm','firm'],['Title','title'],['Email','email'],['Phone','phone']].map(([label, field]) => (
                <div key={field}><label className="label" style={{ fontSize: '10px' }}>{label}</label><input className="input" style={{ fontSize: '12px' }} value={(contact.addForm as any)?.[field] || ''} onChange={e => onUpdate({ addForm: { ...contact.addForm, [field]: e.target.value } } as any)} /></div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-ghost" onClick={() => onUpdate({ showAddForm: false })} style={{ fontSize: '11px', padding: '4px 10px' }}>Cancel</button>
              <button className="btn btn-primary" onClick={() => onAddNew(contactTypeForRole[contact.role] || 'other')} disabled={!contact.addForm?.first_name || !contact.addForm?.last_name} style={{ fontSize: '11px', padding: '4px 10px' }}><Check size={11} /> Add to CRM</button>
            </div>
          </div>
        )
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Pending Queue ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function PendingQueue({ onApproved }: { onApproved: () => void }) {
  const supabase = createClient()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<string | null>(null) // id of item being reviewed
  const [editMap, setEditMap] = useState<Record<string, any>>({})
  const [portcos, setPortcos] = useState<{id:string;name:string}[]>([])
  const [processing, setProcessing] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)

  useEffect(() => {
    load()
    supabase.from('portfolio_companies').select('id, name').eq('status', 'Active').order('name')
      .then(({ data }) => setPortcos(data || []))
  }, [])

  // Close review panel on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReviewing(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/intake/queue?status=pending')
    const data = await res.json()
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  function getEdit(id: string, item: any) {
    return editMap[id] ?? {
      company_name: item.extracted?.company_name ||
        (item.extracted?._email_subject
          ? item.extracted._email_subject.replace(/^(fw|fwd|re)\s*:\s*/i, '').trim()
          : 'Unknown'),
      sector:       item.extracted?.sector ?? '',
      geography:    item.extracted?.geography ?? '',
      revenue:      item.extracted?.revenue ?? null,
      ebitda:       item.extracted?.ebitda ?? null,
      deal_type:    item.extracted?.deal_type ?? 'platform',
      parent_portco: '',
      // Default stage uses the forwarder's suggestion if present, otherwise Teaser
      stage:        item.extracted?._stage_suggestion ?? 'Teaser',
    }
  }

  function setEdit(id: string, patch: any) {
    setEditMap(prev => ({ ...prev, [id]: { ...getEdit(id, items.find(i => i.id === id)), ...patch } }))
  }

  async function handleApprove(item: any) {
    setProcessing(item.id)
    setApproveError(null)
    const edited = getEdit(item.id, item)
    try {
      const res = await fetch(`/api/intake/queue/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', edited }),
      })
      const data = await res.json()
      if (data.success) {
        setItems(prev => prev.filter(i => i.id !== item.id))
        setReviewing(null)
        onApproved()
      } else {
        setApproveError(data.error || 'Something went wrong — check Supabase logs')
      }
    } catch (e: any) {
      setApproveError(e?.message || 'Network error')
    }
    setProcessing(null)
  }

  async function handleReject(id: string) {
    setProcessing(id)
    await fetch(`/api/intake/queue/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    })
    setProcessing(null)
    setItems(prev => prev.filter(i => i.id !== id))
    setReviewing(null)
  }

  if (loading) return null
  if (items.length === 0) return null

  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Pending Review</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--surface-2)', borderRadius: '20px', padding: '2px 8px' }}>{items.length}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items.map(item => {
          const ext = item.extracted ?? {}
          const isOpen = reviewing === item.id
          const edit = getEdit(item.id, item)
          const isProcessing = processing === item.id

          return (
            <div key={item.id} className="card" style={{ padding: '0', overflow: 'hidden' }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', cursor: 'pointer' }} onClick={() => setReviewing(isOpen ? null : item.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600 }}>{ext.company_name ?? '—'}</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: item.doc_type === 'cim' ? '#7c3aed' : '#2563eb', background: item.doc_type === 'cim' ? 'rgba(124,58,237,0.08)' : 'rgba(37,99,235,0.08)', borderRadius: '4px', padding: '1px 6px' }}>{item.doc_type?.toUpperCase() ?? 'DOC'}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>via email</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {ext.sector ?? ''}{ext.geography ? ` · ${ext.geography}` : ''}
                    {ext.revenue ? ` · $${(ext.revenue / 1e6).toFixed(1)}M rev` : ''}
                    {ext.ebitda  ? ` · $${(ext.ebitda  / 1e6).toFixed(1)}M EBITDA` : ''}
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {new Date(item.created_at).toLocaleDateString()}
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
              </div>

              {/* Expanded review panel */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {ext.description && (
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{ext.description}</p>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Company</label>
                      <input className="input" style={{ fontSize: '13px' }} value={edit.company_name} onChange={e => setEdit(item.id, { company_name: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Sector</label>
                      <input className="input" list="pending-sector-opts" style={{ fontSize: '13px' }} value={edit.sector} onChange={e => setEdit(item.id, { sector: e.target.value })} placeholder="Type or select…" />
                      <datalist id="pending-sector-opts">{SECTORS.map(s => <option key={s} value={s} />)}</datalist>
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Geography</label>
                      <input className="input" style={{ fontSize: '13px' }} value={edit.geography ?? ''} onChange={e => setEdit(item.id, { geography: e.target.value })} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Revenue ($M)</label>
                        <input className="input" type="number" style={{ fontSize: '13px' }} value={edit.revenue != null ? edit.revenue / 1e6 : ''} onChange={e => setEdit(item.id, { revenue: e.target.value ? parseFloat(e.target.value) * 1e6 : null })} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>EBITDA ($M)</label>
                        <input className="input" type="number" style={{ fontSize: '13px' }} value={edit.ebitda != null ? edit.ebitda / 1e6 : ''} onChange={e => setEdit(item.id, { ebitda: e.target.value ? parseFloat(e.target.value) * 1e6 : null })} />
                      </div>
                    </div>
                  </div>

                  {/* Deal type */}
                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Deal type</label>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {(['platform', 'add-on'] as const).map(t => (
                        <button key={t} onClick={() => setEdit(item.id, { deal_type: t, parent_portco: t === 'platform' ? '' : edit.parent_portco })}
                          style={{ padding: '5px 12px', fontSize: '12px', fontWeight: edit.deal_type === t ? 600 : 400, borderRadius: '5px', border: '1px solid var(--border)', cursor: 'pointer', background: edit.deal_type === t ? 'var(--accent)' : 'transparent', color: edit.deal_type === t ? '#fff' : 'var(--text-secondary)' }}>
                          {t === 'platform' ? 'Platform' : 'Add-on'}
                        </button>
                      ))}
                      {edit.deal_type === 'add-on' && (
                        <select className="select" style={{ flex: 1, fontSize: '12px' }} value={edit.parent_portco ?? ''} onChange={e => setEdit(item.id, { parent_portco: e.target.value })}>
                          <option value="">Select portfolio company…</option>
                          {portcos.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Stage selector — choose where the deal lands in the pipeline */}
                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Stage</label>
                    <select
                      className="select"
                      style={{ width: '100%', fontSize: '13px' }}
                      value={edit.stage ?? 'Teaser'}
                      onChange={e => setEdit(item.id, { stage: e.target.value })}
                    >
                      <optgroup label="Active">
                        <option value="Teaser">Teaser</option>
                        <option value="Reviewing">Reviewing</option>
                        <option value="Pre-LOI">Pre-LOI</option>
                        <option value="LOI Submitted">LOI Submitted</option>
                        <option value="Exclusivity">Exclusivity</option>
                        <option value="Hold">Hold</option>
                      </optgroup>
                      <optgroup label="Closed">
                        <option value="Closed (Platform)">Closed (Platform)</option>
                        <option value="Closed (Add-On)">Closed (Add-On)</option>
                      </optgroup>
                      <optgroup label="Passed">
                        <option value="Pass (DOA)">Pass (DOA)</option>
                        <option value="Pass (Pre-LOI)">Pass (Pre-LOI)</option>
                        <option value="Pass (Post-LOI)">Pass (Post-LOI)</option>
                      </optgroup>
                    </select>
                  </div>

                  {/* Source info */}
                  {item.from_email && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Forwarded by <strong>{item.from_email}</strong> · {item.file_name}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', paddingTop: '4px' }}>
                    <button
                      onClick={() => handleApprove(item)}
                      disabled={!!isProcessing}
                      className="btn btn-primary"
                      style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      {isProcessing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
                      Add to Pipeline
                    </button>
                    <button
                      onClick={() => handleReject(item.id)}
                      disabled={!!isProcessing}
                      style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '7px', border: '1px solid var(--border)', background: 'white', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      Discard
                    </button>
                  </div>

                  {/* Approve error */}
                  {approveError && reviewing === item.id && (
                    <div style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '7px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '13px' }}>
                      ⚠️ {approveError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Main Page ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const DOC_TYPES: { key: DocType; label: string; icon: React.ReactNode; description: string; formats: string }[] = [
  { key: 'teaser',  label: 'Teaser',  icon: <FileText size={22} />,   description: 'Upload a banker teaser to auto-create a deal and extract contacts', formats: 'PDF · Word' },
  { key: 'cim',     label: 'CIM',     icon: <FileSearch size={22} />, description: 'Analyze a CIM and cross-reference with teaser data and NDA',         formats: 'PDF · Word' },
  { key: 'nda',     label: 'NDA',     icon: <FileCheck size={22} />,  description: 'Review an NDA against your standard template from Best Practices',    formats: 'PDF · Word' },
]

export default function DocumentIntakePage() {
  const isMobile = useIsMobile()
  const [activeType, setActiveType] = useState<DocType>('teaser')
  const [queueKey, setQueueKey] = useState(0)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '14px 16px' : '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Document Intake</h1>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '16px' : '24px 28px' }}>
        {/* Pending queue */}
        <PendingQueue key={queueKey} onApproved={() => setQueueKey(k => k + 1)} />

        {/* Document type selector */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '28px', flexWrap: 'wrap' }}>
          {DOC_TYPES.map(({ key, label, icon, description, formats }) => (
            <button key={key} onClick={() => setActiveType(key)} style={{
              display: 'flex', flexDirection: 'column', gap: '8px',
              padding: '16px 20px', border: `2px solid ${activeType === key ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '10px', background: activeType === key ? 'var(--accent-muted)' : 'var(--surface)',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              flex: '1', minWidth: '200px', maxWidth: '300px',
            }}>
              <div style={{ color: activeType === key ? 'var(--accent)' : 'var(--text-muted)' }}>{icon}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: activeType === key ? 'var(--accent)' : 'var(--text-primary)' }}>{label}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{description}</div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '4px' }}>{formats}</div>
            </button>
          ))}
        </div>

        {/* Active flow */}
        {activeType === 'teaser' && <TeaserFlow />}
        {activeType === 'cim'    && <CIMFlow />}
        {activeType === 'nda'    && <NDAFlow />}
      </div>

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
