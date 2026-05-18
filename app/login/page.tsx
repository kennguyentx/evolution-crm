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
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <img
            src="/logo.png"
            alt="Evolution Strategy Partners"
            style={{ width: '220px', height: 'auto', margin: '0 auto', display: 'block' }}
          />
          <div style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginTop: '10px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            Nexus
          </div>
        </div>

        {/* Auth */}
        <div className="card" style={{ padding: '28px' }}>
          <Auth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#4F284B',
                    brandAccent: '#3d1e3a',
                    inputBackground: '#ffffff',
                    inputBorder: '#e3e6eb',
                    inputText: '#1c1228',
                    inputPlaceholder: '#9088a0',
                  },
                  radii: {
                    borderRadiusButton: '7px',
                    buttonBorderRadius: '7px',
                    inputBorderRadius: '7px',
                  }
                }
              },
              style: {
                button: { fontFamily: 'Nunito Sans, sans-serif', fontSize: '13px', fontWeight: '600' },
                input: { fontFamily: 'Nunito Sans, sans-serif', fontSize: '13px' },
                label: { fontFamily: 'Nunito Sans, sans-serif', color: '#9088a0', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600' },
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
