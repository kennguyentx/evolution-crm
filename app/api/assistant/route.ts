// app/api/assistant/route.ts
// Web chat assistant — streaming responses + write-tool confirmation flow.
// The tool engine (definitions, executeTool, system prompt) lives in lib/assistant-core.ts,
// shared with the email ("Ask:") assistant.

export const maxDuration = 120 // seconds — agent loops need more than the 10s default

import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { AI_MODELS } from '@/lib/ai-config'
import { anthropic, TOOLS, WRITE_TOOLS, executeTool, buildSystemPrompt } from '@/lib/assistant-core'
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit'
import { apiError, withErrorHandler } from '@/lib/api-response'
import { AssistantRequestSchema } from '@/lib/schemas'

// ─── Message sanitizer ────────────────────────────────────────
// Ensures every assistant message with tool_use blocks is immediately followed
// by a user message with matching tool_result blocks; injects synthetic error
// results for any orphaned tool_use so the API doesn't 400.
type ContentBlockParam = Anthropic.ContentBlockParam
type ToolUseBlockParam = Anthropic.ToolUseBlockParam
type ToolResultBlockParam = Anthropic.ToolResultBlockParam

function isToolUseBlock(b: ContentBlockParam): b is ToolUseBlockParam {
  return b.type === 'tool_use'
}

function isToolResultBlock(b: ContentBlockParam): b is ToolResultBlockParam {
  return b.type === 'tool_result'
}

function sanitizeMessages(msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    out.push(msg)
    if (msg.role !== 'assistant') continue
    const toolUses: ToolUseBlockParam[] = Array.isArray(msg.content) ? msg.content.filter(isToolUseBlock) : []
    if (toolUses.length === 0) continue
    const next = msgs[i + 1]
    const nextBlocks: ContentBlockParam[] | null =
      next?.role === 'user' && Array.isArray(next.content) ? next.content : null
    const allResolved = nextBlocks !== null &&
      toolUses.every((tu) => nextBlocks.some((b) => isToolResultBlock(b) && b.tool_use_id === tu.id))
    if (!allResolved) {
      const existingResults: Set<string> = new Set(
        (nextBlocks ?? []).filter(isToolResultBlock).map((b) => b.tool_use_id)
      )
      const syntheticResults: ToolResultBlockParam[] = toolUses
        .filter((tu) => !existingResults.has(tu.id))
        .map((tu) => ({
          type: 'tool_result' as const,
          tool_use_id: tu.id,
          content: JSON.stringify({ error: 'Tool result unavailable — action was interrupted.' }),
        }))
      if (nextBlocks !== null && existingResults.size > 0) {
        msgs[i + 1] = { role: 'user', content: [...nextBlocks, ...syntheticResults] }
      } else {
        out.push({ role: 'user', content: syntheticResults })
      }
    }
  }
  return out
}

// ─── Main handler ─────────────────────────────────────────────

export const POST = withErrorHandler(async (req: NextRequest) => {
  // AI-cost endpoint: cap requests per IP so a loop can't burn Anthropic spend.
  const limit = checkRateLimit(`assistant:${getClientIp(req)}`, { limit: 20, windowMs: 60_000 })
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds)

  try {
    const parsed = AssistantRequestSchema.safeParse(await req.json())
    if (!parsed.success) return apiError(parsed.error.issues[0].message, 400)
    const { confirming } = parsed.data
    // The zod schema validates the wire shape; assert the SDK's message type
    // at this boundary so the typed helpers below (sanitizeMessages,
    // agenticLoop) keep item 13's Anthropic types instead of zod's
    // passthrough output type.
    const messages = parsed.data.messages as unknown as Anthropic.MessageParam[]

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
      startMessages: Anthropic.MessageParam[],
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
        })
        let textSoFar = ''
        claudeStream.on('text', (text: string) => { textSoFar += text; send('chunk', { text }) })
        const resp = await claudeStream.finalMessage()
        if (resp.stop_reason === 'end_turn') { send('done', {}); close(); return }
        const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        if (toolUses.length === 0) { send('done', {}); close(); return }
        const writeToolUse = toolUses.find((t) => WRITE_TOOLS.has(t.name))
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
        send('status', { text: toolUses.map((t) => t.name).join(', ') })
        const toolResults = await Promise.all(
          toolUses.map(async (t) => {
            try {
              const result = await executeTool(t.name, t.input)
              return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(result) }
            } catch (err: unknown) {
              return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }
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
        const allToolUses: ToolUseBlockParam[] = Array.isArray(lastMsg?.content)
          ? lastMsg.content.filter(isToolUseBlock)
          : []
        const toolResults = allToolUses.length > 0
          ? await Promise.all(allToolUses.map(async (t) => {
              if (t.id === confirming.tool_use_id) {
                return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(result) }
              }
              try {
                const r = await executeTool(t.name, t.input)
                return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(r) }
              } catch (err: unknown) {
                return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }
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

  } catch (err: unknown) {
    console.error('Assistant error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
