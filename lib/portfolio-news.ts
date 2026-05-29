// lib/portfolio-news.ts
// Shared RSS fetch + Claude curation logic used by both:
//   - app/api/portfolio-news/route.ts  (dashboard widget)
//   - app/api/portfolio-news/daily-email/route.ts  (cron email)
//
// Each company is curated in its own Claude call so articles fetched for
// one company can never bleed into another company's results.

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { AI_MODELS } from '@/lib/ai-config'

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
  category: 'company' | 'industry' | 'transaction'
  multiple?: string | null
}

export interface CompanyNews {
  name: string
  sector: string | null
  geography: string | null
  articles: NewsArticle[]
}

// ── RSS helpers ───────────────────────────────────────────────────────────────

function extractCdata(raw: string): string {
  const m = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  return m ? m[1].trim() : raw.trim()
}

function parseItems(xml: string): { title: string; link: string; pubDate: string; source: string }[] {
  const items: { title: string; link: string; pubDate: string; source: string }[] = []
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || []
  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/)
    const title = titleMatch ? extractCdata(titleMatch[1]) : ''
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/)
    const link = linkMatch ? linkMatch[1].trim() : ''
    const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)
    const pubDate = dateMatch ? dateMatch[1].trim() : ''
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)
    const source = sourceMatch ? extractCdata(sourceMatch[1]) : ''
    if (title && link) items.push({ title, link, pubDate, source })
  }
  return items
}

function isWithinDays(pubDate: string, days: number): boolean {
  if (!pubDate) return false
  const parsed = new Date(pubDate)
  if (isNaN(parsed.getTime())) return false
  return parsed.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000
}

async function fetchRss(query: string): Promise<{ title: string; link: string; pubDate: string; source: string }[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  try {
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EvolutionCRM/1.0)' },
    })
    if (!res.ok) return []
    const xml = await res.text()
    return parseItems(xml).filter(a => isWithinDays(a.pubDate, 7))
  } catch {
    return []
  }
}

// ── Geographic mismatch filter ────────────────────────────────────────────────
// Deterministic pre-filter applied BEFORE Claude sees the articles.
// Rejects articles whose titles contain place names from clearly different regions.

const REGION_KEYWORDS: [string[], string[]][] = [
  // [signals that indicate this region, place names that belong to it]
  [['houston', 'texas', ' tx'], ['houston', 'san antonio', 'austin', 'corpus christi', 'lubbock', 'el paso', 'texas', ' tx ']],
  [['carolina', 'charlotte', 'raleigh', 'durham'], ['charlotte', 'raleigh', 'durham', 'greensboro', 'asheville', 'wilmington', 'charleston', 'columbia', 'north carolina', 'south carolina', ' nc ', ' sc ']],
  [['michigan', 'detroit', 'grand rapids'], ['detroit', 'grand rapids', 'lansing', 'flint', 'ann arbor', 'kalamazoo', 'michigan', ' mi ']],
  [['dallas', 'fort worth', 'dfw'], ['dallas', 'fort worth', 'dfw', 'arlington', 'plano', 'frisco', 'mckinney', 'garland']],
  [['chicago', 'ohio', 'indiana', 'illinois'], ['chicago', 'cleveland', 'columbus', 'cincinnati', 'indianapolis', 'milwaukee', 'ohio', 'indiana', 'illinois', 'wisconsin']],
]

function isGeographicMismatch(title: string, geography: string | null): boolean {
  if (!geography) return false
  const t = ' ' + title.toLowerCase() + ' '
  const geo = geography.toLowerCase()

  // Find which region(s) this company belongs to
  const ownPlaces = new Set<string>()
  const otherPlaces = new Set<string>()

  for (const [signals, places] of REGION_KEYWORDS) {
    const isOwn = signals.some(s => geo.includes(s))
    for (const p of places) {
      if (isOwn) ownPlaces.add(p)
      else otherPlaces.add(p)
    }
  }

  const mentionsOther = [...otherPlaces].some(p => t.includes(p))
  if (!mentionsOther) return false

  // If the title also mentions own region, it could be a multi-region story — keep it
  const mentionsOwn = [...ownPlaces].some(p => t.includes(p))
  return !mentionsOwn
}

// ── Per-company Claude curation ───────────────────────────────────────────────

const JSON_SHAPE = `
Return ONLY valid JSON — no prose, no markdown fences:
{
  "articles": [
    {
      "title": "...",
      "link": "...",
      "pubDate": "...",
      "source": "...",
      "category": "company" | "industry" | "transaction",
      "multiple": "8.0x EBITDA" | null
    }
  ]
}`

async function curateForCompany(
  anthropic: Anthropic,
  company: { name: string; sector: string | null; geography: string | null },
  articles: { title: string; link: string; pubDate: string; source: string }[],
  today: string,
): Promise<NewsArticle[]> {
  if (articles.length === 0) return []

  const prompt = `You are curating a daily industry news brief for Evolution Strategy Partners, a private equity firm. Today is ${today}.

You are processing ONE portfolio company:
  Name: ${company.name}
  Sector: ${company.sector || 'unknown'}
  Geography: ${company.geography || 'unknown'}

Below are raw RSS articles fetched specifically for this company. Your job is to filter and categorize them.

## Rules
- **Only keep articles that are genuinely relevant** to this company's sector AND geography.
- **Reject any article that is geographically mismatched.** If this company operates in ${company.geography || 'a specific region'}, discard articles about projects or events in other regions unless the story is explicitly national in scope.
- **Only include items published within the past 3 days** (cutoff: ${today}). Discard anything older.
- **No filler.** Each kept article must describe a specific named event: contract award, project announcement, acquisition, regulatory action, earnings release, etc.
- Categorize each kept article as:
  - "company": directly about ${company.name} itself
  - "industry": sector/market news relevant to this company's geography and vertical
  - "transaction": M&A deal or acquisition in this sector; extract any disclosed multiple as a short string like "8.0x EBITDA"
- If an article doesn't fit — wrong sector, wrong geography, too vague, or older than 3 days — omit it entirely.
- It is fine to return 0 articles.

## Raw articles
${JSON.stringify(articles.map((a, i) => ({ id: i, title: a.title, source: a.source, pubDate: a.pubDate, link: a.link })), null, 2)}
${JSON_SHAPE}`

  try {
    const response = await anthropic.messages.create({
      model: AI_MODELS.fast,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim()

    const parsed = JSON.parse(raw) as { articles: NewsArticle[] }
    return parsed.articles ?? []
  } catch {
    // Fallback: return direct company-name articles only, uncategorized
    return articles.slice(0, 3).map(a => ({ ...a, category: 'company' as const, multiple: null }))
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches RSS articles for all active portfolio companies and curates each
 * company independently with its own Claude call — preventing cross-company
 * article bleed. All companies are processed in parallel.
 */
export async function fetchCuratedPortfolioNews(): Promise<CompanyNews[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const { data: companies, error } = await supabase
    .from('portfolio_companies')
    .select('id, name, sector, geography, news_search_name')
    .eq('status', 'Active')
    .order('name')

  if (error || !companies?.length) return []

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  })

  // Fetch RSS + curate each company fully in parallel
  return Promise.all(
    companies.map(async (c) => {
      const name = c.news_search_name?.trim() || c.name
      const sector = c.sector || ''
      const geo = c.geography || ''

      // Four targeted RSS searches
      const [companyArticles, maArticles, industryArticles, macroArticles] = await Promise.all([
        fetchRss(`"${name}"`),
        fetchRss(`${sector} acquisition OR "private equity" OR "PE deal" OR "deal closed" ${geo}`),
        fetchRss(`${sector} ${geo} industry OR market OR outlook OR growth`),
        fetchRss(`${sector} ${geo} labor OR workforce OR "supply chain" OR backlog OR "materials costs" OR regulation`),
      ])

      // Dedupe by link, then drop any article whose title places it in the wrong region
      const seen = new Set<string>()
      const allArticles = [...companyArticles, ...maArticles, ...industryArticles, ...macroArticles].filter(a => {
        if (seen.has(a.link)) return false
        seen.add(a.link)
        if (isGeographicMismatch(a.title, c.geography)) return false
        return true
      })

      // Claude curates only this company's geo-filtered articles
      const curated = await curateForCompany(anthropic, c, allArticles, today)

      return {
        name: c.name,
        sector: c.sector ?? null,
        geography: c.geography ?? null,
        articles: curated,
      }
    })
  )
}
