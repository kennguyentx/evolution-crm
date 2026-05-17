'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Upload, FileText, Download, Trash2, File, FileSpreadsheet, Loader2, X, AlertCircle } from 'lucide-react'

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

const FILE_CATEGORY_MAP: Record<string, { label: string; color: string }> = {
  'application/pdf': { label: 'PDF', color: 'text-red-400 bg-red-400/10' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { label: 'Excel', color: 'text-emerald-400 bg-emerald-400/10' },
  'application/vnd.ms-excel': { label: 'Excel', color: 'text-emerald-400 bg-emerald-400/10' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'Word', color: 'text-blue-400 bg-blue-400/10' },
  'application/msword': { label: 'Word', color: 'text-blue-400 bg-blue-400/10' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { label: 'PPT', color: 'text-orange-400 bg-orange-400/10' },
  'text/plain': { label: 'TXT', color: 'text-zinc-400 bg-zinc-400/10' },
  'image/png': { label: 'IMG', color: 'text-purple-400 bg-purple-400/10' },
  'image/jpeg': { label: 'IMG', color: 'text-purple-400 bg-purple-400/10' },
}

function getFileCategory(mimeType: string | null) {
  if (!mimeType) return { label: 'FILE', color: 'text-zinc-400 bg-zinc-400/10' }
  return FILE_CATEGORY_MAP[mimeType] || { label: 'FILE', color: 'text-zinc-400 bg-zinc-400/10' }
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  if (!mimeType) return <File className="w-5 h-5" />
  if (mimeType.includes('pdf')) return <FileText className="w-5 h-5" />
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return <FileSpreadsheet className="w-5 h-5" />
  return <File className="w-5 h-5" />
}

export default function DocumentsTab({ dealId }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<DealDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('deal_documents')
      .select('*')
      .eq('deal_id', dealId)
      .order('uploaded_at', { ascending: false })

    if (error) {
      setError('Failed to load documents.')
    } else {
      setDocuments(data || [])
    }
    setLoading(false)
  }, [dealId, supabase])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  const uploadFile = async (file: File) => {
    if (!file) return
    setUploading(true)
    setError(null)
    setUploadProgress(`Uploading ${file.name}…`)

    // Sanitize file name: replace spaces and special chars
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${dealId}/${Date.now()}_${safeFileName}`

    const { error: uploadError } = await supabase.storage
      .from('deal-documents')
      .upload(filePath, file, { upsert: false })

    if (uploadError) {
      setError(`Upload failed: ${uploadError.message}`)
      setUploading(false)
      setUploadProgress(null)
      return
    }

    // Insert record into deal_documents table
    const { error: dbError } = await supabase
      .from('deal_documents')
      .insert({
        deal_id: dealId,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type || null,
      })

    if (dbError) {
      setError(`File uploaded but record failed: ${dbError.message}`)
    }

    setUploading(false)
    setUploadProgress(null)
    fetchDocuments()
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      await uploadFile(file)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      await uploadFile(file)
    }
  }

  const handleDownload = async (doc: DealDocument) => {
    const { data, error } = await supabase.storage
      .from('deal-documents')
      .createSignedUrl(doc.file_path, 60) // 60-second signed URL

    if (error || !data?.signedUrl) {
      setError('Failed to generate download link.')
      return
    }

    const link = document.createElement('a')
    link.href = data.signedUrl
    link.download = doc.file_name
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleDelete = async (doc: DealDocument) => {
    if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return
    setDeletingId(doc.id)

    // Delete from storage
    await supabase.storage.from('deal-documents').remove([doc.file_path])

    // Delete DB record
    const { error } = await supabase
      .from('deal_documents')
      .delete()
      .eq('id', doc.id)

    if (error) {
      setError('Failed to delete document.')
    } else {
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
    }
    setDeletingId(null)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-4">
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Drop zone / upload area */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200
          ${dragOver
            ? 'border-blue-400 bg-blue-400/5'
            : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/30'
          }
          ${uploading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg"
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-7 h-7 text-blue-400 animate-spin" />
            <span className="text-sm text-zinc-400">{uploadProgress}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-7 h-7 text-zinc-500" />
            <div>
              <p className="text-sm font-medium text-zinc-300">
                {dragOver ? 'Drop to upload' : 'Drop files here or click to browse'}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                PDF, Excel, Word, PowerPoint, images
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Document list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-10 text-zinc-500 text-sm">
          No documents uploaded yet
        </div>
      ) : (
        <div className="space-y-1">
          {documents.map(doc => {
            const category = getFileCategory(doc.file_type)
            return (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/70 transition-colors group"
              >
                {/* Icon */}
                <div className={`flex-shrink-0 p-1.5 rounded-md ${category.color}`}>
                  <FileIcon mimeType={doc.file_type} />
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">{doc.file_name}</p>
                  <p className="text-xs text-zinc-500">
                    {formatFileSize(doc.file_size)} · {formatDate(doc.uploaded_at)}
                  </p>
                </div>

                {/* Type badge */}
                <span className={`hidden sm:inline-flex text-xs font-medium px-2 py-0.5 rounded ${category.color}`}>
                  {category.label}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleDownload(doc)}
                    title="Download"
                    className="p-1.5 rounded-md text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    title="Delete"
                    disabled={deletingId === doc.id}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                  >
                    {deletingId === doc.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Trash2 className="w-4 h-4" />
                    }
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Count footer */}
      {!loading && documents.length > 0 && (
        <p className="text-xs text-zinc-600 text-right">
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
