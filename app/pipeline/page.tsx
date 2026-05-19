'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import type { Deal, DealStage } from '@/types'
import { formatCurrency, stageClass } from '@/types'
import { Plus, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import NewDealModal from '@/components/deals/NewDealModal'
import { moveDropboxOnStageChange } from '@/lib/dropbox-stage-move'

const STAGES: { name: DealStage; label: string }[] = [
  { name: 'Exclusivity',   label: 'Exclusivity' },
  { name: 'LOI Submitted', label: 'LOI Submitted' },
  { name: 'Pre-LOI',       label: 'Pre-LOI' },
  { name: 'Reviewing',     label: 'Reviewing' },
  { name: 'Teaser',        label: 'Teaser' },
]

export default function PipelinePage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [dealContacts, setDealContacts] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [showNewDeal, setShowNewDeal] = useState(false)
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null)
  const dragId = useRef<string | null>(null)
  const supabase = createClient()

  const fetchDeals = useCallback(async () => {
    const { data } = await supabase
  .from('deals')
  .select('*')
  .in('stage', ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity'])
  .order('updated_at', { ascending: false })
    if (data) {
      setDeals(data)
      const ids = data.map((d: Deal) => d.id)
      if (ids.length > 0) {
        const { data: links } = await supabase
          .from('contact_deal_links')
          .select('deal_id, contact:contacts(first_name, last_name, firm)')
          .in('deal_id', ids)
          .eq('role', 'Source / Banker')
        if (links) {
          const grouped: Record<string, any[]> = {}
          links.forEach((l: any) => {
            if (!grouped[l.deal_id]) grouped[l.deal_id] = []
            grouped[l.deal_id].push(l.contact)
          })
          setDealContacts(grouped)
        }
      }
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchDeals() }, [fetchDeals])

  const dealsByStage = (stage: DealStage) => deals.filter(d => d.stage === stage)

  const updateStage = async (dealId: string, stage: DealStage) => {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage } : d))
    await supabase.from('deals').update({ stage }).eq('id', dealId)
    const deal = deals.find(d => d.id === dealId)
    if (deal) moveDropboxOnStageChange(supabase, dealId, deal.company_name, (deal as any).dropbox_path, stage).catch(console.error)
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '20px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '16px',
        flexShrink: 0, background: 'var(--surface)',
      }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Deal Pipeline</h1>
        <button className="btn btn-primary" onClick={() => setShowNewDeal(true)}>
          <Plus size={14} /> New Deal
        </button>
        <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
          {deals.length} active deal{deals.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Pipeline rows */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        {STAGES.map(({ name, label }) => {
          const stageDeals = dealsByStage(name)
          return (
            <div key={name}
              onDragOver={e => { e.preventDefault(); setDragOverStage(name) }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={e => {
                e.preventDefault()
                setDragOverStage(null)
                const id = e.dataTransfer.getData('text/plain') || dragId.current
                if (id) { updateStage(id, name); dragId.current = null }
              }}
              style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0',
              marginBottom: '0',
              borderBottom: '1px solid var(--border)',
              minHeight: '120px',
              background: dragOverStage === name ? 'var(--accent-muted)' : undefined,
              transition: 'background 0.15s',
            }}>
              {/* Stage label column */}
              <div style={{
                width: '140px',
                minWidth: '140px',
                padding: '16px 16px 16px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                position: 'sticky',
                left: 0,
                background: 'var(--bg)',
                zIndex: 1,
              }}>
                <span className={`badge ${stageClass(name)}`} style={{ alignSelf: 'flex-start' }}>
                  {label}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {stageDeals.length} deal{stageDeals.length !== 1 ? 's' : ''}
                </span>
                {stageDeals.length > 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {formatCurrency(stageDeals.reduce((s, d) => s + (d.ebitda || 0), 0))} EBITDA
                  </span>
                )}
              </div>

              {/* Cards row */}
              <div style={{
                flex: 1,
                display: 'flex',
                gap: '12px',
                padding: '12px 0 12px 12px',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
              }}>
                {stageDeals.length === 0 ? (
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    fontSize: '12px', color: 'var(--text-muted)',
                    fontStyle: 'italic', padding: '8px 0',
                  }}>
                    {dragOverStage === name ? 'Drop to move here' : 'No deals'}
                  </div>
                ) : stageDeals.map(deal => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    contacts={dealContacts[deal.id] || []}
                    onStageChange={updateStage}
                    onDragStart={(e) => { dragId.current = deal.id; e.dataTransfer.setData('text/plain', deal.id); e.dataTransfer.effectAllowed = 'move' }}
                  />
                ))}
              </div>
            </div>
          )
        })}
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

function DealCard({ deal, contacts, onStageChange, onDragStart }: {
  deal: Deal
  contacts: any[]
  onStageChange: (id: string, stage: DealStage) => void
  onDragStart: (e: React.DragEvent) => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      style={{
      width: '280px',
      minWidth: '280px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      transition: 'box-shadow 0.15s, border-color 0.15s',
      cursor: 'grab',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(49,20,50,0.1)'
      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'
      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
    }}
    >
      <Link href={`/deals/${deal.id}`} draggable={false} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>

        {/* Company + arrow */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {deal.company_name}
          </div>
          <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
        </div>

        {/* Sector / Geography */}
        {(deal.sector || deal.geography) && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
            {deal.sector}{deal.geography ? ` · ${deal.geography}` : ''}
          </div>
        )}

        {/* Description */}
        {deal.description && (
          <div style={{
            fontSize: '12px', color: 'var(--text-secondary)',
            marginTop: '7px', lineHeight: 1.5,
            overflow: 'hidden',
            maxHeight: '3em',
          }}>
            {deal.description}
          </div>
        )}

        {/* Financials */}
        {(deal.revenue || deal.ebitda) && (
          <div style={{
            display: 'flex', gap: '16px',
            marginTop: '10px', paddingTop: '10px',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            {deal.revenue && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rev</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>
                  {formatCurrency(deal.revenue)}
                </div>
              </div>
            )}
            {deal.ebitda && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>EBITDA</div>
                <div style={{ fontSize: '12px', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600, marginTop: '1px' }}>
                  {formatCurrency(deal.ebitda)}
                </div>
              </div>
            )}
            {deal.deal_type && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px', textTransform: 'capitalize' }}>
                  {deal.deal_type}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Source contacts */}
        {contacts.length > 0 && (
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
            {contacts.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: i > 0 ? '4px' : '0' }}>
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%',
                  background: 'var(--accent-muted)', color: 'var(--accent)',
                  fontSize: '9px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {c.first_name?.[0]}{c.last_name?.[0]}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  <span style={{ fontWeight: 600 }}>{c.first_name} {c.last_name}</span>
                  {c.firm && <span style={{ color: 'var(--text-muted)' }}> · {c.firm}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Link>
    </div>
  )
}
