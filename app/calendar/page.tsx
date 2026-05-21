'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useIsMobile } from '@/hooks/useIsMobile'

type CalEvent = {
  id: string
  title: string
  event_date: string
  start_time: string | null
  end_time: string | null
  event_type: string
  description: string | null
  deal_id: string | null
  contact_id: string | null
  portfolio_company_id: string | null
  deal?: any
  contact?: any
  portfolio_company?: any
}

const EVENT_TYPES = ['meeting', 'call', 'deadline', 'reminder', 'site visit', 'other']
const TYPE_COLORS: Record<string, string> = {
  meeting: '#7c3aed',
  call: '#2563eb',
  deadline: '#dc2626',
  reminder: '#d97706',
  'site visit': '#059669',
  other: '#6b7280',
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

const emptyForm = () => ({
  title: '', event_date: '', start_time: '', end_time: '',
  event_type: 'meeting', description: '',
  deal_id: '', deal_label: '',
  contact_id: '', contact_label: '',
  portfolio_company_id: '', portfolio_label: '',
})

export default function CalendarPage() {
  const supabase = createClient()
  const isMobile = useIsMobile()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [dealSearch, setDealSearch] = useState('')
  const [dealResults, setDealResults] = useState<any[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
  const [portfolioCompanies, setPortfolioCompanies] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const dealTimer = useRef<any>(null)
  const contactTimer = useRef<any>(null)

  useEffect(() => {
    supabase.from('portfolio_companies').select('id, name').eq('status', 'Active').order('name')
      .then(({ data }) => setPortfolioCompanies(data ?? []))
  }, [])

  // Close event form on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowForm(false)
        setEditingEvent(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const loadEvents = async (y = year, m = month) => {
    setLoading(true)
    const pad = (n: number) => String(n).padStart(2, '0')
    const first = `${y}-${pad(m + 1)}-01`
    const last = `${y}-${pad(m + 1)}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`
    const { data } = await supabase.from('calendar_events')
      .select('*, deal:deals(company_name), contact:contacts(first_name, last_name), portfolio_company:portfolio_companies(name)')
      .gte('event_date', first).lte('event_date', last)
      .order('start_time', { ascending: true, nullsFirst: false })
    setEvents(data ?? [])
    setLoading(false)
  }

  useEffect(() => { loadEvents() }, [year, month])

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const firstDayOfMonth = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDayOfMonth).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = (day: number) => `${year}-${pad(month + 1)}-${pad(day)}`
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const eventsOnDay = (day: number) => events.filter(e => e.event_date === dateStr(day))

  const openAdd = (day: number) => {
    setEditingEvent(null)
    setForm({ ...emptyForm(), event_date: dateStr(day) })
    setDealSearch(''); setContactSearch(''); setDealResults([]); setContactResults([])
    setShowForm(true)
  }

  const openEdit = (ev: CalEvent) => {
    setEditingEvent(ev)
    const deal = unwrap(ev.deal)
    const contact = unwrap(ev.contact)
    const pc = unwrap(ev.portfolio_company)
    setForm({
      title: ev.title, event_date: ev.event_date,
      start_time: ev.start_time ?? '', end_time: ev.end_time ?? '',
      event_type: ev.event_type, description: ev.description ?? '',
      deal_id: ev.deal_id ?? '', deal_label: deal?.company_name ?? '',
      contact_id: ev.contact_id ?? '', contact_label: contact ? `${contact.first_name} ${contact.last_name}` : '',
      portfolio_company_id: ev.portfolio_company_id ?? '', portfolio_label: pc?.name ?? '',
    })
    setDealSearch(''); setContactSearch(''); setDealResults([]); setContactResults([])
    setShowForm(true)
  }

  const searchDeals = (q: string) => {
    setDealSearch(q); clearTimeout(dealTimer.current)
    if (!q.trim()) { setDealResults([]); return }
    dealTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('deals').select('id, company_name').ilike('company_name', `%${q}%`).limit(6)
      setDealResults(data ?? [])
    }, 250)
  }

  const searchContacts = (q: string) => {
    setContactSearch(q); clearTimeout(contactTimer.current)
    if (!q.trim()) { setContactResults([]); return }
    contactTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('contacts').select('id, first_name, last_name, firm').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(6)
      setContactResults(data ?? [])
    }, 250)
  }

  const save = async () => {
    if (!form.title.trim() || !form.event_date) return
    setSaving(true)
    const payload: any = {
      title: form.title, event_date: form.event_date,
      start_time: form.start_time || null, end_time: form.end_time || null,
      event_type: form.event_type, description: form.description || null,
      deal_id: form.deal_id || null, contact_id: form.contact_id || null,
      portfolio_company_id: form.portfolio_company_id || null,
    }
    if (editingEvent) await supabase.from('calendar_events').update(payload).eq('id', editingEvent.id)
    else await supabase.from('calendar_events').insert(payload)
    setSaving(false); setShowForm(false); loadEvents()
  }

  const deleteEvent = async () => {
    if (!editingEvent || !confirm('Delete this event?')) return
    await supabase.from('calendar_events').delete().eq('id', editingEvent.id)
    setShowForm(false); loadEvents()
  }

  const dropStyle: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }
  const dropBtnStyle: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Calendar</h1>
        <button onClick={prevMonth} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', padding: '4px 8px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}><ChevronLeft size={14} /></button>
        <span style={{ fontSize: '15px', fontWeight: 600, minWidth: '170px', textAlign: 'center' }}>{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', padding: '4px 8px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}><ChevronRight size={14} /></button>
        <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}
          style={{ fontSize: '11px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '6px', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          Today
        </button>
        {/* Legend */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
          {EVENT_TYPES.map(t => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-muted)' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: TYPE_COLORS[t], flexShrink: 0 }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '12px 16px' : '16px 28px 28px' }}>
        {isMobile ? (
          /* Mobile: list view grouped by day */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const dayEvs = eventsOnDay(day)
              const ds = dateStr(day)
              const isToday = ds === todayStr
              if (dayEvs.length === 0) return null
              return (
                <div key={day}>
                  <div style={{ padding: '8px 12px', background: isToday ? 'var(--accent-muted)' : 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: isToday ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: isToday ? 'white' : 'var(--text-primary)', flexShrink: 0 }}>{day}</div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                  </div>
                  {dayEvs.map(ev => (
                    <button key={ev.id} onClick={() => openEdit(ev)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px 10px 20px', borderBottom: '1px solid var(--border-subtle)', borderLeft: `3px solid ${TYPE_COLORS[ev.event_type]}`, background: 'var(--surface)', cursor: 'pointer', border: 'none', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'var(--border-subtle)' }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{ev.title}</div>
                      {ev.start_time && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{ev.start_time.slice(0, 5)}{ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''}</div>}
                      <div style={{ fontSize: '11px', color: TYPE_COLORS[ev.event_type], marginTop: '2px', textTransform: 'capitalize' }}>{ev.event_type}</div>
                    </button>
                  ))}
                </div>
              )
            })}
            {events.length === 0 && !loading && (
              <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>No events this month. Tap a day to add one.</div>
            )}
            <div style={{ padding: '16px 12px', textAlign: 'center' }}>
              <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => openAdd(today.getDate())}>+ Add event</button>
            </div>
          </div>
        ) : (
          <>
            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '4px' }}>
              {DAYS.map(d => (
                <div key={d} style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '4px 8px', textAlign: 'center' }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', background: 'var(--border)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
              {cells.map((day, i) => {
                const dayEvs = day ? eventsOnDay(day) : []
                const isToday = day ? dateStr(day) === todayStr : false
                return (
                  <div key={i}
                    onClick={() => day && openAdd(day)}
                    style={{ minHeight: '96px', background: 'var(--surface)', padding: '6px 6px 4px', cursor: day ? 'pointer' : 'default' }}
                    onMouseEnter={e => day && ((e.currentTarget as HTMLElement).style.background = 'var(--surface-2)')}
                    onMouseLeave={e => day && ((e.currentTarget as HTMLElement).style.background = 'var(--surface)')}
                  >
                    {day && (
                      <>
                        <div style={{
                          width: '24px', height: '24px', borderRadius: '50%', marginBottom: '4px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '12px', fontWeight: isToday ? 700 : 400,
                          color: isToday ? 'white' : 'var(--text-secondary)',
                          background: isToday ? 'var(--accent)' : 'transparent',
                        }}>{day}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {dayEvs.slice(0, 3).map(ev => (
                            <button key={ev.id}
                              onClick={e => { e.stopPropagation(); openEdit(ev) }}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left', fontSize: '10px',
                                padding: '2px 5px', borderRadius: '3px', border: 'none', cursor: 'pointer',
                                background: TYPE_COLORS[ev.event_type] + '20',
                                color: TYPE_COLORS[ev.event_type],
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                              {ev.start_time && <span style={{ marginRight: '3px', opacity: 0.75 }}>{ev.start_time.slice(0, 5)}</span>}
                              {ev.title}
                            </button>
                          ))}
                          {dayEvs.length > 3 && <div style={{ fontSize: '9px', color: 'var(--text-muted)', paddingLeft: '3px' }}>+{dayEvs.length - 3} more</div>}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Event form modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={() => setShowForm(false)} />
          <div style={{ position: 'relative', width: '500px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 24px 64px rgba(0,0,0,0.35)', padding: '20px', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600 }}>{editingEvent ? 'Edit event' : `New event · ${form.event_date}`}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={15} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label className="label">Title *</label>
                <input className="input" placeholder="e.g. Call with JP Morgan" value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} autoFocus />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="label">Date</label>
                  <input type="date" className="input" value={form.event_date} onChange={e => setForm(p => ({...p, event_date: e.target.value}))} />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select className="select" value={form.event_type} onChange={e => setForm(p => ({...p, event_type: e.target.value}))}>
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="label">Start time</label>
                  <input type="time" className="input" value={form.start_time} onChange={e => setForm(p => ({...p, start_time: e.target.value}))} />
                </div>
                <div>
                  <label className="label">End time</label>
                  <input type="time" className="input" value={form.end_time} onChange={e => setForm(p => ({...p, end_time: e.target.value}))} />
                </div>
              </div>

              {/* Links */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="label">Deal</label>
                  <div style={{ position: 'relative' }}>
                    {form.deal_id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', border: '1px solid var(--accent)', borderRadius: '5px', fontSize: '11px' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.deal_label}</span>
                        <button onClick={() => setForm(p => ({...p, deal_id: '', deal_label: ''}))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={10} /></button>
                      </div>
                    ) : (
                      <>
                        <input className="input" style={{ fontSize: '11px' }} placeholder="Search…" value={dealSearch} onChange={e => searchDeals(e.target.value)} />
                        {dealResults.length > 0 && <div style={dropStyle}>{dealResults.map((d: any) => <button key={d.id} style={dropBtnStyle} onClick={() => { setForm(p => ({...p, deal_id: d.id, deal_label: d.company_name})); setDealSearch(''); setDealResults([]) }}>{d.company_name}</button>)}</div>}
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <label className="label">Contact</label>
                  <div style={{ position: 'relative' }}>
                    {form.contact_id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', border: '1px solid #3b82f6', borderRadius: '5px', fontSize: '11px' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.contact_label}</span>
                        <button onClick={() => setForm(p => ({...p, contact_id: '', contact_label: ''}))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={10} /></button>
                      </div>
                    ) : (
                      <>
                        <input className="input" style={{ fontSize: '11px' }} placeholder="Search…" value={contactSearch} onChange={e => searchContacts(e.target.value)} />
                        {contactResults.length > 0 && <div style={dropStyle}>{contactResults.map((c: any) => <button key={c.id} style={dropBtnStyle} onClick={() => { setForm(p => ({...p, contact_id: c.id, contact_label: `${c.first_name} ${c.last_name}`})); setContactSearch(''); setContactResults([]) }}>{c.first_name} {c.last_name}</button>)}</div>}
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <label className="label">Portfolio Co.</label>
                  <select className="select" style={{ fontSize: '11px' }} value={form.portfolio_company_id}
                    onChange={e => { const pc = portfolioCompanies.find((c: any) => c.id === e.target.value); setForm(p => ({...p, portfolio_company_id: e.target.value, portfolio_label: pc?.name ?? ''})) }}>
                    <option value="">—</option>
                    {portfolioCompanies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea className="input" rows={2} value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} style={{ resize: 'vertical', width: '100%' }} />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                {editingEvent && <button onClick={deleteEvent} style={{ fontSize: '12px', padding: '6px 12px', border: '1px solid var(--red, #ef4444)', borderRadius: '6px', background: 'transparent', color: 'var(--red, #ef4444)', cursor: 'pointer', marginRight: 'auto' }}>Delete</button>}
                <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim()}>{saving ? 'Saving…' : editingEvent ? 'Save' : 'Add event'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
