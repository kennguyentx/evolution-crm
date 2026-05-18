'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { Deal, Interaction, DiligenceItem, DealCapitalAssignment } from '@/types'
import { formatCurrency, stageClass, contactTypeClass } from '@/types'
import { ArrowLeft, Check, X, Plus, Phone, Mail, ChevronDown, Search, Trash2, Upload } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { format } from 'date-fns'
import DocumentsTab from '@/components/deals/DocumentsTab'
import NewContactModal from '@/components/contacts/NewContactModal'
import UndoToast, { type UndoEntry } from '@/components/layout/UndoToast'

const STAGES = ['Teaser','Reviewing','Pre-LOI','LOI Submitted','Exclusivity','Closed (Platform)','Closed (Add-On)','Pass (DOA)','Pass (Pre-LOI)','Pass (Post-LOI)','Hold']

const DEFAULT_DILIGENCE = [
  { category: 'financial', item: 'Monthly P&L' },
  { category: 'financial', item: 'Monthly Balance Sheet' },
  { category: 'financial', item: 'Audited Financials (3 years)' },
  { category: 'legal', item: 'Corporate Structure & Ownership' },
  { category: 'legal', item: 'Material Contracts Review' },
  { category: 'legal', item: 'Litigation / Contingent Liabilities' },
  { category: 'operational', item: 'Customer Concentration' },
  { category: 'operational', item: 'Backlog & Pipeline Review' },
  { category: 'operational', item: 'Employee Chart' },
  { category: 'operational', item: 'Equipment & Fleet Inventory' },
]

export default function DealDetailPage() {
  const params = useParams()
  const router = useRouter()
  const dealId = params.id as string
  const supabase = createClient()

  const [deal, setDeal] = useState<Deal | null>(null)
  const [linkedContacts, setLinkedContacts] = useState<any[]>([])
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [diligence, setDiligence] = useState<DiligenceItem[]>([])
  const [capital, setCapital] = useState<DealCapitalAssignment[]>([])
  const [documents, setDocuments] = useState<any[]>([])
  const [dealRaises, setDealRaises] = useState<any[]>([])
  const [comps, setComps] = useState<any[]>([])
  const [compsNotes, setCompsNotes] = useState<string | null>(null)
  const [loadingComps, setLoadingComps] = useState(false)
  const [compsError, setCompsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview'|'diligence'|'contacts'|'capital'|'activity'|'documents'>('overview')
  const [editingStage, setEditingStage] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingContact, setEditingContact] = useState<any>(null)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])

  const pushUndo = (entry: Omit<UndoEntry,'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setUndoStack(prev => [{ ...entry, id }, ...prev].slice(0,3))
  }
  const handleUndo = async (id: string) => {
    const entry = undoStack.find(e => e.id===id)
    if (entry) { await entry.undo(); fetchAll() }
    setUndoStack(prev => prev.filter(e => e.id!==id))
  }
  const handleDismiss = (id: string) => setUndoStack(prev => prev.filter(e => e.id!==id))
  const [portfolioCompanies, setPortfolioCompanies] = useState<any[]>([])

  // Contact search
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
  const [showContactSearch, setShowContactSearch] = useState(false)
  const [pendingContactRole, setPendingContactRole] = useState('Contact')
  const searchRef = useRef<HTMLDivElement>(null)

  // Capital form
  const [showCapitalForm, setShowCapitalForm] = useState(false)
  const [capitalSearch, setCapitalSearch] = useState('')
  const [capitalResults, setCapitalResults] = useState<any[]>([])
  const [selectedCapitalContact, setSelectedCapitalContact] = useState<any>(null)
  const [capitalForm, setCapitalForm] = useState({ role: 'LP', committed_amount: '', status: 'Interested' })
  const capitalSearchRef = useRef<HTMLDivElement>(null)

  // Activity form
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [activityForm, setActivityForm] = useState({ interaction_type: 'call', summary: '', next_steps: '' })

  const fetchAll = useCallback(async () => {
    const [dealRes, linksRes, interactionsRes, diligenceRes, capitalRes] = await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase.from('contact_deal_links').select('*, contact:contacts(*)').eq('deal_id', dealId),
      supabase.from('interactions').select('*, contact:contacts(first_name, last_name)').eq('deal_id', dealId).order('interaction_date', { ascending: false }),
      supabase.from('diligence_items').select('*').eq('deal_id', dealId).order('category'),
      supabase.from('deal_capital_assignments').select('*, contact:contacts(first_name, last_name, firm)').eq('deal_id', dealId),
    ])
    if (dealRes.data) setDeal(dealRes.data)
    if (linksRes.data) setLinkedContacts(linksRes.data)
    if (interactionsRes.data) setInteractions(interactionsRes.data)
    if (diligenceRes.data) setDiligence(diligenceRes.data)
    if (capitalRes.data) setCapital(capitalRes.data)
    setLoading(false)
    // Fetch portfolio companies for parent linking
    const { data: pcos } = await supabase.from('portfolio_companies').select('id, name').eq('status', 'Active').order('name')
    if (pcos) setPortfolioCompanies(pcos)
    // Fetch capital raises linked to this deal
    const { data: raises } = await supabase
      .from('capital_raises')
      .select('*, participants:raise_participants(*)')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false })
    if (raises) setDealRaises(raises)
  }, [supabase, dealId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowContactSearch(false)
        setContactSearch('')
        setContactResults([])
      }
      if (capitalSearchRef.current && !capitalSearchRef.current.contains(e.target as Node)) {
        setCapitalResults([])
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Contact search
  useEffect(() => {
    if (!contactSearch.trim()) { setContactResults([]); return }
    const timer = setTimeout(async () => {
      const q = contactSearch.trim()
      const parts = q.split(' ').filter(Boolean)
      let results: any[] = []
      if (parts.length >= 2) {
        const [a, b] = await Promise.all([
          supabase.from('contacts').select('id,first_name,last_name,firm,title,contact_type').ilike('first_name', `%${parts[0]}%`).limit(100),
          supabase.from('contacts').select('id,first_name,last_name,firm,title,contact_type').ilike('last_name', `%${parts[parts.length-1]}%`).limit(100),
        ])
        const ids = new Set((a.data || []).map((c: any) => c.id))
        results = (b.data || []).filter((c: any) => ids.has(c.id))
        if (!results.length) {
          const { data } = await supabase.from('contacts').select('id,first_name,last_name,firm,title,contact_type').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`).limit(8)
          results = data || []
        }
      } else {
        const { data } = await supabase.from('contacts').select('id,first_name,last_name,firm,title,contact_type').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`).limit(8)
        results = data || []
      }
      setContactResults(results.slice(0, 8))
    }, 250)
    return () => clearTimeout(timer)
  }, [contactSearch])

  // Capital contact search
  useEffect(() => {
    if (!capitalSearch.trim()) { setCapitalResults([]); return }
    const timer = setTimeout(async () => {
      const q = capitalSearch.trim()
      const { data } = await supabase.from('contacts').select('id,first_name,last_name,firm,contact_type').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,firm.ilike.%${q}%`).limit(8)
      setCapitalResults(data || [])
    }, 250)
    return () => clearTimeout(timer)
  }, [capitalSearch])

  const updateStage = async (stage: string) => {
    await supabase.from('deals').update({ stage }).eq('id', dealId)
    setDeal(prev => prev ? { ...prev, stage: stage as any } : null)
    setEditingStage(false)

    // Auto-create portfolio card on close
    if (stage === 'Closed (Platform)' || stage === 'Closed (Add-On)') {
      const currentDeal = deal
      if (!currentDeal) return
      // Check if a portfolio company already exists for this deal
      const { data: existing } = await supabase
        .from('portfolio_companies')
        .select('id')
        .eq('deal_id', dealId)
        .maybeSingle()
      if (!existing) {
        await supabase.from('portfolio_companies').insert({
          deal_id: dealId,
          name: currentDeal.company_name,
          sector: currentDeal.sector ?? null,
          geography: currentDeal.geography ?? null,
          status: 'Active',
          platform_type: stage === 'Closed (Platform)' ? 'Platform' : 'Add-On',
        })
      }
    }
  }

  const updateField = async (field: string, value: any) => {
    await supabase.from('deals').update({ [field]: value }).eq('id', dealId)
    setDeal(prev => prev ? { ...prev, [field]: value } : null)
  }

  const linkSourceContact = async (contact: any) => {
    const alreadyLinked = linkedContacts.find(l => l.contact_id === contact.id && l.role === 'Source / Banker')
    if (alreadyLinked) { setShowContactSearch(false); return }
    const { data } = await supabase.from('contact_deal_links').insert({ contact_id: contact.id, deal_id: dealId, role: 'Source / Banker' }).select('*, contact:contacts(*)').single()
    if (data) setLinkedContacts(prev => [...prev, data])
    setShowContactSearch(false)
    setContactSearch('')
    setContactResults([])
  }

  const linkContact = async (contact: any, role: string) => {
    const alreadyLinked = linkedContacts.find(l => l.contact_id === contact.id)
    if (alreadyLinked) { setShowContactSearch(false); return }
    const { data } = await supabase.from('contact_deal_links').insert({ contact_id: contact.id, deal_id: dealId, role }).select('*, contact:contacts(*)').single()
    if (data) setLinkedContacts(prev => [...prev, data])
    setShowContactSearch(false)
    setContactSearch('')
    setContactResults([])
  }

  const unlinkContact = async (linkId: string) => {
    const link = linkedContacts.find(l => l.id === linkId)
    await supabase.from('contact_deal_links').delete().eq('id', linkId)
    setLinkedContacts(prev => prev.filter(l => l.id !== linkId))
    if (link) {
      const name = `${link.contact?.first_name ?? ''} ${link.contact?.last_name ?? ''}`.trim()
      pushUndo({
        label: `Unlinked ${name || 'contact'}`,
        undo: async () => {
          await supabase.from('contact_deal_links').insert({ contact_id: link.contact_id, deal_id: dealId, role: link.role })
        }
      })
    }
  }

  const deleteDeal = async () => {
    await supabase.from('diligence_items').delete().eq('deal_id', dealId)
    await supabase.from('contact_deal_links').delete().eq('deal_id', dealId)
    await supabase.from('interactions').delete().eq('deal_id', dealId)
    await supabase.from('deal_capital_assignments').delete().eq('deal_id', dealId)
    await supabase.from('deals').delete().eq('id', dealId)
    router.push('/deals')
  }

  const seedDiligence = async () => {
    const items = DEFAULT_DILIGENCE.map(d => ({ ...d, deal_id: dealId, status: 'Pending' }))
    const { data } = await supabase.from('diligence_items').insert(items).select()
    if (data) setDiligence(prev => [...prev, ...data])
  }

  const resetDiligence = async () => {
    if (!confirm('Reset checklist to defaults? This will delete all current items.')) return
    await supabase.from('diligence_items').delete().eq('deal_id', dealId)
    const items = DEFAULT_DILIGENCE.map(d => ({ ...d, deal_id: dealId, status: 'Pending' }))
    const { data } = await supabase.from('diligence_items').insert(items).select()
    if (data) setDiligence(data)
  }

  const pullComps = async () => {
    if (!deal) return
    setLoadingComps(true)
    setCompsError(null)
    setComps([])
    setCompsNotes(null)
    try {
      const res = await fetch('/api/deals/comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: deal.company_name,
          sector: deal.sector,
          geography: deal.geography,
          ebitda: deal.ebitda,
          revenue: deal.revenue,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to pull comps')
      setComps(data.comps || [])
      setCompsNotes(data.search_notes || null)
    } catch (e: any) {
      setCompsError(e.message)
    }
    setLoadingComps(false)
  }

  // Simple toggle: Pending ↔ Complete
  const toggleDiligenceStatus = async (item: DiligenceItem) => {
    const next = item.status === 'Complete' ? 'Pending' : 'Complete'
    await supabase.from('diligence_items').update({ status: next }).eq('id', item.id)
    setDiligence(prev => prev.map(d => d.id === item.id ? { ...d, status: next } : d))
  }

  // Upload diligence checklist from Excel/CSV
  const onDropDiligence = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    try {
      let items: { category: string, item: string }[] = []
      if (file.name.endsWith('.csv')) {
        const text = await file.text()
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
        // Skip header row if present
        const start = lines[0].toLowerCase().includes('category') || lines[0].toLowerCase().includes('item') ? 1 : 0
        items = lines.slice(start).map(line => {
          const parts = line.split(',')
          return parts.length >= 2
            ? { category: parts[0].replace(/"/g,'').trim().toLowerCase(), item: parts[1].replace(/"/g,'').trim() }
            : { category: 'other', item: parts[0].replace(/"/g,'').trim() }
        }).filter(i => i.item)
      } else {
        const XLSX = await import('xlsx')
        const ab = await file.arrayBuffer()
        const wb = XLSX.read(ab, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 })
        const start = rows[0]?.some((c: any) => String(c).toLowerCase().includes('category') || String(c).toLowerCase().includes('item')) ? 1 : 0
        items = rows.slice(start).map((row: any) => row.length >= 2
          ? { category: String(row[0] || '').trim().toLowerCase() || 'other', item: String(row[1] || '').trim() }
          : { category: 'other', item: String(row[0] || '').trim() }
        ).filter(i => i.item)
      }
      if (items.length === 0) { alert('No items found in file. Columns: Category, Item'); return }
      // Replace existing checklist with uploaded items
      await supabase.from('diligence_items').delete().eq('deal_id', dealId)
      const payload = items.map(i => ({ ...i, deal_id: dealId, status: 'Pending' }))
      const { data } = await supabase.from('diligence_items').insert(payload).select()
      if (data) setDiligence(data)
    } catch (e: any) { alert('Error reading file: ' + e.message) }
  }, [dealId, supabase])

  const { getRootProps: getDiligenceDropProps, getInputProps: getDiligenceInputProps, isDragActive: isDiligenceDrag } = useDropzone({
    onDrop: onDropDiligence,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'], 'text/csv': ['.csv'] },
    maxFiles: 1,
  })

  const addInteraction = async () => {
    if (!activityForm.summary.trim()) return
    const { data } = await supabase.from('interactions').insert({
      deal_id: dealId,
      interaction_type: activityForm.interaction_type,
      summary: activityForm.summary,
      next_steps: activityForm.next_steps || null,
      interaction_date: new Date().toISOString(),
    }).select().single()
    if (data) setInteractions(prev => [data, ...prev])
    setShowActivityForm(false)
    setActivityForm({ interaction_type: 'call', summary: '', next_steps: '' })
  }

  const addCapital = async () => {
    if (!selectedCapitalContact) return
    const payload: any = {
      deal_id: dealId,
      contact_id: selectedCapitalContact.id,
      role: capitalForm.role,
      status: capitalForm.status,
    }
    if (capitalForm.committed_amount) payload.committed_amount = parseFloat(capitalForm.committed_amount) * 1e6
    const { data } = await supabase.from('deal_capital_assignments').insert(payload).select('*, contact:contacts(first_name, last_name, firm)').single()
    if (data) setCapital(prev => [...prev, data])
    setShowCapitalForm(false)
    setSelectedCapitalContact(null)
    setCapitalSearch('')
    setCapitalForm({ role: 'LP', committed_amount: '', status: 'Interested' })
  }

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>
  if (!deal) return <div style={{ padding: '40px', color: 'var(--red)' }}>Deal not found.</div>

  const completedDiligence = diligence.filter(d => d.status === 'Complete' || d.status === 'Waived').length
  const diligencePct = diligence.length > 0 ? Math.round((completedDiligence / diligence.length) * 100) : 0
  const sourceContacts = linkedContacts.filter(l => l.role === 'Source / Banker')

  const tabs = [
    { key: 'overview',  label: 'Overview' },
    { key: 'diligence', label: `Diligence${diligence.length > 0 ? ` (${diligencePct}%)` : ''}` },
    { key: 'contacts',  label: `Contacts (${linkedContacts.length})` },
    { key: 'capital',   label: `Capital (${capital.length})` },
    { key: 'activity',  label: `Activity (${interactions.length})` },
    { key: 'documents',  label: `Documents (${documents.length})` },
      ]

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* HEADER */}
      <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <Link href="/deals" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none' }}>
            <ArrowLeft size={12} /> Deals
          </Link>
          <span style={{ color: 'var(--border)', fontSize: '12px' }}>·</span>
          <Link href="/pipeline" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none' }}>
            <ArrowLeft size={12} /> Pipeline
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <EditableInline value={deal.company_name} onSave={v => updateField('company_name', v)} style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }} />
          <div style={{ position: 'relative' }}>
            <button className={`badge ${stageClass(deal.stage)}`} style={{ cursor: 'pointer', fontSize: '12px', padding: '4px 12px', border: '1px solid currentColor', background: 'transparent' }} onClick={() => setEditingStage(!editingStage)}>
              {deal.stage} <ChevronDown size={11} style={{ display: 'inline', marginLeft: '4px' }} />
            </button>
            {editingStage && (
              <div style={{ position: 'absolute', left: 0, top: '100%', marginTop: '4px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '4px', zIndex: 50, minWidth: '160px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                {STAGES.map(s => (
                  <button key={s} onClick={() => updateStage(s)} style={{ display: 'block', width: '100%', padding: '7px 12px', background: s === deal.stage ? 'var(--accent-light)' : 'transparent', border: 'none', borderRadius: '5px', cursor: 'pointer', textAlign: 'left', fontSize: '12px', color: s === deal.stage ? 'var(--accent)' : 'var(--text-primary)', fontWeight: s === deal.stage ? 600 : 400 }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <select className="select" value={deal.deal_type || 'platform'} onChange={e => updateField('deal_type', e.target.value)} style={{ width: 'auto', fontSize: '12px', padding: '3px 10px' }}>
            <option value="platform">Platform</option>
            <option value="add-on">Add-On</option>
            <option value="recap">Recap</option>
            <option value="growth">Growth</option>
          </select>
          {deal.cim_parsed && <span style={{ fontSize: '11px', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '4px' }}>● CIM Parsed</span>}
          {(deal.deal_type === 'add-on') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Parent:</span>
              <select className="select" style={{ width: 'auto', fontSize: '12px', padding: '3px 10px' }}
                value={deal.parent_company_id || ''}
                onChange={e => updateField('parent_company_id', e.target.value || null)}>
                <option value="">— Link to platform —</option>
                {portfolioCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <button onClick={() => setShowDeleteConfirm(true)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--red)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}>
            <Trash2 size={14} /> Delete deal
          </button>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
          {deal.sector && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{deal.sector}</span>}
          {deal.geography && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>· {deal.geography}</span>}
        </div>
        <div style={{ display: 'flex', gap: '28px', marginTop: '14px' }}>
          {[
            { label: 'Revenue', value: formatCurrency(deal.revenue) },
            { label: 'EBITDA', value: formatCurrency(deal.ebitda), accent: true },
          ].map(({ label, value, accent }: any) => (
            <div key={label}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ fontSize: '16px', fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent)' : 'var(--text-primary)', marginTop: '2px' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', padding: '0 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)} style={{ padding: '11px 16px', border: 'none', background: 'transparent', fontSize: '13px', cursor: 'pointer', color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent', fontFamily: 'var(--font-sans)', fontWeight: activeTab === tab.key ? 600 : 400 }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ maxWidth: '900px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
            <div className="card" style={{ padding: '20px' }}>
              <div className="label" style={{ marginBottom: '16px' }}>Deal Details</div>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div className="label">Source Contact(s)</div>
                </div>
                {sourceContacts.map(link => {
                  if (!link.contact) return null
                  return (
                  <div key={link.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: '6px', marginBottom: '6px', border: '1px solid var(--border)' }}>
                    <div>
                      <button
                        onClick={() => setEditingContact(link.contact)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{link.contact.first_name} {link.contact.last_name}</div>
                      </button>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{link.contact.firm || link.contact.title || '—'}</div>
                    </div>
                    <button onClick={() => unlinkContact(link.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}><X size={13} /></button>
                  </div>
                  )
                })}
                <div ref={searchRef} style={{ position: 'relative', marginTop: '4px' }}>
                  {showContactSearch ? (
                    <div>
                      <div style={{ position: 'relative' }}>
                        <Search size={12} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input className="input" autoFocus placeholder="Search by name or firm..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} style={{ paddingLeft: '28px', width: '100%', fontSize: '12px' }} />
                      </div>
                      {contactResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                          {contactResults.map(c => (
                            <button key={c.id} onClick={() => linkSourceContact(c)} style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.firm || c.title || c.contact_type}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {contactSearch.length > 1 && contactResults.length === 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          No contacts found for "{contactSearch}"
                        </div>
                      )}
                    </div>
                  ) : (
                    <button className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={() => setShowContactSearch(true)}>
                      <Plus size={11} /> Add source contact
                    </button>
                  )}
                </div>
              </div>
              <EditableField label="LOI Date"   value={deal.loi_date || ''}      onSave={v => updateField('loi_date', v)}       type="date" />
              <EditableField label="Entry Date"  value={deal.expected_close || ''} onSave={v => updateField('expected_close', v)} type="date" />
              <EditableField label="Geography"   value={deal.geography || ''}      onSave={v => updateField('geography', v)} />
              <EditableField label="Sector"      value={deal.sector || ''}         onSave={v => updateField('sector', v)} />
            </div>
            <div className="card" style={{ padding: '20px' }}>
              <div className="label" style={{ marginBottom: '16px' }}>Notes</div>
              <EditableField label="Description" value={deal.description || ''} onSave={v => updateField('description', v)} multiline />
              <EditableField label="Notes"       value={deal.notes || ''}       onSave={v => updateField('notes', v)}        multiline />
              {deal.cim_summary && (
                <div style={{ marginTop: '16px' }}>
                  <div className="label" style={{ marginBottom: '6px' }}>AI CIM Summary</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--surface-2)', borderRadius: '6px', padding: '12px', lineHeight: 1.7 }}>{deal.cim_summary}</div>
                </div>
              )}
            </div>
          </div>{/* end 2-col grid */}

            {/* COMPS */}
            <div className="card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div className="label">M&A Transaction Comps</div>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: '12px' }}
                  onClick={pullComps}
                  disabled={loadingComps}
                >
                  {loadingComps ? '⏳ Searching…' : comps.length > 0 ? '↺ Refresh comps' : '⬇ Pull comps'}
                </button>
              </div>

              {compsError && (
                <div style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '12px' }}>{compsError}</div>
              )}

              {loadingComps && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Searching public sources for {deal.sector || 'sector'} M&A transactions… this takes 15–30 seconds.
                </div>
              )}

              {!loadingComps && comps.length === 0 && !compsError && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Click "Pull comps" to search for comparable M&A transactions based on this deal's sector and size.
                </div>
              )}

              {comps.length > 0 && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Target','Acquirer','Sponsor','EV','Revenue','EBITDA','EV/EBITDA','Geography','Year','Source'].map(h => (
                            <th key={h} style={{ padding: '6px 10px', textAlign: h === 'EV' || h === 'Revenue' || h === 'EBITDA' || h === 'EV/EBITDA' ? 'right' : 'left', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {comps.map((c, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{c.target || '—'}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{c.acquirer || '—'}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{c.sponsor || '—'}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                              {c.ev ? `$${(c.ev / 1e6).toFixed(1)}M` : '—'}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {c.revenue ? `$${(c.revenue / 1e6).toFixed(1)}M` : '—'}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {c.ebitda ? `$${(c.ebitda / 1e6).toFixed(1)}M` : '—'}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: c.ev_ebitda ? 'var(--accent)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {c.ev_ebitda ? `${c.ev_ebitda.toFixed(1)}x` : '—'}
                            </td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{c.geography || '—'}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{c.year || '—'}</td>
                            <td style={{ padding: '8px 10px' }}>
                              {c.source_url ? (
                                <a href={c.source_url} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: '10px', color: 'var(--accent)', textDecoration: 'none' }}
                                  onClick={e => e.stopPropagation()}>
                                  {c.source_name || 'Link'} ↗
                                </a>
                              ) : (
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{c.source_name || '—'}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Summary row */}
                      {comps.filter(c => c.ev_ebitda).length > 1 && (() => {
                        const withMultiples = comps.filter(c => c.ev_ebitda)
                        const avg = withMultiples.reduce((s, c) => s + c.ev_ebitda, 0) / withMultiples.length
                        const min = Math.min(...withMultiples.map(c => c.ev_ebitda))
                        const max = Math.max(...withMultiples.map(c => c.ev_ebitda))
                        return (
                          <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface-2)' }}>
                              <td colSpan={6} style={{ padding: '8px 10px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {withMultiples.length} comps
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
                                {avg.toFixed(1)}x avg<br/>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>{min.toFixed(1)}x – {max.toFixed(1)}x</span>
                              </td>
                              <td colSpan={3} />
                            </tr>
                          </tfoot>
                        )
                      })()}
                    </table>
                  </div>
                  {compsNotes && (
                    <div style={{ marginTop: '10px', fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5 }}>
                      {compsNotes}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* DILIGENCE */}
        {activeTab === 'diligence' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {diligence.length === 0 && <button className="btn btn-ghost" onClick={seedDiligence} style={{ fontSize: '12px' }}>Load default checklist</button>}
              {diligence.length > 0 && <button className="btn btn-ghost" onClick={resetDiligence} style={{ fontSize: '12px', color: 'var(--text-muted)' }}>↺ Reset to defaults</button>}
              <div {...getDiligenceDropProps()} style={{ border: `1.5px dashed ${isDiligenceDrag ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '7px', padding: '6px 14px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', background: isDiligenceDrag ? 'var(--accent-muted)' : 'transparent' }}>
                <input {...getDiligenceInputProps()} />
                <Upload size={12} /> Upload Excel/CSV checklist
              </div>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={async () => {
                const item = prompt('New checklist item:')
                if (!item) return
                const { data } = await supabase.from('diligence_items').insert({ deal_id: dealId, item, status: 'Pending' }).select().single()
                if (data) setDiligence(prev => [...prev, data])
              }}>
                <Plus size={12} /> Add Item
              </button>
              <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{completedDiligence} of {diligence.length} complete</div>
            </div>
            {diligence.length > 0 && (
              <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', marginBottom: '20px' }}>
                <div style={{ height: '100%', width: `${diligencePct}%`, background: 'var(--accent)', borderRadius: '2px', transition: 'width 0.3s' }} />
              </div>
            )}
            {['financial','legal','operational','management','other',''].map(category => {
              const items = diligence.filter(d => (d.category || '') === category)
              if (!items.length) return null
              return (
                <div key={category} style={{ marginBottom: '20px' }}>
                  {category && <div className="label" style={{ marginBottom: '8px', textTransform: 'capitalize' }}>{category}</div>}
                  {items.map(item => (
                    <div key={item.id} className="card-2" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', marginBottom: '6px', cursor: 'pointer' }} onClick={() => toggleDiligenceStatus(item)}>
                      <div style={{ width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${item.status === 'Complete' ? 'var(--green)' : 'var(--border)'}`, background: item.status === 'Complete' ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                        {item.status === 'Complete' && <Check size={11} color="white" strokeWidth={3} />}
                      </div>
                      <div style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)' }}>{item.item}</div>
                      <button onClick={async (e) => { e.stopPropagation(); await supabase.from('diligence_items').delete().eq('id', item.id); setDiligence(prev => prev.filter(d => d.id !== item.id)) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', opacity: 0 }} className="delete-btn">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* CONTACTS */}
        {activeTab === 'contacts' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
              <div ref={searchRef} style={{ position: 'relative' }}>
                {showContactSearch ? (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ position: 'relative' }}>
                        <Search size={12} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input className="input" autoFocus placeholder="Search by name or firm..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} style={{ paddingLeft: '28px', width: '260px', fontSize: '12px' }} />
                      </div>
                      {contactResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', minWidth: '280px' }}>
                          {contactResults.map(c => (
                            <button key={c.id} onClick={() => linkContact(c, pendingContactRole)} style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.firm || c.title || c.contact_type}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {contactSearch.length > 1 && contactResults.length === 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          No contacts found for "{contactSearch}"
                        </div>
                      )}
                    </div>
                    <select
                      value={pendingContactRole}
                      onChange={e => setPendingContactRole(e.target.value)}
                      className="input"
                      style={{ fontSize: '12px', padding: '6px 8px', height: '34px' }}
                    >
                      {['Source / Banker','Advisor','Management','LP','Lender','Contact'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowContactSearch(true)}>
                    <Plus size={12} /> Link Contact
                  </button>
                )}
              </div>
            </div>
            {linkedContacts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No contacts linked to this deal.</div>
            ) : linkedContacts.map(link => {
              const c = link.contact
              if (!c) return null
              return (
                <div key={link.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <button
                      onClick={() => setEditingContact(c)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                    >
                      <div style={{ fontWeight: 500, fontSize: '13px', color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{c.first_name} {c.last_name}</div>
                    </button>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{c.title}{c.firm ? ` · ${c.firm}` : ''}{link.role ? ` · ${link.role}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {c.contact_type && <span className={`badge type-${c.contact_type}`}>{c.contact_type}</span>}
                    {c.email && <a href={`mailto:${c.email}`} style={{ color: 'var(--text-muted)' }}><Mail size={13} /></a>}
                    {c.phone && <a href={`tel:${c.phone}`} style={{ color: 'var(--text-muted)' }}><Phone size={13} /></a>}
                    <button onClick={() => unlinkContact(link.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}><X size={13} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* CAPITAL */}
        {activeTab === 'capital' && (
          <div style={{ maxWidth: '800px' }}>

            {/* Linked Capital Raises */}
            {dealRaises.length > 0 ? (
              <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div className="label">Capital Raises</div>
                  <Link href="/raises" style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}>View all raises →</Link>
                </div>
                {dealRaises.map(raise => {
                  const participants = raise.participants || []
                  const isDebt = /debt/i.test(raise.name)
                  const invested = participants.filter((p: any) => ['invested','confirmed'].includes(p.status))
                  const active = participants.filter((p: any) => !['pass','no_response','invested','confirmed'].includes(p.status))
                  const passed = participants.filter((p: any) => ['pass','no_response'].includes(p.status))
                  const totalCommitted = invested.reduce((s: number, p: any) => s + (p.committed_amount ?? p.debt_amount ?? 0), 0)
                  const target = isDebt ? raise.target_debt : raise.target_equity
                  return (
                    <div key={raise.id} className="card" style={{ padding: '16px 20px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px' }}>{raise.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {raise.status} · {participants.length} participant{participants.length !== 1 ? 's' : ''}
                            {raise.close_date ? ` · Target close ${new Date(raise.close_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}
                          </div>
                        </div>
                        <Link href="/raises" style={{ fontSize: '11px', color: 'var(--text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          Open tracker <ChevronRight size={11} />
                        </Link>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: participants.length > 0 ? '14px' : '0' }}>
                        {[
                          { label: 'Target', val: target ? `$${(target/1e6).toFixed(1)}M` : '—' },
                          { label: 'Committed', val: totalCommitted > 0 ? `$${(totalCommitted/1e6).toFixed(1)}M` : '—', accent: true },
                          { label: isDebt ? 'Lenders active' : 'Investors active', val: String(active.length) },
                          { label: 'Passed', val: String(passed.length) },
                        ].map(m => (
                          <div key={m.label} style={{ background: 'var(--surface-2)', borderRadius: '6px', padding: '8px 10px' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</div>
                            <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '2px', fontFamily: 'var(--font-mono)', color: (m as any).accent ? 'var(--accent)' : 'var(--text-primary)' }}>{m.val}</div>
                          </div>
                        ))}
                      </div>
                      {invested.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>✓ Committed / Invested</div>
                          {invested.map((p: any) => (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                              <span style={{ color: 'var(--text-primary)' }}>{p.firm_name}{p.contact_name ? ` · ${p.contact_name}` : ''}</span>
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>
                                {(p.committed_amount ?? p.debt_amount) ? `$${((p.committed_amount ?? p.debt_amount)/1e6).toFixed(1)}M` : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ marginBottom: '20px', padding: '16px', background: 'var(--surface-2)', borderRadius: '8px', border: '1px dashed var(--border)' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  No capital raises linked to this deal yet.{' '}
                  <Link href="/raises" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Go to Capital Raises →</Link>
                </div>
              </div>
            )}

            {/* Legacy LP/Lender Assignments */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div className="label">Direct Assignments</div>
                <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowCapitalForm(!showCapitalForm)}>
                  <Plus size={12} /> Add LP / Lender
                </button>
              </div>
            </div>

            {showCapitalForm && (
              <div className="card" style={{ padding: '20px', marginBottom: '16px', border: '1px solid var(--accent)' }}>
                <div className="label" style={{ marginBottom: '14px' }}>Add Capital Assignment</div>

                {/* Contact search */}
                <div style={{ marginBottom: '12px' }}>
                  <label className="label">Contact *</label>
                  {selectedCapitalContact ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '7px' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{selectedCapitalContact.first_name} {selectedCapitalContact.last_name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{selectedCapitalContact.firm}</div>
                      </div>
                      <button onClick={() => setSelectedCapitalContact(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={13} /></button>
                    </div>
                  ) : (
                    <div ref={capitalSearchRef} style={{ position: 'relative' }}>
                      <div style={{ position: 'relative' }}>
                        <Search size={12} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input className="input" placeholder="Search contacts..." value={capitalSearch} onChange={e => setCapitalSearch(e.target.value)} style={{ paddingLeft: '28px', fontSize: '12px' }} />
                      </div>
                      {capitalResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                          {capitalResults.map(c => (
                            <button key={c.id} onClick={() => { setSelectedCapitalContact(c); setCapitalSearch(''); setCapitalResults([]) }} style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.firm || c.contact_type}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div>
                    <label className="label">Role</label>
                    <select className="select" value={capitalForm.role} onChange={e => setCapitalForm(p => ({ ...p, role: e.target.value }))}>
                      <option value="LP">LP</option>
                      <option value="Senior Lender">Senior Lender</option>
                      <option value="Mezzanine">Mezzanine</option>
                      <option value="Co-Investor">Co-Investor</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Committed ($M)</label>
                    <input className="input" type="number" step="0.1" placeholder="0.0" value={capitalForm.committed_amount} onChange={e => setCapitalForm(p => ({ ...p, committed_amount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select className="select" value={capitalForm.status} onChange={e => setCapitalForm(p => ({ ...p, status: e.target.value }))}>
                      <option value="Interested">Interested</option>
                      <option value="Soft Circle">Soft Circle</option>
                      <option value="Committed">Committed</option>
                      <option value="Passed">Passed</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setShowCapitalForm(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={addCapital} disabled={!selectedCapitalContact}>
                    <Check size={13} /> Add
                  </button>
                </div>
              </div>
            )}

            {capital.length === 0 && !showCapitalForm ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No direct LP or lender assignments yet.</div>
            ) : capital.map(a => (
              <div key={a.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', alignItems: 'center', gap: '12px' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13px' }}>{a.contact?.first_name} {a.contact?.last_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.contact?.firm}</div>
                </div>
                <span className="badge type-lender" style={{ justifySelf: 'start' }}>{a.role}</span>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent)', textAlign: 'right' }}>{a.committed_amount ? formatCurrency(a.committed_amount) : '—'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>{a.status}</div>
              </div>
            ))}
          </div>
        )}

        {/* ACTIVITY */}
        {activeTab === 'activity' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ marginBottom: '16px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowActivityForm(!showActivityForm)}>
                <Plus size={12} /> Log Interaction
              </button>
            </div>

            {showActivityForm && (
              <div className="card" style={{ padding: '20px', marginBottom: '16px', border: '1px solid var(--accent)' }}>
                <div className="label" style={{ marginBottom: '14px' }}>Log Interaction</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                  <div>
                    <label className="label">Type</label>
                    <select className="select" value={activityForm.interaction_type} onChange={e => setActivityForm(p => ({ ...p, interaction_type: e.target.value }))}>
                      <option value="call">Call</option>
                      <option value="meeting">Meeting</option>
                      <option value="email">Email</option>
                      <option value="note">Note</option>
                      <option value="site visit">Site Visit</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Summary *</label>
                    <textarea className="input" rows={3} style={{ resize: 'vertical' }} placeholder="What happened, what was discussed..." value={activityForm.summary} onChange={e => setActivityForm(p => ({ ...p, summary: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Next Steps</label>
                    <input className="input" placeholder="Follow-up actions..." value={activityForm.next_steps} onChange={e => setActivityForm(p => ({ ...p, next_steps: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '14px' }}>
                  <button className="btn btn-ghost" onClick={() => setShowActivityForm(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={addInteraction} disabled={!activityForm.summary.trim()}>
                    <Check size={13} /> Save
                  </button>
                </div>
              </div>
            )}

            {interactions.length === 0 && !showActivityForm ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No interactions logged yet.</div>
            ) : interactions.map(i => (
              <div key={i.id} className="card-2" style={{ padding: '14px 16px', marginBottom: '8px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {i.interaction_type} · {format(new Date(i.interaction_date), 'MMM d, yyyy')}
                  {(i as any).contact && ` · ${(i as any).contact.first_name} ${(i as any).contact.last_name}`}
                </div>
                {i.summary && <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginTop: '6px' }}>{i.summary}</div>}
                {i.next_steps && <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '6px' }}>→ {i.next_steps}</div>}
              </div>
            ))}
          </div>
        )}

        {/* DOCUMENTS */}
        {activeTab === 'documents' && (
          <div style={{ maxWidth: '700px' }}>
            <DocumentsTab dealId={dealId} />
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div className="card" style={{ padding: '28px', maxWidth: '400px', width: '90%' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Delete this deal?</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>This will permanently delete <strong>{deal.company_name}</strong> and all associated data. This cannot be undone.</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteDeal}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}

      {/* Contact edit modal */}
      {editingContact && (
        <NewContactModal
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onCreated={() => { setEditingContact(null); fetchAll() }}
        />
      )}

      <UndoToast stack={undoStack} onUndo={handleUndo} onDismiss={handleDismiss}/>
    </div>
  )
}

function EditableField({ label, value, onSave, type = 'text', multiline = false, placeholder }: {
  label: string, value: string, onSave: (v: string) => void,
  type?: string, multiline?: boolean, placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  useEffect(() => { setVal(value) }, [value])
  const save = () => { onSave(val); setEditing(false) }
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '10px' }}>
      <div style={{ minWidth: '100px', fontSize: '11px', color: 'var(--text-muted)', paddingTop: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {editing ? (
        <div style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          {multiline ? <textarea className="input" value={val} onChange={e => setVal(e.target.value)} rows={3} style={{ resize: 'vertical', fontSize: '13px' }} />
            : <input className="input" value={val} type={type} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder={placeholder} style={{ fontSize: '13px' }} />}
          <button className="btn btn-ghost" onClick={save} style={{ padding: '6px' }}><Check size={13} /></button>
          <button className="btn btn-ghost" onClick={() => { setEditing(false); setVal(value) }} style={{ padding: '6px' }}><X size={13} /></button>
        </div>
      ) : (
        <div style={{ flex: 1, fontSize: '13px', color: value ? 'var(--text-primary)' : 'var(--text-muted)', padding: '5px 6px', borderRadius: '5px', cursor: 'text', minHeight: '28px' }} onClick={() => setEditing(true)}>
          {value || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Click to edit</span>}
        </div>
      )}
    </div>
  )
}

function EditableInline({ value, onSave, style }: { value: string, onSave: (v: string) => void, style?: any }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  useEffect(() => { setVal(value) }, [value])
  const save = () => { if (val.trim()) { onSave(val); setEditing(false) } }
  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input autoFocus className="input" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} style={{ fontSize: '22px', fontWeight: 700, padding: '4px 8px', width: '320px' }} />
      <button className="btn btn-primary" onClick={save} style={{ padding: '4px 10px', fontSize: '12px' }}>Save</button>
      <button className="btn btn-ghost" onClick={() => setEditing(false)} style={{ padding: '4px 10px', fontSize: '12px' }}>Cancel</button>
    </div>
  )
  return (
    <h1 style={{ ...style, cursor: 'pointer', borderBottom: '1px dashed transparent', display: 'inline-block' }} onClick={() => setEditing(true)} title="Click to edit name"
      onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--text-muted)')}
      onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}>
      {value}
    </h1>
  )
}
