'use client'
// Inline field editors for the deal detail page — extracted verbatim from
// app/deals/[id]/page.tsx (review item 15, behavior-preserving split).

import { useEffect, useState, useRef } from 'react'
import { formatCurrency } from '@/types'
import { Check, X } from 'lucide-react'

export function InlineFinancial({ label, value, accent, onSave }: {
  label: string, value: number | null, accent?: boolean, onSave: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const start = () => {
    setRaw(value ? String((value / 1e6).toFixed(1)) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }
  const save = () => {
    const parsed = parseFloat(raw)
    onSave(isNaN(parsed) ? null : parsed * 1e6)
    setEditing(false)
  }

  if (editing) return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>{label} ($M)</div>
      <input
        ref={inputRef}
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        onBlur={save}
        placeholder="e.g. 4.2"
        style={{ width: '80px', fontSize: '15px', fontFamily: 'var(--font-mono)', fontWeight: 600, padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: '5px', background: 'var(--surface)', color: accent ? 'var(--accent)' : 'var(--text-primary)', outline: 'none' }}
      />
    </div>
  )

  return (
    <div onClick={start} style={{ cursor: 'text' }} title="Click to edit">
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: '16px', fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent)' : 'var(--text-primary)', marginTop: '2px', borderBottom: '1px dashed var(--border)', paddingBottom: '1px', minWidth: '40px' }}>
        {value ? formatCurrency(value) : <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Add</span>}
      </div>
    </div>
  )
}

export function EditableField({ label, value, onSave, type = 'text', multiline = false, placeholder }: {
  label: string, value: string, onSave: (v: string) => void,
  type?: string, multiline?: boolean, placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  useEffect(() => { setVal(value) }, [value])
  const save = () => { onSave(val); setEditing(false) }
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '10px' }}>
      <div style={{ minWidth: '100px', fontSize: '11px', color: 'var(--text-muted)', paddingTop: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {editing ? (
        <div style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          {multiline ? <textarea className="input" value={val} onChange={e => setVal(e.target.value)} rows={3} style={{ resize: 'vertical', fontSize: '13px' }} />
            : <input className="input" value={val} type={type} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder={placeholder} style={{ fontSize: '13px' }} />}
          <button className="btn btn-ghost" onClick={save} style={{ padding: '6px' }}><Check size={13} /></button>
          <button className="btn btn-ghost" onClick={() => { setEditing(false); setVal(value) }} style={{ padding: '6px' }}><X size={13} /></button>
        </div>
      ) : (
        <div style={{ flex: 1, fontSize: '13px', color: value ? 'var(--text-primary)' : 'var(--text-muted)', padding: '5px 6px', borderRadius: '5px', cursor: 'text', minHeight: '28px' }} onClick={() => setEditing(true)}>
          {value || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Click to edit</span>}
        </div>
      )}
    </div>
  )
}

export function EditableInline({ value, onSave, style }: { value: string, onSave: (v: string) => void, style?: any }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  useEffect(() => { setVal(value) }, [value])
  const save = () => { if (val.trim()) { onSave(val); setEditing(false) } }
  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input autoFocus className="input" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} style={{ fontSize: '22px', fontWeight: 700, padding: '4px 8px', width: '320px' }} />
      <button className="btn btn-primary" onClick={save} style={{ padding: '4px 10px', fontSize: '12px' }}>Save</button>
      <button className="btn btn-ghost" onClick={() => setEditing(false)} style={{ padding: '4px 10px', fontSize: '12px' }}>Cancel</button>
    </div>
  )
  return (
    <h1 style={{ ...style, cursor: 'pointer', borderBottom: '1px dashed transparent', display: 'inline-block' }} onClick={() => setEditing(true)} title="Click to edit name"
      onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--text-muted)')}
      onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}>
      {value}
    </h1>
  )
}
