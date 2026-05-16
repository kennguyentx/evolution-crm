'use client'
import { useEffect, useState, useCallback } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { createClient } from '@/lib/supabase'
import type { Deal, DealStage } from '@/types'
import { formatCurrency, stageClass } from '@/types'
import { Plus, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import NewDealModal from '@/components/deals/NewDealModal'

// Active stages — Exclusivity at top (reversed)
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
  const supabase = createClient()

  const fetchDeals = useCallback(async () => {
    const { data } = await supabase
      .from('deals')
      .select('*')
      .eq('status', 'Active')
      .order('updated_at', { ascending: false })
    if (data) {
      setDeals(data)
      // Fetch source contacts for all deals
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

  const dealsByStage = (stage: DealStage) =>
    deals.filter(d => d.stage === stage)

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return
    const dealId = result.draggableId
    const newStage = result.destination.droppableId as DealStage
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage } : d))
    await supabase.from('deals').update({ stage: newStage }).eq('id', dealId)
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '20px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: 'var(--surface)',
      }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>Deal Pipeline</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
            {deals.length} active deal{deals.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNewDeal(true)}>
          <Plus size={14} /> New Deal
        </button>
      </div>

      {/* Kanban — horizontal scroll */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div style={{
          flex: 1,
          display: 'flex',
          gap: '12px',
          padding: '20px 24px',
          overflowX: 'auto',
          alignItems: 'flex-start',
        }}>
          {STAGES.map(({ name, label }) => {
            const stageDeals = dealsByStage(name)
            const totalEbitda = stageDeals.reduce((s, d) => s + (d.ebitda || 0), 0)
            return (
              <div key={name} style={{ minWidth: '260px', width: '260px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Column header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge ${stageClass(name)}`}>{label}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--surface-3)', borderRadius: '999px', padding: '1px 7px' }}>
                      {stageDeals.length}
                    </span>
                  </div>
                  {totalEbitda > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {formatCurrency(totalEbitda)}
                    </span>
                  )}
                </div>

                <Droppable droppableId={name}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      style={{
                        minHeight: '80px',
                        background: snapshot.isDraggingOver ? 'rgba(79,40,75,0.04)' : 'transparent',
                        borderRadius: '8px',
                        transition: 'background 0.15s',
                        display: 'flex', flexDirection: 'column', gap: '8px', padding: '2px',
                      }}
                    >
                      {stageDeals.map((deal, index) => (
                        <Draggable key={deal.id} draggableId={deal.id} index={index}>
                          {(provided, snapshot) => (
                            <DealCard
                              deal={deal}
                              contacts={dealContacts[deal.id] || []}
                              draggableProps={provided.draggableProps}
                              dragHandleProps={provided.dragHandleProps}
                              innerRef={provided.innerRef}
                              isDragging={snapshot.isDragging}
                            />
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )
          })}
        </div>
      </DragDropContext>

      {showNewDeal && (
        <NewDealModal
          onClose={() => setShowNewDeal(false)}
          onCreated={() => { setShowNewDeal(false); fetchDeals() }}
        />
      )}
    </div>
  )
}

function DealCard({ deal, contacts, draggableProps, dragHandleProps, innerRef, isDragging }: {
  deal: Deal
  contacts: any[]
  draggableProps: any
  dragHandleProps: any
  innerRef: any
  isDragging: boolean
}) {
  return (
    <div
      ref={innerRef}
      {...draggableProps}
      {...dragHandleProps}
      style={{
        ...draggableProps.style,
        background: isDragging ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '8px',
        padding: '12px 14px',
        cursor: 'grab',
        boxShadow: isDragging ? '0 8px 24px rgba(49,20,50,0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      <Link href={`/deals/${deal.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }} onClick={e => e.stopPropagation()}>

        {/* Company name */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {deal.company_name}
          </div>
          <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
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
            fontSize: '11px', color: 'var(--text-secondary)',
            marginTop: '6px', lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {deal.description}
          </div>
        )}

        {/* Financials — Revenue first, EBITDA second */}
        {(deal.revenue || deal.ebitda) && (
          <div style={{
            display: 'flex', gap: '12px', marginTop: '10px',
            paddingTop: '10px', borderTop: '1px solid var(--border-subtle)',
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
                <div style={{ fontSize: '12px', color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>
                  {formatCurrency(deal.ebitda)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Source contacts */}
        {contacts.length > 0 && (
          <div style={{
            marginTop: '8px', paddingTop: '8px',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            {contacts.slice(0, 2).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: i > 0 ? '3px' : '0' }}>
                <div style={{
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: 'var(--accent-muted)', color: 'var(--accent)',
                  fontSize: '9px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {c.first_name?.[0]}{c.last_name?.[0]}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.2 }}>
                  <span style={{ fontWeight: 500 }}>{c.first_name} {c.last_name}</span>
                  {c.firm && <span style={{ color: 'var(--text-muted)' }}> · {c.firm}</span>}
                </div>
              </div>
            ))}
            {contacts.length > 2 && (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>
                +{contacts.length - 2} more
              </div>
            )}
          </div>
        )}

        {deal.cim_parsed && (
          <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '3px' }}>
            ● CIM parsed
          </div>
        )}
      </Link>
    </div>
  )
}
