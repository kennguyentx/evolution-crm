'use client'
import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileText, Check, X, AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface NDAMarkupItem {
  section: string
  issue: string
  significance: 'high' | 'medium' | 'low'
  incoming_language: string
  preferred_language: string
  note: string
}

interface NDARecord {
  id: string
  created_at: string
  file_name: string
  status: string
  entity_name: string
  effective_date: string
  term: string
  term_expiry: string | null
  non_solicit: boolean
  non_solicit_term: string | null
  non_solicit_notes: string | null
  representatives: string[]
  financing_sources_included: boolean
  financing_sources_notes: string
  markup: NDAMarkupItem[]
  overall_assessment: string
}

const SIG_COLORS: Record<string, string> = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    'var(--text-muted)',
}

const SIG_BG: Record<string, string> = {
  high:   'rgba(239,68,68,0.08)',
  medium: 'rgba(245,158,11,0.08)',
  low:    'rgba(0,0,0,0.03)',
}

function MarkupItem({ item }: { item: NDAMarkupItem }) {
  const [open, setOpen] = useState(item.significance === 'high')
  return (
    <div style={{
      border: `1px solid ${SIG_COLORS[item.significance]}`,
      borderRadius: '8px',
      overflow: 'hidden',
      marginBottom: '8px',
      background: SIG_BG[item.significance],
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: SIG_COLORS[item.significance], minWidth: '48px',
        }}>{item.significance}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '80px' }}>{item.section}</span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{item.issue}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>Incoming language</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--surface)', borderRadius: '5px', padding: '8px 10px', fontStyle: item.incoming_language === 'Absent' ? 'italic' : 'normal' }}>
              {item.incoming_language}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '4px' }}>Preferred language</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'rgba(79,40,75,0.06)', borderRadius: '5px', padding: '8px 10px' }}>
              {item.preferred_language}
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{item.note}</div>
        </div>
      )}
    </div>
  )
}

function NDAResult({ nda, onStatusChange }: { nda: NDARecord; onStatusChange: (id: string, status: string) => void }) {
  const highCount = (nda.markup || []).filter(m => m.significance === 'high').length
  const medCount  = (nda.markup || []).filter(m => m.significance === 'medium').length
  const sorted    = [...(nda.markup || [])].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.significance] - order[b.significance]
  })

  return (
    <div>
      {/* Summary card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '18px 20px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700 }}>{nda.entity_name || '—'}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{nda.file_name}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {highCount > 0 && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: '20px', padding: '3px 10px' }}>
                {highCount} high
              </span>
            )}
            {medCount > 0 && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', borderRadius: '20px', padding: '3px 10px' }}>
                {medCount} medium
              </span>
            )}
            <select
              value={nda.status}
              onChange={e => onStatusChange(nda.id, e.target.value)}
              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer' }}
            >
              <option value="reviewing">Reviewing</option>
              <option value="negotiating">Negotiating</option>
              <option value="executed">Executed</option>
              <option value="declined">Declined</option>
            </select>
          </div>
        </div>

        {/* Key fields grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' }}>
          <Field label="Effective Date" value={nda.effective_date} />
          <Field label="Term" value={nda.term} />
          <Field label="Expiry" value={nda.term_expiry || '—'} />
          <Field
            label="Non-Solicit"
            value={nda.non_solicit ? `Yes — ${nda.non_solicit_term || 'see notes'}` : 'None'}
            highlight={nda.non_solicit ? undefined : 'ok'}
          />
          <Field
            label="Financing Sources"
            value={nda.financing_sources_included ? 'Included ✓' : 'Not included ✗'}
            highlight={nda.financing_sources_included ? 'ok' : 'warn'}
          />
        </div>

        {/* Representatives */}
        {nda.representatives?.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '5px' }}>Representatives</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {nda.representatives.map((r, i) => (
                <span key={i} style={{ fontSize: '11px', background: 'var(--accent-muted)', color: 'var(--accent)', borderRadius: '4px', padding: '2px 8px' }}>{r}</span>
              ))}
            </div>
          </div>
        )}

        {/* Financing sources notes */}
        {nda.financing_sources_notes && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: nda.financing_sources_included ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', borderRadius: '6px', padding: '8px 12px', marginBottom: '14px' }}>
            <strong>Financing sources: </strong>{nda.financing_sources_notes}
          </div>
        )}

        {/* Non-solicit notes */}
        {nda.non_solicit_notes && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'rgba(245,158,11,0.06)', borderRadius: '6px', padding: '8px 12px', marginBottom: '14px' }}>
            <strong>Non-solicit notes: </strong>{nda.non_solicit_notes}
          </div>
        )}

        {/* Overall assessment */}
        {nda.overall_assessment && (
          <div style={{ fontSize: '13px', color: 'var(--text-primary)', borderTop: '1px solid var(--border)', paddingTop: '12px', fontStyle: 'italic' }}>
            {nda.overall_assessment}
          </div>
        )}
      </div>

      {/* Markup */}
      {sorted.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Markup ({sorted.length} item{sorted.length !== 1 ? 's' : ''})
          </div>
          {sorted.map((item, i) => <MarkupItem key={i} item={item} />)}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: 'ok' | 'warn' }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '3px' }}>{label}</div>
      <div style={{
        fontSize: '12px', fontWeight: 500,
        color: highlight === 'ok' ? '#22c55e' : highlight === 'warn' ? '#ef4444' : 'var(--text-primary)',
      }}>{value}</div>
    </div>
  )
}

export default function NDATab({ dealId, companyName }: { dealId: string; companyName: string }) {
  const [ndas, setNdas] = useState<NDARecord[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload')
  const [pastedText, setPastedText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [activeNdaId, setActiveNdaId] = useState<string | null>(null)

  const fetchNDAs = useCallback(async () => {
    setLoadingList(true)
    const res = await fetch(`/api/nda-analyze?deal_id=${dealId}`)
    const data = await res.json()
    if (data.ndas) {
      setNdas(data.ndas)
      if (data.ndas.length > 0 && !activeNdaId) setActiveNdaId(data.ndas[0].id)
    }
    setLoadingList(false)
  }, [dealId, activeNdaId])

  useEffect(() => { fetchNDAs() }, [])

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setSelectedFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'text/plain': ['.txt'] },
    maxFiles: 1,
  })

  const analyze = async () => {
    if (!selectedFile && !pastedText.trim()) return
    setAnalyzing(true)
    setError(null)

    const fd = new FormData()
    if (selectedFile) fd.append('file', selectedFile)
    else fd.append('text', pastedText)
    fd.append('deal_id', dealId)
    fd.append('company_name', companyName)

    try {
      const res = await fetch('/api/nda-analyze', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      // Refresh list and show new result
      const listRes = await fetch(`/api/nda-analyze?deal_id=${dealId}`)
      const listData = await listRes.json()
      if (listData.ndas) {
        setNdas(listData.ndas)
        if (data.id) setActiveNdaId(data.id)
        else if (listData.ndas[0]) setActiveNdaId(listData.ndas[0].id)
      }

      setSelectedFile(null)
      setPastedText('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const updateStatus = async (id: string, status: string) => {
    await fetch('/api/nda-analyze', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setNdas(prev => prev.map(n => n.id === id ? { ...n, status } : n))
  }

  const activeNda = ndas.find(n => n.id === activeNdaId)

  return (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', maxWidth: '1000px' }}>

      {/* Left: upload + NDA list */}
      <div style={{ width: '260px', minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* Upload card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>Analyze NDA</div>

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {(['upload', 'paste'] as const).map(m => (
              <button key={m} onClick={() => setInputMode(m)} style={{
                flex: 1, padding: '5px', borderRadius: '6px', border: '1px solid var(--border)',
                background: inputMode === m ? 'var(--accent)' : 'transparent',
                color: inputMode === m ? 'white' : 'var(--text-muted)',
                fontSize: '11px', cursor: 'pointer', fontWeight: 500,
              }}>{m === 'upload' ? 'Upload PDF' : 'Paste text'}</button>
            ))}
          </div>

          {inputMode === 'upload' ? (
            <div {...getRootProps()} style={{
              border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '8px', padding: '16px 10px', textAlign: 'center', cursor: 'pointer',
              background: isDragActive ? 'var(--accent-muted)' : 'transparent',
              transition: 'all 0.15s',
            }}>
              <input {...getInputProps()} />
              {selectedFile ? (
                <div>
                  <FileText size={18} style={{ color: 'var(--accent)', margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '11px', fontWeight: 600, wordBreak: 'break-all' }}>{selectedFile.name}</div>
                  <button onClick={e => { e.stopPropagation(); setSelectedFile(null) }} style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                </div>
              ) : (
                <div>
                  <Upload size={18} style={{ color: 'var(--text-muted)', margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Drop PDF here or click to browse</div>
                </div>
              )}
            </div>
          ) : (
            <textarea
              value={pastedText}
              onChange={e => setPastedText(e.target.value)}
              placeholder="Paste NDA text here…"
              style={{
                width: '100%', minHeight: '100px', padding: '8px',
                borderRadius: '7px', border: '1px solid var(--border)',
                fontSize: '11px', resize: 'vertical', fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text-primary)',
                boxSizing: 'border-box',
              }}
            />
          )}

          {error && (
            <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '8px', display: 'flex', gap: '5px', alignItems: 'flex-start' }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '1px' }} />{error}
            </div>
          )}

          <button
            onClick={analyze}
            disabled={analyzing || (!selectedFile && !pastedText.trim())}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '10px', fontSize: '12px', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {analyzing ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…</> : 'Analyze NDA'}
          </button>
        </div>

        {/* NDA list */}
        {!loadingList && ndas.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', padding: '10px 14px 8px', letterSpacing: '0.05em' }}>
              Past NDAs ({ndas.length})
            </div>
            {ndas.map(nda => (
              <button key={nda.id} onClick={() => setActiveNdaId(nda.id)} style={{
                width: '100%', display: 'flex', flexDirection: 'column', gap: '2px',
                padding: '8px 14px', border: 'none', background: activeNdaId === nda.id ? 'var(--accent-muted)' : 'transparent',
                cursor: 'pointer', textAlign: 'left', borderTop: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: activeNdaId === nda.id ? 'var(--accent)' : 'var(--text-primary)' }}>
                  {nda.entity_name || nda.file_name}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {new Date(nda.created_at).toLocaleDateString()}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>· {nda.status}</span>
                  {(nda.markup || []).filter(m => m.significance === 'high').length > 0 && (
                    <span style={{ fontSize: '9px', color: '#ef4444', fontWeight: 700 }}>
                      · {(nda.markup || []).filter(m => m.significance === 'high').length} high
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: results */}
      <div style={{ flex: 1 }}>
        {analyzing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '40px 0', color: 'var(--text-muted)' }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Analyzing NDA…</div>
              <div style={{ fontSize: '12px', marginTop: '2px' }}>Comparing against your standard template in Best Practices</div>
            </div>
          </div>
        )}

        {!analyzing && activeNda && (
          <NDAResult nda={activeNda} onStatusChange={updateStatus} />
        )}

        {!analyzing && !activeNda && ndas.length === 0 && (
          <div style={{ padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            Upload or paste an NDA to get started. Claude will extract key terms and compare against your standard template from Best Practices.
          </div>
        )}
      </div>
    </div>
  )
}
