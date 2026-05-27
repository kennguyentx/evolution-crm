// app/api/portfolio-news/daily-email/route.ts
// Daily portfolio news email — fired by Vercel Cron at 17:00 UTC (12pm ET)
// Also accepts POST for manual trigger from the UI.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getRecipients } from '@/lib/notify-config'

export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FROM_EMAIL = 'intake@evolutionstrategy.com'

// ── Types (mirrored from main route) ─────────────────────────────────────────

interface NewsArticle {
  title: string
  link: string
  pubDate: string
  source: string
}

interface CompanyNews {
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
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/)
    const title = titleMatch ? extractCdata(titleMatch[1]) : ''

    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/)
    const link = linkMatch ? linkMatch[1].trim() : ''

    const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)
    const pubDate = dateMatch ? dateMatch[1].trim() : ''

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
    return parseItems(xml).filter(a => isWithinDays(a.pubDate, 3))
  } catch {
    return []
  }
}

// ── News fetch logic ──────────────────────────────────────────────────────────

async function fetchAllPortfolioNews(): Promise<CompanyNews[]> {
  const { data: companies, error } = await supabase
    .from('portfolio_companies')
    .select('id, name')
    .eq('status', 'Active')
    .order('name')

  if (error || !companies) return []

  return Promise.all(
    companies.map(async (c) => ({
      name: c.name,
      articles: await fetchCompanyNews(c.name),
    }))
  )
}

// ── Email builder ─────────────────────────────────────────────────────────────

function fmtArticleDate(pubDate: string): string {
  if (!pubDate) return ''
  const d = new Date(pubDate)
  if (isNaN(d.getTime())) return pubDate
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function buildHtmlEmail(companies: CompanyNews[], dateStr: string): string {
  const withArticles = companies.filter(c => c.articles.length > 0)
  const noNews = companies.filter(c => c.articles.length === 0)

  const companySections = withArticles
    .map(
      (c) => `
      <div style="margin-bottom:28px;">
        <div style="font-size:13px;font-weight:700;color:#1a1a2e;text-transform:uppercase;
                    letter-spacing:0.06em;padding:8px 0;border-bottom:2px solid #3b5bdb;
                    margin-bottom:12px;">
          ${escHtml(c.name)}
        </div>
        ${c.articles
          .map(
            (a) => `
          <div style="padding:10px 0;border-bottom:1px solid #e8ecf0;">
            <a href="${escHtml(a.link)}" style="font-size:13px;font-weight:600;color:#1a1a2e;
                       text-decoration:none;line-height:1.4;display:block;margin-bottom:4px;"
               target="_blank" rel="noopener noreferrer">
              ${escHtml(a.title)}
            </a>
            <span style="font-size:11px;color:#6b7280;">
              ${a.source ? escHtml(a.source) + ' &nbsp;·&nbsp; ' : ''}${fmtArticleDate(a.pubDate)}
            </span>
          </div>`
          )
          .join('')}
      </div>`
    )
    .join('')

  const noNewsSection =
    noNews.length > 0
      ? `<div style="margin-top:24px;padding:14px 16px;background:#f8f9fa;border-radius:8px;border:1px solid #e8ecf0;">
           <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">No recent news</div>
           <div style="font-size:12px;color:#6b7280;">${noNews.map(c => escHtml(c.name)).join(', ')}</div>
         </div>`
      : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Portfolio News — ${escHtml(dateStr)}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#1a1a2e;border-radius:10px 10px 0 0;padding:28px 32px;">
              <div style="font-size:11px;font-weight:600;color:#8b9cf7;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">
                Evolution Strategy Partners
              </div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;margin-bottom:4px;">
                Portfolio Industry News
              </div>
              <div style="font-size:13px;color:#a0aec0;">
                3-day digest &nbsp;·&nbsp; ${escHtml(dateStr)}
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:28px 32px 8px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
              ${withArticles.length === 0
                ? '<p style="font-size:13px;color:#6b7280;font-style:italic;">No news articles found in the last 3 days for any portfolio company.</p>'
                : companySections
              }
              ${noNewsSection}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fa;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:18px 32px;text-align:center;">
              <div style="font-size:11px;color:#9ca3af;">
                <a href="https://nexus.evolutionstrategy.com" style="color:#3b5bdb;text-decoration:none;font-weight:600;">
                  nexus.evolutionstrategy.com
                </a>
                &nbsp;·&nbsp; Evolution Strategy CRM
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Send logic ────────────────────────────────────────────────────────────────

async function runSend() {
  const RECIPIENTS = await getRecipients('portfolio_news_recipients')

  const serverToken = process.env.POSTMARK_SERVER_TOKEN
  if (!serverToken) {
    return NextResponse.json({ error: 'POSTMARK_SERVER_TOKEN not configured' }, { status: 500 })
  }

  const companies = await fetchAllPortfolioNews()
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  })

  const html = buildHtmlEmail(companies, dateStr)
  const totalArticles = companies.reduce((s, c) => s + c.articles.length, 0)

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': serverToken,
    },
    body: JSON.stringify({
      From: FROM_EMAIL,
      To: RECIPIENTS.join(', '),
      Subject: `Portfolio News — ${dateStr}`,
      HtmlBody: html,
      MessageStream: 'outbound',
    }),
  })

  const result = await res.json()
  if (!res.ok) {
    console.error('[portfolio-news-email] Postmark error:', result)
    return NextResponse.json({ error: result.Message || 'Send failed' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    companies: companies.length,
    articles: totalArticles,
    recipients: RECIPIENTS.length,
  })
}

// ── GET — Vercel Cron ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET not set' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runSend()
}

// ── POST — manual trigger from UI (requires valid Supabase session) ───────────

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return runSend()
}
