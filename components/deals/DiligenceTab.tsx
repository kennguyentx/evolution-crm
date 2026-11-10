'use client'
// Diligence checklist tab for the deal detail page — extracted verbatim from
// app/deals/[id]/page.tsx (review item 15, behavior-preserving split).
// All state and handlers stay in the page and arrive as props.

import type { DiligenceItem } from '@/types'
import { Check, Plus, Upload, X } from 'lucide-react'

export default function DiligenceTab({ diligence, completedDiligence, diligencePct, seedDiligence, resetDiligence, getDiligenceDropProps, getDiligenceInputProps, isDiligenceDrag, addDiligenceItem, deleteDiligenceItem, toggleDiligenceStatus }: {
  diligence: DiligenceItem[]
  completedDiligence: number
  diligencePct: number
  seedDiligence: () => void
  resetDiligence: () => void
  getDiligenceDropProps: any
  getDiligenceInputProps: any
  isDiligenceDrag: boolean
  addDiligenceItem: () => void
  deleteDiligenceItem: (e: any, itemId: string) => void
  toggleDiligenceStatus: (item: DiligenceItem) => void
}) {
  return (
        <div style={{ maxWidth: '700px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {diligence.length === 0 && <button className="btn btn-ghost" onClick={seedDiligence} style={{ fontSize: '12px' }}>Load default checklist</button>}
            {diligence.length > 0 && <button className="btn btn-ghost" onClick={resetDiligence} style={{ fontSize: '12px', color: 'var(--text-muted)' }}>↺ Reset to defaults</button>}
            <div {...getDiligenceDropProps()} style={{ border: `1.5px dashed ${isDiligenceDrag ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '7px', padding: '6px 14px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', background: isDiligenceDrag ? 'var(--accent-muted)' : 'transparent' }}>
              <input {...getDiligenceInputProps()} />
              <Upload size={12} /> Upload Excel/CSV checklist
            </div>
            <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={addDiligenceItem}>
              <Plus size={12} /> Add Item
            </button>
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{completedDiligence} of {diligence.length} complete</div>
          </div>
          {diligence.length > 0 && (
            <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', marginBottom: '20px' }}>
              <div style={{ height: '100%', width: `${diligencePct}%`, background: 'var(--accent)', borderRadius: '2px', transition: 'width 0.3s' }} />
            </div>
          )}
          {['financial','legal','operational','management','other',''].map(category => {
            const items = diligence.filter(d => (d.category || '') === category)
            if (!items.length) return null
            return (
              <div key={category} style={{ marginBottom: '20px' }}>
                {category && <div className="label" style={{ marginBottom: '8px', textTransform: 'capitalize' }}>{category}</div>}
                {items.map(item => (
                  <div key={item.id} className="card-2" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', marginBottom: '6px', cursor: 'pointer' }} onClick={() => toggleDiligenceStatus(item)}>
                    <div style={{ width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${item.status === 'Complete' ? 'var(--green)' : 'var(--border)'}`, background: item.status === 'Complete' ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                      {item.status === 'Complete' && <Check size={11} color="white" strokeWidth={3} />}
                    </div>
                    <div style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)' }}>{item.item}</div>
                    <button onClick={(e) => deleteDiligenceItem(e, item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', opacity: 0 }} className="delete-btn">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
  )
}
