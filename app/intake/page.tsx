'use client'
import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Zap, Upload, FileText, Check, AlertCircle, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

interface ParsedDeal {
  company_name: string
  sector: string
  geography: string
  description: string
  revenue: number | null
  ebitda: number | null
  asking_price: number | null
  ev_ebitda_multiple: number | null
  deal_type: string
  source_notes: string
  cim_summary: string
}

export default function IntakePage() {
  const supabase = createClient()
  const [stage, setStage] = useState<'idle' | 'uploading' | 'parsing' | 'review' | 'saving' | 'done'>('idle')
  const [parsed, setParsed] = useState<ParsedDeal | null>(null)
  const [dealId, setDealId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setFileName(file.name)
    setStage('uploading')
    setError(null)

    try {
      // Convert to base64 for API
      const base64 = await fileToBase64(file)
      setStage('parsing')

      const res = await fetch('/api/intake/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, fileName: file.name }),
      })

      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setParsed(data)
      setStage('review')
    } catch (err: any) {
      setError(err.message || 'Parsing failed')
      setStage('idle')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: stage !== 'idle',
  })

  const handleSave = async () => {
    if (!parsed) return
    setStage('saving')

    const { data, error } = await supabase.from('deals').insert({
      company_name: parsed.company_name || 'Unknown Company',
      sector: parsed.sector || null,
      geography: parsed.geography || null,
      description: parsed.description || null,
      revenue: parsed.revenue,
      ebitda: parsed.ebitda,
      asking_price: parsed.asking_price,
      ev_ebitda_multiple: parsed.ev_ebitda_multiple,
      deal_type: parsed.deal_type || 'platform',
      source_notes: parsed.source_notes || null,
      cim_summary: parsed.cim_summary,
      cim_parsed: true,
      stage: 'Reviewing',
      status: 'Active',
    }).select().single()

    if (error) {
      setError(error.message)
      setStage('review')
    } else {
      setDealId(data.id)
      setStage('done')
    }
  }

  const reset = () => {
    setStage('idle')
    setParsed(null)
    setDealId(null)
    setError(null)
    setFileName('')
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px' }}>CIM Intake</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
          Upload a teaser or CIM — AI extracts deal data automatically
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '40px 28px', maxWidth: '700px' }}>

        {/* IDLE / UPLOAD */}
        {(stage === 'idle' || stage === 'uploading') && (
          <div
            {...getRootProps()}
            style={{
              border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '12px',
              padding: '60px 40px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragActive ? 'var(--accent-muted)' : 'var(--surface)',
              transition: 'all 0.2s',
            }}
          >
            <input {...getInputProps()} />
            <Upload size={32} style={{ color: isDragActive ? 'var(--accent)' : 'var(--text-muted)', marginBottom: '16px' }} />
            <div style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px' }}>
              {stage === 'uploading' ? 'Uploading...' : 'Drop CIM or teaser here'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              PDF files only · AI will extract deal data
            </div>
          </div>
        )}

        {/* PARSING */}
        {stage === 'parsing' && (
          <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
            <div style={{ marginBottom: '20px' }}>
              <Zap size={32} style={{ color: 'var(--accent)' }} />
            </div>
            <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px' }}>
              Parsing {fileName}...
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Claude is reading the document and extracting deal data
            </div>
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '6px' }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: `pulse 1.2s ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* ERROR */}
        {error && (
          <div style={{
            display: 'flex', gap: '12px', alignItems: 'flex-start',
            padding: '14px 16px', background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px',
            marginBottom: '16px', fontSize: '13px', color: 'var(--red)',
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* REVIEW */}
        {stage === 'review' && parsed && (
          <div className="fade-in">
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              marginBottom: '24px', padding: '12px 16px',
              background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '8px',
              fontSize: '13px', color: 'var(--green)',
            }}>
              <Check size={15} /> CIM parsed successfully — review and confirm
            </div>

            <div className="card" style={{ padding: '24px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
                Extracted Deal Data
              </div>

              {[
                { label: 'Company', value: parsed.company_name },
                { label: 'Sector', value: parsed.sector },
                { label: 'Geography', value: parsed.geography },
                { label: 'Deal Type', value: parsed.deal_type },
                { label: 'Source / Banker', value: parsed.source_notes },
                { label: 'Revenue', value: parsed.revenue ? `$${(parsed.revenue / 1e6).toFixed(1)}M` : '—' },
                { label: 'EBITDA', value: parsed.ebitda ? `$${(parsed.ebitda / 1e6).toFixed(1)}M` : '—' },
                { label: 'Asking Price', value: parsed.asking_price ? `$${(parsed.asking_price / 1e6).toFixed(1)}M` : '—' },
                { label: 'EV/EBITDA', value: parsed.ev_ebitda_multiple ? `${parsed.ev_ebitda_multiple.toFixed(1)}x` : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                  <div style={{ minWidth: '130px', fontSize: '11px', color: 'var(--text-muted)', paddingTop: '2px' }}>{label}</div>
                  <div style={{ fontSize: '13px', color: value && value !== '—' ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {value || '—'}
                  </div>
                </div>
              ))}
            </div>

            {parsed.cim_summary && (
              <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                  AI Summary
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {parsed.cim_summary}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-ghost" onClick={reset}>Start over</button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Check size={14} /> Save as deal
              </button>
            </div>
          </div>
        )}

        {/* SAVING */}
        {stage === 'saving' && (
          <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Saving deal...</div>
          </div>
        )}

        {/* DONE */}
        {stage === 'done' && dealId && (
          <div className="card fade-in" style={{ padding: '40px', textAlign: 'center' }}>
            <Check size={40} style={{ color: 'var(--green)', marginBottom: '16px' }} />
            <div style={{ fontSize: '18px', fontFamily: 'var(--font-display)', marginBottom: '8px' }}>
              Deal created
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              {parsed?.company_name} has been added to your pipeline as "Reviewing"
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={reset}>Parse another</button>
              <Link href={`/deals/${dealId}`} className="btn btn-primary">
                View deal <ChevronRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
