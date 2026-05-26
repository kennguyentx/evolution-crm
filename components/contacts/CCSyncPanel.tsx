'use client'
import { useState, useEffect } from 'react'
import { X, RefreshCw, CheckCircle2, AlertCircle, ArrowUpRight, Zap, Link2 } from 'lucide-react'

interface NexusContact {
  id: string
  first_name: string
  last_name: string
  email: string
  firm: string
  contact_type: string
  created_at?: string
  phone?: string
  title?: string
}

interface Props {
  onClose: () => void
}

// Only these types belong in Constant Contact — management/other are excluded
const CC_TYPES = ['banker', 'lender', 'lp']

const TYPE_COLORS: Record<string, string> = {
  banker: '#6366f1',
  lp: '#10b981',
  lender: '#f59e0b',
  advisor: '#8b5cf6',
  management: '#ec4899',
  other: '#94a3b8',
}

export default function CCSyncPanel({ onClose }: Props) {
  // Fast-load state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)
  const [contacts, setContacts] = useState<NexusContact[]>([])
  const [lists, setLists] = useState<{ id: string; name: string; count: number | null }[]>([])
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [savingList, setSavingList] = useState(false)

  // Background CC dedup check
  const [ccCheckStatus, setCcCheckStatus] = useState<'idle' | 'checking' | 'done'>('idle')
  const [ccAlreadyInCount, setCcAlreadyInCount] = useState(0)

  // Filter / selection
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Sync state
  const [pushing, setPushing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null)
  const [syncDone, setSyncDone] = useState<{ synced: number; failed: number } | null>(null)
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set())
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({})

  // Background: fetch CC contacts and remove those already in CC from the list
  const checkCC = async () => {
    setCcCheckStatus('checking')
    try {
      const res = await fetch('/api/constant-contact/compare')
      if (!res.ok) { setCcCheckStatus('done'); return }
      const data = await res.json()
      if (data.not_connected) { setCcCheckStatus('done'); return }

      // matched = nexus contacts already in CC (matched by email)
      const matchedIds = new Set<string>((data.matched || []).map((c: any) => c.id))
      if (matchedIds.size > 0) {
        setCcAlreadyInCount(matchedIds.size)
        setContacts(prev => prev.filter(c => !matchedIds.has(c.id)))
      }
    } catch {
      // silent — CC check is best-effort, don't block the UI
    } finally {
      setCcCheckStatus('done')
    }
  }

  // Phase 1: fast Supabase load. Phase 2: background CC dedup check.
  const load = async () => {
    setLoading(true)
    setError(null)
    setNotConnected(false)
    setSyncDone(null)
    setCcCheckStatus('idle')
    setCcAlreadyInCount(0)
    try {
      const [contactsRes, listsRes] = await Promise.all([
        fetch('/api/constant-contact/nexus-contacts'),
        fetch('/api/constant-contact/lists'),
      ])

      if (listsRes.status === 503) {
        const body = await listsRes.json().catch(() => ({}))
        if (body.not_connected) { setNotConnected(true); return }
      }

      if (!contactsRes.ok) {
        const body = await contactsRes.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${contactsRes.status}`)
      }

      const contactsBody = await contactsRes.json()
      // Only show types that belong in CC — exclude management, other, etc.
      setContacts((contactsBody.contacts || []).filter((c: NexusContact) => CC_TYPES.includes(c.contact_type)))

      if (listsRes.ok) {
        const listsBody = await listsRes.json()
        setLists(listsBody.lists || [])
        setSelectedListId(listsBody.selected_list_id ?? null)
      }
    } catch (e: any) {
      setError(e.message)
      return
    } finally {
      setLoading(false)
    }

    // Phase 2: background CC check — runs after fast load, doesn't block UI
    checkCC()
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const saveListChoice = async (listId: string | null) => {
    setSelectedListId(listId)
    setSavingList(true)
    await fetch('/api/constant-contact/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: listId }),
    }).finally(() => setSavingList(false))
  }

  // Core sync function
  const syncContacts = async (toSync: NexusContact[]) => {
    if (!toSync.length) return
    setPushing(true)
    setSyncDone(null)
    setContactErrors({})
    setSyncProgress({ done: 0, total: toSync.length })

    let synced = 0, failed = 0
    const BATCH = 3

    for (let i = 0; i < toSync.length; i += BATCH) {
      const batch = toSync.slice(i, i + BATCH)
      await Promise.all(batch.map(async c => {
        try {
          const res = await fetch('/api/constant-contact/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: c.id, first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone, firm: c.firm, title: c.title }),
          })
          const json = await res.json().catch(() => ({}))
          if (res.ok) {
            synced++
            setSyncedIds(prev => new Set([...prev, c.id]))
            // Remove immediately — cc_synced_at stamped in DB
            setContacts(prev => prev.filter(x => x.id !== c.id))
          } else {
            failed++
            setContactErrors(prev => ({ ...prev, [c.id]: json.error || `HTTP ${res.status}` }))
          }
        } catch (err: any) {
          failed++
          setContactErrors(prev => ({ ...prev, [c.id]: err.message || 'Network error' }))
        }
        setSyncProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null)
      }))
    }

    setSyncProgress(null)
    setSyncDone({ synced, failed })
    setPushing(false)
    setSelectedIds(new Set())
  }

  // Derived filtered list
  const filtered = contacts.filter(c =>
    typeFilter === 'all' || c.contact_type === typeFilter
  )
  const unsynced = filtered.filter(c => !syncedIds.has(c.id))

  // Type counts for pills
  const typeCounts: Record<string, number> = {}
  contacts.forEach(c => { typeCounts[c.contact_type] = (typeCounts[c.contact_type] || 0) + 1 })
  const types = Object.keys(typeCounts).sort()

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '48px', backdropFilter: 'blur(4px)',
    }}>
      <div className="card slide-in" style={{
        width: '680px', maxHeight: 'calc(100vh - 96px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={15} color="#d97706" />
          </div>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Constant Contact Sync</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              {loading
                ? 'Loading…'
                : `${contacts.length.toLocaleString()} not yet in CC`}
              {ccCheckStatus === 'checking' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: '11px' }}>
                  <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> verifying with CC…
                </span>
              )}
              {ccCheckStatus === 'done' && ccAlreadyInCount > 0 && (
                <span style={{ fontSize: '11px', color: '#16a34a' }}>· {ccAlreadyInCount} already in CC hidden</span>
              )}
            </p>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
              <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
              <div style={{ fontSize: '13px' }}>Loading contacts…</div>
            </div>
          )}

          {/* Not connected */}
          {notConnected && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 24px' }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Link2 size={24} color="#d97706" />
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 8px' }}>Connect Constant Contact</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 24px', lineHeight: 1.6 }}>
                Authorize Nexus to sync contacts with your Constant Contact account.
              </p>
              <a href="/api/constant-contact/oauth" className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                <Zap size={14} /> Connect Constant Contact
              </a>
            </div>
          )}

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', display: 'flex', gap: 10 }}>
              <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: '#991b1b' }}>{error}</span>
            </div>
          )}

          {!loading && !notConnected && !error && (
            <>
              {/* List picker */}
              {lists.length > 0 && (
                <div style={{ background: 'var(--surface-raised)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Sync to list:</span>
                  <select value={selectedListId ?? ''} onChange={e => saveListChoice(e.target.value || null)}
                    style={{ flex: 1, fontSize: '12px', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <option value="">No list (contacts only)</option>
                    {lists.map(l => (
                      <option key={l.id} value={l.id}>{l.name}{l.count !== null ? ` (${l.count.toLocaleString()})` : ''}</option>
                    ))}
                  </select>
                  {savingList && <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                </div>
              )}

              {/* Progress bar */}
              {syncProgress && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: 5 }}>
                    <span>Syncing to Constant Contact…</span>
                    <span>{syncProgress.done} / {syncProgress.total}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 99, width: `${Math.round((syncProgress.done / syncProgress.total) * 100)}%`, transition: 'width 0.2s' }} />
                  </div>
                </div>
              )}

              {/* Sync result */}
              {syncDone && (
                <div style={{
                  background: syncDone.failed > 0 ? '#fef3c7' : '#f0fdf4',
                  border: `1px solid ${syncDone.failed > 0 ? '#fde68a' : '#bbf7d0'}`,
                  borderRadius: 8, padding: '10px 14px', marginBottom: 14,
                  display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px',
                }}>
                  <CheckCircle2 size={15} color={syncDone.failed > 0 ? '#d97706' : '#16a34a'} />
                  <span>
                    <strong>{syncDone.synced}</strong> contact{syncDone.synced !== 1 ? 's' : ''} synced to Constant Contact
                    {syncDone.failed > 0 && <span style={{ color: '#b45309' }}> · {syncDone.failed} failed</span>}
                  </span>
                </div>
              )}

              {contacts.length === 0 && ccCheckStatus === 'done' ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                  <CheckCircle2 size={32} color="#16a34a" style={{ marginBottom: 12 }} />
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>All caught up!</div>
                  <div style={{ fontSize: '13px', marginTop: 4 }}>All bankers, lenders & LPs are already in Constant Contact.</div>
                </div>
              ) : contacts.length === 0 && ccCheckStatus === 'checking' ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite', marginBottom: 10 }} />
                  <div>Verifying with Constant Contact…</div>
                </div>
              ) : (
                <>
                  {/* Type filter pills */}
                  {types.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      <button onClick={() => { setTypeFilter('all'); setSelectedIds(new Set()) }}
                        style={{ padding: '3px 10px', borderRadius: 999, border: `1px solid ${typeFilter === 'all' ? 'var(--accent)' : 'var(--border)'}`, background: typeFilter === 'all' ? 'var(--accent-muted)' : 'transparent', color: typeFilter === 'all' ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        All <span style={{ fontFamily: 'var(--font-mono)' }}>{contacts.length}</span>
                      </button>
                      {types.map(t => (
                        <button key={t} onClick={() => { setTypeFilter(t); setSelectedIds(new Set()) }}
                          style={{ padding: '3px 10px', borderRadius: 999, border: `1px solid ${typeFilter === t ? (TYPE_COLORS[t] || 'var(--accent)') : 'var(--border)'}`, background: typeFilter === t ? (TYPE_COLORS[t] || 'var(--accent)') + '20' : 'transparent', color: typeFilter === t ? (TYPE_COLORS[t] || 'var(--accent)') : 'var(--text-secondary)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {t} <span style={{ fontFamily: 'var(--font-mono)' }}>{typeCounts[t]}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Toolbar: select all + sync button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: 'var(--surface-raised)', borderRadius: 6 }}>
                    <input type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === unsynced.length}
                      onChange={() => setSelectedIds(prev => prev.size === unsynced.length ? new Set() : new Set(unsynced.map(c => c.id)))}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', flex: 1 }}>
                      {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${filtered.length} contacts`}
                      {syncedIds.size > 0 && ` · ${syncedIds.size} synced this session`}
                    </span>
                    {selectedIds.size > 0 ? (
                      <button className="btn btn-primary" onClick={() => syncContacts(filtered.filter(c => selectedIds.has(c.id)))} disabled={pushing}
                        style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {pushing ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowUpRight size={12} />}
                        {pushing && syncProgress ? `${syncProgress.done} / ${syncProgress.total}` : `Sync ${selectedIds.size}`}
                      </button>
                    ) : (
                      <button className="btn btn-ghost" onClick={() => syncContacts(unsynced)} disabled={pushing || ccCheckStatus === 'checking'}
                        style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {pushing ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowUpRight size={12} />}
                        {pushing && syncProgress ? `${syncProgress.done} / ${syncProgress.total}` : `Sync All ${unsynced.length}`}
                      </button>
                    )}
                  </div>

                  {/* Contact list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filtered.map(c => {
                      const isSynced = syncedIds.has(c.id)
                      const isSelected = selectedIds.has(c.id)
                      const ccError = contactErrors[c.id]
                      return (
                        <div key={c.id} style={{
                          borderRadius: 6, overflow: 'hidden',
                          border: `1px solid ${ccError ? '#fecaca' : isSelected ? 'var(--accent)' : 'transparent'}`,
                          background: isSynced ? '#f0fdf4' : isSelected ? 'var(--accent-muted)' : 'var(--surface-raised)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px' }}>
                            {isSynced
                              ? <CheckCircle2 size={14} color="#16a34a" style={{ flexShrink: 0 }} />
                              : <input type="checkbox" checked={isSelected} onChange={() => setSelectedIds(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })}
                                  disabled={pushing} style={{ cursor: 'pointer', flexShrink: 0 }} />
                            }
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 600 }}>{c.first_name} {c.last_name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {[c.firm, c.email].filter(Boolean).join(' · ')}
                                {c.created_at && <span style={{ marginLeft: 6, opacity: 0.6 }}>· {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                              </div>
                            </div>
                            <span style={{
                              fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                              padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                              background: (TYPE_COLORS[c.contact_type] || '#94a3b8') + '20',
                              color: TYPE_COLORS[c.contact_type] || '#94a3b8',
                            }}>{c.contact_type}</span>
                            {!isSynced && !pushing && (
                              <button onClick={() => syncContacts([c])}
                                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', fontSize: '11px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                <ArrowUpRight size={10} /> Sync
                              </button>
                            )}
                          </div>
                          {ccError && (
                            <div style={{ padding: '4px 10px 7px 34px', fontSize: '11px', color: '#dc2626', background: '#fef2f2' }}>
                              ⚠ {ccError}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 24px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button onClick={load} disabled={loading || ccCheckStatus === 'checking'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw size={12} style={(loading || ccCheckStatus === 'checking') ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
