'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { X, Check } from 'lucide-react'

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

// Reassign all FK references from secondary → primary, then delete secondary
const FK_TABLES: { table: string; col: string }[] = [
  { table: 'interactions',       col: 'contact_id' },
  { table: 'contact_deal_links', col: 'contact_id' },
  { table: 'notes',              col: 'contact_id' },
  { table: 'capital_contacts',   col: 'crm_contact_id' },
  { table: 'calendar_events',    col: 'contact_id' },
]

export default function DupesPage() {
  const supabase = createClient()
  const [pairs, setPairs]       = useState<DupePair[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [loading, setLoading]   = useState(true)
  const [acting, setActing]     = useState<string | null>(null)
  const [done, setDone]         = useState<Set<string>>(new Set())

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email, phone, firm, title, contact_type, notes, created_at')
        .order('created_at', { ascending: true })
      const contacts: Contact[] = data ?? []
      const found: DupePair[] = []
      const seen = new Set<string>()

      const addPair = (a: Contact, b: Contact, reason: DupePair['reason']) => {
        const key = [a.id, b.id].sort().join('|')
        if (!seen.has(key)) { seen.add(key); found.push({ a, b, reason }) }
      }

      // Email duplicates
      const byEmail = new Map<string, Contact[]>()
      for (const c of contacts) {
        if (!c.email) continue
        const key = c.email.toLowerCase().trim()
        if (!byEmail.has(key)) byEmail.set(key, [])
        byEmail.get(key)!.push(c)
      }
      for (const [, group] of byEmail) {
        if (group.length < 2) continue
        for (let i = 0; i < group.length - 1; i++)
          for (let j = i + 1; j < group.length; j++)
            addPair(group[i], group[j], 'email')
      }

      // Phone duplicates
      const normalize = (p: string) => p.replace(/\D/g, '')
      const byPhone = new Map<string, Contact[]>()
      for (const c of contacts) {
        if (!c.phone) continue
        const key = normalize(c.phone)
        if (key.length < 7) continue
        if (!byPhone.has(key)) byPhone.set(key, [])
        byPhone.get(key)!.push(c)
      }
      for (const [, group] of byPhone) {
        if (group.length < 2) continue
        for (let i = 0; i < group.length - 1; i++)
          for (let j = i + 1; j < group.length; j++)
            addPair(group[i], group[j], 'phone')
      }

      // Name duplicates
      const byName = new Map<string, Contact[]>()
      for (const c of contacts) {
        const key = `${c.first_name.toLowerCase().trim()}|${c.last_name.toLowerCase().trim()}`
        if (!byName.has(key)) byName.set(key, [])
        byName.get(key)!.push(c)
      }
      for (const [, group] of byName) {
        if (group.length < 2) continue
        for (let i = 0; i < group.length - 1; i++)
          for (let j = i + 1; j < group.length; j++)
            addPair(group[i], group[j], 'name')
      }

      setPairs(found)
      setLoading(false)
    }
    load()
  }, [])

  const pairKey = (p: DupePair) => [p.a.id, p.b.id].sort().join('|')

  // Merge: keep primary, fill its empty fields from secondary, reassign refs, delete secondary
  const merge = async (primary: Contact, secondary: Contact, p: DupePair) => {
    const key = pairKey(p)
    setActing(key)
    const patch: Partial<Contact> = {}
    const fields: (keyof Contact)[] = ['email', 'phone', 'firm', 'title', 'notes']
    for (const f of fields) if (!primary[f] && secondary[f]) (patch as any)[f] = secondary[f]
    if (Object.keys(patch).length > 0)
      await supabase.from('contacts').update(patch).eq('id', primary.id)
    await Promise.all(FK_TABLES.map(({ table, col }) =>
      supabase.from(table as any).update({ [col]: primary.id }).eq(col, secondary.id)
    ))
    await supabase.from('contacts').delete().eq('id', secondary.id)
    setActing(null)
    setDone(prev => new Set([...prev, key]))
  }

  // Overwrite: keep primary, replace all non-null fields from secondary, reassign refs, delete secondary
  const overwrite = async (primary: Contact, secondary: Contact, p: DupePair) => {
    const key = pairKey(p)
    setActing(key)
    const patch: Partial<Contact> = {}
    const fields: (keyof Contact)[] = ['email', 'phone', 'firm', 'title', 'notes']
    for (const f of fields) if (secondary[f]) (patch as any)[f] = secondary[f]
    if (Object.keys(patch).length > 0)
      await supabase.from('contacts').update(patch).eq('id', primary.id)
    await Promise.all(FK_TABLES.map(({ table, col }) =>
      supabase.from(table as any).update({ [col]: primary.id }).eq(col, secondary.id)
    ))
    await supabase.from('contacts').delete().eq('id', secondary.id)
    setActing(null)
    setDone(prev => new Set([...prev, key]))
  }

  const visible = pairs.filter(p => !dismissed.has(pairKey(p)) && !done.has(pairKey(p)))
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const reasonLabel = (r: DupePair['reason']) =>
    r === 'email' ? 'Same email' : r === 'phone' ? 'Same phone' : 'Same name'

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Contact Deduplication</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
          {loading ? 'Scanning…' : `${visible.length} potential duplicate${visible.length !== 1 ? 's' : ''} found`}
          {done.size > 0 && <span style={{ marginLeft: '12px', color: 'var(--green)' }}>· {done.size} resolved this session</span>}
        </p>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px' }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Scanning contacts…</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>✓</div>
            No duplicates found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '960px' }}>
            {visible.map(p => {
              const key = pairKey(p)
              const isActing = acting === key
              return (
                <div key={key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                  {/* Header */}
                  <div style={{ padding: '8px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)', background: 'var(--accent-muted)', padding: '2px 8px', borderRadius: '10px' }}>
                      {reasonLabel(p.reason)}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', flex: 1 }}>
                      {p.reason === 'email' ? `email: ${p.a.email}` : p.reason === 'phone' ? `phone: ${p.a.phone}` : `${p.a.first_name} ${p.a.last_name}`}
                    </span>
                    <button onClick={() => setDismissed(prev => new Set([...prev, key]))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <X size={12} /> Not a duplicate
                    </button>
                  </div>

                  {/* Side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr' }}>
                    {[p.a, p.b].map((c, idx) => {
                      const other = idx === 0 ? p.b : p.a
                      return (
                        <div key={c.id} style={{ padding: '18px 20px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{c.first_name} {c.last_name}</div>
                          {c.title && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.title}</div>}
                          {c.firm  && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{c.firm}</div>}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '12px' }}>
                            {c.email && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>✉ {c.email}</div>}
                            {c.phone && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>✆ {c.phone}</div>}
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{c.contact_type}</div>
                            {c.notes && <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }}>{c.notes}</div>}
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>Added {fmtDate(c.created_at)}</div>
                          </div>

                          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '6px' }}>
                            Keep this one and…
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <button
                              onClick={() => merge(c, other, p)}
                              disabled={isActing}
                              title="Keep this contact, fill its blank fields with the other's data, then delete the other"
                              style={{ fontSize: '11px', padding: '5px 12px', border: '1px solid var(--accent)', borderRadius: '6px', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: 'pointer', textAlign: 'left', opacity: isActing ? 0.5 : 1 }}
                            >
                              <Check size={11} style={{ display: 'inline', marginRight: '5px' }} />
                              Merge — fill my blank fields from the other
                            </button>
                            <button
                              onClick={() => overwrite(c, other, p)}
                              disabled={isActing}
                              title="Keep this contact, replace all its fields with the other's data, then delete the other"
                              style={{ fontSize: '11px', padding: '5px 12px', border: '1px solid #d97706', borderRadius: '6px', background: 'rgba(245,158,11,0.07)', color: '#d97706', cursor: 'pointer', textAlign: 'left', opacity: isActing ? 0.5 : 1 }}
                            >
                              ↺ Overwrite — replace all my fields with the other's
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    <div style={{ background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      <span style={{ position: 'absolute', background: 'var(--surface)', padding: '4px 6px', fontSize: '10px', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '4px' }}>vs</span>
                    </div>
                  </div>

                  {isActing && (
                    <div style={{ padding: '10px 20px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text-muted)' }}>
                      Merging and updating references…
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
