'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Send, Bot, User, AlertTriangle, Check, X, RefreshCw, Star, Clock, Plus, Trash2 } from 'lucide-react'

type Message = {
  id: string
  role: 'user' | 'assistant' | 'confirmation' | 'system'
  content: string
  toolName?: string
  toolInput?: any
  toolUseId?: string
  messagesSoFar?: any[]
}

type Thread = {
  id: string
  created_at: string
  updated_at: string
  title: string | null
  user_name: string | null
  messages: Message[]
  api_messages: any[]
}

const TOOL_LABELS: Record<string, string> = {
  update_deal_stage: 'Update deal stage',
  log_note: 'Log a note',
  update_raise_participant_status: 'Update raise participant status',
}

const TOOL_SUMMARIES: Record<string, (input: any) => string> = {
  update_deal_stage: (i) => `Change **${i.company_name}** from ${i.current_stage || '?'} to **${i.new_stage}**`,
  log_note: (i) => `Log note: "${i.summary.slice(0, 120)}${i.summary.length > 120 ? '...' : ''}"`,
  update_raise_participant_status: (i) => `Update **${i.firm_name}** on ${i.raise_name || 'raise'}: ${i.current_status || '?'} to **${i.new_status}**`,
}

const SUGGESTED_PROMPTS = [
  "Show me all active deals in the pipeline",
  "What's our total committed capital across open raises?",
  "Which lenders have we talked to about DiPonio?",
  "Find contacts at BMO",
  "What notes do we have from this week?",
  "What are current senior debt pricing benchmarks for infrastructure services?",
]

function renderMarkdown(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*)/gm, '<h3 style="font-size:13px;font-weight:700;margin:12px 0 4px">$1</h3>')
    .replace(/^## (.*)/gm, '<h2 style="font-size:14px;font-weight:700;margin:14px 0 6px">$1</h2>')
    .replace(/^- (.*)/gm, '<li style="margin:2px 0;padding-left:4px">$1</li>')
    .replace(/(<li.*<\/li>)/gs, '<ul style="margin:6px 0;padding-left:16px">$1</ul>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>')
}

function fmtTime(d: string) {
  const date = new Date(d)
  const now = new Date()
  const diffH = (now.getTime() - date.getTime()) / 3600000
  if (diffH < 24) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diffH < 168) return date.toLocaleDateString('en-US', { weekday: 'short' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function AssistantPage() {
  const supabase = createClient()
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThread, setActiveThread] = useState<Thread | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [apiMessages, setApiMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [showSidebar, setShowSidebar] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { loadThreads() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const loadThreads = async () => {
    setLoadingThreads(true)
    const { data } = await supabase
      .from('assistant_threads')
      .select('id, created_at, updated_at, title, user_name, messages, api_messages')
      .order('updated_at', { ascending: false })
      .limit(50)
    setThreads((data as Thread[]) ?? [])
    setLoadingThreads(false)
  }

  const openThread = (thread: Thread) => {
    setActiveThread(thread)
    setMessages(thread.messages || [])
    setApiMessages(thread.api_messages || [])
  }

  const newThread = () => {
    setActiveThread(null)
    setMessages([])
    setApiMessages([])
    setInput('')
  }

  const deleteThread = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await supabase.from('assistant_threads').delete().eq('id', id)
    setThreads(prev => prev.filter(t => t.id !== id))
    if (activeThread?.id === id) newThread()
  }

  const saveThread = async (threadId: string | null, msgs: Message[], apiMsgs: any[], title?: string) => {
    const payload: any = { messages: msgs, api_messages: apiMsgs, updated_at: new Date().toISOString() }
    if (title) payload.title = title
    if (threadId) {
      await supabase.from('assistant_threads').update(payload).eq('id', threadId)
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, ...payload } : t))
      return threadId
    } else {
      const { data } = await supabase.from('assistant_threads').insert({ ...payload, title: title || 'New conversation' }).select().single()
      if (data) {
        setActiveThread(data as Thread)
        setThreads(prev => [data as Thread, ...prev])
        return data.id
      }
    }
    return null
  }

  const uid = () => Math.random().toString(36).slice(2)

  const sendMessage = useCallback(async (text: string, currentApiMessages = apiMessages) => {
    if (!text.trim() || loading) return
    setLoading(true)

    const userMsg: Message = { id: uid(), role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')

    const newApiMessages = [...currentApiMessages, { role: 'user', content: text }]
    setApiMessages(newApiMessages)

    const isFirst = messages.length === 0
    const title = isFirst ? text.slice(0, 60) + (text.length > 60 ? '...' : '') : undefined
    let threadId = activeThread?.id ?? null

    // Create thread immediately on first message
    if (!threadId) {
      const saved = await saveThread(null, newMessages, newApiMessages, title)
      threadId = saved
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90000)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ messages: newApiMessages }),
      })
      clearTimeout(timeout)
      const data = await res.json()

      if (data.error) {
        const errMsg: Message = { id: uid(), role: 'system', content: `Error: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}` }
        const final = [...newMessages, errMsg]
        setMessages(final)
        await saveThread(threadId, final, newApiMessages)
        return
      }

      if (data.type === 'text') {
        const aMsg: Message = { id: uid(), role: 'assistant', content: data.content }
        const final = [...newMessages, aMsg]
        const finalApi = [...newApiMessages, { role: 'assistant', content: data.content }]
        setMessages(final)
        setApiMessages(finalApi)
        await saveThread(threadId, final, finalApi, title)
      } else if (data.type === 'confirmation') {
        const cMsg: Message = {
          id: uid(), role: 'confirmation', content: data.preview_text || '',
          toolName: data.tool_name, toolInput: data.tool_input,
          toolUseId: data.tool_use_id, messagesSoFar: data.messages_so_far,
        }
        const final = [...newMessages, cMsg]
        setMessages(final)
        setApiMessages(data.messages_so_far)
        await saveThread(threadId, final, data.messages_so_far, title)
      }
    } catch (e: any) {
      clearTimeout(timeout)
      const errText = e.name === 'AbortError' ? 'Request timed out (90s). Try again.' : `Network error: ${e.message}`
      setMessages(prev => [...prev, { id: uid(), role: 'system', content: errText }])
    } finally {
      setLoading(false)
    }
  }, [loading, apiMessages, messages, activeThread, supabase])

  const handleConfirm = async (msg: Message) => {
    setLoading(true)
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: 'Confirmed - executing...' } : m))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90000)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: msg.messagesSoFar,
          confirming: { tool_use_id: msg.toolUseId, tool_name: msg.toolName, input: msg.toolInput },
        }),
      })
      clearTimeout(timeout)
      const data = await res.json()

      if (data.error) {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, role: 'system', content: `Error: ${data.error}` } : m))
      } else if (data.type === 'text') {
        const doneMsg: Message = { id: uid(), role: 'system', content: 'Done' }
        const aMsg: Message = { id: uid(), role: 'assistant', content: data.content }
        const finalApi = [...(msg.messagesSoFar || []), { role: 'assistant', content: data.content }]
        const threadId = activeThread?.id ?? null
        let snapshotMsgs: Message[] = []
        setMessages(prev => {
          const updated = prev.map(m => m.id === msg.id ? doneMsg : m)
          snapshotMsgs = [...updated, aMsg]
          return snapshotMsgs
        })
        setApiMessages(finalApi)
        await saveThread(threadId, snapshotMsgs, finalApi)
      } else {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, role: 'system', content: `Unexpected response: ${JSON.stringify(data)}` } : m))
      }
    } catch (e: any) {
      clearTimeout(timeout)
      const errText = e.name === 'AbortError' ? 'Request timed out (90s). Try again.' : `Error: ${e.message}`
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, role: 'system', content: errText } : m))
    } finally {
      setLoading(false)
    }
  }

  const handleDeny = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, role: 'system', content: 'Cancelled' } : m))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  return (
    <div style={{ height: '100vh', display: 'flex' }}>

      {/* Thread sidebar */}
      {showSidebar && (
        <div style={{ width: '220px', flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Threads</span>
            <button onClick={newThread} className="btn btn-ghost" style={{ padding: '3px 7px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Plus size={11} /> New
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {loadingThreads ? (
              <div style={{ padding: '14px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>Loading...</div>
            ) : threads.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No conversations yet</div>
            ) : threads.map(t => (
              <div key={t.id} onClick={() => openThread(t)}
                style={{ padding: '9px 12px', cursor: 'pointer', background: activeThread?.id === t.id ? 'var(--accent-muted)' : undefined, borderLeft: activeThread?.id === t.id ? '2px solid var(--accent)' : '2px solid transparent', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}
                onMouseEnter={e => { if (activeThread?.id !== t.id) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                onMouseLeave={e => { if (activeThread?.id !== t.id) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || 'Untitled'}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Clock size={9} /> {fmtTime(t.updated_at)}
                  </div>
                </div>
                <button onClick={e => deleteThread(t.id, e)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--red)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => setShowSidebar(s => !s)} className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '11px' }}>{showSidebar ? '◂' : '▸'}</button>
          <Star size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: '15px', fontWeight: 700 }}>{activeThread?.title || 'Nexus Assistant'}</span>
          {!activeThread && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Ask anything about your deals, contacts, raises, and portfolio</span>}
          {messages.length > 0 && (
            <button onClick={newThread} className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <RefreshCw size={12} /> New
            </button>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 0' }}>
          {messages.length === 0 ? (
            <div style={{ padding: '0 24px', maxWidth: '640px', margin: '0 auto' }}>
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px' }}>What can I help you with?</div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>I can search deals, contacts, raises, notes, and portfolio — or look things up on the web. I can also make changes with your confirmation.</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {SUGGESTED_PROMPTS.map(p => (
                  <button key={p} onClick={() => sendMessage(p)}
                    style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: '0 24px', maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {messages.map(msg => (
                <div key={msg.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                  {msg.role !== 'system' && (
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, background: msg.role === 'user' ? 'var(--accent)' : msg.role === 'confirmation' ? '#f59e0b' : 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {msg.role === 'user' ? <User size={13} color="white" /> : msg.role === 'confirmation' ? <AlertTriangle size={13} color="white" /> : <Bot size={13} style={{ color: 'var(--accent)' }} />}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {msg.role === 'user' && (
                      <div style={{ background: 'var(--accent)', color: '#fff', padding: '9px 13px', borderRadius: '12px 4px 12px 12px', fontSize: '13px', lineHeight: 1.6, display: 'inline-block', maxWidth: '100%' }}>{msg.content}</div>
                    )}
                    {msg.role === 'assistant' && (
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '11px 15px', borderRadius: '4px 12px 12px 12px', fontSize: '13px', lineHeight: 1.7 }}
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                    )}
                    {msg.role === 'confirmation' && (
                      <div style={{ background: 'var(--surface)', border: '1px solid #f59e0b', padding: '13px 15px', borderRadius: '4px 12px 12px 12px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '7px' }}>Confirm: {TOOL_LABELS[msg.toolName!] || msg.toolName}</div>
                        {msg.content && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />}
                        <div style={{ fontSize: '13px', background: 'var(--surface-2)', borderRadius: '6px', padding: '9px 11px', marginBottom: '10px', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(TOOL_SUMMARIES[msg.toolName!]?.(msg.toolInput) || JSON.stringify(msg.toolInput)) }} />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => handleConfirm(msg)} className="btn btn-primary" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}><Check size={12} /> Confirm</button>
                          <button onClick={() => handleDeny(msg.id)} className="btn btn-ghost" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}><X size={12} /> Cancel</button>
                        </div>
                      </div>
                    )}
                    {msg.role === 'system' && <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '3px 0' }}>{msg.content}</div>}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Bot size={13} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: '4px 12px 12px 12px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
          <div style={{ maxWidth: '640px', margin: '0 auto', position: 'relative' }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Ask anything... (Enter to send, Shift+Enter for new line)"
              disabled={loading} rows={1}
              style={{ width: '100%', resize: 'none', padding: '11px 46px 11px 14px', fontSize: '13px', lineHeight: 1.5, borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font-sans)', maxHeight: '140px', overflowY: 'auto', boxSizing: 'border-box' }}
              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px' }} />
            <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()}
              style={{ position: 'absolute', right: '9px', top: '50%', transform: 'translateY(-50%)', background: input.trim() ? 'var(--accent)' : 'var(--border)', border: 'none', borderRadius: '7px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: input.trim() ? 'pointer' : 'default' }}>
              <Send size={12} color="white" />
            </button>
          </div>
          <div style={{ maxWidth: '640px', margin: '5px auto 0', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
            Reads from and writes to Nexus · Web search enabled · Changes require confirmation
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  )
}
