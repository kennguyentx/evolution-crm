// lib/log.ts
// Tiny structured logger — the one place console.* may be called directly.
//
// Every line is a single JSON object:
//   { "ts": "2026-11-10T…Z", "level": "info", "tag": "email-intake", "msg": "…", …meta }
//
// Usage:
//   import { createLogger } from '@/lib/log'
//   const log = createLogger('email-intake')
//   log.info('intake received', { messageId, attachments: 2 })
//   log.error('assistant failed', err)            // Error → name/message/stack kept
//   log.warn('duplicate message', { messageId })
//
// Rules:
// - NEVER pass user content (email subjects/bodies, question text, note or
//   activity text, parsed-instruction dumps). Log metadata only: IDs, counts,
//   sizes, stages, file names, Dropbox paths.
// - As a backstop, meta keys that commonly carry user content (question, text,
//   body, subject, summary, …) are redacted to "[redacted len=N]" — see
//   REDACTED_KEYS below. The message string itself is NOT scanned, so keep
//   content out of it too.
// - Minimum level is `info` by default; set LOG_LEVEL=debug|info|warn|error
//   to change it. Real errors always pass at `error` with their stack.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function minLevel(): LogLevel {
  const raw = (typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined)?.toLowerCase()
  return raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info'
}

// Meta keys whose values are user-authored content, not metadata. Values are
// replaced with a length marker so "was something there / how big" survives
// without the content itself landing in logs.
const REDACTED_KEYS = new Set([
  'question', 'text', 'textbody', 'body', 'raw_text', 'rawtext', 'subject',
  'summary', 'next_steps', 'nextsteps', 'answer', 'content', 'html', 'htmlbody',
  'note', 'notes', 'forwarder_note', 'forwardernote', 'instructions', 'payload',
  'email', 'emails', 'recipients', 'to', 'from', 'names',
])

function serializeValue(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (depth >= 3) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 20).map(v => serializeValue(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        out[key] = typeof v === 'string' ? `[redacted len=${v.length}]` : '[redacted]'
      } else {
        out[key] = serializeValue(v, depth + 1)
      }
    }
    return out
  }
  return String(value)
}

function emit(level: LogLevel, tag: string, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return

  const [first, ...rest] = args
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    tag,
  }

  if (typeof first === 'string') {
    entry.msg = first.replace(/:\s*$/, '')
  } else if (first instanceof Error) {
    entry.msg = first.message
    entry.error = serializeValue(first, 0)
  } else if (first !== undefined) {
    entry.msg = ''
    entry.context = serializeValue(first, 0)
  } else {
    entry.msg = ''
  }

  for (const arg of rest) {
    if (arg instanceof Error) {
      entry.error = serializeValue(arg, 0)
    } else if (arg !== null && typeof arg === 'object' && !Array.isArray(arg)) {
      // Plain-object meta is merged in (with redaction) so logs stay queryable.
      const meta = serializeValue(arg, 0) as Record<string, unknown>
      for (const [k, v] of Object.entries(meta)) {
        if (!(k in entry)) entry[k] = v
      }
    } else if (arg !== undefined) {
      entry.context = serializeValue(arg, 0)
    }
  }

  const line = JSON.stringify(entry)
  // The logger is the single sanctioned console sink.
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createLogger(tag: string): Logger {
  return {
    debug: (...args: unknown[]) => emit('debug', tag, args),
    info: (...args: unknown[]) => emit('info', tag, args),
    warn: (...args: unknown[]) => emit('warn', tag, args),
    error: (...args: unknown[]) => emit('error', tag, args),
  }
}
