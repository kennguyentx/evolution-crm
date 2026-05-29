// lib/portfolio-news.ts
// Shared RSS fetch + Claude curation logic used by both:
//   - app/api/portfolio-news/route.ts  (dashboard widget)
//   - app/api/portfolio-news/daily-email/route.ts  (cron email)

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { AI_MODELS } from '@/lib/ai-config'
import { DAILY_NEWS_BRIEF_PROMPT, fillPrompt } from '@/lib/prompts'

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

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches RSS articles for all active portfolio companies, curates them with
 * Claude using the canonical daily brief prompt, and returns the result.
 */
export async function fetchCuratedPortfolioNews(): Promise<CompanyNews[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  // 1. Fetch active portfolio companies
  const { data: companies, error } = await supabase
    .from('portfolio_companies')
    .select('id, name, sector, geography, news_search_name')
    .eq('status', 'Active')
    .order('name')

  if (error || !companies?.length) return []

  // 2. Four RSS searches per company in parallel
  const rawByCompany = await Promise.all(
    companies.map(async (c) => {
      const name = c.news_search_name?.trim() || c.name
      const sector = c.sector || ''
      const geo = c.geography || ''

      const [companyArticles, maArticles, industryArticles, macroArticles] = await Promise.all([
        fetchRss(`"${name}"`),
        fetchRss(`${sector} acquisition OR "private equity" OR "PE deal" OR "deal closed" ${geo}`),
        fetchRss(`${sector} ${geo} industry OR market OR outlook OR growth`),
        fetchRss(`${sector} ${geo} labor OR workforce OR "supply chain" OR backlog OR "materials costs" OR regulation`),
      ])

      const seen = new Set<string>()
      const all = [...companyArticles, ...maArticles, ...industryArticles, ...macroArticles].filter(a => {
        if (seen.has(a.link)) return false
        seen.add(a.link)
        return true
      })

      return { company: c, articles: all }
    })
  )

  // 3. Build prompt
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  })

  const portfolioList = companies
    .map(c => `- ${c.name} (${[c.sector, c.geography].filter(Boolean).join(', ')})`)
    .join('\n')

  const rawArticlesJson = JSON.stringify(
    rawByCompany.map(r => ({
      company: r.company.name,
      articles: r.articles.map((a, i) => ({ id: i, title: a.title, source: a.source, pubDate: a.pubDate, link: a.link })),
    })),
    null, 2
  )

  const prompt = fillPrompt(DAILY_NEWS_BRIEF_PROMPT, {
    TODAY: today,
    PORTFOLIO_COMPANIES: portfolioList,
    RAW_ARTICLES: rawArticlesJson,
  }) + `

Return ONLY valid JSON in this exact shape — no prose, no markdown fences:
{
  "companies": [
    {
      "name": "Company Name",
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
    }
  ]
}

Only include articles that are genuinely relevant and meet the 3-day freshness rule. Omit irrelevant articles entirely. It's fine to have 0 articles for a company.`

  // 4. Claude curation
  try {
    const response = await anthropic.messages.create({
      model: AI_MODELS.fast,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim()

    const curated = JSON.parse(raw) as { companies: CompanyNews[] }

    return curated.companies.map(c => {
      const orig = companies.find(p => p.name === c.name)
      return { ...c, sector: orig?.sector ?? null, geography: orig?.geography ?? null }
    })
  } catch {
    // Fallback: return raw company-name articles uncurated
    return rawByCompany.map(r => ({
      name: r.company.name,
      sector: r.company.sector,
      geography: r.company.geography,
      articles: r.articles.slice(0, 5).map(a => ({ ...a, category: 'company' as const, multiple: null })),
    }))
  }
}
