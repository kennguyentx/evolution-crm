'use client'
// components/deals/DropboxFilesTab.tsx
// Replaces DocumentsTab — shows files from both Supabase storage (existing uploads)
// and a linked Dropbox folder, with upload-to-Dropbox support.
//
// Props:
//   dealId        — Supabase deal UUID
//   companyName   — used to build default Dropbox path
//   dropboxPath   — override path (from deal.dropbox_path column)
//   onPathSaved   — callback after user saves a Dropbox path

import { useEffect, useState, useRef, useCallback } from 'react'
import { Upload, Download, Folder, File, FileText, Table2, Monitor,
         Image, Archive, Loader2, ExternalLink, RefreshCw, Link, Check, Trash2 } from 'lucide-react'
import { expectedDropboxFolder } from '@/lib/dropbox'

interface DropboxItem {
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  modified?: string
  icon: string
  readable: boolean
}

interface DropboxFilesTabProps {
  dealId: string
  companyName: string
  /** Deal stage — used to prefill the deal's expected (deal-ID) folder path. */
  stage?: string
  dropboxPath?: string | null
  onPathSaved?: (path: string) => void
  table?: string
}

/** Server allow-list root — manual paths must live under it (item 46). */
const ALLOWED_ROOT = '/Evolution Strategy Partners'

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ icon, className }: { icon: string; className?: string }) {
  const cls = `w-4 h-4 flex-shrink-0 ${className || 'text-zinc-500'}`
  switch (icon) {
    case 'folder':      return <Folder className={cls} />
    case 'pdf':         return <FileText className={`${cls} text-red-400`} />
    case 'spreadsheet': return <Table2 className={`${cls} text-green-400`} />
    case 'word':        return <FileText className={`${cls} text-blue-400`} />
    case 'slides':      return <Monitor className={`${cls} text-orange-400`} />
    case 'image':       return <Image className={`${cls} text-purple-400`} />
    case 'archive':     return <Archive className={cls} />
    default:            return <File className={cls} />
  }
}

// If a stored path ends with a filename (has a dot in the last segment),
// return the parent folder instead. Handles legacy records that stored file paths.
function normalizeFolderPath(path: string): string {
  if (!path) return path
  const lastSegment = path.split('/').pop() ?? ''
  if (lastSegment.includes('.')) return path.substring(0, path.lastIndexOf('/'))
  return path
}

export default function DropboxFilesTab({
  dealId, companyName, stage, dropboxPath: initialPath, onPathSaved, table = 'deals',
}: DropboxFilesTabProps) {
  const folderPath = normalizeFolderPath(initialPath || '')
  const [dropboxPath, setDropboxPath] = useState(folderPath)
  // Prefill with the deal's expected folder (deal-ID path, item 45/46) —
  // NEVER a bare `/<CompanyName>`, which sits outside the allow-list root
  // and would make every later list call 403.
  const [pathInput, setPathInput] = useState(folderPath || (stage ? expectedDropboxFolder(dealId, stage) : ''))
  const [showPathEdit, setShowPathEdit] = useState(!folderPath)
  const [savingPath, setSavingPath] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)

  const [items, setItems] = useState<DropboxItem[]>([])
  const [currentPath, setCurrentPath] = useState(initialPath || '')
  const [breadcrumbs, setBreadcrumbs] = useState<{ name: string; path: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchFolder = useCallback(async (path: string, cursor?: string) => {
    if (!path) return
    const append = !!cursor
    if (append) setLoadingMore(true); else { setLoading(true); setNextCursor(null) }
    setError(null)
    try {
      const qs = new URLSearchParams({ action: 'list', path })
      if (cursor) qs.set('cursor', cursor)
      const res = await fetch(`/api/dropbox?${qs.toString()}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setItems(prev => append ? [...prev, ...(data.items || [])] : (data.items || []))
      setNextCursor(data.has_more ? (data.cursor ?? null) : null)
      setCurrentPath(path)
      // Build breadcrumbs
      const parts = path.split('/').filter(Boolean)
      const crumbs = parts.map((part, i) => ({
        name: part,
        path: '/' + parts.slice(0, i + 1).join('/'),
      }))
      setBreadcrumbs(crumbs)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [])

  useEffect(() => {
    if (dropboxPath) fetchFolder(dropboxPath)
  }, [dropboxPath, fetchFolder])

  const handleSavePath = async () => {
    const path = (pathInput.startsWith('/') ? pathInput : `/${pathInput}`).replace(/\/$/, '')
    setPathError(null)

    // Validate against the server allow-list BEFORE saving (item 46):
    // a path outside the root saves fine in Supabase but every later
    // Dropbox call then 403s.
    if (!path.toLowerCase().startsWith(ALLOWED_ROOT.toLowerCase())) {
      setPathError(`Path must be under ${ALLOWED_ROOT} — e.g. ${ALLOWED_ROOT}/Deals/…`)
      return
    }

    setSavingPath(true)
    try {
      // Verify the folder actually exists before linking it. If it doesn't,
      // warn and ask for confirmation instead of storing a dead link; if
      // Dropbox can't be reached, say so and let the user decide.
      let proceed = true
      try {
        const res = await fetch(`/api/dropbox?action=exists&path=${encodeURIComponent(path)}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        if (!data.exists) {
          proceed = window.confirm(
            `The folder "${path}" does not exist in Dropbox yet.\n\nLink it anyway? Browsing it will show an error until the folder is created in Dropbox.`,
          )
        }
      } catch {
        proceed = window.confirm(
          `Could not verify that "${path}" exists in Dropbox (Dropbox may be unreachable).\n\nSave the link anyway?`,
        )
      }
      if (!proceed) { setSavingPath(false); return }

      // Save to Supabase deal record
      const { createClient } = await import('@/lib/supabase')
      const supabase = createClient()
      await supabase.from(table as any).update({ dropbox_path: path }).eq('id', dealId)
      setDropboxPath(path)
      setShowPathEdit(false)
      onPathSaved?.(path)
      fetchFolder(path)
    } finally {
      setSavingPath(false)
    }
  }

  // Delete a file/folder from Dropbox (item 51) — confirm first, always.
  const handleDelete = async (item: DropboxItem) => {
    const ok = window.confirm(
      `Delete "${item.name}" from Dropbox?\n\nThis permanently removes it from Dropbox (it can be recovered from Dropbox's Deleted files for a limited time). It cannot be undone from Nexus.`,
    )
    if (!ok) return
    setError(null)
    try {
      const res = await fetch(`/api/dropbox?path=${encodeURIComponent(item.path)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      fetchFolder(currentPath)
    } catch (err: any) {
      setError(`Delete failed: ${err.message}`)
    }
  }

  const handleDownload = async (item: DropboxItem) => {
    const res = await fetch(`/api/dropbox?action=link&path=${encodeURIComponent(item.path)}`)
    const data = await res.json()
    if (data.url) window.open(data.url, '_blank')
  }

  // Files larger than this can't be sent inline — Vercel rejects request bodies
  // over ~4.5 MB. Those go via a signed Supabase upload, then a server-side move
  // into Dropbox (same pattern as document intake).
  const INLINE_MAX_BYTES = 4 * 1024 * 1024

  const handleUpload = async (files: File[]) => {
    if (!currentPath) return
    setUploading(true)
    setError(null)
    for (const file of files) {
      try {
        if (file.size <= INLINE_MAX_BYTES) {
          // Small file — send inline as base64
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve((reader.result as string).split(',')[1])
            reader.readAsDataURL(file)
          })
          const res = await fetch('/api/dropbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: currentPath, name: file.name, base64 }),
          })
          const data = await res.json()
          if (data.error) { setError(`Upload failed: ${data.error}`); break }
        } else {
          // Large file — signed upload to Supabase, then server-side move to Dropbox
          const urlRes = await fetch('/api/intake/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name }),
          })
          const { signedUploadUrl, storagePath, error: urlErr } = await urlRes.json()
          if (urlErr || !signedUploadUrl) { setError(`Upload failed: ${urlErr ?? 'no signed URL'}`); break }

          const putRes = await fetch(signedUploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          })
          if (!putRes.ok) { setError(`Upload failed while transferring ${file.name}`); break }

          const moveRes = await fetch('/api/dropbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: currentPath, name: file.name, storagePath }),
          })
          const moveData = await moveRes.json()
          if (moveData.error) { setError(`Upload failed: ${moveData.error}`); break }
        }
      } catch (e: any) {
        setError(`Upload failed: ${e?.message ?? 'unknown error'}`)
        break
      }
    }
    setUploading(false)
    setUploadSuccess(true)
    setTimeout(() => setUploadSuccess(false), 2000)
    fetchFolder(currentPath)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Path setup screen ─────────────────────────────────────
  if (showPathEdit) {
    return (
      <div className="space-y-4">
        <div className="bg-zinc-800/40 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Link className="w-4 h-4 text-blue-400" />
            <span>Link a Dropbox folder to this deal</span>
          </div>
          <p className="text-xs text-zinc-500">
            Enter the path to the existing company folder in your Dropbox.
            It must be under <code className="text-zinc-400">{ALLOWED_ROOT}</code> —
            example: <code className="text-zinc-400">{ALLOWED_ROOT}/Deals/DiPonio Holdings</code>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={pathInput}
              onChange={e => { setPathInput(e.target.value); setPathError(null) }}
              placeholder={`${ALLOWED_ROOT}/Deals/…`}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={handleSavePath}
              disabled={savingPath || !pathInput}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {savingPath ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Link'}
            </button>
          </div>
          {pathError && (
            <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{pathError}</p>
          )}
        </div>
      </div>
    )
  }

  // ── Main files view ───────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Header: path + refresh + change */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 min-w-0">
          {/* Breadcrumbs */}
          <button
            onClick={() => fetchFolder(dropboxPath)}
            className="hover:text-zinc-300 transition-colors font-mono truncate max-w-[200px]"
            title={dropboxPath}
          >
            {dropboxPath.split('/').pop() || 'Root'}
          </button>
          {breadcrumbs.slice(breadcrumbs.findIndex(b => b.path === dropboxPath) + 1).map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <span>/</span>
              <button
                onClick={() => fetchFolder(crumb.path)}
                className="hover:text-zinc-300 transition-colors truncate max-w-[120px]"
              >
                {crumb.name}
              </button>
            </span>
          ))}
          {currentPath !== dropboxPath && (
            <button
              onClick={() => {
                const parent = currentPath.split('/').slice(0, -1).join('/') || dropboxPath
                fetchFolder(parent)
              }}
              className="ml-1 text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              ↑
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => fetchFolder(currentPath)}
            className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setPathInput(dropboxPath); setPathError(null); setShowPathEdit(true) }}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Change folder
          </button>
        </div>
      </div>

      {/* Upload drop zone */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleUpload(Array.from(e.dataTransfer.files)) }}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`border border-dashed rounded-lg px-4 py-3 text-center cursor-pointer transition-colors
          ${uploading || uploadSuccess
            ? 'border-zinc-700 bg-zinc-800/20'
            : 'border-zinc-700 hover:border-zinc-500'}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => handleUpload(Array.from(e.target.files || []))}
        />
        <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
          {uploading
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading to Dropbox…</>
            : uploadSuccess
            ? <><Check className="w-3.5 h-3.5 text-green-400" /> <span className="text-green-400">Uploaded</span></>
            : <><Upload className="w-3.5 h-3.5" /> Drop files or click to upload to Dropbox</>
          }
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </p>
      )}

      {/* File list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-zinc-600 py-6">No files found in this folder</p>
      ) : (
        <div className="space-y-0.5">
          {items.map(item => (
            <div
              key={item.path}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 group transition-colors cursor-pointer"
              onClick={() => item.type === 'folder' ? fetchFolder(item.path) : undefined}
            >
              <FileIcon icon={item.icon} />
              <span className={`flex-1 text-sm truncate ${
                item.type === 'folder' ? 'text-zinc-300 font-medium' : 'text-zinc-300'
              }`}>
                {item.name}
              </span>
              {item.size && (
                <span className="text-xs text-zinc-600 flex-shrink-0">{formatSize(item.size)}</span>
              )}
              {item.type === 'file' && (
                <button
                  onClick={e => { e.stopPropagation(); handleDownload(item) }}
                  className="p-1 text-zinc-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  title="Open in Dropbox"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); handleDelete(item) }}
                className="p-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                title="Delete from Dropbox"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {/* Pagination (item 48): folders can hold more entries than one
              list_folder page returns — fetch the next page on demand. */}
          {nextCursor && (
            <button
              onClick={() => fetchFolder(currentPath, nextCursor)}
              disabled={loadingMore}
              className="w-full mt-2 py-2 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {loadingMore
                ? <span className="inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</span>
                : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
