'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import type { DealStage } from '@/types'
import { formatCurrency } from '@/types'
import { useIsMobile } from '@/hooks/useIsMobile'

const ACTIVE_STAGES: DealStage[] = ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity']
const FUNNEL_STAGES = ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity'] as DealStage[]
const STALE_DAYS = 30

const TYPE_COLORS: Record<string, string> = {
  meeting: '#7c3aed',
  call: '#2563eb',
  deadline: '#dc2626',
  reminder: '#d97706',
  'site visit': '#059669',
  other: '#6b7280',
}

type DealRow = { id: string; company_name: string; stage: DealStage; ebitda: number | null; revenue: number | null; sector: string | null }
type RaiseRow = { id: string; name: string; target_equity: number | null; target_debt: number | null; deal: { company_name: string } | { company_name: string }[] | null }
type CalEvent = { id: string; title: string; event_date: string; start_time: string | null; event_type: string; deal?: any; contact?: any }
type NoteRow = { id: string; note_date: string; summary: string | null; next_steps: string | null; source: string | null; logged_by: string | null; deal: { id: string; company_name: string } | null; created_at: string }

type JoinOne<T> = T | T[] | null
function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const daysSince = (d: string) => Math.floor((Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400000)

export default function DashboardPage() {
  const isMobile = useIsMobile()
  const supabase = createClient()
  const [deals, setDeals] = useState<DealRow[]>([])
  const [raises, setRaises] = useState<RaiseRow[]>([])
  const [committed, setCommitted] = useState<Record<string, number>>({})
  const [upcomingEvents, setUpcomingEvents] = useState<CalEvent[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [recentNotes, setRecentNotes] = useState<NoteRow[]>([])
  const [nextSteps, setNextSteps] = useState<NoteRow[]>([])
  const [lastActivityByDeal, setLastActivityByDeal] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const today         = new Date().toISOString().split('T')[0]
      const twoWeeksOut   = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]

      const [
        { data: dealData },
        { data: raiseData },
        { data: partData },
        { data: evtData },
        { count: pendingCnt },
        { data: notesData },
        { data: nextStepsData },
        { data: activityData },
      ] = await Promise.all([
        supabase.from('deals').select('id, company_name, stage, ebitda, revenue, sector').in('stage', ACTIVE_STAGES),
        supabase.from('capital_raises').select('id, name, target_equity, target_debt, deal:deals(company_name)').eq('status', 'Open'),
        supabase.from('raise_participants').select('raise_id, committed_amount, debt_amount, status').in('status', ['invested', 'confirmed']),
        supabase.from('calendar_events')
          .select('id, title, event_date, start_time, event_type, deal:deals(company_name), contact:contacts(first_name, last_name)')
          .gte('event_date', today).lte('event_date', twoWeeksOut)
          .order('event_date', { ascending: true }).order('start_time', { ascending: true, nullsFirst: false })
          .limit(10),
        supabase.from('intake_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        // Recent activity feed — latest notes across all deals
        supabase.from('notes')
          .select('id, note_date, summary, next_steps, source, logged_by, created_at, deal:deals(id, company_name)')
          .not('deal_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(8),
        // Open next steps — notes with next_steps, most recent first
        supabase.from('notes')
          .select('id, note_date, summary, next_steps, source, logged_by, created_at, deal:deals(id, company_name)')
          .not('next_steps', 'is', null)
          .neq('next_steps', '')
          .not('deal_id', 'is', null)
          .order('note_date', { ascending: false })
          .limit(10),
        // Most recent note per deal — for stale detection
        supabase.from('notes')
          .select('deal_id, note_date')
          .not('deal_id', 'is', null)
          .order('note_date', { ascending: false }),
      ])

      setDeals(dealData ?? [])
      setRaises(raiseData ?? [])
      setPendingCount(pendingCnt ?? 0)
      setRecentNotes((notesData ?? []) as any)
      setNextSteps((nextStepsData ?? []) as any)

      // Build most-recent-activity map per deal
      const actMap: Record<string, string> = {}
      for (const row of (activityData ?? [])) {
        if (row.deal_id && !actMap[row.deal_id]) {
          actMap[row.deal_id] = row.note_date
        }
      }
      setLastActivityByDeal(actMap)

      const c: Record<string, number> = {}
      for (const p of (partData ?? [])) {
        c[p.raise_id] = (c[p.raise_id] ?? 0) + (p.committed_amount ?? p.debt_amount ?? 0)
      }
      setCommitted(c)
      setUpcomingEvents(evtData ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const stageSummary = FUNNEL_STAGES.map(s => ({
    stage: s,
    deals: deals.filter(d => d.stage === s),
    count: deals.filter(d => d.stage === s).length,
    ebitda: deals.filter(d => d.stage === s).reduce((sum, d) => sum + (d.ebitda ?? 0), 0),
  }))

  const totalEbitda = deals.reduce((s, d) => s + (d.ebitda ?? 0), 0)
  const maxCount    = Math.max(...stageSummary.map(s => s.count), 5)

  // Stale deals: active deals with no note in the last STALE_DAYS days
  const staleDeals = deals.filter(d => {
    const last = lastActivityByDeal[d.id]
    if (!last) return true // no notes at all → stale
    return daysSince(last) >= STALE_DAYS
  })

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</div>

  return (
    <div style={{ height: '100vh', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '16px 16px 0' : '24px 28px 0', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Dashboard</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <div style={{ padding: isMobile ? '16px' : '24px 28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* Summary metrics — 4 cards */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px' }}>
          {[
            { label: 'Active deals',    value: deals.length,              sub: `${ACTIVE_STAGES.length} stages tracked`,                  href: '/pipeline' },
            { label: 'Pipeline EBITDA', value: formatCurrency(totalEbitda), sub: 'across active stages',                                  href: '/deals' },
            { label: 'Open raises',     value: raises.length,             sub: `${raises.length === 1 ? '1 raise' : `${raises.length} raises`} in market`, href: '/raises' },
            { label: 'Pending review',  value: pendingCount,              sub: pendingCount === 0 ? 'inbox clear' : `${pendingCount} item${pendingCount !== 1 ? 's' : ''} need attention`, href: '/intake', highlight: pendingCount > 0 },
          ].map((m: any) => (
            <Link key={m.label} href={m.href} style={{ textDecoration: 'none' }}>
              <div style={{
                padding: '16px 18px',
                background: 'var(--surface)',
                border: `1px solid ${m.highlight ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'box-shadow 0.15s',
              }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
              >
                <div style={{ fontSize: '10px', color: m.highlight ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{m.label}</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: m.highlight ? 'var(--accent)' : 'var(--text-primary)' }}>{m.value}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{m.sub}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Middle row: Deal funnel + Open raises */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>

          {/* Deal funnel */}
          <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Deal Funnel</div>
              <Link href="/pipeline" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View pipeline →</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {stageSummary.map(({ stage, count, ebitda }, idx) => {
                const widthPct = maxCount > 0 ? (count / maxCount) * 100 : 0
                const marginPct = (100 - widthPct) / 2
                return (
                  <div key={stage}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{stage}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {count} deal{count !== 1 ? 's' : ''}
                        {ebitda > 0 && <span style={{ marginLeft: '6px' }}>{formatCurrency(ebitda)}</span>}
                      </span>
                    </div>
                    <div style={{ height: '20px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        position: 'absolute', left: `${marginPct}%`, width: `${widthPct}%`, height: '100%',
                        background: `hsl(${280 - idx * 30}, 60%, ${count > 0 ? 45 : 70}%)`,
                        borderRadius: '3px', transition: 'width 0.3s, left 0.3s',
                        minWidth: count > 0 ? '4px' : '0',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {count > 0 && widthPct > 15 && (
                          <span style={{ fontSize: '10px', color: 'white', fontWeight: 600 }}>{count}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {deals.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No active deals.</div>}
            </div>
          </div>

          {/* Open raises */}
          <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Open Raises</div>
              <Link href="/raises" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View raises →</Link>
            </div>
            {raises.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No open raises.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {raises.map(r => {
                  const isDebt = /debt/i.test(r.name)
                  const target = isDebt ? r.target_debt : r.target_equity
                  const comm   = committed[r.id] ?? 0
                  const pct    = target ? Math.min((comm / target) * 100, 100) : 0
                  const fmt    = (n: number | null) => n ? `$${(n / 1e6).toFixed(1)}M` : '—'
                  return (
                    <div key={r.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>{r.name}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmt(comm)} / {fmt(target)}</span>
                      </div>
                      <div style={{ height: '7px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: pct >= 80 ? 'var(--green)' : 'var(--accent)', borderRadius: '4px', transition: 'width 0.3s' }} />
                      </div>
                      {r.deal && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>{Array.isArray(r.deal) ? r.deal[0]?.company_name : r.deal.company_name}</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity + Open Next Steps */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>

          {/* Recent activity feed */}
          <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Recent Activity</div>
              <Link href="/notes" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View all →</Link>
            </div>
            {recentNotes.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No recent activity.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                {recentNotes.map((note: any) => {
                  const deal = unwrap(note.deal) as any
                  return (
                    <Link key={note.id} href={deal ? `/deals/${deal.id}` : '/notes'} style={{ textDecoration: 'none' }}>
                      <div style={{ padding: '9px 10px', borderRadius: '6px', transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: note.source === 'email' ? '#6366f1' : 'var(--text-muted)' }}>
                            {note.source === 'email' ? 'Email' : 'Note'}
                          </span>
                          {deal && (
                            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)' }}>{deal.company_name}</span>
                          )}
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{fmtShort(note.note_date)}</span>
                        </div>
                        {note.summary && (
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                            {note.summary}
                          </div>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Open next steps */}
          <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Open Next Steps</div>
              <Link href="/notes" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View notes →</Link>
            </div>
            {nextSteps.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No open next steps.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                {nextSteps.map((note: any) => {
                  const deal = unwrap(note.deal) as any
                  return (
                    <Link key={note.id} href={deal ? `/deals/${deal.id}` : '/notes'} style={{ textDecoration: 'none' }}>
                      <div style={{ padding: '9px 10px', borderRadius: '6px', transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                          {deal && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)' }}>{deal.company_name}</span>}
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{fmtShort(note.note_date)}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                          → {note.next_steps}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Stale deals */}
        {staleDeals.length > 0 && (
          <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid #d9770630', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>Deals Gone Quiet</div>
                <span style={{ fontSize: '11px', color: '#d97706', background: '#d9770615', padding: '2px 8px', borderRadius: '20px' }}>
                  No activity in {STALE_DAYS}+ days
                </span>
              </div>
              <Link href="/deals" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View deals →</Link>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
              {staleDeals.map(d => {
                const last    = lastActivityByDeal[d.id]
                const days    = last ? daysSince(last) : null
                return (
                  <Link key={d.id} href={`/deals/${d.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{
                      padding: '10px 12px', borderRadius: '7px',
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      transition: 'box-shadow 0.15s',
                    }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
                    >
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.company_name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{d.stage}</span>
                        <span style={{ fontSize: '10px', color: days && days > 60 ? '#ef4444' : '#d97706', fontWeight: 600 }}>
                          {days === null ? 'No notes' : `${days}d ago`}
                        </span>
                      </div>
                      {d.sector && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{d.sector}</div>}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Upcoming events */}
        <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Upcoming Events <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)' }}>— next 14 days</span></div>
            <Link href="/calendar" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View calendar →</Link>
          </div>
          {upcomingEvents.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No upcoming events.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px' }}>
              {upcomingEvents.map(ev => {
                const color   = TYPE_COLORS[ev.event_type] ?? TYPE_COLORS.other
                const contact = unwrap(ev.contact)
                const deal    = unwrap(ev.deal)
                return (
                  <Link key={ev.id} href="/calendar" style={{ textDecoration: 'none' }}>
                    <div style={{ padding: '10px 12px', borderRadius: '7px', border: `1px solid ${color}30`, background: `${color}08`, cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span>{fmtDate(ev.event_date)}{ev.start_time ? ` · ${ev.start_time.slice(0, 5)}` : ''}</span>
                        {contact && <span style={{ color: 'var(--text-secondary)' }}>{(contact as any).first_name} {(contact as any).last_name}</span>}
                        {deal && <span style={{ padding: '1px 5px', background: 'var(--accent-muted)', color: 'var(--accent)', borderRadius: '3px' }}>{(deal as any).company_name}</span>}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
