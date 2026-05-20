'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { Plus, Search, X, Check, Mail, MessageSquare, Edit3, Pencil, UserPlus } from 'lucide-react'
import { useIsMobile } from '@/hooks/useIsMobile'

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
  deal_id: string | null
  contact_id: string | null
  capital_contact_id: string | null
  deal_stage_updated: string | null
  raise_status_updated: string | null
  deal?: { company_name: string } | null
  contact?: { first_name: string; last_name: string; firm: string | null } | null
  raise?: { name: string } | null
  capital_contact?: { firm: string; contact_name: string | null } | null
}

type UnknownName = {
  first: string; last: string; dismissed: boolean
  showForm: boolean; form: { firm: string; title: string; contact_type: string }
  adding: boolean; addedId: string | null
}

// Common capitalized two-word phrases that are NOT person names
const NAME_BLOCKLIST = new Set([
  'New York','Los Angeles','San Francisco','North Carolina','South Carolina','North America',
  'South America','East Coast','West Coast','United States','Good Morning','Good Afternoon',
  'Good Evening','Dear Ken','Dear Sir','Per Our','Per The','As Discussed','This Week',
  'Last Week','Next Week','This Month','Last Month','Next Month','Monday Tuesday',
  'Tuesday Wednesday','Wednesday Thursday','Thursday Friday','Friday Saturday',
  'Best Regards','Kind Regards','Looking Forward','Follow Up','Follow Up',
])

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
  const isMobile = useIsMobile()
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
  const [addForm, setAddForm] = useState({ note_date: new Date().toISOString().split('T')[0], raw_text: '', logged_by: 'Ken', deal_id: '', contact_id: '', contact_label: '', capital_contact_id: '', capital_contact_label: '' })
  const [addContactSearch, setAddContactSearch] = useState('')
  const [addContactResults, setAddContactResults] = useState<any[]>([])
  const [addCapContactSearch, setAddCapContactSearch] = useState('')
  const [addCapContactResults, setAddCapContactResults] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ note_date: string; raw_text: string; summary: string; next_steps: string; logged_by: string; deal_id: string; contact_id: string; contact_label: string; capital_contact_id: string; capital_contact_label: string }>({ note_date: '', raw_text: '', summary: '', next_steps: '', logged_by: '', deal_id: '', contact_id: '', contact_label: '', capital_contact_id: '', capital_contact_label: '' })
  const [editContactSearch, setEditContactSearch] = useState('')
  const [editContactResults, setEditContactResults] = useState<any[]>([])
  const [editCapContactSearch, setEditCapContactSearch] = useState('')
  const [editCapContactResults, setEditCapContactResults] = useState<any[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [detectedContacts, setDetectedContacts] = useState<{ item: any; accepted: boolean }[]>([])
  const [detectedDeals, setDetectedDeals] = useState<{ item: any; accepted: boolean }[]>([])
  const [editDetectedContacts, setEditDetectedContacts] = useState<{ item: any; accepted: boolean }[]>([])
  const [editDetectedDeals, setEditDetectedDeals] = useState<{ item: any; accepted: boolean }[]>([])
  const [unknownNames, setUnknownNames] = useState<UnknownName[]>([])
  const [editUnknownNames, setEditUnknownNames] = useState<UnknownName[]>([])
  const detectTimer = useRef<any>(null)
  const editDetectTimer = useRef<any>(null)
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

  const detectMentions = useCallback(async (text: string) => {
    if (!text.trim()) { setDetectedContacts([]); setDetectedDeals([]); setUnknownNames([]); return }

    // Strip email header lines (From/To/Cc/Subject/Date/Files) before scanning —
    // subject lines like "FW: Acquisition Opportunity — Media Relations..." produce
    // false contact matches like "Media Relations" or "Growth Files"
    const scanText = text
      .split('\n')
      .filter(l => !/^(from|to|cc|subject|date|files|forwarded via email|sent):/i.test(l.trim()))
      .join('\n')

    const lower = scanText.toLowerCase()

    // Extract capitalized "FirstName LastName" pairs — more reliable than word-by-word
    const nameRx = /\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b/g
    const candidates: { first: string; last: string; key: string }[] = []
    const seenKeys = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = nameRx.exec(scanText)) !== null) {
      const key = `${m[1]} ${m[2]}`
      if (!NAME_BLOCKLIST.has(key) && !seenKeys.has(key)) {
        candidates.push({ first: m[1], last: m[2], key })
        seenKeys.add(key)
      }
    }

    const foundContacts: { item: any; accepted: boolean }[] = []
    const foundContactIds = new Set<string>()
    const newUnknown: { first: string; last: string }[] = []

    for (const pair of candidates.slice(0, 12)) {
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, firm, contact_type')
        .ilike('first_name', pair.first)
        .ilike('last_name', pair.last)
        .limit(1)
      if (data?.[0] && !foundContactIds.has(data[0].id)) {
        foundContacts.push({ item: data[0], accepted: true })
        foundContactIds.add(data[0].id)
      } else if (!data?.[0]) {
        newUnknown.push({ first: pair.first, last: pair.last })
      }
    }

    setDetectedContacts(foundContacts)
    if (foundContacts[0]) setAddForm(p => ({ ...p, contact_id: foundContacts[0].item.id, contact_label: `${foundContacts[0].item.first_name} ${foundContacts[0].item.last_name}${foundContacts[0].item.firm ? ` · ${foundContacts[0].item.firm}` : ''}` }))

    // Preserve dismissed / added state for names already shown
    setUnknownNames(prev => newUnknown.map(n => {
      const existing = prev.find(u => u.first === n.first && u.last === n.last)
      return existing ?? { first: n.first, last: n.last, dismissed: false, showForm: false, form: { firm: '', title: '', contact_type: 'other' }, adding: false, addedId: null }
    }))

    const foundDeals: { item: any; accepted: boolean }[] = []
    const foundDealIds = new Set<string>()
    for (const deal of deals) {
      if (deal.company_name.length > 3 && lower.includes(deal.company_name.toLowerCase()) && !foundDealIds.has(deal.id)) {
        foundDeals.push({ item: deal, accepted: true })
        foundDealIds.add(deal.id)
      }
    }
    setDetectedDeals(foundDeals)
    if (foundDeals[0]) setAddForm(p => ({ ...p, deal_id: foundDeals[0].item.id }))
  }, [supabase, deals])

  const handleRawTextChange = (text: string) => {
    setAddForm(p => ({ ...p, raw_text: text }))
    if (detectTimer.current) clearTimeout(detectTimer.current)
    detectTimer.current = setTimeout(() => detectMentions(text), 600)
  }

  const detectEditMentions = useCallback(async (text: string) => {
    if (!text.trim()) { setEditDetectedContacts([]); setEditDetectedDeals([]); setEditUnknownNames([]); return }

    const scanText = text
      .split('\n')
      .filter(l => !/^(from|to|cc|subject|date|files|forwarded via email|sent):/i.test(l.trim()))
      .join('\n')

    const lower = scanText.toLowerCase()

    const nameRx = /\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b/g
    const candidates: { first: string; last: string; key: string }[] = []
    const seenKeys = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = nameRx.exec(scanText)) !== null) {
      const key = `${m[1]} ${m[2]}`
      if (!NAME_BLOCKLIST.has(key) && !seenKeys.has(key)) {
        candidates.push({ first: m[1], last: m[2], key })
        seenKeys.add(key)
      }
    }

    const foundContacts: { item: any; accepted: boolean }[] = []
    const foundContactIds = new Set<string>()
    const newUnknown: { first: string; last: string }[] = []

    for (const pair of candidates.slice(0, 12)) {
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, firm, contact_type')
        .ilike('first_name', pair.first)
        .ilike('last_name', pair.last)
        .limit(1)
      if (data?.[0] && !foundContactIds.has(data[0].id)) {
        foundContacts.push({ item: data[0], accepted: true })
        foundContactIds.add(data[0].id)
      } else if (!data?.[0]) {
        newUnknown.push({ first: pair.first, last: pair.last })
      }
    }

    setEditDetectedContacts(foundContacts)
    if (foundContacts[0]) setEditForm(p => ({ ...p, contact_id: foundContacts[0].item.id, contact_label: `${foundContacts[0].item.first_name} ${foundContacts[0].item.last_name}${foundContacts[0].item.firm ? ` · ${foundContacts[0].item.firm}` : ''}` }))

    setEditUnknownNames(prev => newUnknown.map(n => {
      const existing = prev.find(u => u.first === n.first && u.last === n.last)
      return existing ?? { first: n.first, last: n.last, dismissed: false, showForm: false, form: { firm: '', title: '', contact_type: 'other' }, adding: false, addedId: null }
    }))

    const foundDeals: { item: any; accepted: boolean }[] = []
    const foundDealIds = new Set<string>()
    for (const deal of deals) {
      if (deal.company_name.length > 3 && lower.includes(deal.company_name.toLowerCase()) && !foundDealIds.has(deal.id)) {
        foundDeals.push({ item: deal, accepted: true })
        foundDealIds.add(deal.id)
      }
    }
    setEditDetectedDeals(foundDeals)
    if (foundDeals[0]) setEditForm(p => ({ ...p, deal_id: foundDeals[0].item.id }))
  }, [supabase, deals])

  const handleEditRawTextChange = (text: string) => {
    setEditForm(p => ({ ...p, raw_text: text }))
    if (editDetectTimer.current) clearTimeout(editDetectTimer.current)
    editDetectTimer.current = setTimeout(() => detectEditMentions(text), 600)
  }

  const searchContacts = async (q: string, setter: (r: any[]) => void) => {
    if (!q.trim()) { setter([]); return }
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, firm')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`)
      .limit(6)
    setter(data ?? [])
  }

  const searchCapContacts = async (q: string, setter: (r: any[]) => void) => {
    if (!q.trim()) { setter([]); return }
    const { data } = await supabase
      .from('capital_contacts')
      .select('id, firm, contact_name')
      .or(`firm.ilike.%${q}%,contact_name.ilike.%${q}%`)
      .limit(6)
    setter(data ?? [])
  }

  const addNewContactFromNote = async (idx: number) => {
    const u = unknownNames[idx]
    setUnknownNames(prev => prev.map((x, i) => i === idx ? { ...x, adding: true } : x))
    const { data } = await supabase.from('contacts').insert({
      first_name: u.first, last_name: u.last,
      firm: u.form.firm || null, title: u.form.title || null,
      contact_type: u.form.contact_type || 'other',
    }).select().single()
    if (data) {
      setUnknownNames(prev => prev.map((x, i) => i === idx ? { ...x, adding: false, addedId: data.id, showForm: false } : x))
      // Auto-link to note if no contact linked yet
      setAddForm(p => p.contact_id ? p : { ...p, contact_id: data.id, contact_label: `${data.first_name} ${data.last_name}${data.firm ? ` · ${data.firm}` : ''}` })
    } else {
      setUnknownNames(prev => prev.map((x, i) => i === idx ? { ...x, adding: false } : x))
    }
  }

  const addNewContactFromEdit = async (idx: number) => {
    const u = editUnknownNames[idx]
    setEditUnknownNames(prev => prev.map((x, i) => i === idx ? { ...x, adding: true } : x))
    const { data } = await supabase.from('contacts').insert({
      first_name: u.first, last_name: u.last,
      firm: u.form.firm || null, title: u.form.title || null,
      contact_type: u.form.contact_type || 'other',
    }).select().single()
    if (data) {
      setEditUnknownNames(prev => prev.map((x, i) => i === idx ? { ...x, adding: false, addedId: data.id, showForm: false } : x))
      setEditForm(p => p.contact_id ? p : { ...p, contact_id: data.id, contact_label: `${data.first_name} ${data.last_name}${data.firm ? ` · ${data.firm}` : ''}` })
    } else {
      setEditUnknownNames(prev => prev.map((x, i) => i === idx ? { ...x, adding: false } : x))
    }
  }

  const addNote = async () => {
    if (!addForm.raw_text.trim()) return
    setSaving(true)
    const payload: any = {
      raw_text: addForm.raw_text,
      summary: addForm.raw_text.slice(0, 300),
      logged_by: addForm.logged_by || 'Manual',
      source: 'manual',
      note_date: addForm.note_date,
    }
    if (addForm.deal_id) payload.deal_id = addForm.deal_id
    if (addForm.contact_id) payload.contact_id = addForm.contact_id
    if (addForm.capital_contact_id) payload.capital_contact_id = addForm.capital_contact_id
    const { data } = await supabase.from('notes').insert(payload)
      .select(`*, deal:deals(company_name), contact:contacts(first_name, last_name, firm), raise:capital_raises(name), capital_contact:capital_contacts(firm, contact_name)`).single()
    if (data) setNotes(prev => [data, ...prev])
    setAddForm({ note_date: new Date().toISOString().split('T')[0], raw_text: '', logged_by: 'Ken', deal_id: '', contact_id: '', contact_label: '', capital_contact_id: '', capital_contact_label: '' })
    setAddContactSearch('')
    setAddContactResults([])
    setAddCapContactSearch('')
    setAddCapContactResults([])
    setDetectedContacts([])
    setDetectedDeals([])
    setUnknownNames([])
    setShowAddForm(false)
    setSaving(false)
  }

  const deleteNote = async (id: string) => {
    await supabase.from('notes').delete().eq('id', id)
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  const startEdit = (note: Note) => {
    setEditingNoteId(note.id)
    setEditForm({
      note_date: note.note_date,
      raw_text: note.raw_text,
      summary: note.summary ?? '',
      next_steps: note.next_steps ?? '',
      logged_by: note.logged_by ?? '',
      deal_id: note.deal_id ?? '',
      contact_id: note.contact_id ?? '',
      contact_label: note.contact ? `${note.contact.first_name} ${note.contact.last_name}${note.contact.firm ? ` · ${note.contact.firm}` : ''}` : '',
      capital_contact_id: (note as any).capital_contact_id ?? '',
      capital_contact_label: note.capital_contact ? `${note.capital_contact.firm}${note.capital_contact.contact_name ? ` · ${note.capital_contact.contact_name}` : ''}` : '',
    })
    setEditContactSearch('')
    setEditContactResults([])
    setEditCapContactSearch('')
    setEditCapContactResults([])
    setEditError(null)
    setExpandedId(note.id)
    setEditDetectedContacts(note.contact && note.contact_id ? [{ item: { id: note.contact_id, first_name: note.contact.first_name, last_name: note.contact.last_name, firm: note.contact.firm }, accepted: true }] : [])
    setEditDetectedDeals(note.deal && note.deal_id ? [{ item: { id: note.deal_id, company_name: note.deal.company_name }, accepted: true }] : [])
    setTimeout(() => detectEditMentions(note.raw_text), 0)
  }

  const saveEdit = async () => {
    if (!editingNoteId) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch('/api/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingNoteId,
          note_date: editForm.note_date,
          raw_text: editForm.raw_text,
          summary: editForm.summary || null,
          next_steps: editForm.next_steps || null,
          logged_by: editForm.logged_by || null,
          deal_id: editForm.deal_id || null,
          contact_id: editForm.contact_id || null,
          capital_contact_id: editForm.capital_contact_id || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setNotes(prev => prev.map(n => n.id === editingNoteId ? json : n))
      setEditingNoteId(null)
      setEditDetectedContacts([])
      setEditDetectedDeals([])
      setEditUnknownNames([])
    } catch (err: any) {
      setEditError(err.message)
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ padding: isMobile ? '14px 16px' : '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '16px' }}>
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
          <div style={{ maxWidth: '760px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 120px', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={addForm.note_date} onChange={e => setAddForm(p => ({...p, note_date: e.target.value}))} />
              </div>
              <div>
                <label className="label">Notes *</label>
                <textarea className="input" rows={3} placeholder="Paste freeform notes here…" value={addForm.raw_text} onChange={e => handleRawTextChange(e.target.value)} style={{ resize: 'vertical', width: '100%' }} />
                {(detectedContacts.length > 0 || detectedDeals.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Detected:</span>
                    {detectedDeals.map(({ item: d }) => (
                      <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 6px 2px 8px', borderRadius: '999px', background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                        {d.company_name}
                        <button onClick={() => { setDetectedDeals(p => p.filter(x => x.item.id !== d.id)); setAddForm(p => ({ ...p, deal_id: '' })) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', lineHeight: 1, color: 'var(--accent)' }} title="Remove"><X size={10} /></button>
                      </span>
                    ))}
                    {detectedContacts.map(({ item: c }) => (
                      <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 6px 2px 8px', borderRadius: '999px', background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontWeight: 500 }}>
                        {c.first_name} {c.last_name}{c.firm ? ` · ${c.firm}` : ''}
                        <button onClick={() => { setDetectedContacts(p => p.filter(x => x.item.id !== c.id)); setAddForm(p => ({ ...p, contact_id: '', contact_label: '' })) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', lineHeight: 1, color: 'var(--text-muted)' }} title="Remove"><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                )}
                {/* Unknown names — prompt to add as new contact */}
                {unknownNames.filter(u => !u.dismissed && !u.addedId).map((u, idx) => (
                  <div key={`${u.first}-${u.last}`} style={{ marginTop: '8px', padding: '8px 10px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '7px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <UserPlus size={12} style={{ color: '#b45309', flexShrink: 0 }} />
                      <span style={{ fontSize: '12px', color: '#b45309', flex: 1 }}><strong>{u.first} {u.last}</strong> isn't in your contacts yet</span>
                      <button onClick={() => setUnknownNames(p => p.map((x, i) => i === idx ? { ...x, showForm: !x.showForm } : x))}
                        style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.4)', background: 'transparent', color: '#b45309', cursor: 'pointer' }}>
                        {u.showForm ? 'Cancel' : 'Add contact'}
                      </button>
                      <button onClick={() => setUnknownNames(p => p.map((x, i) => i === idx ? { ...x, dismissed: true } : x))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', padding: '2px' }}><X size={11} /></button>
                    </div>
                    {u.showForm && (
                      <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '6px', alignItems: 'end' }}>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px' }}>Firm</div>
                          <input className="input" style={{ fontSize: '11px' }} placeholder="e.g. Sunbelt Advisors" value={u.form.firm}
                            onChange={e => setUnknownNames(p => p.map((x, i) => i === idx ? { ...x, form: { ...x.form, firm: e.target.value } } : x))} />
                        </div>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px' }}>Title</div>
                          <input className="input" style={{ fontSize: '11px' }} placeholder="e.g. Managing Director" value={u.form.title}
                            onChange={e => setUnknownNames(p => p.map((x, i) => i === idx ? { ...x, form: { ...x.form, title: e.target.value } } : x))} />
                        </div>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px' }}>Type</div>
                          <select className="select" style={{ fontSize: '11px', width: '100%' }} value={u.form.contact_type}
                            onChange={e => setUnknownNames(p => p.map((x, i) => i === idx ? { ...x, form: { ...x.form, contact_type: e.target.value } } : x))}>
                            <option value="banker">Banker</option>
                            <option value="management">Management</option>
                            <option value="lender">Lender</option>
                            <option value="advisor">Advisor</option>
                            <option value="lp">LP</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <button className="btn btn-primary" style={{ fontSize: '11px' }} onClick={() => addNewContactFromNote(idx)} disabled={u.adding}>
                          {u.adding ? 'Adding…' : 'Add & Link'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {unknownNames.filter(u => u.addedId).map(u => (
                  <div key={`added-${u.first}-${u.last}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '11px', color: 'var(--green)' }}>
                    <Check size={11} /> <strong>{u.first} {u.last}</strong> added to contacts
                  </div>
                ))}
              </div>
              <div>
                <label className="label">Logged by</label>
                <input className="input" value={addForm.logged_by} onChange={e => setAddForm(p => ({...p, logged_by: e.target.value}))} />
              </div>
            </div>
            {/* Link row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="label">Link to Deal</label>
                <select className="select" style={{ width: '100%', fontSize: '12px' }} value={addForm.deal_id} onChange={e => setAddForm(p => ({ ...p, deal_id: e.target.value }))}>
                  <option value="">— none —</option>
                  {deals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
                </select>
              </div>
              <div style={{ position: 'relative' }}>
                <label className="label">Link to Contact</label>
                {addForm.contact_id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-primary)', flex: 1 }}>{addForm.contact_label}</span>
                    <button onClick={() => { setAddForm(p => ({ ...p, contact_id: '', contact_label: '' })); setAddContactSearch(''); setAddContactResults([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={12} /></button>
                  </div>
                ) : (
                  <>
                    <input className="input" style={{ fontSize: '12px' }} placeholder="Search by name or firm…" value={addContactSearch} onChange={e => { setAddContactSearch(e.target.value); searchContacts(e.target.value, setAddContactResults) }} />
                    {addContactResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                        {addContactResults.map(c => (
                          <div key={c.id} onClick={() => { setAddForm(p => ({ ...p, contact_id: c.id, contact_label: `${c.first_name} ${c.last_name}${c.firm ? ` · ${c.firm}` : ''}` })); setAddContactSearch(''); setAddContactResults([]) }} style={{ padding: '8px 12px', fontSize: '12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }} className="table-row">
                            <span style={{ fontWeight: 500 }}>{c.first_name} {c.last_name}</span>{c.firm && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{c.firm}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <label className="label">Link to Capital Contact</label>
                {addForm.capital_contact_id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-primary)', flex: 1 }}>{addForm.capital_contact_label}</span>
                    <button onClick={() => { setAddForm(p => ({ ...p, capital_contact_id: '', capital_contact_label: '' })); setAddCapContactSearch(''); setAddCapContactResults([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={12} /></button>
                  </div>
                ) : (
                  <>
                    <input className="input" style={{ fontSize: '12px' }} placeholder="Search firm or contact…" value={addCapContactSearch} onChange={e => { setAddCapContactSearch(e.target.value); searchCapContacts(e.target.value, setAddCapContactResults) }} />
                    {addCapContactResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                        {addCapContactResults.map(c => (
                          <div key={c.id} onClick={() => { setAddForm(p => ({ ...p, capital_contact_id: c.id, capital_contact_label: `${c.firm}${c.contact_name ? ` · ${c.contact_name}` : ''}` })); setAddCapContactSearch(''); setAddCapContactResults([]) }} style={{ padding: '8px 12px', fontSize: '12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }} className="table-row">
                            <span style={{ fontWeight: 500 }}>{c.firm}</span>{c.contact_name && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{c.contact_name}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-ghost" onClick={() => { setShowAddForm(false); setDetectedContacts([]); setDetectedDeals([]); setUnknownNames([]); setAddContactSearch(''); setAddContactResults([]); setAddCapContactSearch(''); setAddCapContactResults([]) }}>Cancel</button>
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
                  <div className="table-row" style={{ padding: isMobile ? '12px 16px' : '14px 28px', display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : '100px 1fr auto', gap: '12px', alignItems: 'start', cursor: 'pointer' }}
                    onClick={() => setExpandedId(isExpanded ? null : note.id)}>

                    {/* Date + source — hidden on mobile (shown below summary instead) */}
                    {!isMobile && (
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmtDate(note.note_date)}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                          <SrcIcon size={11} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{note.source}</span>
                        </div>
                        {note.logged_by && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{note.logged_by}</div>}
                      </div>
                    )}

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
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={e => { e.stopPropagation(); startEdit(note) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', opacity: 0.5 }}>
                          <Pencil size={12} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); deleteNote(note.id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', opacity: 0.5 }}>
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded section */}
                  {isExpanded && (
                    <div style={{ padding: '0 28px 16px 144px', background: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)' }}>
                      {editingNoteId === note.id ? (
                        <div style={{ marginTop: '12px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '10px', marginBottom: '10px' }}>
                            <div>
                              <label className="label">Date</label>
                              <input type="date" className="input" value={editForm.note_date} onChange={e => setEditForm(p => ({...p, note_date: e.target.value}))} />
                            </div>
                            <div>
                              <label className="label">Logged by</label>
                              <input className="input" value={editForm.logged_by} onChange={e => setEditForm(p => ({...p, logged_by: e.target.value}))} />
                            </div>
                          </div>
                          <div style={{ marginBottom: '10px' }}>
                            <label className="label">Summary</label>
                            <textarea className="input" rows={2} value={editForm.summary} onChange={e => setEditForm(p => ({...p, summary: e.target.value}))} style={{ resize: 'vertical', width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: '10px' }}>
                            <label className="label">Next Steps</label>
                            <textarea className="input" rows={2} value={editForm.next_steps} onChange={e => setEditForm(p => ({...p, next_steps: e.target.value}))} style={{ resize: 'vertical', width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: '10px' }}>
                            <label className="label">Raw Notes</label>
                            <textarea className="input" rows={4} value={editForm.raw_text} onChange={e => handleEditRawTextChange(e.target.value)} style={{ resize: 'vertical', width: '100%' }} />
                            {(editDetectedContacts.length > 0 || editDetectedDeals.length > 0) && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Detected:</span>
                                {editDetectedDeals.map(({ item: d }) => (
                                  <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 6px 2px 8px', borderRadius: '999px', background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                                    {d.company_name}
                                    <button onClick={() => { setEditDetectedDeals(p => p.filter(x => x.item.id !== d.id)); setEditForm(p => ({ ...p, deal_id: '' })) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', lineHeight: 1, color: 'var(--accent)' }} title="Remove"><X size={10} /></button>
                                  </span>
                                ))}
                                {editDetectedContacts.map(({ item: c }) => (
                                  <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 6px 2px 8px', borderRadius: '999px', background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontWeight: 500 }}>
                                    {c.first_name} {c.last_name}{c.firm ? ` · ${c.firm}` : ''}
                                    <button onClick={() => { setEditDetectedContacts(p => p.filter(x => x.item.id !== c.id)); setEditForm(p => ({ ...p, contact_id: '', contact_label: '' })) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', lineHeight: 1, color: 'var(--text-muted)' }} title="Remove"><X size={10} /></button>
                                  </span>
                                ))}
                              </div>
                            )}
                            {editUnknownNames.filter(u => !u.dismissed && !u.addedId).map((u, idx) => (
                              <div key={`${u.first}-${u.last}`} style={{ marginTop: '8px', padding: '8px 10px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '7px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <UserPlus size={12} style={{ color: '#b45309', flexShrink: 0 }} />
                                  <span style={{ fontSize: '12px', color: '#b45309', flex: 1 }}><strong>{u.first} {u.last}</strong> isn't in your contacts yet</span>
                                  <button onClick={() => setEditUnknownNames(p => p.map((x, i) => i === idx ? { ...x, showForm: !x.showForm } : x))}
                                    style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.4)', background: 'transparent', color: '#b45309', cursor: 'pointer' }}>
                                    {u.showForm ? 'Cancel' : 'Add contact'}
                                  </button>
                                  <button onClick={() => setEditUnknownNames(p => p.map((x, i) => i === idx ? { ...x, dismissed: true } : x))}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', padding: '2px' }}><X size={11} /></button>
                                </div>
                                {u.showForm && (
                                  <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '6px', alignItems: 'end' }}>
                                    <div>
                                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px' }}>Firm</div>
                                      <input className="input" style={{ fontSize: '11px' }} placeholder="e.g. Sunbelt Advisors" value={u.form.firm}
                                        onChange={e => setEditUnknownNames(p => p.map((x, i) => i === idx ? { ...x, form: { ...x.form, firm: e.target.value } } : x))} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px' }}>Title</div>
                                      <input className="input" style={{ fontSize: '11px' }} placeholder="e.g. Managing Director" value={u.form.title}
                                        onChange={e => setEditUnknownNames(p => p.map((x, i) => i === idx ? { ...x, form: { ...x.form, title: e.target.value } } : x))} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px' }}>Type</div>
                                      <select className="select" style={{ fontSize: '11px', width: '100%' }} value={u.form.contact_type}
                                        onChange={e => setEditUnknownNames(p => p.map((x, i) => i === idx ? { ...x, form: { ...x.form, contact_type: e.target.value } } : x))}>
                                        <option value="banker">Banker</option>
                                        <option value="management">Management</option>
                                        <option value="lender">Lender</option>
                                        <option value="advisor">Advisor</option>
                                        <option value="lp">LP</option>
                                        <option value="other">Other</option>
                                      </select>
                                    </div>
                                    <button className="btn btn-primary" style={{ fontSize: '11px' }} onClick={() => addNewContactFromEdit(idx)} disabled={u.adding}>
                                      {u.adding ? 'Adding…' : 'Add & Link'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                            {editUnknownNames.filter(u => u.addedId).map(u => (
                              <div key={`added-${u.first}-${u.last}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '11px', color: 'var(--green)' }}>
                                <Check size={11} /> <strong>{u.first} {u.last}</strong> added to contacts
                              </div>
                            ))}
                          </div>
                          {/* Link row */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                            <div>
                              <label className="label">Link to Deal</label>
                              <select className="select" style={{ width: '100%', fontSize: '12px' }} value={editForm.deal_id} onChange={e => setEditForm(p => ({ ...p, deal_id: e.target.value }))}>
                                <option value="">— none —</option>
                                {deals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
                              </select>
                            </div>
                            <div style={{ position: 'relative' }}>
                              <label className="label">Link to Contact</label>
                              {editForm.contact_id ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '12px', color: 'var(--text-primary)', flex: 1 }}>{editForm.contact_label}</span>
                                  <button onClick={() => { setEditForm(p => ({ ...p, contact_id: '', contact_label: '' })); setEditContactSearch(''); setEditContactResults([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={12} /></button>
                                </div>
                              ) : (
                                <>
                                  <input className="input" style={{ fontSize: '12px' }} placeholder="Search by name or firm…" value={editContactSearch} onChange={e => { setEditContactSearch(e.target.value); searchContacts(e.target.value, setEditContactResults) }} />
                                  {editContactResults.length > 0 && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                      {editContactResults.map(c => (
                                        <div key={c.id} onClick={() => { setEditForm(p => ({ ...p, contact_id: c.id, contact_label: `${c.first_name} ${c.last_name}${c.firm ? ` · ${c.firm}` : ''}` })); setEditContactSearch(''); setEditContactResults([]) }} style={{ padding: '8px 12px', fontSize: '12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }} className="table-row">
                                          <span style={{ fontWeight: 500 }}>{c.first_name} {c.last_name}</span>{c.firm && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{c.firm}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            <div style={{ position: 'relative' }}>
                              <label className="label">Link to Capital Contact</label>
                              {editForm.capital_contact_id ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '12px', color: 'var(--text-primary)', flex: 1 }}>{editForm.capital_contact_label}</span>
                                  <button onClick={() => { setEditForm(p => ({ ...p, capital_contact_id: '', capital_contact_label: '' })); setEditCapContactSearch(''); setEditCapContactResults([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={12} /></button>
                                </div>
                              ) : (
                                <>
                                  <input className="input" style={{ fontSize: '12px' }} placeholder="Search firm or contact…" value={editCapContactSearch} onChange={e => { setEditCapContactSearch(e.target.value); searchCapContacts(e.target.value, setEditCapContactResults) }} />
                                  {editCapContactResults.length > 0 && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                      {editCapContactResults.map(c => (
                                        <div key={c.id} onClick={() => { setEditForm(p => ({ ...p, capital_contact_id: c.id, capital_contact_label: `${c.firm}${c.contact_name ? ` · ${c.contact_name}` : ''}` })); setEditCapContactSearch(''); setEditCapContactResults([]) }} style={{ padding: '8px 12px', fontSize: '12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }} className="table-row">
                                          <span style={{ fontWeight: 500 }}>{c.firm}</span>{c.contact_name && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{c.contact_name}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {editError && <div style={{ fontSize: '11px', color: 'var(--red)', marginBottom: '8px' }}>{editError}</div>}
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => { setEditingNoteId(null); setEditDetectedContacts([]); setEditDetectedDeals([]); setEditUnknownNames([]); setEditContactSearch(''); setEditContactResults([]) }}>Cancel</button>
                            <button className="btn btn-primary" style={{ fontSize: '11px' }} onClick={saveEdit} disabled={editSaving}>
                              <Check size={12} /> {editSaving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
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
                        </>
                      )}
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
