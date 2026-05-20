'use client'
import { useEffect, useState, useCallback } from 'react'
import { Folder, FileText, Table2, Monitor, File, Download, ChevronRight, Home, Loader2, AlertCircle, ExternalLink, BookOpen } from 'lucide-react'
import { useIsMobile } from '@/hooks/useIsMobile'

const BP_ROOT = '/Evolution Strategy Partners/Best Practices'

interface DropboxItem {
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  modified?: string
  icon: string
  readable: boolean
}

function FileIcon({ icon }: { icon: string }) {
  const style = { flexShrink: 0 } as const
  switch (icon) {
    case 'folder':      return <Folder      size={18} style={{ ...style, color: 'var(--accent)' }} />
    case 'pdf':         return <FileText    size={18} style={{ ...style, color: '#ef4444' }} />
    case 'spreadsheet': return <Table2      size={18} style={{ ...style, color: '#22c55e' }} />
    case 'word':        return <FileText    size={18} style={{ ...style, color: '#3b82f6' }} />
    case 'slides':      return <Monitor     size={18} style={{ ...style, color: '#f97316' }} />
    default:            return <File        size={18} style={{ ...style, color: 'var(--text-muted)' }} />
  }
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function BestPracticesPage() {
  const isMobile = useIsMobile()
  const [currentPath, setCurrentPath] = useState(BP_ROOT)
  const [items, setItems] = useState<DropboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  // Breadcrumbs relative to BP_ROOT
  const breadcrumbs = (() => {
    if (currentPath === BP_ROOT) return []
    const rel = currentPath.slice(BP_ROOT.length) // e.g. '/Credit Agreements'
    const parts = rel.split('/').filter(Boolean)
    return parts.map((part, i) => ({
      label: part,
      path: BP_ROOT + '/' + parts.slice(0, i + 1).join('/'),
    }))
  })()

  const fetchFolder = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dropbox?action=list&path=${encodeURIComponent(path)}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setItems(data.items || [])
      setCurrentPath(path)
    } catch (err: any) {
      setError(err.message || 'Failed to load folder')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchFolder(BP_ROOT) }, [fetchFolder])

  const handleOpen = async (item: DropboxItem) => {
    if (item.type === 'folder') {
      fetchFolder(item.path)
      return
    }
    // Open file — get temp download link
    setDownloading(item.path)
    try {
      const res = await fetch(`/api/dropbox?action=link&path=${encodeURIComponent(item.path)}`)
      const data = await res.json()
      if (data.url) window.open(data.url, '_blank')
    } catch { /* ignore */ }
    setDownloading(null)
  }

  const folders = items.filter(i => i.type === 'folder')
  const files   = items.filter(i => i.type === 'file')
  const isRoot  = currentPath === BP_ROOT

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '14px 16px' : '20px 28px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: breadcrumbs.length > 0 ? '10px' : '0' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Best Practices</h1>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '4px' }}>Dropbox library</span>
        </div>

        {/* Breadcrumb */}
        {breadcrumbs.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <button
              onClick={() => fetchFolder(BP_ROOT)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '3px', fontSize: '12px', padding: 0 }}
            >
              <Home size={11} /> Home
            </button>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ChevronRight size={11} />
                {i < breadcrumbs.length - 1 ? (
                  <button
                    onClick={() => fetchFolder(crumb.path)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '12px', padding: 0 }}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{crumb.label}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '16px' : '24px 28px' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '13px' }}>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', gap: '10px', padding: '12px 16px', background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '8px', fontSize: '13px', color: 'var(--red)' }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>This folder is empty.</div>
        )}

        {!loading && !error && items.length > 0 && (
          <>
            {/* Folders — card grid at root level, list within subfolders */}
            {folders.length > 0 && (
              <>
                {isRoot ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: files.length > 0 ? '24px' : '0' }}>
                    {folders.map(folder => (
                      <button
                        key={folder.path}
                        onClick={() => handleOpen(folder)}
                        className="card"
                        style={{ padding: '20px 18px', cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--surface)', width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', transition: 'border-color 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                      >
                        <Folder size={28} style={{ color: 'var(--accent)' }} />
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{folder.name}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginBottom: files.length > 0 ? '20px' : '0' }}>
                    {folders.map(folder => (
                      <div
                        key={folder.path}
                        onClick={() => handleOpen(folder)}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '7px', cursor: 'pointer', marginBottom: '4px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                      >
                        <FileIcon icon="folder" />
                        <span style={{ fontSize: '13px', fontWeight: 500, flex: 1 }}>{folder.name}</span>
                        <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Files */}
            {files.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                {files.map((file, i) => (
                  <div
                    key={file.path}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 16px',
                      borderBottom: i < files.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleOpen(file)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <FileIcon icon={file.icon} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
                      {(file.size || file.modified) && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
                          {formatSize(file.size)}{file.size && file.modified ? ' · ' : ''}
                          {file.modified ? new Date(file.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                        </div>
                      )}
                    </div>
                    {downloading === file.path ? (
                      <Loader2 size={13} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                        <ExternalLink size={13} style={{ color: 'var(--text-muted)' }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
