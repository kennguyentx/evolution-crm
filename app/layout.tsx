import type { Metadata } from 'next'
import './globals.css'
import LayoutClient from '@/components/layout/LayoutClient'

export const metadata: Metadata = {
  title: 'Evolution Strategy | Deal CRM',
  description: 'Deal pipeline and contact management',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  )
}
