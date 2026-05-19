'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled error:', error)
  }, [error])

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      color: 'var(--text-primary)',
      background: 'var(--bg)',
    }}>
      <div style={{ fontSize: '32px' }}>⚠️</div>
      <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Something went wrong</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, maxWidth: '360px', textAlign: 'center' }}>
        {error.message || 'An unexpected error occurred. Try refreshing the page.'}
      </p>
      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <button
          className="btn btn-primary"
          onClick={reset}
        >
          Try again
        </button>
        <button
          className="btn"
          onClick={() => window.location.href = '/dashboard'}
        >
          Go to dashboard
        </button>
      </div>
      {error.digest && (
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '8px' }}>
          Error ID: {error.digest}
        </p>
      )}
    </div>
  )
}
