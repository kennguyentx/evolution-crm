// app/api/portfolio-news/route.ts
// Fetches Google News RSS for each active portfolio company, filtered to last 3 days.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const maxDuration = 30

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
}

export interface CompanyNews {
  name: string
  articles: NewsArticle[]
}

// ── RSS helpers ───────────────────────────────────────────────────────────────

function extractCdata(raw: string): string {
  const m = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  return m ? m[1].trim() : raw.trim()
}

function parseItems(xml: string): NewsArticle[] {
  const items: NewsArticle[] = []
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || []

  for (const block of itemBlocks) {
    // Title
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/)
    const title = titleMatch ? extractCdata(titleMatch[1]) : ''

    // Link — Google News RSS uses <link> as a plain tag (not CDATA)
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/)
    const link = linkMatch ? linkMatch[1].trim() : ''

    // pubDate
    const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)
    const pubDate = dateMatch ? dateMatch[1].trim() : ''

    // Source name — <source url="...">Name</source>
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)
    const source = sourceMatch ? extractCdata(sourceMatch[1]) : ''

    if (title && link) {
      items.push({ title, link, pubDate, source })
    }
  }

  return items
}

function isWithinDays(pubDate: string, days: number): boolean {
  if (!pubDate) return false
  const parsed = new Date(pubDate)
  if (isNaN(parsed.getTime())) return false
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return parsed.getTime() >= cutoff
}

async function fetchCompanyNews(name: string): Promise<NewsArticle[]> {
  const url = `https://news.google.com/rss/search?q="${encodeURIComponent(name)}"&hl=en-US&gl=US&ceid=US:en`
  try {
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EvolutionCRM/1.0)' },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const items = parseItems(xml)
    return items.filter(a => isWithinDays(a.pubDate, 3))
  } catch {
    return []
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  // 1. Fetch active portfolio companies
  const { data: companies, error } = await supabase
    .from('portfolio_companies')
    .select('id, name')
    .eq('status', 'Active')
    .order('name')

  if (error || !companies) {
    return NextResponse.json({ error: 'Failed to fetch portfolio companies' }, { status: 500 })
  }

  // 2. Fetch news for each company in parallel
  const results = await Promise.all(
    companies.map(async (c) => {
      const articles = await fetchCompanyNews(c.name)
      return { name: c.name, articles } as CompanyNews
    })
  )

  return NextResponse.json({ companies: results })
}
