import type { Metadata } from 'next'
import './globals.css'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'

export const metadata: Metadata = {
  title: 'Evolution Strategy | Deal CRM',
  description: 'Deal pipeline and contact management',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createServerComponentClient({ cookies })
  const { data: { session } } = await supabase.auth.getSession()

  // If no session and not on login page, redirect
  // (handled client-side for flexibility)

  return (
    <html lang="en">
      <body>
        {session ? (
          <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            <Sidebar />
            <main style={{ flex: 1, overflow: 'auto', padding: '0' }}>
              {children}
            </main>
          </div>
        ) : (
          <div style={{ minHeight: '100vh' }}>
            {children}
          </div>
        )}
      </body>
    </html>
  )
}
