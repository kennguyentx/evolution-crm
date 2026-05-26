'use client'
import { useState, useEffect } from 'react'
import { X, RefreshCw, CheckCircle2, AlertCircle, Users, ArrowUpRight, ArrowDownLeft, Zap, Link2 } from 'lucide-react'

interface CCContact {
  cc_id?: string
  first_name: string
  last_name: string
  email: string
  firm: string
  title?: string
}

interface NexusContact {
  id: string
  first_name: string
  last_name: string
  email: string
  firm: string
  contact_type: string
}

interface CompareResult {
  nexus_total: number
  cc_total: number
  matched_count: number
  nexus_only_count: number
  cc_only_count: number
  nexus_only: NexusContact[]
  cc_only: CCContact[]
  matched: NexusContact[]
}

type Tab = 'overview' | 'nexus_only' | 'cc_only' | 'matched'

interface Props {
  onClose: () => void
}

export default function CCSyncPanel({ onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)
  const [data, setData] = useState<CompareResult | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<{ synced: number; failed: number; errors?: string[] } | null>(null)
  const [pushingSingle, setPushingSingle] = useState<string | null>(null)
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set())

  const load = async () => {
    setLoading(true)
    setError(null)
    setNotConnected(false)
    setPushResult(null)
    try {
      const res = await fetch('/api/constant-contact/compare')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (body.not_connected || res.status === 503) {
          setNotConnected(true)
        } else {
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        return
      }
      setData(body)
      if (body.nexus_only_count > 0) setTab('nexus_only')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const pushAll = async () => {
    setPushing(true)
    setPushResult(null)
    try {
      const res = await fetch('/api/constant-contact/push-missing', { method: 'POST' })
      const json = await res.json()
      setPushResult(json)
      if (json.synced > 0) {
        // Refresh comparison data
        await load()
      }
    } catch {
      setPushResult({ synced: 0, failed: 1, errors: ['Request failed'] })
    } finally {
      setPushing(false)
    }
  }

  const pushOne = async (contact: NexusContact) => {
    setPushingSingle(contact.id)
    try {
      const res = await fetch('/api/constant-contact/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contact),
      })
      if (res.ok) {
        setSyncedIds(prev => new Set([...prev, contact.id]))
      }
    } finally {
      setPushingSingle(null)
    }
  }

  const typeColor: Record<string, string> = {
    banker: '#6366f1',
    lp: '#10b981',
    lender: '#f59e0b',
    advisor: '#8b5cf6',
    management: '#ec4899',
    other: '#94a3b8',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '48px', backdropFilter: 'blur(4px)',
    }}>
      <div className="card slide-in" style={{
        width: '680px',
        maxHeight: 'calc(100vh - 96px)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={15} color="#d97706" />
          </div>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Constant Contact Sync</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Compare and sync contacts between Nexus and CC</p>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
              <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
              <div style={{ fontSize: '13px' }}>Comparing contacts…</div>
            </div>
          )}

          {/* Not connected — prompt OAuth */}
          {notConnected && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 24px' }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Link2 size={24} color="#d97706" />
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 8px' }}>Connect Constant Contact</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 24px', lineHeight: 1.6 }}>
                Authorize Nexus to sync contacts with your Constant Contact account.<br />
                You'll be redirected to CC and brought right back.
              </p>
              <a
                href="/api/constant-contact/oauth"
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
              >
                <Zap size={14} /> Connect Constant Contact
              </a>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 16 }}>
                Requires <code>CONSTANT_CONTACT_CLIENT_ID</code> and <code>CONSTANT_CONTACT_CLIENT_SECRET</code> in Vercel env vars.
              </p>
            </div>
          )}

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>Failed to compare</div>
                <div style={{ fontSize: '12px', color: '#991b1b' }}>{error}</div>
              </div>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
                {[
                  { label: 'In Nexus', value: data.nexus_total, color: '#0f172a', icon: <Users size={14} /> },
                  { label: 'In CC', value: data.cc_total, color: '#0f172a', icon: <Users size={14} /> },
                  { label: 'Matched', value: data.matched_count, color: '#10b981', icon: <CheckCircle2 size={14} /> },
                  { label: 'Need Sync', value: data.nexus_only_count, color: data.nexus_only_count > 0 ? '#d97706' : '#10b981', icon: <ArrowUpRight size={14} /> },
                ].map(stat => (
                  <div key={stat.label} style={{ background: 'var(--surface-raised)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: stat.color, marginBottom: 4 }}>
                      {stat.icon}
                      <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</span>
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: stat.color }}>{stat.value.toLocaleString()}</div>
                  </div>
                ))}
              </div>

              {/* Push result banner */}
              {pushResult && (
                <div style={{
                  background: pushResult.failed > 0 ? '#fef3c7' : '#f0fdf4',
                  border: `1px solid ${pushResult.failed > 0 ? '#fde68a' : '#bbf7d0'}`,
                  borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px',
                }}>
                  <CheckCircle2 size={15} color={pushResult.failed > 0 ? '#d97706' : '#16a34a'} />
                  <span>
                    <strong>{pushResult.synced}</strong> synced to CC
                    {pushResult.failed > 0 && <span style={{ color: '#b45309' }}>, {pushResult.failed} failed</span>}
                    {pushResult.message && ` — ${pushResult.message}`}
                  </span>
                </div>
              )}

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
                {([
                  { key: 'nexus_only', label: `Not in CC`, count: data.nexus_only_count, accent: '#d97706' },
                  { key: 'cc_only', label: `CC only`, count: data.cc_only_count, accent: '#6366f1' },
                  { key: 'matched', label: `Matched`, count: data.matched_count, accent: '#10b981' },
                ] as { key: Tab; label: string; count: number; accent: string }[]).map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)} style={{
                    padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: `2px solid ${tab === t.key ? t.accent : 'transparent'}`,
                    color: tab === t.key ? t.accent : 'var(--text-muted)',
                    marginBottom: '-1px',
                  }}>
                    {t.label} <span style={{ fontFamily: 'var(--font-mono)', marginLeft: 4 }}>{t.count.toLocaleString()}</span>
                  </button>
                ))}
              </div>

              {/* Tab: Not in CC */}
              {tab === 'nexus_only' && (
                <>
                  {data.nexus_only_count === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                      <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#16a34a' }}>All Nexus contacts are in CC!</div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                          {data.nexus_only_count} contact{data.nexus_only_count !== 1 ? 's' : ''} in Nexus that are not in Constant Contact
                        </p>
                        <button
                          className="btn btn-primary"
                          onClick={pushAll}
                          disabled={pushing}
                          style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          {pushing ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowUpRight size={12} />}
                          {pushing ? 'Syncing…' : `Sync All ${data.nexus_only_count}`}
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {data.nexus_only.map(c => {
                          const isSynced = syncedIds.has(c.id)
                          return (
                            <div key={c.id} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '8px 10px', borderRadius: 6,
                              background: isSynced ? '#f0fdf4' : 'var(--surface-raised)',
                              opacity: isSynced ? 0.7 : 1,
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                  {c.first_name} {c.last_name}
                                  {isSynced && <CheckCircle2 size={12} color="#16a34a" style={{ marginLeft: 6, display: 'inline' }} />}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                  {[c.firm, c.email].filter(Boolean).join(' · ')}
                                </div>
                              </div>
                              <span style={{
                                fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                                padding: '2px 6px', borderRadius: 4,
                                background: typeColor[c.contact_type] + '20',
                                color: typeColor[c.contact_type] || '#94a3b8',
                              }}>{c.contact_type}</span>
                              {!isSynced && (
                                <button
                                  onClick={() => pushOne(c)}
                                  disabled={pushingSingle === c.id}
                                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', fontSize: '11px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}
                                >
                                  {pushingSingle === c.id
                                    ? <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} />
                                    : <ArrowUpRight size={10} />}
                                  Sync
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Tab: CC only */}
              {tab === 'cc_only' && (
                <>
                  {data.cc_only_count === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                      <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>No CC-only contacts</div>
                    </div>
                  ) : (
                    <>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 12 }}>
                        {data.cc_only_count} contact{data.cc_only_count !== 1 ? 's' : ''} in Constant Contact that are not in Nexus
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {data.cc_only.map((c, i) => (
                          <div key={c.cc_id || i} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 10px', borderRadius: 6, background: 'var(--surface-raised)',
                          }}>
                            <ArrowDownLeft size={14} color="#6366f1" style={{ flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                {c.first_name} {c.last_name}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {[c.firm, c.email].filter(Boolean).join(' · ')}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Tab: Matched */}
              {tab === 'matched' && (
                <>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 12 }}>
                    {data.matched_count} contact{data.matched_count !== 1 ? 's' : ''} exist in both systems (matched by email)
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {data.matched.map(c => (
                      <div key={c.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 6, background: 'var(--surface-raised)',
                      }}>
                        <CheckCircle2 size={14} color="#10b981" style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600 }}>{c.first_name} {c.last_name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {[c.firm, c.email].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <span style={{
                          fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                          padding: '2px 6px', borderRadius: 4,
                          background: (typeColor[c.contact_type] || '#94a3b8') + '20',
                          color: typeColor[c.contact_type] || '#94a3b8',
                        }}>{c.contact_type}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button onClick={load} disabled={loading} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw size={12} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
