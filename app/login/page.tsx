'use client'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function LoginPage() {
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        router.push('/pipeline')
        router.refresh()
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase, router])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{ width: '380px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '36px',
            color: 'var(--accent)',
            lineHeight: 1,
          }}>
            Evolution
          </div>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            marginTop: '4px',
          }}>
            Strategy · Deal CRM
          </div>
        </div>

        {/* Auth UI */}
        <div className="card" style={{ padding: '28px' }}>
          <Auth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#c9a96e',
                    brandAccent: '#d9bc8a',
                    inputBackground: '#1a1e28',
                    inputBorder: '#2a2f40',
                    inputText: '#eef0f6',
                    inputPlaceholder: '#5c6480',
                  },
                  radii: {
                    borderRadiusButton: '6px',
                    buttonBorderRadius: '6px',
                    inputBorderRadius: '6px',
                  }
                }
              },
              style: {
                button: { fontFamily: 'DM Sans, sans-serif', fontSize: '13px' },
                input: { fontFamily: 'DM Sans, sans-serif', fontSize: '13px' },
                label: { fontFamily: 'DM Sans, sans-serif', color: '#9ba3bf', fontSize: '12px' },
              }
            }}
            providers={[]}
            view="sign_in"
          />
        </div>
      </div>
    </div>
  )
}
