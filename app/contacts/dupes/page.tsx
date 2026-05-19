'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Check, X, Merge } from 'lucide-react'

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

type DupePair = { a: Contact; b: Contact; reason: 'name' | 'email' }

function mergeFields(primary: Contact, secondary: Contact): Partial<Contact> {
  const merged: Partial<Contact> = {}
  const fields: (keyof Contact)[] = ['email', 'phone', 'firm', 'title', 'notes']
  for (const f of fields) {
    if (!primary[f] && secondary[f]) (merged as any)[f] = secondary[f]
  }
  return merged
}

export default function DupesPage() {
  const supabase = createClient()
  const [pairs, setPairs] = useState<DupePair[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState<string | null>(null)
  const [merged, setMerged] = useState<Set<string>>(new Set())

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('contacts').select('id, first_name, last_name, email, phone, firm, title, contact_type, notes, created_at').order('created_at', { ascending: true })
      const contacts: Contact[] = data ?? []
      const found: DupePair[] = []
      const seen = new Set<string>()

      // Check by email
      const byEmail = new Map<string, Contact[]>()
      for (const c of contacts) {
        if (!c.email) continue
        const key = c.email.toLowerCase()
        if (!byEmail.has(key)) byEmail.set(key, [])
        byEmail.get(key)!.push(c)
      }
      for (const [, group] of byEmail) {
        if (group.length < 2) continue
        for (let i = 0; i < group.length - 1; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const key = `${group[i].id}|${group[j].id}`
            if (!seen.has(key)) { seen.add(key); found.push({ a: group[i], b: group[j], reason: 'email' }) }
          }
        }
      }

      // Check by name
      const byName = new Map<string, Contact[]>()
      for (const c of contacts) {
        const key = `${c.first_name.toLowerCase()}|${c.last_name.toLowerCase()}`
        if (!byName.has(key)) byName.set(key, [])
        byName.get(key)!.push(c)
      }
      for (const [, group] of byName) {
        if (group.length < 2) continue
        for (let i = 0; i < group.length - 1; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const key = `${group[i].id}|${group[j].id}`
            if (!seen.has(key)) { seen.add(key); found.push({ a: group[i], b: group[j], reason: 'name' }) }
          }
        }
      }

      setPairs(found)
      setLoading(false)
    }
    load()
  }, [])

  const pairKey = (p: DupePair) => `${p.a.id}|${p.b.id}`

  const dismiss = (p: DupePair) => setDismissed(prev => new Set([...prev, pairKey(p)]))

  const merge = async (primary: Contact, secondary: Contact, p: DupePair) => {
    const key = pairKey(p)
    if (!confirm(`Merge "${secondary.first_name} ${secondary.last_name}" into "${primary.first_name} ${primary.last_name}"? This will update all references and delete the secondary record.`)) return
    setMerging(key)

    // Copy empty fields from secondary to primary
    const updates = mergeFields(primary, secondary)
    if (Object.keys(updates).length > 0) {
      await supabase.from('contacts').update(updates).eq('id', primary.id)
    }

    // Reassign FK references
    await Promise.all([
      supabase.from('interactions').update({ contact_id: primary.id }).eq('contact_id', secondary.id),
      supabase.from('contact_deal_links').update({ contact_id: primary.id }).eq('contact_id', secondary.id),
      supabase.from('notes').update({ contact_id: primary.id }).eq('contact_id', secondary.id),
      supabase.from('capital_contacts').update({ crm_contact_id: primary.id }).eq('crm_contact_id', secondary.id),
    ])

    // Delete secondary
    await supabase.from('contacts').delete().eq('id', secondary.id)

    setMerging(null)
    setMerged(prev => new Set([...prev, key]))
  }

  const visible = pairs.filter(p => !dismissed.has(pairKey(p)) && !merged.has(pairKey(p)))

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Contact Deduplication</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
          {loading ? 'Scanning…' : `${visible.length} potential duplicate${visible.length !== 1 ? 's' : ''} found`}
          {merged.size > 0 && <span style={{ marginLeft: '12px', color: 'var(--green)' }}>· {merged.size} merged this session</span>}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '900px' }}>
            {visible.map(p => {
              const key = pairKey(p)
              const isMerging = merging === key
              return (
                <div key={key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                  {/* Reason badge */}
                  <div style={{ padding: '8px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)', background: 'var(--accent-muted)', padding: '2px 8px', borderRadius: '10px' }}>
                      {p.reason === 'email' ? 'Same email' : 'Same name'}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', flex: 1 }}>
                      {p.reason === 'email' ? `Both have email: ${p.a.email}` : `${p.a.first_name} ${p.a.last_name}`}
                    </span>
                    <button onClick={() => dismiss(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <X size={12} /> Not a duplicate
                    </button>
                  </div>

                  {/* Side-by-side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0' }}>
                    {[p.a, p.b].map((c, idx) => (
                      <>
                        <div key={c.id} style={{ padding: '16px 20px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{c.first_name} {c.last_name}</div>
                          {c.title && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>{c.title}</div>}
                          {c.firm && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{c.firm}</div>}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {c.email && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>✉ {c.email}</div>}
                            {c.phone && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>✆ {c.phone}</div>}
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{c.contact_type}</div>
                            {c.notes && <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.notes}</div>}
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>Added {fmtDate(c.created_at)}</div>
                          </div>

                          {/* Merge buttons */}
                          <div style={{ marginTop: '14px', display: 'flex', gap: '6px' }}>
                            <button
                              onClick={() => merge(c, idx === 0 ? p.b : p.a, p)}
                              disabled={isMerging}
                              style={{ fontSize: '11px', padding: '5px 12px', border: '1px solid var(--accent)', borderRadius: '6px', background: 'var(--accent-muted)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Check size={11} /> Keep this one
                            </button>
                          </div>
                        </div>
                        {idx === 0 && (
                          <div key="divider" style={{ width: '1px', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                            <span style={{ position: 'absolute', background: 'var(--surface)', padding: '4px 6px', fontSize: '10px', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '4px' }}>vs</span>
                          </div>
                        )}
                      </>
                    ))}
                  </div>

                  {isMerging && (
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
