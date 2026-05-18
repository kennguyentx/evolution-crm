'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'

// ─── Types ───────────────────────────────────────────────────
// Matches existing capital_raises table (target_equity, target_debt, close_date, status = 'Open'|'Closed')

type Raise = {
  id: string
  name: string
  deal_id: string | null
  status: string          // 'Open' | 'Closed' — existing values
  target_equity: number | null
  target_debt: number | null
  close_date: string | null
  notes: string | null
  deal?: { company_name: string }
}

type Participant = {
  id: string
  raise_id: string
  crm_investor_id: string | null
  firm_name: string
  contact_name: string | null
  contact_title: string | null
  contact_email: string | null
  contact_phone: string | null
  firm_type: string | null
  check_size_min: number | null
  check_size_max: number | null
  sbic: boolean
  status: string
  teaser_date: string | null
  nda_date: string | null
  cim_date: string | null
  first_call_date: string | null
  model_date: string | null
  term_sheet_date: string | null
  invested_date: string | null
  committed_amount: number | null
  pass_date: string | null
  pass_reason: string | null
  debt_amount: number | null
  debt_structure: string | null
  pricing_notes: string | null
  notes: string | null
  sort_order: number
}

type Activity = {
  id: string
  participant_id: string
  event_date: string
  event_type: string
  summary: string
  detail: string | null
  logged_by: string | null
  source: string
}

// ─── Status config ────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  outreach:    { label: 'Outreach',    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  teaser_sent: { label: 'Teaser sent', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  nda_signed:  { label: 'NDA signed',  className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  cim_sent:    { label: 'CIM sent',    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  call_had:    { label: 'Call had',    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  model_sent:  { label: 'Model sent',  className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  in_dd:       { label: 'In DD',       className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  term_sheet:  { label: 'Term sheet',  className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  invested:    { label: 'Invested',    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  confirmed:   { label: 'Confirmed',   className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  pass:        { label: 'Pass',        className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  no_response: { label: 'No response', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500' },
}

const STATUS_GROUPS = [
  { key: 'invested',   label: '✓ Invested / confirmed', statuses: ['invested','confirmed'] },
  { key: 'active',     label: '↻ Active diligence',     statuses: ['term_sheet','in_dd','model_sent','call_had','nda_signed','cim_sent'] },
  { key: 'outreach',   label: '→ Outreach',              statuses: ['teaser_sent','outreach'] },
  { key: 'pass',       label: '✕ Passed / no response', statuses: ['pass','no_response'] },
]

// ─── Helpers ─────────────────────────────────────────────────

const fmt = (n: number | null) =>
  n == null ? '—' : `$${(n / 1_000_000).toFixed(1)}M`

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '—'

const fmtCheckSize = (min: number | null, max: number | null) => {
  if (!min && !max) return '—'
  if (min && max) return `$${min/1e6 < 1 ? (min/1e6).toFixed(1) : Math.round(min/1e6)}–${Math.round(max/1e6)}M`
  if (min) return `$${Math.round(min/1e6)}M+`
  return `Up to $${Math.round(max!/1e6)}M`
}

// Derive raise type from name — existing raises are named "X — Equity 2026" or "X — Debt 2026"
// Falls back to 'equity' if name doesn't contain 'Debt'
function deriveRaiseType(name: string): 'equity' | 'debt' {
  return /debt/i.test(name) ? 'debt' : 'equity'
}

// ─── Inline editable cell ─────────────────────────────────────

function EditableCell({
  value, onSave, type = 'text', options, placeholder, className = ''
}: {
  value: string | null
  onSave: (v: string) => void
  type?: 'text' | 'date' | 'number' | 'select' | 'textarea'
  options?: { value: string; label: string }[]
  placeholder?: string
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef<any>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  if (!editing) {
    return (
      <span
        className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5 min-w-[32px] inline-block ${className}`}
        onClick={() => { setDraft(value ?? ''); setEditing(true) }}
        title="Click to edit"
      >
        {value || <span className="text-gray-300 dark:text-gray-600">{placeholder ?? '—'}</span>}
      </span>
    )
  }

  if (type === 'select' && options) {
    return (
      <select
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        className="text-xs border border-blue-400 rounded px-1 py-0.5 bg-white dark:bg-gray-900 outline-none"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  if (type === 'textarea') {
    return (
      <textarea
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        rows={3}
        className="text-xs border border-blue-400 rounded px-1 py-0.5 bg-white dark:bg-gray-900 outline-none w-full resize-none"
      />
    )
  }

  return (
    <input
      ref={ref}
      type={type}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      className="text-xs border border-blue-400 rounded px-1 py-0.5 bg-white dark:bg-gray-900 outline-none w-full"
    />
  )
}

// ─── Add activity modal ───────────────────────────────────────

function AddActivityModal({
  participantId, raiseId, onClose, onSaved
}: {
  participantId: string; raiseId: string; onClose: () => void; onSaved: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    event_date: new Date().toISOString().split('T')[0],
    event_type: 'note',
    summary: '',
    detail: '',
    logged_by: 'Ken',
  })
  const [saving, setSaving] = useState(false)

  const eventTypes = [
    'teaser_sent','nda_signed','cim_sent','call','model_sent',
    'dd_started','term_sheet','invested','confirmed','pass','email','ping','note'
  ]

  const save = async () => {
    if (!form.summary.trim()) return
    setSaving(true)
    await supabase.from('raise_activity').insert({
      participant_id: participantId,
      raise_id: raiseId,
      ...form,
      source: 'manual',
    })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium mb-4">Log activity</h3>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Date</label>
              <input type="date" value={form.event_date} onChange={e => setForm({...form, event_date: e.target.value})}
                className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Type</label>
              <select value={form.event_type} onChange={e => setForm({...form, event_type: e.target.value})}
                className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 outline-none focus:border-blue-400">
                {eventTypes.map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Summary</label>
            <input value={form.summary} onChange={e => setForm({...form, summary: e.target.value})}
              placeholder="e.g. Call with Logan Timmons"
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Notes</label>
            <textarea value={form.detail} onChange={e => setForm({...form, detail: e.target.value})}
              rows={3} placeholder="Call notes, context, next steps…"
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400 resize-none" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Logged by</label>
            <input value={form.logged_by} onChange={e => setForm({...form, logged_by: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add participant modal ────────────────────────────────────

function AddParticipantModal({
  raiseId, onClose, onSaved
}: {
  raiseId: string; onClose: () => void; onSaved: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    firm_name: '', contact_name: '', contact_title: '', contact_email: '',
    firm_type: 'PE Fund', check_size_min: '', check_size_max: '',
    sbic: false, status: 'outreach', notes: '',
    debt_structure: '', pricing_notes: '',
  })
  const [saving, setSaving] = useState(false)

  const firmTypes = ['PE Fund','Family Office','FOF','Endowment','SBIC','Bank','Mezz','Unitranche','Other']

  const save = async () => {
    if (!form.firm_name.trim()) return
    setSaving(true)
    await supabase.from('raise_participants').insert({
      raise_id: raiseId,
      firm_name: form.firm_name,
      contact_name: form.contact_name || null,
      contact_title: form.contact_title || null,
      contact_email: form.contact_email || null,
      firm_type: form.firm_type,
      check_size_min: form.check_size_min ? Number(form.check_size_min) * 1e6 : null,
      check_size_max: form.check_size_max ? Number(form.check_size_max) * 1e6 : null,
      sbic: form.sbic,
      status: form.status,
      notes: form.notes || null,
      debt_structure: form.debt_structure || null,
      pricing_notes: form.pricing_notes || null,
    })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium mb-4">Add participant</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Firm name *', 'firm_name', 'text'],
            ['Contact name', 'contact_name', 'text'],
            ['Title', 'contact_title', 'text'],
            ['Email', 'contact_email', 'email'],
            ['Check size min ($M)', 'check_size_min', 'number'],
            ['Check size max ($M)', 'check_size_max', 'number'],
          ].map(([label, key, type]) => (
            <div key={key as string}>
              <label className="text-xs text-gray-500 mb-1 block">{label as string}</label>
              <input type={type as string} value={(form as any)[key as string]}
                onChange={e => setForm({...form, [key as string]: e.target.value})}
                className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Type</label>
            <select value={form.firm_type} onChange={e => setForm({...form, firm_type: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 outline-none focus:border-blue-400">
              {firmTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Status</label>
            <select value={form.status} onChange={e => setForm({...form, status: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 outline-none focus:border-blue-400">
              {Object.entries(STATUS_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              rows={2} className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400 resize-none" />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="sbic" checked={form.sbic} onChange={e => setForm({...form, sbic: e.target.checked})} />
            <label htmlFor="sbic" className="text-xs text-gray-500">SBIC</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Participant row ──────────────────────────────────────────

function ParticipantRow({
  p, raiseId, isDebt, onUpdate, onRefresh
}: {
  p: Participant; raiseId: string; isDebt: boolean; onUpdate: (id: string, field: string, value: any) => void; onRefresh: () => void
}) {
  const supabase = createClient()
  const [expanded, setExpanded] = useState(false)
  const [activities, setActivities] = useState<Activity[]>([])
  const [showAddActivity, setShowAddActivity] = useState(false)
  const [loadingAct, setLoadingAct] = useState(false)

  const loadActivities = async () => {
    setLoadingAct(true)
    const { data } = await supabase
      .from('raise_activity')
      .select('*')
      .eq('participant_id', p.id)
      .order('event_date', { ascending: true })
    setActivities(data ?? [])
    setLoadingAct(false)
  }

  const toggleExpand = () => {
    if (!expanded) loadActivities()
    setExpanded(!expanded)
  }

  const update = (field: string) => (value: string) => {
    let v: any = value
    if (['check_size_min','check_size_max','committed_amount','debt_amount'].includes(field)) {
      v = value ? Number(value) * 1e6 : null
    }
    if (field === 'sbic') v = value === 'true'
    onUpdate(p.id, field, v)
  }

  const deleteParticipant = async () => {
    if (!confirm(`Remove ${p.firm_name} from this raise?`)) return
    await supabase.from('raise_participants').delete().eq('id', p.id)
    onRefresh()
  }

  const sc = STATUS_CONFIG[p.status] ?? STATUS_CONFIG['outreach']
  const isPass = p.status === 'pass' || p.status === 'no_response'

  const dateCols = [
    { key: 'teaser_date', val: p.teaser_date },
    { key: 'nda_date', val: p.nda_date },
    { key: 'cim_date', val: p.cim_date },
    { key: 'first_call_date', val: p.first_call_date },
    { key: 'model_date', val: p.model_date },
    { key: 'term_sheet_date', val: p.term_sheet_date },
  ]

  return (
    <>
      <tr className={`border-b border-gray-100 dark:border-gray-800 group ${isPass ? 'opacity-60' : ''} hover:bg-gray-50/50 dark:hover:bg-gray-800/30`}>

        {/* Firm */}
        <td className="py-2 px-3 min-w-[140px]">
          <div className="flex flex-col gap-0.5">
            <button onClick={toggleExpand} className="text-left text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline leading-tight">
              {expanded ? '▾' : '▸'} <EditableCell value={p.firm_name} onSave={update('firm_name')} className="!text-xs !font-medium" />
            </button>
            <EditableCell value={p.contact_name} onSave={update('contact_name')} placeholder="Contact" className="!text-[10px] text-gray-500" />
            <EditableCell value={p.contact_title} onSave={update('contact_title')} placeholder="Title" className="!text-[10px] text-gray-400" />
          </div>
        </td>

        {/* Type */}
        <td className="py-2 px-3">
          <EditableCell value={p.firm_type} onSave={update('firm_type')} type="select"
            options={['PE Fund','Family Office','FOF','Endowment','SBIC','Bank','Mezz','Unitranche','Other'].map(v=>({value:v,label:v}))}
            className="!text-[10px] border border-gray-200 dark:border-gray-700 rounded px-1" />
          {p.sbic && <span className="text-[9px] text-purple-500 block mt-0.5">SBIC</span>}
        </td>

        {/* Check / hold size */}
        <td className="py-2 px-3 whitespace-nowrap">
          <span className="text-[10px] text-gray-500">
            {fmtCheckSize(p.check_size_min, p.check_size_max)}
          </span>
        </td>

        {/* Status */}
        <td className="py-2 px-3">
          <EditableCell value={p.status} onSave={update('status')} type="select"
            options={Object.entries(STATUS_CONFIG).map(([k,v])=>({value:k,label:v.label}))}
            className={`!text-[9px] !font-semibold rounded-full px-2 py-0.5 ${sc.className}`} />
        </td>

        {/* Milestone date columns */}
        {dateCols.map(({ key, val }) => (
          <td key={key} className="py-2 px-2 text-center">
            <EditableCell value={val ? fmtDate(val) : null} onSave={update(key)} type="date" placeholder="—"
              className="!text-[10px] text-center" />
          </td>
        ))}

        {/* Amount committed */}
        <td className="py-2 px-3 whitespace-nowrap">
          {isDebt ? (
            <div className="flex flex-col gap-0.5">
              <EditableCell value={p.debt_amount ? String(p.debt_amount / 1e6) : null}
                onSave={update('debt_amount')} type="number" placeholder="$M"
                className="!text-xs !font-medium" />
              <EditableCell value={p.pricing_notes} onSave={update('pricing_notes')}
                placeholder="pricing…" className="!text-[10px] text-gray-400" />
            </div>
          ) : (
            <EditableCell value={p.committed_amount ? String(p.committed_amount / 1e6) : null}
              onSave={update('committed_amount')} type="number" placeholder="$M"
              className="!text-xs !font-medium" />
          )}
        </td>

        {/* Notes / pass reason */}
        <td className="py-2 px-3 max-w-[180px]">
          {isPass && p.pass_reason ? (
            <EditableCell value={p.pass_reason} onSave={update('pass_reason')} type="textarea"
              className="!text-[10px] italic text-red-600 dark:text-red-400" />
          ) : (
            <EditableCell value={p.notes} onSave={update('notes')} type="textarea"
              placeholder="notes…" className="!text-[10px] text-gray-500 leading-snug" />
          )}
        </td>

        {/* Actions */}
        <td className="py-2 px-2">
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => { setShowAddActivity(true); if(!expanded) { setExpanded(true); loadActivities() }}}
              className="text-[10px] text-blue-500 hover:text-blue-700 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">
              + log
            </button>
            <button onClick={deleteParticipant}
              className="text-[10px] text-gray-400 hover:text-red-500 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5">
              ✕
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded activity log */}
      {expanded && (
        <tr className="border-b border-gray-100 dark:border-gray-800">
          <td colSpan={11} className="p-0">
            <div className="pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Activity log</span>
                <button onClick={() => setShowAddActivity(true)}
                  className="text-[10px] text-blue-500 border border-dashed border-blue-300 dark:border-blue-700 rounded px-2 py-0.5">
                  + add entry
                </button>
              </div>
              {loadingAct ? (
                <p className="text-[10px] text-gray-400">Loading…</p>
              ) : activities.length === 0 ? (
                <p className="text-[10px] text-gray-400 italic">No activity logged yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {activities.map(a => (
                    <div key={a.id} className="flex gap-3 items-start">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.event_type === 'pass' ? 'bg-red-400' : 'bg-blue-400'}`} />
                      <span className="text-[10px] text-gray-400 w-12 flex-shrink-0">{fmtDate(a.event_date)}</span>
                      <div>
                        <p className="text-[11px] leading-tight">{a.summary}</p>
                        {a.detail && <p className="text-[10px] text-gray-400 italic mt-0.5 leading-snug">{a.detail}</p>}
                        {a.logged_by && <p className="text-[9px] text-gray-300 dark:text-gray-600 mt-0.5">— {a.logged_by}{a.source === 'discord_bot' ? ' via Discord' : ''}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      {showAddActivity && (
        <AddActivityModal
          participantId={p.id}
          raiseId={raiseId}
          onClose={() => setShowAddActivity(false)}
          onSaved={() => { loadActivities(); setExpanded(true) }}
        />
      )}
    </>
  )
}

// ─── Edit raise modal ─────────────────────────────────────────

function EditRaiseModal({
  raise, deals, onClose, onSaved
}: {
  raise: Raise; deals: { id: string; company_name: string }[]; onClose: () => void; onSaved: (updates: Partial<Raise>) => void
}) {
  const [form, setForm] = useState({
    name: raise.name ?? '',
    deal_id: raise.deal_id ?? '',
    target_equity: raise.target_equity ? String(raise.target_equity / 1e6) : '',
    target_debt: raise.target_debt ? String(raise.target_debt / 1e6) : '',
    close_date: raise.close_date ?? '',
    status: raise.status ?? 'Open',
    notes: raise.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const updates: any = {
      name: form.name,
      deal_id: form.deal_id || null,
      close_date: form.close_date || null,
      status: form.status,
      notes: form.notes || null,
      target_equity: form.target_equity ? Number(form.target_equity) * 1e6 : null,
      target_debt: form.target_debt ? Number(form.target_debt) * 1e6 : null,
    }
    setSaving(false)
    onSaved(updates)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium mb-4">Edit raise</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">Name</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">Linked deal</label>
            <select value={form.deal_id} onChange={e => setForm({...form, deal_id: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 outline-none focus:border-blue-400">
              <option value="">— None —</option>
              {deals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Target equity ($M)</label>
            <input type="number" step="0.1" value={form.target_equity} onChange={e => setForm({...form, target_equity: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Target debt ($M)</label>
            <input type="number" step="0.1" value={form.target_debt} onChange={e => setForm({...form, target_debt: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Target close date</label>
            <input type="date" value={form.close_date} onChange={e => setForm({...form, close_date: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Status</label>
            <select value={form.status} onChange={e => setForm({...form, status: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 outline-none focus:border-blue-400">
              <option value="Open">Open</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">Notes</label>
            <input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── New raise modal ──────────────────────────────────────────

function NewRaiseModal({
  onClose, onSaved, deals
}: {
  onClose: () => void; onSaved: () => void; deals: { id: string; company_name: string }[]
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    name: '', deal_id: '', target_equity: '', target_debt: '', close_date: '', notes: ''
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const payload: any = {
      name: form.name,
      deal_id: form.deal_id || null,
      close_date: form.close_date || null,
      notes: form.notes || null,
      status: 'Open',
    }
    if (form.target_equity) payload.target_equity = Number(form.target_equity) * 1e6
    if (form.target_debt) payload.target_debt = Number(form.target_debt) * 1e6
    await supabase.from('capital_raises').insert(payload)
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium mb-4">New capital raise</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">Name *</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              placeholder="e.g. Coggins Underground — Equity 2026"
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">Linked deal</label>
            <select value={form.deal_id} onChange={e => setForm({...form, deal_id: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 outline-none focus:border-blue-400">
              <option value="">— Select deal —</option>
              {deals.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Target equity ($M)</label>
            <input type="number" step="0.1" value={form.target_equity} onChange={e => setForm({...form, target_equity: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Target debt ($M)</label>
            <input type="number" step="0.1" value={form.target_debt} onChange={e => setForm({...form, target_debt: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Target close date</label>
            <input type="date" value={form.close_date} onChange={e => setForm({...form, close_date: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">Notes</label>
            <input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-transparent outline-none focus:border-blue-400" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create raise'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function RaisesPage() {
  const supabase = createClient()
  const [raises, setRaises] = useState<Raise[]>([])
  const [selectedRaise, setSelectedRaise] = useState<Raise | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [deals, setDeals] = useState<{ id: string; company_name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showPassed, setShowPassed] = useState(false)
  const [showAddParticipant, setShowAddParticipant] = useState(false)
  const [showNewRaise, setShowNewRaise] = useState(false)
  const [showEditRaise, setShowEditRaise] = useState(false)

  // Load raises + deals
  useEffect(() => {
    const load = async () => {
      const [{ data: r }, { data: d }] = await Promise.all([
        supabase.from('capital_raises').select('*, deal:deals(company_name)').order('created_at', { ascending: false }),
        supabase.from('deals').select('id, company_name').order('company_name'),
      ])
      setRaises(r ?? [])
      setDeals(d ?? [])
      if (r && r.length > 0) setSelectedRaise(r[0])
      setLoading(false)
    }
    load()
  }, [])

  // Load participants when raise changes
  useEffect(() => {
    if (selectedRaise) loadParticipants()
  }, [selectedRaise?.id])

  const loadParticipants = async () => {
    if (!selectedRaise) return
    const { data } = await supabase
      .from('raise_participants')
      .select('*')
      .eq('raise_id', selectedRaise.id)
      .order('sort_order', { ascending: true })
    setParticipants(data ?? [])
  }

  const reloadRaises = async () => {
    const { data } = await supabase.from('capital_raises').select('*, deal:deals(company_name)').order('created_at', { ascending: false })
    setRaises(data ?? [])
    if (data && data.length > 0 && !selectedRaise) setSelectedRaise(data[0])
  }

  const deleteRaise = async () => {
    if (!selectedRaise) return
    if (!confirm(`Delete "${selectedRaise.name}"? This will also remove all participants and activity. This cannot be undone.`)) return
    await supabase.from('capital_raises').delete().eq('id', selectedRaise.id)
    const updated = raises.filter(r => r.id !== selectedRaise.id)
    setRaises(updated)
    setSelectedRaise(updated[0] ?? null)
    setParticipants([])
  }

  const saveRaiseEdits = async (updates: Partial<Raise>) => {
    if (!selectedRaise) return
    await supabase.from('capital_raises').update(updates).eq('id', selectedRaise.id)
    const updatedRaise = { ...selectedRaise, ...updates }
    setRaises(prev => prev.map(r => r.id === selectedRaise.id ? updatedRaise : r))
    setSelectedRaise(updatedRaise)
  }

  const updateParticipant = async (id: string, field: string, value: any) => {
    await supabase.from('raise_participants').update({ [field]: value }).eq('id', id)
    setParticipants(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  // Derive isDebt from the raise name (no raise_type column in existing schema)
  const isDebt = selectedRaise ? deriveRaiseType(selectedRaise.name) === 'debt' : false

  // Target amount from existing columns
  const targetAmount = selectedRaise
    ? (isDebt ? selectedRaise.target_debt : selectedRaise.target_equity)
    : null

  // Filter participants
  const filtered = participants.filter(p => {
    const matchSearch = !search ||
      p.firm_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.contact_name ?? '').toLowerCase().includes(search.toLowerCase())
    const matchPassed = showPassed || (p.status !== 'pass' && p.status !== 'no_response')
    return matchSearch && matchPassed
  })

  // Group by stage
  const grouped = STATUS_GROUPS.map(g => ({
    ...g,
    rows: filtered.filter(p => g.statuses.includes(p.status))
  })).filter(g => g.rows.length > 0)

  // Summary metrics
  const invested = participants.filter(p => p.status === 'invested' || p.status === 'confirmed')
  const active = participants.filter(p => !['pass','no_response','invested','confirmed'].includes(p.status))
  const passed = participants.filter(p => p.status === 'pass' || p.status === 'no_response')
  const totalCommitted = invested.reduce((s, p) => s + (p.committed_amount ?? p.debt_amount ?? 0), 0)

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Capital Raises</h1>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Click any cell to edit · Expand row for activity log</p>
        </div>
        <button
          onClick={() => setShowNewRaise(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium hover:opacity-90"
          style={{ fontSize: '12px' }}
        >
          + New raise
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px' }}>
        {/* Raise selector pills */}
        {raises.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {raises.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedRaise(r)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  selectedRaise?.id === r.id
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent font-medium'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400'
                }`}
                style={{ fontSize: '11px' }}
              >
                {r.name || r.deal?.company_name || 'Unnamed'}
                {r.status === 'Closed' && <span className="ml-1.5 opacity-50 text-[9px]">Closed</span>}
              </button>
            ))}
          </div>
        )}

        {selectedRaise && (
          <>
            {/* Raise-level actions */}
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setShowEditRaise(true)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400 hover:text-gray-700"
              >
                Edit raise
              </button>
              <button
                onClick={deleteRaise}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                Delete raise
              </button>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-6 gap-2 mb-5">
              {[
                { label: 'Target', val: fmt(targetAmount) },
                { label: 'Committed', val: fmt(totalCommitted), color: 'text-green-600' },
                { label: isDebt ? 'Lenders active' : 'Investors active', val: String(active.length), color: 'text-blue-600' },
                { label: 'In diligence', val: String(participants.filter(p=>p.status==='in_dd'||p.status==='term_sheet').length), color: 'text-amber-600' },
                { label: 'Passed', val: String(passed.length), color: 'text-red-500' },
                { label: 'Status', val: selectedRaise.status },
              ].map(m => (
                <div key={m.label} className="bg-gray-50 dark:bg-gray-800/60 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-gray-400 mb-0.5">{m.label}</p>
                  <p className={`text-sm font-medium ${(m as any).color ?? ''}`}>{m.val}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 mb-4">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search firm or contact…"
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent outline-none focus:border-blue-400 w-56"
              />
              <button
                onClick={() => setShowPassed(!showPassed)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${showPassed ? 'bg-gray-100 dark:bg-gray-800 border-gray-400 font-medium' : 'border-gray-200 dark:border-gray-700 text-gray-400'}`}
              >
                {showPassed ? 'Hiding passed' : 'Show passed'}
              </button>
              <button
                onClick={() => setShowAddParticipant(true)}
                className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-blue-300 dark:border-blue-700 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 ml-auto"
              >
                + Add participant
              </button>
            </div>

            {/* Tracker table */}
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full border-collapse text-xs" style={{ minWidth: '1000px' }}>
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-800">
                    {[
                      ['Firm / Contact', 'min-w-[150px] text-left'],
                      ['Type', 'text-left'],
                      [isDebt ? 'Hold size' : 'Check size', 'text-left'],
                      ['Status', 'text-left'],
                      ['Teaser', 'text-center'],
                      ['NDA', 'text-center'],
                      ['CIM', 'text-center'],
                      ['Call', 'text-center'],
                      ['Model', 'text-center'],
                      ['Term sheet', 'text-center'],
                      [isDebt ? 'Amount / pricing' : 'Committed', 'text-left'],
                      ['Notes / pass reason', 'min-w-[160px] text-left'],
                      ['', 'w-16'],
                    ].map(([label, cls]) => (
                      <th key={label as string} className={`px-3 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider ${cls}`}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-6 text-center text-xs text-gray-400">
                        No participants yet.{' '}
                        <button onClick={() => setShowAddParticipant(true)} className="text-blue-500 underline">Add the first one.</button>
                      </td>
                    </tr>
                  ) : grouped.map(g => (
                    <>
                      <tr key={g.key} className="bg-gray-50/80 dark:bg-gray-800/50">
                        <td colSpan={13} className="px-3 py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                          {g.label} <span className="font-normal opacity-60 ml-1">({g.rows.length})</span>
                        </td>
                      </tr>
                      {g.rows.map(p => (
                        <ParticipantRow
                          key={p.id}
                          p={p}
                          raiseId={selectedRaise.id}
                          isDebt={isDebt}
                          onUpdate={updateParticipant}
                          onRefresh={loadParticipants}
                        />
                      ))}
                    </>
                  ))}
                  <tr>
                    <td colSpan={13} className="px-3 py-2">
                      <button
                        onClick={() => setShowAddParticipant(true)}
                        className="text-[10px] text-blue-500 border border-dashed border-blue-300 dark:border-blue-700 rounded px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      >
                        + Add participant
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {raises.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            No capital raises yet.{' '}
            <button onClick={() => setShowNewRaise(true)} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px' }}>
              Create your first raise.
            </button>
          </div>
        )}
      </div>

      {showEditRaise && selectedRaise && (
        <EditRaiseModal
          raise={selectedRaise}
          deals={deals}
          onClose={() => setShowEditRaise(false)}
          onSaved={saveRaiseEdits}
        />
      )}

      {showAddParticipant && selectedRaise && (
        <AddParticipantModal
          raiseId={selectedRaise.id}
          onClose={() => setShowAddParticipant(false)}
          onSaved={loadParticipants}
        />
      )}

      {showNewRaise && (
        <NewRaiseModal
          deals={deals}
          onClose={() => setShowNewRaise(false)}
          onSaved={reloadRaises}
        />
      )}
    </div>
  )
}
