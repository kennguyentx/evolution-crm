'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import type { DealStage } from '@/types'
import { formatCurrency } from '@/types'

const ACTIVE_STAGES: DealStage[] = ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity']
const STAGE_ORDER = ['Exclusivity', 'LOI Submitted', 'Pre-LOI', 'Reviewing', 'Teaser'] as DealStage[]

type DealRow = { id: string; company_name: string; stage: DealStage; ebitda: number | null; revenue: number | null; sector: string | null }
type RaiseRow = { id: string; name: string; target_equity: number | null; target_debt: number | null; deal: { company_name: string } | { company_name: string }[] | null }
type JoinOne<T> = T | T[] | null
type InteractionRow = { id: string; interaction_date: string; interaction_type: string | null; summary: string | null; next_steps: string | null; contact: JoinOne<{ first_name: string; last_name: string }>; deal: JoinOne<{ company_name: string }> }

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const daysSince = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default function DashboardPage() {
  const supabase = createClient()
  const [deals, setDeals] = useState<DealRow[]>([])
  const [raises, setRaises] = useState<RaiseRow[]>([])
  const [committed, setCommitted] = useState<Record<string, number>>({})
  const [interactions, setInteractions] = useState<InteractionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [{ data: dealData }, { data: raiseData }, { data: partData }, { data: intData }] = await Promise.all([
        supabase.from('deals').select('id, company_name, stage, ebitda, revenue, sector').eq('status', 'Active').in('stage', ACTIVE_STAGES),
        supabase.from('capital_raises').select('id, name, target_equity, target_debt, deal:deals(company_name)').eq('status', 'Open'),
        supabase.from('raise_participants').select('raise_id, committed_amount, debt_amount, status').in('status', ['invested', 'confirmed']),
        supabase.from('interactions').select('id, interaction_date, interaction_type, summary, next_steps, contact:contacts(first_name, last_name), deal:deals(company_name)').order('interaction_date', { ascending: false }).limit(20),
      ])
      setDeals(dealData ?? [])
      setRaises(raiseData ?? [])
      const c: Record<string, number> = {}
      for (const p of (partData ?? [])) {
        c[p.raise_id] = (c[p.raise_id] ?? 0) + (p.committed_amount ?? p.debt_amount ?? 0)
      }
      setCommitted(c)
      setInteractions(intData ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const stageSummary = STAGE_ORDER.map(s => ({
    stage: s,
    deals: deals.filter(d => d.stage === s),
    ebitda: deals.filter(d => d.stage === s).reduce((sum, d) => sum + (d.ebitda ?? 0), 0),
  }))

  const totalEbitda = deals.reduce((s, d) => s + (d.ebitda ?? 0), 0)
  const maxStageEbitda = Math.max(...stageSummary.map(s => s.ebitda), 1)

  const overdueFollowUps = interactions.filter(i => i.next_steps && daysSince(i.interaction_date) >= 3)
  const recentActivity = interactions.filter(i => daysSince(i.interaction_date) <= 14).slice(0, 8)

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {[
            { label: 'Active deals', value: deals.length, sub: `${ACTIVE_STAGES.length} stages tracked`, href: '/pipeline' },
            { label: 'Pipeline EBITDA', value: formatCurrency(totalEbitda), sub: 'across active stages', href: '/deals' },
            { label: 'Open raises', value: raises.length, sub: `${raises.length === 1 ? '1 raise' : `${raises.length} raises`} in market`, href: '/raises' },
            { label: 'Pending follow-ups', value: overdueFollowUps.length, sub: '3+ days without action', href: '/notes', urgent: overdueFollowUps.length > 0 },
          ].map(m => (
            <Link key={m.label} href={m.href} style={{ textDecoration: 'none' }}>
              <div style={{ padding: '16px 18px', background: 'var(--surface)', border: `1px solid ${(m as any).urgent && m.value ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '10px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{m.label}</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: (m as any).urgent && m.value ? 'var(--accent)' : 'var(--text-primary)' }}>{m.value}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{m.sub}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Middle row: Deal funnel + Open raises */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

          {/* Deal funnel */}
          <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Deal Funnel</div>
              <Link href="/pipeline" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View pipeline →</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {stageSummary.map(({ stage, deals: stageDeals, ebitda }) => (
                <div key={stage}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{stage}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {stageDeals.length} deal{stageDeals.length !== 1 ? 's' : ''}
                      {ebitda > 0 && <span style={{ marginLeft: '8px' }}>{formatCurrency(ebitda)} EBITDA</span>}
                    </span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${maxStageEbitda > 0 ? (ebitda / maxStageEbitda) * 100 : stageDeals.length > 0 ? 20 : 0}%`, background: 'var(--accent)', borderRadius: '3px', minWidth: stageDeals.length > 0 ? '4px' : '0', transition: 'width 0.3s' }} />
                  </div>
                </div>
              ))}
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

        {/* Bottom row: Recent activity + Overdue follow-ups */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

          {/* Recent activity */}
          <div style={{ padding: '18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Recent Activity</div>
              <Link href="/notes" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>All notes →</Link>
            </div>
            {recentActivity.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No recent activity.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {recentActivity.map(i => (
                  <div key={i.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', marginTop: '4px', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                          {unwrap(i.contact) ? `${unwrap(i.contact)!.first_name} ${unwrap(i.contact)!.last_name}` : 'Note'}
                        </span>
                        {unwrap(i.deal) && <span style={{ fontSize: '10px', padding: '1px 6px', background: 'var(--accent-muted)', color: 'var(--accent)', borderRadius: '4px', whiteSpace: 'nowrap' }}>{unwrap(i.deal)!.company_name}</span>}
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>{fmtDate(i.interaction_date)}</span>
                      </div>
                      {i.summary && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Overdue follow-ups */}
          <div style={{ padding: '18px', background: 'var(--surface)', border: `1px solid ${overdueFollowUps.length > 0 ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>
                Pending Follow-ups
                {overdueFollowUps.length > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-muted)', padding: '1px 7px', borderRadius: '10px' }}>{overdueFollowUps.length}</span>}
              </div>
            </div>
            {overdueFollowUps.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--green)', fontStyle: 'italic' }}>All clear — no overdue follow-ups.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {overdueFollowUps.slice(0, 6).map(i => (
                  <div key={i.id} style={{ padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '7px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                      {unwrap(i.contact) && <span style={{ fontSize: '12px', fontWeight: 500 }}>{unwrap(i.contact)!.first_name} {unwrap(i.contact)!.last_name}</span>}
                      {unwrap(i.deal) && <span style={{ fontSize: '10px', padding: '1px 6px', background: 'var(--accent-muted)', color: 'var(--accent)', borderRadius: '4px' }}>{unwrap(i.deal)!.company_name}</span>}
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{daysSince(i.interaction_date)}d ago</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--accent)', fontStyle: 'italic' }}>→ {i.next_steps}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
