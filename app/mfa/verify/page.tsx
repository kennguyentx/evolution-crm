'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { ShieldCheck, Loader2 } from 'lucide-react'

export default function MFAVerifyPage() {
  const supabase = createClient()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Get the enrolled TOTP factor
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totp = factors?.totp?.[0]
      if (!totp) {
        setError('No MFA factor found. Please re-enroll.')
        setLoading(false)
        return
      }

      const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
        factorId: totp.id,
        code: code.replace(/\s/g, ''),
      })

      if (verifyErr) {
        setError('Invalid code. Please try again.')
        setCode('')
        inputRef.current?.focus()
      } else {
        router.replace('/pipeline')
        router.refresh()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{ width: '360px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <img src="/logo.png" alt="Evolution Strategy Partners" style={{ width: '200px', height: 'auto', margin: '0 auto 12px', display: 'block' }} />
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Nexus</div>
        </div>

        <div className="card" style={{ padding: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <ShieldCheck size={20} color="#4F284B" />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>Two-factor authentication</h2>
          </div>
          <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Enter the 6-digit code from your authenticator app.
          </p>

          <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: '24px',
                letterSpacing: '0.3em',
                textAlign: 'center',
                border: `1px solid ${error ? '#e53e3e' : 'var(--border)'}`,
                borderRadius: '8px',
                outline: 'none',
                fontFamily: 'monospace',
                background: 'white',
                color: 'var(--text)',
                boxSizing: 'border-box',
              }}
            />

            {error && (
              <p style={{ margin: 0, fontSize: '12px', color: '#e53e3e', textAlign: 'center' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              style={{
                padding: '11px',
                borderRadius: '7px',
                border: 'none',
                background: code.length === 6 && !loading ? '#4F284B' : '#c4b5c2',
                color: 'white',
                fontSize: '13px',
                fontWeight: 600,
                cursor: code.length === 6 && !loading ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background 0.15s',
              }}
            >
              {loading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
              Verify
            </button>
          </form>

          <button
            onClick={handleSignOut}
            style={{
              marginTop: '16px',
              width: '100%',
              background: 'none',
              border: 'none',
              fontSize: '12px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            Sign out and use a different account
          </button>
        </div>
      </div>
    </div>
  )
}
