'use client'
import { useEffect } from 'react'
import { RotateCcw, X } from 'lucide-react'

export type UndoEntry = {
  id: string
  label: string       // e.g. "Deleted DiPonio Holdings"
  undo: () => Promise<void> | void
}

interface Props {
  stack: UndoEntry[]
  onUndo: (id: string) => void
  onDismiss: (id: string) => void
}

export default function UndoToast({ stack, onUndo, onDismiss }: Props) {
  // Auto-dismiss oldest after 6s
  useEffect(() => {
    if (stack.length === 0) return
    const oldest = stack[stack.length - 1]
    const t = setTimeout(() => onDismiss(oldest.id), 6000)
    return () => clearTimeout(t)
  }, [stack, onDismiss])

  if (stack.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center',
      pointerEvents: 'none',
    }}>
      {[...stack].reverse().map((entry, i) => (
        <div
          key={entry.id}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '10px 14px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            fontSize: '13px',
            color: 'var(--text-primary)',
            pointerEvents: 'all',
            opacity: i === 0 ? 1 : 0.7,
            transform: `scale(${i === 0 ? 1 : 0.96})`,
            transition: 'all 0.15s',
            minWidth: '260px',
          }}
        >
          <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{entry.label}</span>
          <button
            onClick={() => onUndo(entry.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: '5px',
              padding: '4px 10px', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={12} /> Undo
          </button>
          <button
            onClick={() => onDismiss(entry.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
