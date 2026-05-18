'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Plus, Search, X, Check, Phone, Mail, ChevronDown, ChevronRight } from 'lucide-react'

type Contact = {
  id: string
  source: string
  firm: string
  firm_type: string | null
  firm_focus: string | null
  investment_pref: string | null
  contact_name: string | null
  title: string | null
  email: string | null
  phone: string | null
  conf_lead: string | null
  notes: string | null
  status: string
  _calls?: Call[]
  _callsLoaded?: boolean
}

type Call = {
  id: string
  contact_id: string
  call_date: string
  summary: string
  logged_by: string | null
  deal_context: string | null
}

type NewCallForm = {
  call_date: string
  summary: string
  logged_by: string
  deal_context: string
}

const SOURCE_LABELS: Record<string, string> = {
  equity: 'Equity',
  lender: 'Lender',
}

const SOURCE_COLORS: Record<string, string> = {
  equity: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  lender: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
}

// Group contacts by firm, merging multiple contacts per firm
function groupByFirm(contacts: Contact[]): { firm: string; rows: Contact[] }[] {
  const map = new Map<string, Contact[]>()
  for (const c of contacts) {
    const key = c.firm
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(c)
  }
  return Array.from(map.entries()).map(([firm, rows]) => ({ firm, rows }))
}

export default function CapitalContactsPage() {
  const supabase = createClient()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'equity' | 'lender'>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active')
  const [expandedFirms, setExpandedFirms] = useState<Set<string>>(new Set())
  const [showAddForm, setShowAddForm] = useState(false)
  const [addingCallFor, setAddingCallFor] = useState<string | null>(null) // contact id
  const [newCallForm, setNewCallForm] = useState<NewCallForm>({
    call_date: new Date().toISOString().split('T')[0],
    summary: '',
    logged_by: 'Ken',
    deal_context: '',
  })
  const [savingCall, setSavingCall] = useState(false)
  const [addForm, setAddForm] = useState({
    firm: '', firm_type: '', firm_focus: '', investment_pref: '',
    contact_name: '', title: '', email: '', phone: '', conf_lead: '', notes: '',
    source: 'equity',
  })
  const [savingAdd, setSavingAdd] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [total, setTotal] = useState(0)

  const PAGE = 100

  const load = useCallback(async (q = search, src = sourceFilter, st = statusFilter) => {
    setLoading(true)
    let query = supabase
      .from('capital_contacts')
      .select('*', { count: 'exact' })
      .order('firm')
      .limit(PAGE)

    if (st !== 'all') query = query.eq('status', st)
    if (src !== 'all') query = query.eq('source', src)

    if (q.trim()) {
      query = query.or(
        `firm.ilike.%${q}%,contact_name.ilike.%${q}%,firm_type.ilike.%${q}%,notes.ilike.%${q}%`
      )
    }

    const { data, count } = await query
    setContacts(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [supabase, search, sourceFilter, statusFilter])

  useEffect(() => { load() }, [])

  // Debounced search
  const searchTimer = useRef<any>(null)
  const handleSearch = (v: string) => {
    setSearch(v)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(v, sourceFilter, statusFilter), 300)
  }

  const handleSourceFilter = (v: typeof sourceFilter) => {
    setSourceFilter(v)
    load(search, v, statusFilter)
  }

  const handleStatusFilter = (v: typeof statusFilter) => {
    setStatusFilter(v)
    load(search, sourceFilter, v)
  }

  const toggleFirm = async (firm: string, rows: Contact[]) => {
    const next = new Set(expandedFirms)
    if (next.has(firm)) {
      next.delete(firm)
    } else {
      next.add(firm)
      // Load calls for all contacts in this firm that haven't been loaded
      const toLoad = rows.filter(r => !r._callsLoaded)
      if (toLoad.length > 0) {
        const ids = toLoad.map(r => r.id)
        const { data } = await supabase
          .from('capital_contact_calls')
          .select('*')
          .in('contact_id', ids)
          .order('call_date', { ascending: false })
        const callsByContact: Record<string, Call[]> = {}
        for (const call of data ?? []) {
          if (!callsByContact[call.contact_id]) callsByContact[call.contact_id] = []
          callsByContact[call.contact_id].push(call)
        }
        setContacts(prev => prev.map(c =>
          ids.includes(c.id)
            ? { ...c, _calls: callsByContact[c.id] ?? [], _callsLoaded: true }
            : c
        ))
      }
    }
    setExpandedFirms(next)
  }

  const saveCall = async (contactId: string) => {
    if (!newCallForm.summary.trim()) return
    setSavingCall(true)
    const { data } = await supabase.from('capital_contact_calls').insert({
      contact_id: contactId,
      call_date: newCallForm.call_date,
      summary: newCallForm.summary,
      logged_by: newCallForm.logged_by || null,
      deal_context: newCallForm.deal_context || null,
    }).select().single()
    if (data) {
      setContacts(prev => prev.map(c =>
        c.id === contactId
          ? { ...c, _calls: [data, ...(c._calls ?? [])] }
          : c
      ))
    }
    setNewCallForm({ call_date: new Date().toISOString().split('T')[0], summary: '', logged_by: 'Ken', deal_context: '' })
    setAddingCallFor(null)
    setSavingCall(false)
  }

  const deleteCall = async (callId: string, contactId: string) => {
    await supabase.from('capital_contact_calls').delete().eq('id', callId)
    setContacts(prev => prev.map(c =>
      c.id === contactId
        ? { ...c, _calls: (c._calls ?? []).filter(cl => cl.id !== callId) }
        : c
    ))
  }

  const saveNote = async (contactId: string) => {
    await supabase.from('capital_contacts').update({ notes: noteDraft }).eq('id', contactId)
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, notes: noteDraft } : c))
    setEditingNote(null)
  }

  const setStatus = async (contactId: string, status: string) => {
    await supabase.from('capital_contacts').update({ status }).eq('id', contactId)
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status } : c))
  }

  const addContact = async () => {
    if (!addForm.firm.trim()) return
    setSavingAdd(true)
    const { data } = await supabase.from('capital_contacts').insert({
      firm: addForm.firm,
      firm_type: addForm.firm_type || null,
      firm_focus: addForm.firm_focus || null,
      investment_pref: addForm.investment_pref || null,
      contact_name: addForm.contact_name || null,
      title: addForm.title || null,
      email: addForm.email || null,
      phone: addForm.phone || null,
      conf_lead: addForm.conf_lead || null,
      notes: addForm.notes || null,
      source: addForm.source,
    }).select().single()
    if (data) setContacts(prev => [data, ...prev])
    setAddForm({ firm: '', firm_type: '', firm_focus: '', investment_pref: '', contact_name: '', title: '', email: '', phone: '', conf_lead: '', notes: '', source: 'equity' })
    setShowAddForm(false)
    setSavingAdd(false)
  }

  const grouped = groupByFirm(contacts)
  const equityCount = contacts.filter(c => c.source === 'equity').length
  const lenderCount = contacts.filter(c => c.source === 'lender').length

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Capital Contacts</h1>
          <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowAddForm(!showAddForm)}>
            <Plus size={13} /> Add Contact
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '20px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Equity</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>{equityCount.toLocaleString()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lenders</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>{lenderCount.toLocaleString()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Showing</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>{total.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="input"
              placeholder="Search firm, contact, type, notes…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              style={{ paddingLeft: '30px', width: '280px', fontSize: '12px' }}
            />
          </div>
          {(['all', 'equity', 'lender'] as const).map(s => (
            <button
              key={s}
              onClick={() => handleSourceFilter(s)}
              className={sourceFilter === s ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ fontSize: '11px', padding: '5px 12px' }}
            >
              {s === 'all' ? 'All' : SOURCE_LABELS[s]}
            </button>
          ))}
          <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
          <button
            onClick={() => handleStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
            className={statusFilter === 'all' ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ fontSize: '11px', padding: '5px 12px' }}
          >
            {statusFilter === 'all' ? 'All statuses' : 'Active only'}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', flexShrink: 0 }}>
          <div style={{ maxWidth: '900px' }}>
            <div className="label" style={{ marginBottom: '12px' }}>New Contact</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '10px' }}>
              <div><label className="label">Firm *</label><input className="input" value={addForm.firm} onChange={e => setAddForm(p => ({...p, firm: e.target.value}))} /></div>
              <div><label className="label">Source</label>
                <select className="select" value={addForm.source} onChange={e => setAddForm(p => ({...p, source: e.target.value}))}>
                  <option value="equity">Equity</option>
                  <option value="lender">Lender</option>
                </select>
              </div>
              <div><label className="label">Type</label><input className="input" placeholder="PE Fund, Family Office…" value={addForm.firm_type} onChange={e => setAddForm(p => ({...p, firm_type: e.target.value}))} /></div>
              <div><label className="label">Focus</label><input className="input" placeholder="Sector/strategy focus" value={addForm.firm_focus} onChange={e => setAddForm(p => ({...p, firm_focus: e.target.value}))} /></div>
              <div><label className="label">Inv. Pref / Size</label><input className="input" placeholder="$2-5M checks, $3-7M EBITDA…" value={addForm.investment_pref} onChange={e => setAddForm(p => ({...p, investment_pref: e.target.value}))} /></div>
              <div><label className="label">Contact</label><input className="input" value={addForm.contact_name} onChange={e => setAddForm(p => ({...p, contact_name: e.target.value}))} /></div>
              <div><label className="label">Title</label><input className="input" value={addForm.title} onChange={e => setAddForm(p => ({...p, title: e.target.value}))} /></div>
              <div><label className="label">Conf / Lead</label><input className="input" placeholder="KN / SS" value={addForm.conf_lead} onChange={e => setAddForm(p => ({...p, conf_lead: e.target.value}))} /></div>
              <div><label className="label">Email</label><input className="input" type="email" value={addForm.email} onChange={e => setAddForm(p => ({...p, email: e.target.value}))} /></div>
              <div><label className="label">Phone</label><input className="input" value={addForm.phone} onChange={e => setAddForm(p => ({...p, phone: e.target.value}))} /></div>
              <div style={{ gridColumn: 'span 2' }}><label className="label">Notes</label><input className="input" value={addForm.notes} onChange={e => setAddForm(p => ({...p, notes: e.target.value}))} /></div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addContact} disabled={savingAdd || !addForm.firm.trim()}>
                <Check size={13} /> {savingAdd ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1.5fr 1.5fr 1fr 1fr 80px',
        padding: '7px 28px',
        fontSize: '10px', fontWeight: 600,
        color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <div>Firm / Contact</div>
        <div>Type</div>
        <div>Focus / Pref</div>
        <div>Notes</div>
        <div>Conf / Lead</div>
        <div>Source</div>
        <div></div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px 28px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</div>
        ) : grouped.length === 0 ? (
          <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            No contacts found.
          </div>
        ) : grouped.map(({ firm, rows }) => {
          const first = rows[0]
          const isExpanded = expandedFirms.has(firm)
          const allCalls = rows.flatMap(r => r._calls ?? []).sort((a, b) => b.call_date.localeCompare(a.call_date))
          const firstNotes = rows.map(r => r.notes).filter(Boolean).join(' | ')

          return (
            <div key={firm} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {/* Firm row */}
              <div
                className="table-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1.5fr 1.5fr 1fr 1fr 80px',
                  padding: '10px 28px',
                  alignItems: 'center',
                  cursor: 'pointer',
                  background: isExpanded ? 'var(--surface-2)' : undefined,
                }}
                onClick={() => toggleFirm(firm, rows)}
              >
                {/* Firm + contacts */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isExpanded ? <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{firm}</span>
                  </div>
                  {rows.filter(r => r.contact_name).length > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', paddingLeft: '18px' }}>
                      {rows.filter(r => r.contact_name).map(r => r.contact_name).join(', ')}
                    </div>
                  )}
                </div>

                {/* Type */}
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{first.firm_type || '—'}</div>

                {/* Focus / Pref */}
                <div>
                  {first.firm_focus && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{first.firm_focus}</div>}
                  {first.investment_pref && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{first.investment_pref}</div>}
                  {!first.firm_focus && !first.investment_pref && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </div>

                {/* Notes preview */}
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }}>
                  {firstNotes || '—'}
                </div>

                {/* Conf / Lead */}
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {rows.map(r => r.conf_lead).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—'}
                </div>

                {/* Source badge */}
                <div>
                  <span className={`text-[9px] font-semibold rounded-full px-2 py-0.5 ${SOURCE_COLORS[first.source] ?? ''}`}>
                    {SOURCE_LABELS[first.source] ?? first.source}
                  </span>
                </div>

                {/* Call count */}
                <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--text-muted)' }}>
                  {allCalls.length > 0 && <span>{allCalls.length} call{allCalls.length !== 1 ? 's' : ''}</span>}
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)', padding: '16px 28px 20px 46px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '900px' }}>

                    {/* Left: contacts */}
                    <div>
                      <div className="label" style={{ marginBottom: '10px' }}>Contacts</div>
                      {rows.filter(r => r.contact_name || r.email || r.phone).map(r => (
                        <div key={r.id} style={{ marginBottom: '12px', padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                            <div>
                              {r.contact_name && <div style={{ fontWeight: 600, fontSize: '13px' }}>{r.contact_name}</div>}
                              {r.title && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{r.title}</div>}
                              <div style={{ display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
                                {r.email && (
                                  <a href={`mailto:${r.email}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>
                                    <Mail size={11} /> {r.email}
                                  </a>
                                )}
                                {r.phone && (
                                  <a href={`tel:${r.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)', textDecoration: 'none' }}>
                                    <Phone size={11} /> {r.phone}
                                  </a>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                              <select
                                value={r.status}
                                onChange={e => { e.stopPropagation(); setStatus(r.id, e.target.value) }}
                                onClick={e => e.stopPropagation()}
                                style={{ fontSize: '10px', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)', cursor: 'pointer' }}
                              >
                                <option value="active">Active</option>
                                <option value="pass">Pass</option>
                                <option value="inactive">Inactive</option>
                              </select>
                              <button
                                onClick={e => { e.stopPropagation(); setAddingCallFor(r.id); setNewCallForm(p => ({...p, summary: ''})) }}
                                style={{ fontSize: '10px', padding: '2px 8px', border: '1px dashed var(--accent)', borderRadius: '4px', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}
                              >
                                + log call
                              </button>
                            </div>
                          </div>

                          {/* Notes for this contact */}
                          {editingNote === r.id ? (
                            <div style={{ marginTop: '8px' }} onClick={e => e.stopPropagation()}>
                              <textarea
                                className="input"
                                rows={3}
                                value={noteDraft}
                                onChange={e => setNoteDraft(e.target.value)}
                                style={{ fontSize: '11px', resize: 'vertical', width: '100%' }}
                                autoFocus
                              />
                              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                <button className="btn btn-ghost" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={() => setEditingNote(null)}>Cancel</button>
                                <button className="btn btn-primary" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={() => saveNote(r.id)}>Save</button>
                              </div>
                            </div>
                          ) : r.notes ? (
                            <div
                              style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5, cursor: 'pointer', padding: '4px', borderRadius: '4px' }}
                              onClick={e => { e.stopPropagation(); setEditingNote(r.id); setNoteDraft(r.notes ?? '') }}
                              title="Click to edit"
                            >
                              {r.notes}
                            </div>
                          ) : (
                            <button
                              style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                              onClick={e => { e.stopPropagation(); setEditingNote(r.id); setNoteDraft('') }}
                            >
                              + add note
                            </button>
                          )}

                          {/* Add call form */}
                          {addingCallFor === r.id && (
                            <div style={{ marginTop: '10px', padding: '10px', background: 'var(--surface-2)', borderRadius: '6px', border: '1px solid var(--accent)' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                <div>
                                  <label className="label">Date</label>
                                  <input type="date" className="input" value={newCallForm.call_date} onChange={e => setNewCallForm(p => ({...p, call_date: e.target.value}))} style={{ fontSize: '11px' }} />
                                </div>
                                <div>
                                  <label className="label">Deal context</label>
                                  <input className="input" placeholder="DiPonio, Coggins, General…" value={newCallForm.deal_context} onChange={e => setNewCallForm(p => ({...p, deal_context: e.target.value}))} style={{ fontSize: '11px' }} />
                                </div>
                                <div style={{ gridColumn: 'span 2' }}>
                                  <label className="label">Summary *</label>
                                  <textarea className="input" rows={2} placeholder="What was discussed, outcome, next steps…" value={newCallForm.summary} onChange={e => setNewCallForm(p => ({...p, summary: e.target.value}))} style={{ fontSize: '11px', resize: 'vertical', width: '100%' }} />
                                </div>
                                <div>
                                  <label className="label">Logged by</label>
                                  <input className="input" value={newCallForm.logged_by} onChange={e => setNewCallForm(p => ({...p, logged_by: e.target.value}))} style={{ fontSize: '11px' }} />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => setAddingCallFor(null)}>Cancel</button>
                                <button className="btn btn-primary" style={{ fontSize: '11px' }} onClick={() => saveCall(r.id)} disabled={savingCall || !newCallForm.summary.trim()}>
                                  <Check size={11} /> {savingCall ? 'Saving…' : 'Save call'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Right: call log */}
                    <div>
                      <div className="label" style={{ marginBottom: '10px' }}>Call Log</div>
                      {allCalls.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No calls logged yet.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {allCalls.map(call => (
                            <div key={call.id} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>{fmtDate(call.call_date)}</span>
                                    {call.deal_context && (
                                      <span style={{ fontSize: '10px', padding: '1px 6px', background: 'var(--accent-muted)', color: 'var(--accent)', borderRadius: '4px' }}>{call.deal_context}</span>
                                    )}
                                    {call.logged_by && (
                                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>— {call.logged_by}</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{call.summary}</div>
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); deleteCall(call.id, call.contact_id) }}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }}
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Load more hint */}
        {total > PAGE && (
          <div style={{ padding: '16px 28px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
            Showing {contacts.length} of {total.toLocaleString()} — use search to narrow results
          </div>
        )}
      </div>
    </div>
  )
}
