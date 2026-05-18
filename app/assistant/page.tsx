'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Bot, User, AlertTriangle, Check, X, RefreshCw, Star } from 'lucide-react'

type Message = {
  id: string
  role: 'user' | 'assistant' | 'confirmation' | 'system'
  content: string
  toolName?: string
  toolInput?: any
  toolUseId?: string
  messagesSoFar?: any[]
}

const TOOL_LABELS: Record<string, string> = {
  update_deal_stage: 'Update deal stage',
  log_note: 'Log a note',
  update_raise_participant_status: 'Update raise participant status',
}

const TOOL_SUMMARIES: Record<string, (input: any) => string> = {
  update_deal_stage: (i) => `Change **${i.company_name}** from ${i.current_stage || '?'} → **${i.new_stage}**`,
  log_note: (i) => `Log note: "${i.summary.slice(0, 120)}${i.summary.length > 120 ? '…' : ''}"${i.deal_id ? ' (linked to deal)' : ''}`,
  update_raise_participant_status: (i) => `Update **${i.firm_name}** on ${i.raise_name || 'raise'}: ${i.current_status || '?'} → **${i.new_status}**`,
}

const SUGGESTED_PROMPTS = [
  'Show me all active deals in the pipeline',
  'What\'s our total committed capital across open raises?',
  'Which lenders have we talked to about DiPonio?',
  'Find contacts at BMO',
  'What notes do we have from this week?',
  'What are current senior debt pricing benchmarks for infrastructure services?',
]

function renderMarkdown(text: string) {
  // Simple markdown: bold, bullets, line breaks
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

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [apiMessages, setApiMessages] = useState<any[]>([]) // full Anthropic message history
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const uid = () => Math.random().toString(36).slice(2)

  const sendMessage = useCallback(async (text: string, currentApiMessages = apiMessages) => {
    if (!text.trim() || loading) return
    setLoading(true)

    const userMsg: Message = { id: uid(), role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')

    const newApiMessages = [
      ...currentApiMessages,
      { role: 'user', content: text },
    ]
    setApiMessages(newApiMessages)

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newApiMessages }),
      })
      const data = await res.json()

      if (data.error) {
        setMessages(prev => [...prev, { id: uid(), role: 'system', content: `Error: ${data.error}` }])
        setLoading(false)
        return
      }

      if (data.type === 'text') {
        const assistantMsg: Message = { id: uid(), role: 'assistant', content: data.content }
        setMessages(prev => [...prev, assistantMsg])
        setApiMessages([
          ...newApiMessages,
          { role: 'assistant', content: data.content },
        ])
      } else if (data.type === 'confirmation') {
        const confirmMsg: Message = {
          id: uid(),
          role: 'confirmation',
          content: data.preview_text || '',
          toolName: data.tool_name,
          toolInput: data.tool_input,
          toolUseId: data.tool_use_id,
          messagesSoFar: data.messages_so_far,
        }
        setMessages(prev => [...prev, confirmMsg])
        setApiMessages(data.messages_so_far)
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { id: uid(), role: 'system', content: `Network error: ${e.message}` }])
    }
    setLoading(false)
  }, [loading, apiMessages])

  const handleConfirm = async (msg: Message) => {
    setLoading(true)
    // Replace confirmation bubble with "confirming…" state
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: '✓ Confirmed — executing…' } : m))

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msg.messagesSoFar,
          confirming: {
            tool_use_id: msg.toolUseId,
            tool_name: msg.toolName,
            input: msg.toolInput,
          },
        }),
      })
      const data = await res.json()
      if (data.type === 'text') {
        setMessages(prev => prev.map(m => m.id === msg.id
          ? { ...m, role: 'system', content: '✓ Done' }
          : m
        ))
        setMessages(prev => [...prev, { id: uid(), role: 'assistant', content: data.content }])
        setApiMessages([
          ...(msg.messagesSoFar || []),
          { role: 'assistant', content: data.content },
        ])
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, role: 'system', content: `Error: ${e.message}` } : m))
    }
    setLoading(false)
  }

  const handleDeny = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId
      ? { ...m, role: 'system', content: '✕ Cancelled' }
      : m
    ))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const clearThread = () => {
    setMessages([])
    setApiMessages([])
    setInput('')
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Star size={18} style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Nexus Assistant</h1>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '4px' }}>
          Ask anything about your deals, contacts, raises, and portfolio — or the market
        </div>
        {messages.length > 0 && (
          <button onClick={clearThread} className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <RefreshCw size={12} /> New thread
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 0' }}>
        {messages.length === 0 ? (
          <div style={{ padding: '0 28px', maxWidth: '720px', margin: '0 auto' }}>
            <div style={{ marginBottom: '32px' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                What can I help you with?
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                I can search your deals, contacts, raises, notes, and portfolio — or look things up on the web. I can also make changes with your confirmation.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {SUGGESTED_PROMPTS.map(p => (
                <button key={p} onClick={() => sendMessage(p)}
                  style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, transition: 'all 0.15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 28px', maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {messages.map(msg => (
              <div key={msg.id} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>

                {/* Avatar */}
                {msg.role !== 'system' && (
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                    background: msg.role === 'user' ? 'var(--accent)' : msg.role === 'confirmation' ? '#f59e0b' : 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {msg.role === 'user' ? <User size={14} color="white" /> :
                     msg.role === 'confirmation' ? <AlertTriangle size={14} color="white" /> :
                     <Bot size={14} style={{ color: 'var(--accent)' }} />}
                  </div>
                )}

                {/* Bubble */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {msg.role === 'user' && (
                    <div style={{ background: 'var(--accent)', color: '#fff', padding: '10px 14px', borderRadius: '12px 4px 12px 12px', fontSize: '13px', lineHeight: 1.6, display: 'inline-block', maxWidth: '100%' }}>
                      {msg.content}
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: '4px 12px 12px 12px', fontSize: '13px', lineHeight: 1.7, color: 'var(--text-primary)' }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  )}

                  {msg.role === 'confirmation' && (
                    <div style={{ background: 'var(--surface)', border: '1px solid #f59e0b', padding: '14px 16px', borderRadius: '4px 12px 12px 12px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                        ⚡ Confirm action: {TOOL_LABELS[msg.toolName!] || msg.toolName}
                      </div>
                      {msg.content && (
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                      )}
                      <div style={{ fontSize: '13px', color: 'var(--text-primary)', background: 'var(--surface-2)', borderRadius: '6px', padding: '10px 12px', marginBottom: '12px', lineHeight: 1.6 }}
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(TOOL_SUMMARIES[msg.toolName!]?.(msg.toolInput) || JSON.stringify(msg.toolInput, null, 2)) }} />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => handleConfirm(msg)} className="btn btn-primary" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Check size={12} /> Confirm
                        </button>
                        <button onClick={() => handleDeny(msg.id)} className="btn btn-ghost" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <X size={12} /> Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {msg.role === 'system' && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                      {msg.content}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Bot size={14} style={{ color: 'var(--accent)' }} />
                </div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: '4px 12px 12px 12px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', opacity: 0.4, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', position: 'relative' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"
            disabled={loading}
            rows={1}
            style={{
              width: '100%', resize: 'none', padding: '12px 48px 12px 16px',
              fontSize: '13px', lineHeight: 1.5, borderRadius: '10px',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font-sans)',
              maxHeight: '160px', overflowY: 'auto', boxSizing: 'border-box',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
            onInput={e => {
              const t = e.target as HTMLTextAreaElement
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 160) + 'px'
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            style={{
              position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
              background: input.trim() ? 'var(--accent)' : 'var(--border)',
              border: 'none', borderRadius: '7px', width: '30px', height: '30px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: input.trim() ? 'pointer' : 'default', transition: 'background 0.15s',
            }}
          >
            <Send size={13} color="white" />
          </button>
        </div>
        <div style={{ maxWidth: '720px', margin: '6px auto 0', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
          Reads from and writes to Nexus · Web search enabled · Changes require confirmation
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
