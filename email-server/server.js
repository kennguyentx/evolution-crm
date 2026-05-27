// email-server/server.js
// Thin relay deployed on Render.com.
//
// WHY THIS EXISTS:
//   Vercel enforces a 4.5 MB request body limit on serverless functions.
//   Postmark can send CIM/Teaser PDFs as base64 attachments that are 30–50 MB.
//   This server accepts up to 50 MB, uploads each large attachment directly to
//   Supabase Storage, then forwards a compact payload (with storage paths instead
//   of raw base64) to the canonical Next.js endpoint where all business logic lives.
//
// CONFIGURATION (Render env vars):
//   POSTMARK_WEBHOOK_TOKEN   — must match the token appended by Postmark (?token=…)
//   INTERNAL_WEBHOOK_SECRET  — shared secret used to authenticate relay→Next.js calls
//   NEXT_PUBLIC_SUPABASE_URL — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — service-role key for storage uploads
//   NEXT_PUBLIC_APP_URL      — canonical Next.js URL (default: nexus.evolutionstrategy.com)
//   PORT                     — listen port (default: 3001)

require('dotenv').config()

const express = require('express')
const { createClient } = require('@supabase/supabase-js')

const app = express()
// 50 MB limit — handles even very large CIM PDFs sent as base64 via Postmark
app.use(express.json({ limit: '50mb' }))

const BUCKET = 'intake-temp'

// Attachments larger than this threshold (in base64 chars ≈ 3 MB binary) are
// uploaded to Supabase Storage so the forwarded payload stays under 4.5 MB.
const STORE_THRESHOLD = 4 * 1024 * 1024 // ~3 MB binary

const NEXT_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://nexus.evolutionstrategy.com').replace(/\/$/, '')

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

// ── Main relay handler ────────────────────────────────────────────────────────

app.post('/api/notes/email', async (req, res) => {
  const webhookToken  = process.env.POSTMARK_WEBHOOK_TOKEN
  const internalSecret = process.env.INTERNAL_WEBHOOK_SECRET

  if (!webhookToken)   return res.status(500).json({ error: 'Server misconfigured: POSTMARK_WEBHOOK_TOKEN not set' })
  if (!internalSecret) return res.status(500).json({ error: 'Server misconfigured: INTERNAL_WEBHOOK_SECRET not set' })

  // Validate Postmark webhook token
  const provided = req.query.token ?? req.headers['x-webhook-token']
  if (provided !== webhookToken) return res.status(403).json({ error: 'Forbidden' })

  const body        = req.body
  const attachments = body.Attachments ?? []

  console.log(
    `[relay] messageId=${body.MessageID ?? '—'} from=${body.From ?? '—'} attachments=${attachments.length}`,
    attachments.map(a => ({ name: a.Name, type: a.ContentType, base64len: a.Content?.length ?? 0 })),
  )

  // ── Upload large attachments to Supabase Storage ──────────────────────────
  const supabase = serviceClient()
  const processedAttachments = []

  for (const att of attachments) {
    const contentLen = att.Content?.length ?? 0

    if (contentLen > STORE_THRESHOLD) {
      const buffer      = Buffer.from(att.Content, 'base64')
      const safeName    = (att.Name ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `relay/${Date.now()}-${safeName}`

      console.log(`[relay] Uploading ${att.Name} (${(buffer.length / 1024 / 1024).toFixed(1)} MB) → storage:${storagePath}`)

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: att.ContentType || 'application/octet-stream',
          upsert: false,
        })

      if (error) {
        // Non-fatal: fall back to inline base64 (may exceed Vercel limit, but at least we tried)
        console.error(`[relay] Storage upload failed for ${att.Name}:`, error.message, '— falling back to inline')
        processedAttachments.push(att)
      } else {
        // Replace binary content with a storage reference
        processedAttachments.push({
          Name:          att.Name,
          ContentType:   att.ContentType,
          ContentLength: att.ContentLength,
          StoragePath:   storagePath,
          // Content is intentionally omitted — Next.js will download from storage
        })
      }
    } else {
      processedAttachments.push(att)
    }
  }

  const storedCount = processedAttachments.filter(a => a.StoragePath).length
  console.log(`[relay] Forwarding to Next.js — ${attachments.length} attachments (${storedCount} via storage, ${attachments.length - storedCount} inline)`)

  // ── Forward compact payload to canonical Next.js handler ─────────────────
  const forwardBody = { ...body, Attachments: processedAttachments }

  let nextRes
  try {
    nextRes = await fetch(`${NEXT_URL}/api/notes/email`, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify(forwardBody),
    })
  } catch (fetchErr) {
    console.error('[relay] Could not reach Next.js endpoint:', fetchErr?.message)
    return res.status(502).json({ error: 'Could not reach processing endpoint' })
  }

  const result = await nextRes.json().catch(() => ({}))
  console.log(`[relay] Next.js responded ${nextRes.status}:`, JSON.stringify(result))
  res.status(nextRes.status).json(result)
})

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Email relay server running on port ${PORT}`)

  const required = [
    'POSTMARK_WEBHOOK_TOKEN',
    'INTERNAL_WEBHOOK_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_APP_URL',
  ]
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    console.error(`FATAL: Missing required env vars: ${missing.join(', ')}`)
    process.exit(1)
  }
})
