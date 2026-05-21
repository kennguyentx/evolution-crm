// app/api/portfolio-news/route.ts
// Fetches and curates news for each active portfolio company using Claude.
// For each company, runs 3 RSS searches: company name, industry M&A, sector/geo.
// Claude then filters noise, categorizes articles, and extracts transaction multiples.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export const maxDuration = 60

export interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
  category: 'company' | 'industry' | 'transaction'
  multiple?: string | null  // e.g. "8.0x EBITDA" if mentioned
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
    return parseItems(xml).filter(a => isWithinDays(a.pubDate, 3))
  } catch {
    return []
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  // 1. Fetch active portfolio companies with sector + geography
  const { data: companies, error } = await supabase
    .from('portfolio_companies')
    .select('id, name, sector, geography')
    .eq('status', 'Active')
    .order('name')

  if (error || !companies?.length) {
    return NextResponse.json({ companies: [] })
  }

  // 2. For each company, run 3 RSS searches in parallel
  const rawByCompany = await Promise.all(
    companies.map(async (c) => {
      const name = c.name
      const sector = c.sector || ''
      const geo = c.geography || ''

      // Query 1: direct company name search
      // Query 2: sector M&A / transactions in geography
      // Query 3: sector industry news in geography
      const [companyArticles, maArticles, industryArticles] = await Promise.all([
        fetchRss(`"${name}"`),
        fetchRss(`${sector} acquisition OR transaction OR "deal closed" ${geo}`),
        fetchRss(`${sector} ${geo}`),
      ])

      // Dedupe by title across all three searches
      const seen = new Set<string>()
      const all = [...companyArticles, ...maArticles, ...industryArticles].filter(a => {
        if (seen.has(a.link)) return false
        seen.add(a.link)
        return true
      })

      return { company: c, articles: all }
    })
  )

  // 3. If no articles at all, return empty
  const totalArticles = rawByCompany.reduce((s, r) => s + r.articles.length, 0)
  if (totalArticles === 0) {
    return NextResponse.json({
      companies: companies.map(c => ({ name: c.name, sector: c.sector, geography: c.geography, articles: [] }))
    })
  }

  // 4. Pass all raw articles to Claude for curation, categorization, and multiple extraction
  const prompt = `You are helping a private equity firm curate news for their portfolio companies.

Portfolio companies:
${companies.map(c => `- ${c.name} (${[c.sector, c.geography].filter(Boolean).join(', ')})`).join('\n')}

Below are raw news articles collected in the last 3 days. For each portfolio company, return the relevant articles categorized as:
- "company": directly about THIS specific company (filter out articles that merely share a similar name with an unrelated company)
- "industry": relevant market trends, sector news, or regulatory news for this company's sector and geography
- "transaction": announced or closed M&A deals, acquisitions, or investments in similar companies in the same sector. If a revenue or EBITDA multiple is mentioned (e.g., "acquired for 8x EBITDA", "$50M deal, $6M EBITDA"), extract it as a short string like "8.0x EBITDA" or "6.5x revenue".

Raw articles (JSON):
${JSON.stringify(rawByCompany.map(r => ({
  company: r.company.name,
  articles: r.articles.map((a, i) => ({ id: i, title: a.title, source: a.source, pubDate: a.pubDate, link: a.link }))
})), null, 2)}

Return ONLY valid JSON in this exact shape:
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

Only include articles that are genuinely relevant. Omit irrelevant articles entirely. It's fine to have 0 articles for a company.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
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

    // Merge sector/geography back in (Claude doesn't return those)
    const enriched = curated.companies.map(c => {
      const orig = companies.find(p => p.name === c.name)
      return { ...c, sector: orig?.sector ?? null, geography: orig?.geography ?? null }
    })

    return NextResponse.json({ companies: enriched })
  } catch (e) {
    // If Claude fails, fall back to raw company-name articles only
    const fallback = rawByCompany.map(r => ({
      name: r.company.name,
      sector: r.company.sector,
      geography: r.company.geography,
      articles: r.articles.slice(0, 5).map(a => ({ ...a, category: 'company' as const, multiple: null })),
    }))
    return NextResponse.json({ companies: fallback })
  }
}
