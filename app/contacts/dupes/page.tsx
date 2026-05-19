'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { X, Check, Search, ChevronDown, ChevronUp } from 'lucide-react'

type Contact = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  firm: string | null
  title: string | null
  contact_type: string
  notes: string | null
  created_at: string
}

type DupePair = { a: Contact; b: Contact; reason: 'email' | 'name' | 'phone' }

const FK_TABLES: { table: string; col: string }[] = [
  { table: 'interactions',       col: 'contact_id' },
  { table: 'contact_deal_links', col: 'contact_id' },
  { table: 'notes',              col: 'contact_id' },
  { table: 'capital_contacts',   col: 'crm_contact_id' },
  { table: 'calendar_events',    col: 'contact_id' },
]

const COMPARE_FIELDS: { key: keyof Contact; label: string }[] = [
  { key: 'first_name', label: 'First' },
  { key: 'last_name',  label: 'Last' },
  { key: 'email',      label: 'Email' },
  { key: 'phone',      label: 'Phone' },
  { key: 'firm',       label: 'Firm' },
  { key: 'title',      label: 'Title' },
  { key: 'contact_type', label: 'Type' },
]

async function loadAllContacts(supabase: any): Promise<Contact[]> {
  const all: Contact[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone, firm, title, contact_type, notes, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function doMerge(supabase: any, primary: Contact, secondary: Contact, mode: 'merge' | 'overwrite') {
  const patch: Record<string, any> = {}
  const fields: (keyof Contact)[] = ['email', 'phone', 'firm', 'title', 'notes']
  for (const f of fields) {
    if (mode === 'merge') { if (!primary[f] && secondary[f]) patch[f] = secondary[f] }
    else                  { if (secondary[f]) patch[f] = secondary[f] }
  }
  if (Object.keys(patch).length > 0)
    await supabase.from('contacts').update(patch).eq('id', primary.id)
  await Promise.all(FK_TABLES.map(({ table, col }) =>
    supabase.from(table as any).update({ [col]: primary.id }).eq(col, secondary.id)
  ))
  await supabase.from('contacts').delete().eq('id', secondary.id)
}

export default function DupesPage() {
  const supabase = createClient()
  const [pairs, setPairs]         = useState<DupePair[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [done, setDone]           = useState<Set<string>>(new Set())
  const [loading, setLoading]     = useState(true)
  const [acting, setActing]       = useState<Set<string>>(new Set())
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [search, setSearch]       = useState('')
  const [bulkActing, setBulkActing] = useState(false)

  useEffect(() => {
    const load = async () => {
      const contacts = await loadAllContacts(supabase)
      const found: DupePair[] = []
      const seen = new Set<string>()
      const addPair = (a: Contact, b: Contact, reason: DupePair['reason']) => {
        const key = [a.id, b.id].sort().join('|')
        if (!seen.has(key)) { seen.add(key); found.push({ a, b, reason }) }
      }

      // Email
      const byEmail = new Map<string, Contact[]>()
      for (const c of contacts) {
        if (!c.email) continue
        const k = c.email.toLowerCase().trim()
        if (!byEmail.has(k)) byEmail.set(k, [])
        byEmail.get(k)!.push(c)
      }
      for (const [, g] of byEmail) if (g.length > 1) for (let i=0;i<g.length-1;i++) for (let j=i+1;j<g.length;j++) addPair(g[i],g[j],'email')

      // Phone — only flag if same phone AND (same last name OR same firm)
      // Pure phone matches are too noisy due to shared main office lines
      const norm = (p: string) => p.replace(/\D/g, '')
      const byPhone = new Map<string, Contact[]>()
      for (const c of contacts) {
        if (!c.phone) continue
        const k = norm(c.phone)
        if (k.length < 7) continue
        if (!byPhone.has(k)) byPhone.set(k, [])
        byPhone.get(k)!.push(c)
      }
      for (const [, g] of byPhone) {
        if (g.length < 2) continue
        for (let i = 0; i < g.length - 1; i++) {
          for (let j = i + 1; j < g.length; j++) {
            const a = g[i], b = g[j]
            const sameLast = a.last_name.toLowerCase().trim() === b.last_name.toLowerCase().trim()
            const sameFirm = a.firm && b.firm && a.firm.toLowerCase().trim() === b.firm.toLowerCase().trim()
            if (sameLast || sameFirm) addPair(a, b, 'phone')
          }
        }
      }

      // Name
      const byName = new Map<string, Contact[]>()
      for (const c of contacts) {
        const k = `${c.first_name.toLowerCase().trim()}|${c.last_name.toLowerCase().trim()}`
        if (!byName.has(k)) byName.set(k, [])
        byName.get(k)!.push(c)
      }
      for (const [, g] of byName) if (g.length > 1) for (let i=0;i<g.length-1;i++) for (let j=i+1;j<g.length;j++) addPair(g[i],g[j],'name')

      setPairs(found)
      setLoading(false)
    }
    load()
  }, [])

  const pairKey = (p: DupePair) => [p.a.id, p.b.id].sort().join('|')

  const act = async (key: string, fn: () => Promise<void>) => {
    setActing(prev => new Set([...prev, key]))
    await fn()
    setActing(prev => { const s = new Set(prev); s.delete(key); return s })
    setDone(prev => new Set([...prev, key]))
    setSelected(prev => { const s = new Set(prev); s.delete(key); return s })
  }

  const merge    = (primary: Contact, secondary: Contact, p: DupePair) =>
    act(pairKey(p), () => doMerge(supabase, primary, secondary, 'merge'))
  const overwrite = (primary: Contact, secondary: Contact, p: DupePair) =>
    act(pairKey(p), () => doMerge(supabase, primary, secondary, 'overwrite'))

  // Bulk: keep older contact, merge (fill blank fields)
  const bulkMergeOlder = async () => {
    setBulkActing(true)
    for (const key of selected) {
      const p = visible.find(x => pairKey(x) === key)
      if (!p) continue
      const [primary, secondary] = p.a.created_at <= p.b.created_at ? [p.a, p.b] : [p.b, p.a]
      await doMerge(supabase, primary, secondary, 'merge')
      setDone(prev => new Set([...prev, key]))
    }
    setSelected(new Set())
    setBulkActing(false)
  }

  const bulkDismiss = () => {
    setDismissed(prev => new Set([...prev, ...selected]))
    setSelected(new Set())
  }

  const q = search.toLowerCase().trim()
  const visible = pairs.filter(p => {
    if (dismissed.has(pairKey(p)) || done.has(pairKey(p))) return false
    if (!q) return true
    return [p.a.first_name, p.a.last_name, p.a.email, p.a.phone, p.a.firm,
            p.b.first_name, p.b.last_name, p.b.email, p.b.phone, p.b.firm]
      .join(' ').toLowerCase().includes(q)
  })

  const allSelected = visible.length > 0 && visible.every(p => selected.has(pairKey(p)))
  const toggleAll   = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(visible.map(pairKey)))
  }
  const toggleOne = (key: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  const toggleExpand = (key: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })

  const fmtDate  = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  const reasonBg = (r: DupePair['reason']) => r === 'email' ? 'rgba(99,102,241,0.12)' : r === 'phone' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)'
  const reasonColor = (r: DupePair['reason']) => r === 'email' ? '#6366f1' : r === 'phone' ? '#059669' : '#d97706'

  // Compute differing fields for a pair
  const diffFields = (a: Contact, b: Contact) =>
    COMPARE_FIELDS.filter(f => {
      const av = (a[f.key] ?? '').toString().toLowerCase().trim()
      const bv = (b[f.key] ?? '').toString().toLowerCase().trim()
      return av !== bv
    }).map(f => f.label)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Contact Deduplication</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {loading ? 'Scanning all contacts…' : `${visible.length} potential duplicate${visible.length !== 1 ? 's' : ''}`}
            {done.size > 0 && <span style={{ marginLeft: '10px', color: 'var(--green)' }}>· {done.size} resolved</span>}
          </p>
        </div>
        {!loading && (
          <div style={{ position: 'relative', marginLeft: 'auto' }}>
            <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" placeholder="Filter by name, email, firm…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '30px', width: '240px' }} />
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{ padding: '10px 28px', background: 'var(--accent-muted)', borderBottom: '1px solid var(--accent)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>{selected.size} selected</span>
          <button
            onClick={bulkMergeOlder}
            disabled={bulkActing}
            className="btn btn-primary"
            style={{ fontSize: '11px', padding: '4px 12px' }}
          >
            <Check size={11} /> Merge all — keep older contact
          </button>
          <button
            onClick={bulkDismiss}
            disabled={bulkActing}
            className="btn btn-ghost"
            style={{ fontSize: '11px', padding: '4px 12px' }}
          >
            <X size={11} /> Dismiss all
          </button>
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-muted)' }}>
            Clear selection
          </button>
        </div>
      )}

      {/* Column header */}
      {!loading && visible.length > 0 && (
        <div style={{ padding: '6px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'grid', gridTemplateColumns: '28px 90px 1fr 1fr 120px 80px', gap: '12px', alignItems: 'center' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer' }} />
          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Match</span>
          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Contact A (older)</span>
          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Contact B (newer)</span>
          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Differences</span>
          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Actions</span>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px 28px', color: 'var(--text-muted)', fontSize: '13px' }}>Scanning contacts…</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>✓</div>
            {q ? 'No duplicates match your search.' : 'No duplicates found.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {visible.map(p => {
              const key       = pairKey(p)
              const isActing  = acting.has(key)
              const isExpanded = expanded.has(key)
              const isSelected = selected.has(key)
              // Sort a=older, b=newer
              const [cA, cB]  = p.a.created_at <= p.b.created_at ? [p.a, p.b] : [p.b, p.a]
              const diffs     = diffFields(cA, cB)

              return (
                <div key={key} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'var(--accent-muted)' : 'var(--surface)', opacity: isActing ? 0.6 : 1 }}>
                  {/* Compact row */}
                  <div style={{ padding: '10px 28px', display: 'grid', gridTemplateColumns: '28px 90px 1fr 1fr 120px 80px', gap: '12px', alignItems: 'center' }}>

                    {/* Checkbox */}
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(key)} style={{ cursor: 'pointer' }} />

                    {/* Match badge */}
                    <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: reasonColor(p.reason), background: reasonBg(p.reason), padding: '2px 7px', borderRadius: '10px', whiteSpace: 'nowrap' }}>
                      {p.reason === 'email' ? '✉ email' : p.reason === 'phone' ? '✆ phone' : '👤 name'}
                    </span>

                    {/* Contact A */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cA.first_name} {cA.last_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[cA.firm, cA.contact_type, fmtDate(cA.created_at)].filter(Boolean).join(' · ')}
                      </div>
                    </div>

                    {/* Contact B */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cB.first_name} {cB.last_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[cB.firm, cB.contact_type, fmtDate(cB.created_at)].filter(Boolean).join(' · ')}
                      </div>
                    </div>

                    {/* Diff summary */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                      {diffs.length === 0 ? (
                        <span style={{ fontSize: '10px', color: 'var(--green)' }}>identical</span>
                      ) : diffs.map(f => (
                        <span key={f} style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(245,158,11,0.12)', color: '#d97706', borderRadius: '4px', fontWeight: 500 }}>{f}</span>
                      ))}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <button
                        onClick={() => toggleExpand(key)}
                        title="Show field-by-field comparison and action options"
                        style={{ fontSize: '10px', padding: '3px 7px', border: '1px solid var(--border)', borderRadius: '5px', background: isExpanded ? 'var(--surface-2)' : 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}
                      >
                        {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                      <button
                        onClick={() => setDismissed(prev => new Set([...prev, key]))}
                        title="Not a duplicate"
                        style={{ fontSize: '10px', padding: '3px 7px', border: '1px solid var(--border)', borderRadius: '5px', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded detail + actions */}
                  {isExpanded && (
                    <div style={{ margin: '0 28px 12px', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                      {/* Field comparison table */}
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: 'var(--surface-2)' }}>
                            <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', width: '80px' }}>Field</th>
                            <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                              A — {cA.first_name} {cA.last_name} <span style={{ fontWeight: 400, textTransform: 'none' }}>(added {fmtDate(cA.created_at)})</span>
                            </th>
                            <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                              B — {cB.first_name} {cB.last_name} <span style={{ fontWeight: 400, textTransform: 'none' }}>(added {fmtDate(cB.created_at)})</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {COMPARE_FIELDS.map(({ key: fk, label }) => {
                            const av = cA[fk] ?? '—'
                            const bv = cB[fk] ?? '—'
                            const differs = (cA[fk] ?? '').toString().toLowerCase().trim() !== (cB[fk] ?? '').toString().toLowerCase().trim()
                            return (
                              <tr key={fk} style={{ borderTop: '1px solid var(--border)', background: differs ? 'rgba(245,158,11,0.04)' : 'transparent' }}>
                                <td style={{ padding: '5px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</td>
                                <td style={{ padding: '5px 12px', color: differs ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: differs ? 500 : 400 }}>{String(av)}</td>
                                <td style={{ padding: '5px 12px', color: differs ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: differs ? 500 : 400 }}>
                                  {String(bv)}
                                  {differs && <span style={{ marginLeft: '6px', fontSize: '9px', color: '#d97706' }}>≠</span>}
                                </td>
                              </tr>
                            )
                          })}
                          {(cA.notes || cB.notes) && (
                            <tr style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '5px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase' }}>Notes</td>
                              <td style={{ padding: '5px 12px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '11px' }}>{cA.notes || '—'}</td>
                              <td style={{ padding: '5px 12px', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '11px' }}>{cB.notes || '—'}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>

                      {/* Action buttons */}
                      <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginRight: '4px' }}>Keep A and…</span>
                        <button onClick={() => merge(cA, cB, p)} disabled={isActing} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid var(--accent)', borderRadius: '5px', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: 'pointer' }}>
                          <Check size={10} style={{ display: 'inline', marginRight: '4px' }} />Merge (fill blanks)
                        </button>
                        <button onClick={() => overwrite(cA, cB, p)} disabled={isActing} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid #d97706', borderRadius: '5px', background: 'rgba(245,158,11,0.07)', color: '#d97706', cursor: 'pointer' }}>
                          ↺ Overwrite all
                        </button>
                        <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginLeft: '12px', marginRight: '4px' }}>Keep B and…</span>
                        <button onClick={() => merge(cB, cA, p)} disabled={isActing} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid var(--accent)', borderRadius: '5px', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: 'pointer' }}>
                          <Check size={10} style={{ display: 'inline', marginRight: '4px' }} />Merge (fill blanks)
                        </button>
                        <button onClick={() => overwrite(cB, cA, p)} disabled={isActing} style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid #d97706', borderRadius: '5px', background: 'rgba(245,158,11,0.07)', color: '#d97706', cursor: 'pointer' }}>
                          ↺ Overwrite all
                        </button>
                        <button onClick={() => setDismissed(prev => new Set([...prev, key]))} style={{ marginLeft: 'auto', fontSize: '11px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '5px', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <X size={10} /> Not a duplicate
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
