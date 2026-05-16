import { NextResponse } from 'next/server'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_KEY!

  const types = ['banker', 'lp', 'lender', 'advisor', 'management', 'other']

  const [totalRes, ...typeRes] = await Promise.all([
    fetch(`${url}/rest/v1/contacts?select=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' }
    }),
    ...types.map(t =>
      fetch(`${url}/rest/v1/contacts?select=id&contact_type=eq.${t}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' }
      })
    )
  ])

  const parseCount = (res: Response) => {
    const cr = res.headers.get('content-range')
    return cr ? parseInt(cr.split('/')[1]) || 0 : 0
  }

  const total = parseCount(totalRes)
  const counts: Record<string, number> = {}
  types.forEach((t, i) => { counts[t] = parseCount(typeRes[i]) })

  return NextResponse.json({ total, counts })
}
