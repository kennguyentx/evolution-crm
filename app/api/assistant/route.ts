// app/api/assistant/route.ts
// Web chat assistant — streaming responses + write-tool confirmation flow.
// The tool engine (definitions, executeTool, system prompt) lives in lib/assistant-core.ts,
// shared with the email ("Ask:") assistant.

export const maxDuration = 120 // seconds — agent loops need more than the 10s default

import { NextRequest, NextResponse } from 'next/server'
import { AI_MODELS } from '@/lib/ai-config'
import { anthropic, TOOLS, WRITE_TOOLS, executeTool, buildSystemPrompt } from '@/lib/assistant-core'

// ─── Message sanitizer ────────────────────────────────────────
// Ensures every assistant message with tool_use blocks is immediately followed
// by a user message with matching tool_result blocks; injects synthetic error
// results for any orphaned tool_use so the API doesn't 400.
function sanitizeMessages(msgs: any[]): any[] {
  const out: any[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    out.push(msg)
    if (msg.role !== 'assistant') continue
    const toolUses: any[] = Array.isArray(msg.content) ? msg.content.filter((b: any) => b.type === 'tool_use') : []
    if (toolUses.length === 0) continue
    const next = msgs[i + 1]
    const allResolved = next?.role === 'user' &&
      Array.isArray(next.content) &&
      toolUses.every((tu: any) => next.content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === tu.id))
    if (!allResolved) {
      const existingResults: Set<string> = new Set(
        (next?.role === 'user' && Array.isArray(next?.content))
          ? next.content.filter((b: any) => b.type === 'tool_result').map((b: any) => b.tool_use_id)
          : []
      )
      const syntheticResults = toolUses
        .filter((tu: any) => !existingResults.has(tu.id))
        .map((tu: any) => ({
          type: 'tool_result' as const,
          tool_use_id: tu.id,
          content: JSON.stringify({ error: 'Tool result unavailable — action was interrupted.' }),
        }))
      if (next?.role === 'user' && Array.isArray(next.content) && existingResults.size > 0) {
        msgs[i + 1] = { role: 'user', content: [...next.content, ...syntheticResults] }
      } else {
        out.push({ role: 'user', content: syntheticResults })
      }
    }
  }
  return out
}

// ─── Main handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { messages, confirming } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages array' }, { status: 400 })
    }

    const systemPrompt = buildSystemPrompt({ channel: 'web' })
    const encoder = new TextEncoder()

    const makeStream = (handler: (send: (event: string, data: object) => void, close: () => void) => Promise<void>): Response => {
      let ctrl: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c } })
      const send = (event: string, data: object) => {
        try { ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...data })}\n\n`)) } catch {}
      }
      const close = () => { try { ctrl.close() } catch {} }
      handler(send, close).catch(err => { send('error', { message: err?.message || String(err) }); close() })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
      })
    }

    // ── Shared agentic loop ────────────────────────────────────
    const agenticLoop = async (
      send: (event: string, data: object) => void,
      close: () => void,
      startMessages: any[],
      firstModel = AI_MODELS.balanced,
    ) => {
      let currentMessages = sanitizeMessages(startMessages)
      const MAX_ITER = 10
      for (let i = 0; i < MAX_ITER; i++) {
        const model = i === 0 ? firstModel : AI_MODELS.fast
        const claudeStream = anthropic.messages.stream({
          model,
          max_tokens: 2000,
          system: systemPrompt,
          tools: TOOLS,
          messages: currentMessages,
        } as any)
        let textSoFar = ''
        claudeStream.on('text', (text: string) => { textSoFar += text; send('chunk', { text }) })
        const resp = await claudeStream.finalMessage()
        if (resp.stop_reason === 'end_turn') { send('done', {}); close(); return }
        const toolUses = resp.content.filter((b: any) => b.type === 'tool_use')
        if (toolUses.length === 0) { send('done', {}); close(); return }
        const writeToolUse = toolUses.find((t: any) => WRITE_TOOLS.has(t.name)) as any
        if (writeToolUse) {
          send('confirmation', {
            tool_use_id: writeToolUse.id,
            tool_name: writeToolUse.name,
            tool_input: writeToolUse.input,
            preview_text: textSoFar,
            messages_so_far: [...currentMessages, { role: 'assistant', content: resp.content }],
          })
          close()
          return
        }
        send('status', { text: toolUses.map((t: any) => t.name).join(', ') })
        const toolResults = await Promise.all(
          toolUses.map(async (t: any) => {
            try {
              const result = await executeTool(t.name, t.input)
              return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(result) }
            } catch (err: any) {
              return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify({ error: err.message }) }
            }
          })
        )
        currentMessages = [...currentMessages, { role: 'assistant', content: resp.content }, { role: 'user', content: toolResults }]
      }
      send('chunk', { text: 'I reached my iteration limit. Try breaking the question into smaller parts.' })
      send('done', {})
      close()
    }

    // ── Confirmation flow ──────────────────────────────────────
    if (confirming) {
      return makeStream(async (send, close) => {
        const result = await executeTool(confirming.tool_name, confirming.input)
        const lastMsg = messages[messages.length - 1]
        const allToolUses: any[] = Array.isArray(lastMsg?.content)
          ? lastMsg.content.filter((b: any) => b.type === 'tool_use')
          : []
        const toolResults = allToolUses.length > 0
          ? await Promise.all(allToolUses.map(async (t: any) => {
              if (t.id === confirming.tool_use_id) {
                return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(result) }
              }
              try {
                const r = await executeTool(t.name, t.input)
                return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(r) }
              } catch (err: any) {
                return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify({ error: err.message }) }
              }
            }))
          : [{ type: 'tool_result' as const, tool_use_id: confirming.tool_use_id, content: JSON.stringify(result) }]
        await agenticLoop(send, close, [...messages, { role: 'user', content: toolResults }], AI_MODELS.balanced)
      })
    }

    // ── Agentic loop ───────────────────────────────────────────
    return makeStream(async (send, close) => {
      await agenticLoop(send, close, messages)
    })

  } catch (err: any) {
    console.error('Assistant error:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
