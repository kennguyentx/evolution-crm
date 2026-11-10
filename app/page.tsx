import { redirect } from 'next/navigation'

// Server-component redirect (item 29b): middleware has already sent
// unauthenticated requests to /login (and MFA-pending sessions to
// /mfa/verify) before this page renders, so reaching here means the
// session is valid — go straight to the dashboard without the old
// client-side session check that rendered a blank page first.
export default function Home() {
  redirect('/dashboard')
}
