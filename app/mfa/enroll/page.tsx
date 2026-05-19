'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { ShieldCheck, ShieldOff, Loader2, CheckCircle2, Copy } from 'lucide-react'

type Step = 'loading' | 'enrolled' | 'setup-scan' | 'setup-verify' | 'success'

export default function MFAEnrollPage() {
  const supabase = createClient()
  const [step, setStep] = useState<Step>('loading')
  const [factorId, setFactorId] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => { checkEnrollment() }, [])

  async function checkEnrollment() {
    const { data } = await supabase.auth.mfa.listFactors()
    const verified = data?.totp?.find(f => f.status === 'verified')
    setStep(verified ? 'enrolled' : 'loading')
    if (verified) setFactorId(verified.id)
    else await startEnroll()
  }

  async function startEnroll() {
    setError('')
    const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Authenticator App',
    })
    if (enrollErr || !data) {
      setError('Could not start enrollment. Please try again.')
      setStep('enrolled') // fallback
      return
    }
    setFactorId(data.id)
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setStep('setup-scan')
    setTimeout(() => codeRef.current?.focus(), 100)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.replace(/\s/g, ''),
    })
    setLoading(false)
    if (verifyErr) {
      setError('Invalid code. Try again.')
      setCode('')
      codeRef.current?.focus()
    } else {
      setStep('success')
    }
  }

  async function handleUnenroll() {
    if (!confirm('Remove two-factor authentication from your account?')) return
    setLoading(true)
    const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId })
    setLoading(false)
    if (unenrollErr) {
      setError(unenrollErr.message)
    } else {
      setFactorId('')
      await startEnroll()
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const cardStyle: React.CSSProperties = {
    maxWidth: '420px',
    margin: '48px auto',
    padding: '32px',
  }

  // ── Loading ──────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}>
        <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
      </div>
    )
  }

  // ── Already enrolled ─────────────────────────────────────────
  if (step === 'enrolled') {
    return (
      <div className="card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <ShieldCheck size={20} color="#22c55e" />
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Two-factor authentication</h2>
        </div>
        <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          MFA is <strong style={{ color: '#22c55e' }}>active</strong> on your account. You'll be prompted for your authenticator code each time you sign in.
        </p>
        {error && <p style={{ marginBottom: '16px', fontSize: '12px', color: '#e53e3e' }}>{error}</p>}
        <button
          onClick={handleUnenroll}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '9px 14px', borderRadius: '7px',
            border: '1px solid #e53e3e', background: 'white',
            color: '#e53e3e', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ShieldOff size={14} />}
          Remove MFA
        </button>
      </div>
    )
  }

  // ── Success ──────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <CheckCircle2 size={20} color="#22c55e" />
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>MFA enabled</h2>
        </div>
        <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Your account is now protected with two-factor authentication. You'll be asked for a code from your authenticator app each time you sign in.
        </p>
        <button
          onClick={() => setStep('enrolled')}
          style={{
            padding: '9px 16px', borderRadius: '7px', border: 'none',
            background: '#4F284B', color: 'white', fontSize: '13px',
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    )
  }

  // ── Setup: scan QR ───────────────────────────────────────────
  return (
    <div className="card" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <ShieldCheck size={20} color="#4F284B" />
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Set up two-factor authentication</h2>
      </div>
      <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Scan the QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code below to confirm.
      </p>

      {/* QR code */}
      {qrCode && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{ padding: '12px', background: 'white', border: '1px solid var(--border)', borderRadius: '10px', display: 'inline-block' }}>
            <img src={qrCode} alt="MFA QR code" style={{ width: '180px', height: '180px', display: 'block' }} />
          </div>
        </div>
      )}

      {/* Manual secret */}
      <div style={{ marginBottom: '24px' }}>
        <p style={{ margin: '0 0 6px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Can't scan? Enter this key manually
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <code style={{
            flex: 1, padding: '8px 10px', borderRadius: '6px',
            background: 'var(--bg)', border: '1px solid var(--border)',
            fontSize: '12px', letterSpacing: '0.1em', wordBreak: 'break-all', color: 'var(--text)',
          }}>
            {secret}
          </code>
          <button
            onClick={copySecret}
            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'white', cursor: 'pointer', flexShrink: 0 }}
            title="Copy secret"
          >
            {copied ? <CheckCircle2 size={14} color="#22c55e" /> : <Copy size={14} color="var(--text-muted)" />}
          </button>
        </div>
      </div>

      {/* Verify code */}
      <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '6px' }}>
            Verification code
          </label>
          <input
            ref={codeRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{
              width: '100%',
              padding: '11px 14px',
              fontSize: '20px',
              letterSpacing: '0.25em',
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
        </div>

        {error && <p style={{ margin: 0, fontSize: '12px', color: '#e53e3e' }}>{error}</p>}

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
          }}
        >
          {loading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
          Activate MFA
        </button>
      </form>
    </div>
  )
}
