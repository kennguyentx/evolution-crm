// app/api/dropbox/route.ts
// Handles all Dropbox operations for Nexus:
//   GET  ?action=list&path=/Deals/DiPonio     — list folder contents
//   GET  ?action=link&path=/Deals/...file.pdf — get temporary download link
//   GET  ?action=read&path=/Deals/...file.pdf — read text/PDF content for assistant
//   POST { path, file (base64), name }        — upload a file

import { NextRequest, NextResponse } from 'next/server'
import { getDropboxToken } from '@/lib/dropbox'

const DBX_API  = 'https://api.dropboxapi.com/2'
const DBX_CONTENT = 'https://content.dropboxapi.com/2'

// File types the assistant can read
const READABLE_TYPES = new Set(['.pdf', '.txt', '.md', '.csv', '.docx', '.xlsx', '.xls'])

function ext(name: string) {
  return name.slice(name.lastIndexOf('.')).toLowerCase()
}

function fileIcon(name: string): string {
  const e = ext(name)
  if (['.pdf'].includes(e)) return 'pdf'
  if (['.xlsx', '.xls', '.csv'].includes(e)) return 'spreadsheet'
  if (['.docx', '.doc'].includes(e)) return 'word'
  if (['.pptx', '.ppt'].includes(e)) return 'slides'
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(e)) return 'image'
  if (['.zip', '.rar'].includes(e)) return 'archive'
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const path   = searchParams.get('path') || ''

  try {
    // ── List folder ───────────────────────────────────────────
    if (action === 'list') {
      // Dropbox API uses empty string for root, not "/" or "."
      const dbxPath = path === '/' || path === '.' ? '' : path
      const data = await dbxPost('/files/list_folder', {
        path: dbxPath,
        recursive: false,
        include_media_info: false,
        include_deleted: false,
      })

      const items = (data.entries || []).map((e: any) => ({
        name: e.name,
        path: e.path_lower,
        type: e['.tag'], // 'file' | 'folder'
        size: e.size,
        modified: e.client_modified,
        icon: e['.tag'] === 'folder' ? 'folder' : fileIcon(e.name),
        readable: e['.tag'] === 'file' && READABLE_TYPES.has(ext(e.name)),
      }))

      // Sort: folders first, then files alphabetically
      items.sort((a: any, b: any) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return NextResponse.json({ items, has_more: data.has_more })
    }

    // ── Temporary download link ───────────────────────────────
    if (action === 'link') {
      const data = await dbxPost('/files/get_temporary_link', { path })
      return NextResponse.json({ url: data.link, name: data.metadata.name })
    }

    // ── Read file content for assistant ──────────────────────
    if (action === 'read') {
      const fileExt = ext(path)

      if (!READABLE_TYPES.has(fileExt)) {
        return NextResponse.json({ error: 'File type not readable' }, { status: 400 })
      }

      // Download the file bytes
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

      // Return base64 + metadata — assistant route will pass to Claude as document
      const metaHeader = downloadRes.headers.get('dropbox-api-result')
      const meta = metaHeader ? JSON.parse(metaHeader) : {}

      return NextResponse.json({
        name: meta.name || path.split('/').pop(),
        path,
        ext: fileExt,
        base64,
        size: buffer.byteLength,
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: any) {
    console.error('Dropbox API error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { path, name, base64 } = await req.json()
    if (!path || !name || !base64) {
      return NextResponse.json({ error: 'path, name, and base64 required' }, { status: 400 })
    }

    const fullPath = `${path.replace(/\/$/, '')}/${name}`
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
    return NextResponse.json({ success: true, path: result.path_lower, name: result.name })

  } catch (err: any) {
    console.error('Dropbox upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
