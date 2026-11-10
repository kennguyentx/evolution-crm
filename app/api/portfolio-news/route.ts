// app/api/portfolio-news/route.ts
// Returns curated portfolio news for the dashboard widget.
// Fetching, RSS search, and Claude curation all live in lib/portfolio-news.ts.

import { NextResponse } from 'next/server'
import { fetchCuratedPortfolioNews } from '@/lib/portfolio-news'
import { withErrorHandler } from '@/lib/api-response'

export const maxDuration = 60

// Re-export types so the dashboard component can import them from here as before
export type { NewsArticle, CompanyNews } from '@/lib/portfolio-news'

export const GET = withErrorHandler(async () => {
  const companies = await fetchCuratedPortfolioNews()
  return NextResponse.json({ companies })
})
