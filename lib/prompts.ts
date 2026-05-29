// lib/prompts.ts
// Canonical prompt strings used by AI-powered routes.
// Edit here — routes import from this file rather than embedding prompts inline.

// ── Portfolio News Daily Brief ────────────────────────────────────────────────

export const DAILY_NEWS_BRIEF_PROMPT = `You are preparing the daily industry news brief for Evolution Strategy Partners, a private equity firm. Today's date is {{TODAY}}. Research and compile genuinely new news for each of the portfolio companies below.

## Portfolio Companies

{{PORTFOLIO_COMPANIES}}

## Research Instructions

- Do NOT search for any portfolio company names directly. Search for industry trends, sector news, regional project activity, and M&A in their respective verticals.
- **Strict freshness rule: Only include items published or announced within the past 3 days.** If you cannot confirm a publish date, skip the item. Do not include it.
- Do not include: market size statistics, industry growth projections, regulatory background, general trend articles, or any item without a clear, verifiable publish date within the past 3 days.
- Always include the source name, URL, and publish date for each item.

## Content Rules

- **If there is no fresh news for a company, skip that company entirely.** A short brief with real news is better than a long brief with filler.
- **No filler.** Each bullet must describe a specific, named event (a contract award, project announcement, acquisition, regulatory action, earnings release, etc.) with a date.
- **No repetition.** If the same story touches multiple companies, include it once under the most relevant one.
- **No relevance commentary.** State the facts — what happened, where, when, at what scale. Do not explain implications for the portfolio company.

## M&A Section

- Only include deals announced within the past 30 days in sectors relevant to the portfolio: landscaping, underground utilities, municipal infrastructure, electrical contracting, public works, industrial safety.
- **Omit the section entirely if there are no qualifying deals.**
- For each deal: acquirer, target, geography, announcement date, and one sentence on what the target does.
- **Valuation multiples:** If the deal includes disclosed financial terms, highlight the relevant multiples (e.g., EV/EBITDA, EV/Revenue). If multiples are not explicitly disclosed but deal size and financial data (revenue, EBITDA, backlog) are available from press releases, filings, or comparable sources, calculate and present the implied multiples with a note that they are inferred. If no financial data is available, omit rather than speculate.

## Raw Articles (for curation)

The following articles were collected via RSS in the past 7 days. Use them as a starting point, but apply the strict freshness and relevance rules above. Omit any article that does not meet the 3-day freshness requirement or is not a specific named event.

{{RAW_ARTICLES}}`

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fill template placeholders in a prompt string.
 * Usage: fillPrompt(DAILY_NEWS_BRIEF_PROMPT, { TODAY: '...', PORTFOLIO_COMPANIES: '...', RAW_ARTICLES: '...' })
 */
export function fillPrompt(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [key, val]) => s.replaceAll(`{{${key}}}`, val),
    template
  )
}
