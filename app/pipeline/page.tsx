'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import type { Deal, DealStage } from '@/types'
import { formatCurrency, stageClass } from '@/types'
import { Plus, ChevronRight, Mail, X, Send, Check, Search, ArrowRightLeft } from 'lucide-react'
import Link from 'next/link'
import NewDealModal from '@/components/deals/NewDealModal'
import { moveDropboxOnStageChange } from '@/lib/dropbox-stage-move'
import { useIsMobile } from '@/hooks/useIsMobile'
import { initialParam, useUrlFilterSync } from '@/hooks/useUrlState'
import { usePageTitle } from '@/hooks/usePageTitle'
import { createLogger } from '@/lib/log'

const log = createLogger('pipeline')

const STAGES: { name: DealStage; label: string }[] = [
  { name: 'Teaser',        label: 'Teaser' },
  { name: 'Reviewing',     label: 'Reviewing' },
  { name: 'Pre-LOI',       label: 'Pre-LOI' },
  { name: 'LOI Submitted', label: 'LOI Submitted' },
  { name: 'Exclusivity',   label: 'Exclusivity' },
  { name: 'Hold',          label: 'Hold' },
]

export default function PipelinePage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [dealContacts, setDealContacts] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [showNewDeal, setShowNewDeal] = useState(false)
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null)
  const dragId = useRef<string | null>(null)
  // Item 23: board search lives in the URL (?q=) like the other list pages.
  const [search, setSearch] = useState(() => initialParam('q') ?? '')
  // Item 24: which card's touch stage menu is open (deal id), if any.
  const [stageMenuFor, setStageMenuFor] = useState<string | null>(null)
  usePageTitle('Pipeline')
  useUrlFilterSync({ q: search || null })

  // Email settings state
  const [showEmailPanel, setShowEmailPanel] = useState(false)
  const [recipients, setRecipients] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [savingRecipients, setSavingRecipients] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<'success' | 'error' | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const supabase = createClient()
  const isMobile = useIsMobile()

  const fetchDeals = useCallback(async () => {
    const { data } = await supabase
  .from('deals')
  .select('*')
  .in('stage', ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity', 'Hold'])
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

  // Load recipients from app_settings on mount
  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'pipeline_email_recipients')
      .single()
      .then(({ data }) => {
        if (data?.value) setRecipients(data.value as string[])
      })
  }, [])

  // Close email panel on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEmailPanel(false)
        setShowNewDeal(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const saveRecipients = async (list: string[]) => {
    setSavingRecipients(true)
    await fetch('/api/pipeline/weekly-email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: list }),
    })
    setSavingRecipients(false)
  }

  const addEmail = () => {
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed || recipients.includes(trimmed)) { setNewEmail(''); return }
    const updated = [...recipients, trimmed]
    setRecipients(updated)
    setNewEmail('')
    saveRecipients(updated)
  }

  const removeEmail = (email: string) => {
    const updated = recipients.filter(r => r !== email)
    setRecipients(updated)
    saveRecipients(updated)
  }

  const sendNow = async () => {
    setSending(true)
    setSendResult(null)
    setSendError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/pipeline/weekly-email', {
      method: 'POST',
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    })
    const body = await res.json().catch(() => ({}))
    log.info('weekly email send response', { status: res.status })
    if (res.ok) {
      setSendResult('success')
      const recipsList = Array.isArray(body.recipients) ? body.recipients.join(', ') : `${body.recipients ?? '?'} recipient(s)`
      setSendError(`Sent to ${recipsList} · ${body.deals ?? '?'} deals · Postmark id ${body.postmark_message_id ?? '—'}`)
      setTimeout(() => { setSendResult(null); setSendError(null) }, 15000)
    } else {
      setSendError(body.error ? `${body.error}${body.postmark_code ? ` (Postmark code ${body.postmark_code})` : ''}` : `HTTP ${res.status}`)
      setSendResult('error')
      setTimeout(() => { setSendResult(null); setSendError(null) }, 15000)
    }
    setSending(false)
  }

  const dealsByStage = (stage: DealStage) => deals.filter(d => {
    if (d.stage !== stage) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return d.company_name.toLowerCase().includes(q)
      || (d.sector || '').toLowerCase().includes(q)
      || (d.geography || '').toLowerCase().includes(q)
  })

  const updateStage = async (dealId: string, stage: DealStage) => {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage } : d))
    await supabase.from('deals').update({ stage }).eq('id', dealId)
    const deal = deals.find(d => d.id === dealId)
    // The move is recorded in dropbox_move_jobs by the helper; a failure
    // surfaces as a warning banner (with Retry) on the deal page.
    if (deal) moveDropboxOnStageChange(supabase, dealId, (deal as any).dropbox_path, stage).catch((e: any) => log.error('Dropbox stage move failed', { dealId, error: e?.message ?? String(e) }))
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: isMobile ? '14px 16px' : '20px 28px',
        borderBottom: showEmailPanel ? 'none' : '1px solid var(--border)',
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
        <div style={{ position: 'relative', marginLeft: 'auto', flex: isMobile ? '1 1 120px' : '0 0 220px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search board…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '30px' }} aria-label="Search pipeline deals" />
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '12px', gap: '5px' }}
          onClick={() => setShowEmailPanel(p => !p)}
        >
          <Mail size={13} /> {isMobile ? '' : 'Weekly Email'}
        </button>
      </div>

      {/* Email settings panel */}
      {showEmailPanel && (
        <div style={{ padding: isMobile ? '16px' : '20px 28px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', flexShrink: 0 }}>
          <div style={{ maxWidth: '560px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div className="label" style={{ margin: 0 }}>Weekly Pipeline Email</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>Sends every Monday 8am ET</div>
            </div>

            {/* Recipient chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {recipients.map(r => (
                <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid rgba(79,40,75,0.2)', borderRadius: '999px', padding: '3px 10px 3px 12px' }}>
                  {r}
                  <button onClick={() => removeEmail(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--accent)', opacity: 0.6 }}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              {recipients.length === 0 && (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No recipients yet</span>
              )}
            </div>

            {/* Add email input */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <input
                className="input"
                type="email"
                placeholder="Add email address..."
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEmail()}
                style={{ maxWidth: '280px' }}
              />
              <button className="btn btn-ghost" onClick={addEmail} style={{ fontSize: '12px' }}>
                Add
              </button>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={sendNow}
                disabled={sending || recipients.length === 0}
                style={{ fontSize: '12px' }}
              >
                <Send size={12} /> {sending ? 'Sending...' : 'Send Now'}
              </button>
              {sendResult === 'success' && (
                <span style={{ fontSize: '12px', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Check size={13} /> {sendError || `Sent to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}`}
                </span>
              )}
              {sendResult === 'error' && (
                <span style={{ fontSize: '12px', color: 'var(--red)' }}>
                  {sendError || 'Send failed'}
                </span>
              )}
              {savingRecipients && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Saving...</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile scroll hint */}
      <div style={{ display: isMobile ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', padding: '6px 16px', background: 'var(--accent-muted)', borderBottom: '1px solid var(--border)', fontSize: '11px', color: 'var(--accent)', flexShrink: 0 }}>
        ← Scroll to see all stages · use “Move to” on a card to change its stage →
      </div>

      {/* Kanban board — horizontal columns */}
      <div style={{ flex: 1, overflow: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', padding: isMobile ? '12px 12px' : '16px 20px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
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
                width: isMobile ? '200px' : '250px',
                minWidth: isMobile ? '200px' : '250px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: dragOverStage === name ? 'var(--accent-muted)' : 'var(--surface)',
                border: `1px solid ${dragOverStage === name ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '10px',
                padding: '12px',
                transition: 'border-color 0.15s, background 0.15s',
                alignSelf: 'flex-start',
              }}>
              {/* Column header */}
              <div style={{ paddingBottom: '10px', borderBottom: '1px solid var(--border)' }}>
                <span className={`badge ${stageClass(name)}`} style={{ display: 'inline-block' }}>{label}</span>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '5px', display: 'flex', gap: '6px' }}>
                  <span>{stageDeals.length} deal{stageDeals.length !== 1 ? 's' : ''}</span>
                  {stageDeals.length > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)' }}>· {formatCurrency(stageDeals.reduce((s, d) => s + (d.ebitda || 0), 0))}</span>
                  )}
                </div>
              </div>

              {/* Cards */}
              {stageDeals.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '12px 0', textAlign: 'center' }}>
                  {dragOverStage === name ? 'Drop here' : 'No deals'}
                </div>
              ) : stageDeals.map(deal => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  contacts={dealContacts[deal.id] || []}
                  onStageChange={(id, stage) => { setStageMenuFor(null); updateStage(id, stage) }}
                  menuOpen={stageMenuFor === deal.id}
                  onToggleMenu={() => setStageMenuFor(cur => cur === deal.id ? null : deal.id)}
                  onDragStart={(e) => { dragId.current = deal.id; e.dataTransfer.setData('text/plain', deal.id); e.dataTransfer.effectAllowed = 'move' }}
                />
              ))}
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

function DealCard({ deal, contacts, onStageChange, onDragStart, menuOpen, onToggleMenu }: {
  deal: Deal
  contacts: any[]
  onStageChange: (id: string, stage: DealStage) => void
  onDragStart: (e: React.DragEvent) => void
  menuOpen: boolean
  onToggleMenu: () => void
}) {
  // Escape closes the stage menu (item 24 touch fallback).
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onToggleMenu() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [menuOpen, onToggleMenu])

  return (
    // Click-vs-drag stays explicit (item 24): the card wrapper is the
    // draggable element (desktop HTML5 drag); the inner <Link> and the
    // stage-menu controls are draggable={false} so a click/tap on them
    // navigates or opens the menu instead of starting a drag. Touch
    // devices never fire HTML5 drag events, so the "Move to" menu below
    // is the stage-change path there.
    <div
      draggable
      onDragStart={onDragStart}
      style={{
      width: '100%',
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '12px',
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

      {/* Touch fallback for stage moves (item 24): native HTML5
          drag-and-drop never fires on touch devices, so every card gets
          a stage menu. It sits outside the <Link> so tapping it never
          navigates, and it is draggable={false} so a desktop drag that
          starts on it still belongs to the card wrapper. */}
      <div draggable={false} style={{ position: 'relative', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
        <button
          type="button"
          draggable={false}
          className="btn btn-ghost btn-sm"
          style={{ width: '100%', justifyContent: 'center' }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu() }}
        >
          <ArrowRightLeft size={12} /> Move to stage
        </button>
        {menuOpen && (
          <div role="menu" className="menu-sheet" style={{ left: 0, right: 0, top: 'calc(100% + 4px)' }}>
            {STAGES.map(({ name, label }) => (
              <button
                key={name}
                type="button"
                role="menuitem"
                draggable={false}
                className={`menu-sheet-item${name === deal.stage ? ' menu-sheet-item-current' : ''}`}
                disabled={name === deal.stage}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStageChange(deal.id, name) }}
              >
                {label}{name === deal.stage ? ' · current' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
