'use client'
import { useEffect, useState, useCallback } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { createClient } from '@/lib/supabase'
import type { Deal, DealStage } from '@/types'
import { formatCurrency, formatMultiple, stageClass } from '@/types'
import { Plus, Building2, TrendingUp, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import NewDealModal from '@/components/deals/NewDealModal'

const STAGES: { name: DealStage; label: string }[] = [
  { name: 'Teaser',        label: 'Teaser' },
  { name: 'Reviewing',     label: 'Reviewing' },
  { name: 'Pre-LOI',       label: 'Pre-LOI' },
  { name: 'LOI Submitted', label: 'LOI Submitted' },
  { name: 'Exclusivity',   label: 'Exclusivity' },
]

export default function PipelinePage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewDeal, setShowNewDeal] = useState(false)
  const supabase = createClient()

  const fetchDeals = useCallback(async () => {
    const { data } = await supabase
      .from('deals')
      .select('*')
      .eq('status', 'Active')
      .order('updated_at', { ascending: false })
    if (data) setDeals(data)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchDeals() }, [fetchDeals])

  const dealsByStage = (stage: DealStage) =>
    deals.filter(d => d.stage === stage)

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return
    const dealId = result.draggableId
    const newStage = result.destination.droppableId as DealStage

    // Optimistic update
    setDeals(prev =>
      prev.map(d => d.id === dealId ? { ...d, stage: newStage } : d)
    )

    await supabase
      .from('deals')
      .update({ stage: newStage })
      .eq('id', dealId)
  }

  if (loading) return (
    <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading pipeline...</div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '20px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', color: 'var(--text-primary)' }}>
            Deal Pipeline
          </h1>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
            {deals.length} active deal{deals.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowNewDeal(true)}
        >
          <Plus size={14} />
          New Deal
        </button>
      </div>

      {/* Kanban board */}
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
              <div
                key={name}
                style={{
                  minWidth: '240px',
                  width: '240px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {/* Column header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 4px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge ${stageClass(name)}`}>{label}</span>
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      background: 'var(--surface-2)',
                      borderRadius: '999px',
                      padding: '1px 7px',
                    }}>
                      {stageDeals.length}
                    </span>
                  </div>
                  {totalEbitda > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {formatCurrency(totalEbitda)} EBITDA
                    </span>
                  )}
                </div>

                {/* Droppable */}
                <Droppable droppableId={name}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      style={{
                        minHeight: '80px',
                        background: snapshot.isDraggingOver
                          ? 'rgba(201,169,110,0.04)'
                          : 'transparent',
                        borderRadius: '8px',
                        transition: 'background 0.15s',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        padding: '2px',
                      }}
                    >
                      {stageDeals.map((deal, index) => (
                        <Draggable key={deal.id} draggableId={deal.id} index={index}>
                          {(provided, snapshot) => (
                            <DealCard
                              deal={deal}
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

function DealCard({ deal, draggableProps, dragHandleProps, innerRef, isDragging }: {
  deal: Deal
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
        background: isDragging ? 'var(--surface-3)' : 'var(--surface)',
        border: `1px solid ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '8px',
        padding: '12px',
        cursor: 'grab',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.4)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      <Link
        href={`/deals/${deal.id}`}
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {deal.company_name}
          </div>
          <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
        </div>

        {deal.sector && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {deal.sector}
            {deal.geography ? ` · ${deal.geography}` : ''}
          </div>
        )}

        {(deal.ebitda || deal.revenue) && (
          <div style={{
            display: 'flex',
            gap: '10px',
            marginTop: '10px',
            paddingTop: '10px',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            {deal.ebitda && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>EBITDA</div>
                <div style={{ fontSize: '12px', color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>
                  {formatCurrency(deal.ebitda)}
                </div>
              </div>
            )}
            {deal.revenue && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rev</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>
                  {formatCurrency(deal.revenue)}
                </div>
              </div>
            )}
            {deal.ev_ebitda_multiple && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>EV/E</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>
                  {formatMultiple(deal.ev_ebitda_multiple)}
                </div>
              </div>
            )}
          </div>
        )}

        {deal.cim_parsed && (
          <div style={{
            marginTop: '8px',
            fontSize: '10px',
            color: 'var(--green)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            <span>●</span> CIM parsed
          </div>
        )}
      </Link>
    </div>
  )
}
