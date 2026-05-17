'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Upload, Download, Trash2, Loader2 } from 'lucide-react'

interface DealDocument {
  id: string
  deal_id: string
  file_name: string
  file_path: string
  file_size: number
  file_type: string | null
  uploaded_at: string
}

interface DocumentsTabProps {
  dealId: string
}

function formatFileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentsTab({ dealId }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<DealDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const fetchDocuments = useCallback(async () => {
    const { data } = await supabase
      .from('deal_documents')
      .select('*')
      .eq('deal_id', dealId)
      .order('uploaded_at', { ascending: false })
    setDocuments(data || [])
    setLoading(false)
  }, [dealId, supabase])

  useEffect(() => { fetchDocuments() }, [fetchDocuments])

  const uploadFile = async (file: File) => {
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${dealId}/${Date.now()}_${safeFileName}`
    const { error: uploadError } = await supabase.storage.from('deal-documents').upload(filePath, file)
    if (uploadError) { setError(`Upload failed: ${uploadError.message}`); return }
    await supabase.from('deal_documents').insert({
      deal_id: dealId, file_name: file.name, file_path: filePath,
      file_size: file.size, file_type: file.type || null,
    })
  }

  const handleFiles = async (files: File[]) => {
    setUploading(true); setError(null)
    for (const file of files) await uploadFile(file)
    await fetchDocuments()
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDownloadOne = async (doc: DealDocument) => {
    const { data } = await supabase.storage.from('deal-documents').createSignedUrl(doc.file_path, 60)
    if (!data?.signedUrl) { setError('Could not generate download link.'); return }
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = doc.file_name; a.click()
  }

  const handleDownloadAll = async () => {
    if (documents.length === 1) { handleDownloadOne(documents[0]); return }
    setDownloading(true); setError(null)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      await Promise.all(documents.map(async (doc) => {
        const { data } = await supabase.storage.from('deal-documents').createSignedUrl(doc.file_path, 120)
        if (!data?.signedUrl) return
        const blob = await fetch(data.signedUrl).then(r => r.blob())
        zip.file(doc.file_name, blob)
      }))
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(zipBlob)
      a.download = `deal-documents-${dealId.slice(0, 8)}.zip`
      a.click(); URL.revokeObjectURL(a.href)
    } catch { setError('Zip download failed. Try downloading individually.') }
    setDownloading(false)
  }

  const handleDelete = async (doc: DealDocument) => {
    if (!confirm(`Delete "${doc.file_name}"?`)) return
    setDeletingId(doc.id)
    await supabase.storage.from('deal-documents').remove([doc.file_path])
    await supabase.from('deal_documents').delete().eq('id', doc.id)
    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    setDeletingId(null)
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
          {error} <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </p>
      )}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)) }}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${dragOver ? 'border-blue-400 bg-blue-400/5' : 'border-zinc-700 hover:border-zinc-500'}
          ${uploading ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input ref={fileInputRef} type="file" multiple className="hidden"
          onChange={e => handleFiles(Array.from(e.target.files || []))} />
        {uploading
          ? <div className="flex items-center justify-center gap-2 text-sm text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</div>
          : <div className="flex items-center justify-center gap-2 text-sm text-zinc-400"><Upload className="w-4 h-4" /> Drop files or click to upload</div>
        }
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-zinc-500 animate-spin" /></div>
      ) : documents.length === 0 ? (
        <p className="text-center text-sm text-zinc-600 py-6">No documents yet</p>
      ) : (
        <>
          {documents.length > 1 && (
            <button onClick={handleDownloadAll} disabled={downloading}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50">
              {downloading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Zipping…</>
                : <><Download className="w-3.5 h-3.5" /> Download all ({documents.length} files)</>
              }
            </button>
          )}
          <div className="space-y-1">
            {documents.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/70 group transition-colors">
                <span className="flex-1 text-sm text-zinc-200 truncate">{doc.file_name}</span>
                <span className="text-xs text-zinc-600">{formatFileSize(doc.file_size)}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleDownloadOne(doc)} className="p-1 text-zinc-500 hover:text-blue-400 transition-colors">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(doc)} disabled={deletingId === doc.id}
                    className="p-1 text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50">
                    {deletingId === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
