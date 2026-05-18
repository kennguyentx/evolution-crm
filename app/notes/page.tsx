'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { Plus, Search, X, Check, Mail, MessageSquare, Edit3 } from 'lucide-react'

type Note = {
  id: string
  created_at: string
  note_date: string
  raw_text: string
  summary: string | null
  next_steps: string | null
  sentiment: string | null
  logged_by: string | null
  source: string
  deal_stage_updated: string | null
  raise_status_updated: string | null
  deal?: { company_name: string } | null
  contact?: { first_name: string; last_name: string; firm: string | null } | null
  raise?: { name: string } | null
  capital_contact?: { firm: string; contact_name: string | null } | null
}

const SENTIMENT_CONFIG: Record<string, { label: string; color: string }> = {
  interested: { label: 'Interested',  color: 'var(--green)' },
  neutral:    { label: 'Neutral',     color: 'var(--text-muted)' },
  passing:    { label: 'Passing',     color: '#f59e0b' },
  passed:     { label: 'Passed',      color: 'var(--red)' },
}

const SOURCE_ICON: Record<string, any> = {
  discord: MessageSquare,
  email:   Mail,
  manual:  Edit3,
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const PAGE = 50

export default function NotesPage() {
  const supabase = createClient()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [sentimentFilter, setSentimentFilter] = useState('all')
  const [dealFilter, setDealFilter] = useState('')
  const [deals, setDeals] = useState<{ id: string; company_name: string }[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ note_date: new Date().toISOString().split('T')[0], raw_text: '', logged_by: 'Ken' })
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const searchTimer = useRef<any>(null)

  // Fetch deals for filter dropdown
  useEffect(() => {
    supabase.from('deals').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => { if (data) setDeals(data) })
  }, [])

  const load = useCallback(async (q = search, src = sourceFilter, sent = sentimentFilter, deal = dealFilter, off = 0, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)

    let query = supabase
      .from('notes')
      .select(`
        *,
        deal:deals(company_name),
        contact:contacts(first_name, last_name, firm),
        raise:capital_raises(name),
        capital_contact:capital_contacts(firm, contact_name)
      `, { count: 'exact' })
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(off, off + PAGE - 1)

    if (q.trim()) query = query.or(`summary.ilike.%${q}%,raw_text.ilike.%${q}%,next_steps.ilike.%${q}%`)
    if (src !== 'all') query = query.eq('source', src)
    if (sent !== 'all') query = query.eq('sentiment', sent)
    if (deal) query = query.eq('deal_id', deal)

    const { data, count } = await query
    if (append) setNotes(prev => [...prev, ...(data ?? [])])
    else setNotes(data ?? [])
    setTotal(count ?? 0)
    setOffset(off + (data?.length ?? 0))
    setLoading(false)
    setLoadingMore(false)
  }, [supabase, search, sourceFilter, sentimentFilter, dealFilter])

  useEffect(() => { load() }, [])

  const handleSearch = (v: string) => {
    setSearch(v)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(v, sourceFilter, sentimentFilter, dealFilter, 0, false), 300)
  }

  const applyFilter = (src: string, sent: string, deal: string) => {
    setSourceFilter(src); setSentimentFilter(sent); setDealFilter(deal)
    load(search, src, sent, deal, 0, false)
    setOffset(0)
  }

  const addNote = async () => {
    if (!addForm.raw_text.trim()) return
    setSaving(true)
    // Simple manual note — no AI parse, just log raw
    const { data } = await supabase.from('notes').insert({
      raw_text: addForm.raw_text,
      summary: addForm.raw_text.slice(0, 300),
      logged_by: addForm.logged_by || 'Manual',
      source: 'manual',
      note_date: addForm.note_date,
    }).select(`*, deal:deals(company_name), contact:contacts(first_name, last_name, firm), raise:capital_raises(name), capital_contact:capital_contacts(firm, contact_name)`).single()
    if (data) setNotes(prev => [data, ...prev])
    setAddForm({ note_date: new Date().toISOString().split('T')[0], raw_text: '', logged_by: 'Ken' })
    setShowAddForm(false)
    setSaving(false)
  }

  const deleteNote = async (id: string) => {
    await supabase.from('notes').delete().eq('id', id)
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Notes</h1>
        <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowAddForm(!showAddForm)}>
          <Plus size={13} /> Add Note
        </button>
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
          {total.toLocaleString()} note{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', flexShrink: 0 }}>
          <div style={{ maxWidth: '700px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 120px', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={addForm.note_date} onChange={e => setAddForm(p => ({...p, note_date: e.target.value}))} />
              </div>
              <div>
                <label className="label">Notes *</label>
                <textarea className="input" rows={3} placeholder="Paste freeform notes here…" value={addForm.raw_text} onChange={e => setAddForm(p => ({...p, raw_text: e.target.value}))} style={{ resize: 'vertical', width: '100%' }} />
              </div>
              <div>
                <label className="label">Logged by</label>
                <input className="input" value={addForm.logged_by} onChange={e => setAddForm(p => ({...p, logged_by: e.target.value}))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addNote} disabled={saving || !addForm.raw_text.trim()}>
                <Check size={13} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ padding: '12px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search notes…" value={search} onChange={e => handleSearch(e.target.value)} style={{ paddingLeft: '30px', width: '240px', fontSize: '12px' }} />
        </div>

        {/* Source */}
        {(['all','discord','email','manual'] as const).map(s => (
          <button key={s} onClick={() => applyFilter(s, sentimentFilter, dealFilter)}
            className={sourceFilter === s ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ fontSize: '11px', padding: '4px 10px', textTransform: 'capitalize' }}>
            {s === 'all' ? 'All sources' : s}
          </button>
        ))}

        <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />

        {/* Sentiment */}
        <select className="select" style={{ fontSize: '11px', width: '130px' }} value={sentimentFilter}
          onChange={e => applyFilter(sourceFilter, e.target.value, dealFilter)}>
          <option value="all">All sentiment</option>
          {Object.entries(SENTIMENT_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        {/* Deal filter */}
        <select className="select" style={{ fontSize: '11px', width: '180px' }} value={dealFilter}
          onChange={e => applyFilter(sourceFilter, sentimentFilter, e.target.value)}>
          <option value="">All deals</option>
          {deals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
        </select>

        {(search || sourceFilter !== 'all' || sentimentFilter !== 'all' || dealFilter) && (
          <button className="btn btn-ghost" style={{ fontSize: '11px' }}
            onClick={() => { setSearch(''); setSentimentFilter('all'); setDealFilter(''); applyFilter('all','all','') }}>
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {/* Notes list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '40px 28px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</div>
        ) : notes.length === 0 ? (
          <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            No notes yet. Paste meeting notes in <strong>#meeting-notes</strong> on Discord, forward emails to your notes inbox, or add manually above.
          </div>
        ) : (
          <>
            {notes.map(note => {
              const SrcIcon = SOURCE_ICON[note.source] ?? Edit3
              const sent = SENTIMENT_CONFIG[note.sentiment ?? 'neutral']
              const isExpanded = expandedId === note.id
              const links = [
                note.deal?.company_name,
                note.contact ? `${note.contact.first_name} ${note.contact.last_name}` : null,
                note.raise?.name,
                note.capital_contact?.firm,
              ].filter(Boolean)

              return (
                <div key={note.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="table-row" style={{ padding: '14px 28px', display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: '16px', alignItems: 'start', cursor: 'pointer' }}
                    onClick={() => setExpandedId(isExpanded ? null : note.id)}>

                    {/* Date + source */}
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmtDate(note.note_date)}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                        <SrcIcon size={11} style={{ color: 'var(--text-muted)' }} />
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{note.source}</span>
                      </div>
                      {note.logged_by && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{note.logged_by}</div>}
                    </div>

                    {/* Summary + links */}
                    <div>
                      <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: '4px' }}>
                        {note.summary || note.raw_text.slice(0, 200)}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                        {links.map((l, i) => (
                          <span key={i} style={{ fontSize: '10px', padding: '1px 7px', background: 'var(--accent-muted)', color: 'var(--accent)', borderRadius: '4px' }}>{l}</span>
                        ))}
                        {note.deal_stage_updated && (
                          <span style={{ fontSize: '10px', padding: '1px 7px', background: 'var(--surface-2)', color: 'var(--text-muted)', borderRadius: '4px' }}>Stage → {note.deal_stage_updated}</span>
                        )}
                        {note.raise_status_updated && (
                          <span style={{ fontSize: '10px', padding: '1px 7px', background: 'var(--surface-2)', color: 'var(--text-muted)', borderRadius: '4px' }}>Status → {note.raise_status_updated}</span>
                        )}
                      </div>
                    </div>

                    {/* Sentiment + actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                      {note.sentiment && note.sentiment !== 'neutral' && (
                        <span style={{ fontSize: '10px', fontWeight: 600, color: sent.color }}>{sent.label}</span>
                      )}
                      <button onClick={e => { e.stopPropagation(); deleteNote(note.id) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', opacity: 0.5 }}>
                        <X size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded raw text + next steps */}
                  {isExpanded && (
                    <div style={{ padding: '0 28px 16px 144px', background: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)' }}>
                      {note.next_steps && (
                        <div style={{ marginTop: '12px' }}>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Next Steps</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{note.next_steps}</div>
                        </div>
                      )}
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Raw Notes</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px' }}>
                          {note.raw_text}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Load more */}
            {notes.length < total && (
              <div style={{ padding: '20px 28px', textAlign: 'center' }}>
                <button className="btn btn-ghost" style={{ fontSize: '12px' }}
                  onClick={() => load(search, sourceFilter, sentimentFilter, dealFilter, offset, true)}
                  disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Load more (${notes.length} of ${total.toLocaleString()})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
