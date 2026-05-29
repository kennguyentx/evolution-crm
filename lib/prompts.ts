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

The following articles were collected via RSS in the past 7 days, grouped by which portfolio company's search query found them. Use them as a starting point and apply these rules:

- **Geography is a hard filter.** Each company has a defined geography. Do not assign a geographically-specific article to a company operating in a different region. For example, a project or contract award in Houston belongs only to Texas-based companies — not to a company based in the Carolinas or Michigan.
- **Sector is a hard filter.** Do not assign an article about landscaping to an electrical contractor, or vice versa, just because both operate in the same region.
- **Articles may only move between companies if the story is genuinely sector-wide and geography-agnostic** (e.g., a national OSHA rule, a broad federal infrastructure bill). In that case, assign it once to the most relevant company.
- Omit any article that does not meet the 3-day freshness requirement or is not a specific named event.

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
