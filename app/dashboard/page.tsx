'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import type { DealStage } from '@/types'
import { formatCurrency } from '@/types'

const ACTIVE_STAGES: DealStage[] = ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity']
// Funnel order: widest (most) at top, narrowest (least) at bottom
const FUNNEL_STAGES = ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity'] as DealStage[]

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

type JoinOne<T> = T | T[] | null
function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function DashboardPage() {
  const supabase = createClient()
  const [deals, setDeals] = useState<DealRow[]>([])
  const [raises, setRaises] = useState<RaiseRow[]>([])
  const [committed, setCommitted] = useState<Record<string, number>>({})
  const [upcomingEvents, setUpcomingEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().split('T')[0]
      const twoWeeksOut = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]

      const [{ data: dealData }, { data: raiseData }, { data: partData }, { data: evtData }] = await Promise.all([
        supabase.from('deals').select('id, company_name, stage, ebitda, revenue, sector').eq('status', 'Active').in('stage', ACTIVE_STAGES),
        supabase.from('capital_raises').select('id, name, target_equity, target_debt, deal:deals(company_name)').eq('status', 'Open'),
        supabase.from('raise_participants').select('raise_id, committed_amount, debt_amount, status').in('status', ['invested', 'confirmed']),
        supabase.from('calendar_events')
          .select('id, title, event_date, start_time, event_type, deal:deals(company_name), contact:contacts(first_name, last_name)')
          .gte('event_date', today).lte('event_date', twoWeeksOut)
          .order('event_date', { ascending: true }).order('start_time', { ascending: true, nullsFirst: false })
          .limit(10),
      ])
      setDeals(dealData ?? [])
      setRaises(raiseData ?? [])
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
  const maxCount = Math.max(...stageSummary.map(s => s.count), 1)

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</div>

  return (
    <div style={{ height: '100vh', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '24px 28px 0', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Dashboard</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* Summary metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {[
            { label: 'Active deals', value: deals.length, sub: `${ACTIVE_STAGES.length} stages tracked`, href: '/pipeline' },
            { label: 'Pipeline EBITDA', value: formatCurrency(totalEbitda), sub: 'across active stages', href: '/deals' },
            { label: 'Open raises', value: raises.length, sub: `${raises.length === 1 ? '1 raise' : `${raises.length} raises`} in market`, href: '/raises' },
          ].map(m => (
            <Link key={m.label} href={m.href} style={{ textDecoration: 'none' }}>
              <div style={{ padding: '16px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{m.label}</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>{m.value}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{m.sub}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Middle row: Deal funnel + Open raises */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

          {/* Deal funnel */}
          <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Deal Funnel</div>
              <Link href="/pipeline" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View pipeline →</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {stageSummary.map(({ stage, count, ebitda }, idx) => {
                const widthPct = maxCount > 0 ? (count / maxCount) * 100 : 0
                // Center the bar so it looks like a funnel narrowing downward
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
                        position: 'absolute',
                        left: `${marginPct}%`,
                        width: `${widthPct}%`,
                        height: '100%',
                        background: `hsl(${280 - idx * 30}, 60%, ${count > 0 ? 45 : 70}%)`,
                        borderRadius: '3px',
                        transition: 'width 0.3s, left 0.3s',
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
                  const comm = committed[r.id] ?? 0
                  const pct = target ? Math.min((comm / target) * 100, 100) : 0
                  const fmt = (n: number | null) => n ? `$${(n / 1e6).toFixed(1)}M` : '—'
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
                const color = TYPE_COLORS[ev.event_type] ?? TYPE_COLORS.other
                const contact = unwrap(ev.contact)
                const deal = unwrap(ev.deal)
                return (
                  <Link key={ev.id} href="/calendar" style={{ textDecoration: 'none' }}>
                    <div style={{
                      padding: '10px 12px', borderRadius: '7px', border: `1px solid ${color}30`,
                      background: `${color}08`, cursor: 'pointer',
                      transition: 'box-shadow 0.15s',
                    }}
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
