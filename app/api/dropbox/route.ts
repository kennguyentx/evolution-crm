// app/api/dropbox/route.ts
// Handles all Dropbox operations for Nexus:
//   GET  ?action=list&path=/Deals/DiPonio     — list folder contents
//   GET  ?action=link&path=/Deals/...file.pdf — get temporary download link
//   GET  ?action=read&path=/Deals/...file.pdf — read text/PDF content for assistant
//   POST { path, file (base64), name }        — upload a file
//   PATCH { from_path, to_path }              — move a file/folder
//
// Security controls applied to every request:
//   • Path allow-list  — all paths must be inside ALLOWED_ROOT
//   • Upload size cap  — POST base64 payload ≤ MAX_UPLOAD_BASE64 chars
//   • Audit logging    — every action is logged as structured JSON to console

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getDropboxToken, dropboxMove } from '@/lib/dropbox'

const DBX_API     = 'https://api.dropboxapi.com/2'
const DBX_CONTENT = 'https://content.dropboxapi.com/2'

// ── Security constants ────────────────────────────────────────────────────────

/** Every non-root Dropbox path in this app lives under this prefix. */
const ALLOWED_ROOT = '/evolution strategy partners'

/** 20 MB binary ≈ 27 MB base64 — cap before the buffer is even decoded. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_UPLOAD_BASE64 = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3)

// ── Path guard ────────────────────────────────────────────────────────────────

function isAllowedPath(path: string | null | undefined): boolean {
  if (!path) return false
  return path.toLowerCase().startsWith(ALLOWED_ROOT)
}

/** Root listing (empty string) is allowed for browse navigation. */
function isAllowedListPath(path: string): boolean {
  return path === '' || isAllowedPath(path)
}

// ── Audit logging ─────────────────────────────────────────────────────────────

function audit(
  action: string,
  path: string,
  userId: string | undefined,
  extra?: Record<string, unknown>,
) {
  console.log(
    '[dropbox-audit]',
    JSON.stringify({ ts: new Date().toISOString(), action, path, userId, ...extra }),
  )
}

// ── Session extraction ────────────────────────────────────────────────────────
// The middleware already rejects unauthenticated requests. We re-read the
// session here only to capture the user ID for audit logs.

async function getSessionUser(req: NextRequest): Promise<string | undefined> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    )
    const cookieHeader = req.headers.get('cookie') ?? ''
    const match = cookieHeader.match(/sb-[^-]+-auth-token=([^;]+)/)
    if (!match) return undefined
    const token = decodeURIComponent(match[1])
    const parsed = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())
    return parsed?.sub as string | undefined
  } catch {
    return undefined
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const READABLE_TYPES = new Set(['.pdf', '.txt', '.md', '.csv', '.docx', '.xlsx', '.xls'])

function ext(name: string) {
  return name.slice(name.lastIndexOf('.')).toLowerCase()
}

function fileIcon(name: string): string {
  const e = ext(name)
  if (['.pdf'].includes(e))                         return 'pdf'
  if (['.xlsx', '.xls', '.csv'].includes(e))        return 'spreadsheet'
  if (['.docx', '.doc'].includes(e))                return 'word'
  if (['.pptx', '.ppt'].includes(e))                return 'slides'
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(e)) return 'image'
  if (['.zip', '.rar'].includes(e))                 return 'archive'
  return 'file'
}

async function dbxPost(endpoint: string, body: any, contentHeaders?: Record<string, string>) {
  const token = await getDropboxToken()
  const res = await fetch(`${DBX_API}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...contentHeaders,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Dropbox error ${res.status}: ${err}`)
  }
  return res.json()
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const path   = searchParams.get('path') || ''
  const userId = await getSessionUser(req)

  try {
    // ── List folder ─────────────────────────────────────────────────────────
    if (action === 'list') {
      if (!isAllowedListPath(path)) {
        audit('list:denied', path, userId, { reason: 'path not allowed' })
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
      }

      const dbxPath = path === '/' || path === '.' ? '' : path
      const data = await dbxPost('/files/list_folder', {
        path: dbxPath,
        recursive: false,
        include_media_info: false,
        include_deleted: false,
      })

      const items = (data.entries || []).map((e: any) => ({
        name:     e.name,
        path:     e.path_lower,
        type:     e['.tag'],
        size:     e.size,
        modified: e.client_modified,
        icon:     e['.tag'] === 'folder' ? 'folder' : fileIcon(e.name),
        readable: e['.tag'] === 'file' && READABLE_TYPES.has(ext(e.name)),
      }))

      items.sort((a: any, b: any) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      audit('list', path, userId, { count: items.length })
      return NextResponse.json({ items, has_more: data.has_more })
    }

    // ── Temporary download link ──────────────────────────────────────────────
    if (action === 'link') {
      if (!isAllowedPath(path)) {
        audit('link:denied', path, userId, { reason: 'path not allowed' })
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
      }

      const data = await dbxPost('/files/get_temporary_link', { path })
      audit('link', path, userId)
      return NextResponse.json({ url: data.link, name: data.metadata.name })
    }

    // ── Read file content ────────────────────────────────────────────────────
    if (action === 'read') {
      if (!isAllowedPath(path)) {
        audit('read:denied', path, userId, { reason: 'path not allowed' })
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
      }

      const fileExt = ext(path)
      if (!READABLE_TYPES.has(fileExt)) {
        return NextResponse.json({ error: 'File type not readable' }, { status: 400 })
      }

      const token = await getDropboxToken()
      const downloadRes = await fetch(`${DBX_CONTENT}/files/download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': JSON.stringify({ path }),
        },
      })
      if (!downloadRes.ok) throw new Error(`Download failed: ${downloadRes.status}`)

      const buffer = await downloadRes.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const metaHeader = downloadRes.headers.get('dropbox-api-result')
      const meta = metaHeader ? JSON.parse(metaHeader) : {}

      audit('read', path, userId, { bytes: buffer.byteLength })
      return NextResponse.json({
        name:   meta.name || path.split('/').pop(),
        path,
        ext:    fileExt,
        base64,
        size:   buffer.byteLength,
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: any) {
    console.error('Dropbox API error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST — upload ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const userId = await getSessionUser(req)

  try {
    const { path, name, base64 } = await req.json()

    if (!path || !name || !base64) {
      return NextResponse.json({ error: 'path, name, and base64 required' }, { status: 400 })
    }

    if (!isAllowedPath(path)) {
      audit('upload:denied', path, userId, { name, reason: 'path not allowed' })
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
    }

    if (base64.length > MAX_UPLOAD_BASE64) {
      const mb = (base64.length * 3 / 4 / 1024 / 1024).toFixed(1)
      audit('upload:denied', path, userId, { name, reason: 'size limit exceeded', sizeMb: mb })
      return NextResponse.json({ error: `File too large (${mb} MB; limit is 20 MB)` }, { status: 413 })
    }

    const fullPath   = `${path.replace(/\/$/, '')}/${name}`
    const fileBuffer = Buffer.from(base64, 'base64')
    const uploadToken = await getDropboxToken()

    const uploadRes = await fetch(`${DBX_CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${uploadToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: fullPath,
          mode: 'add',
          autorename: true,
          mute: false,
        }),
      },
      body: fileBuffer,
    })

    if (!uploadRes.ok) {
      const err = await uploadRes.text()
      throw new Error(`Upload failed: ${err}`)
    }

    const result = await uploadRes.json()
    audit('upload', path, userId, { name, bytes: fileBuffer.byteLength, dest: result.path_lower })
    return NextResponse.json({ success: true, path: result.path_lower, name: result.name })

  } catch (err: any) {
    console.error('Dropbox upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── PATCH — move ──────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUser(req)

  try {
    const { from_path, to_path } = await req.json()

    if (!from_path || !to_path) {
      return NextResponse.json({ error: 'from_path and to_path required' }, { status: 400 })
    }

    if (!isAllowedPath(from_path) || !isAllowedPath(to_path)) {
      audit('move:denied', from_path, userId, { to_path, reason: 'path not allowed' })
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
    }

    const newPath = await dropboxMove(from_path, to_path)
    audit('move', from_path, userId, { to_path: newPath })
    return NextResponse.json({ success: true, path: newPath })

  } catch (err: any) {
    console.error('Dropbox move error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
