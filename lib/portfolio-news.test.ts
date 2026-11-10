// lib/portfolio-news.test.ts
// Tests for the deterministic portfolio-news curation logic in
// lib/portfolio-news.ts: the RSS parsing, the recency filter, the
// geographic-mismatch pre-filter, and the lookback window.
// The Claude curation step itself (curateForCompany) needs the Anthropic
// API and is intentionally NOT covered here.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultLookbackDays,
  extractCdata,
  isGeographicMismatch,
  isWithinDays,
  parseItems,
} from './portfolio-news'

describe('extractCdata', () => {
  it('unwraps CDATA and trims', () => {
    expect(extractCdata('<![CDATA[  Amped Electric wins contract  ]]>')).toBe(
      'Amped Electric wins contract',
    )
  })

  it('returns plain text trimmed when there is no CDATA', () => {
    expect(extractCdata('  Plain title  ')).toBe('Plain title')
  })

  it('returns an empty string for empty input', () => {
    expect(extractCdata('')).toBe('')
  })
})

describe('parseItems', () => {
  const xml = `
    <rss><channel>
      <item>
        <title><![CDATA[Amped Electric wins $12M contract]]></title>
        <link>https://example.com/a</link>
        <pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate>
        <source url="https://example.com">Example News</source>
      </item>
      <item>
        <title>Second story without CDATA</title>
        <link>https://example.com/b</link>
        <pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate>
      </item>
      <item>
        <title>No link here</title>
        <pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate>
      </item>
      <item>
        <link>https://example.com/no-title</link>
        <pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate>
      </item>
    </channel></rss>
  `

  it('parses title, link, pubDate, and source from each item', () => {
    const items = parseItems(xml)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      title: 'Amped Electric wins $12M contract',
      link: 'https://example.com/a',
      pubDate: 'Mon, 09 Nov 2026 10:00:00 GMT',
      source: 'Example News',
    })
    expect(items[1].title).toBe('Second story without CDATA')
    expect(items[1].source).toBe('')
  })

  it('drops items missing a title or a link', () => {
    const items = parseItems(xml)
    expect(items.some((i) => i.link === 'https://example.com/no-title')).toBe(false)
    expect(items.some((i) => i.title === 'No link here')).toBe(false)
  })

  it('returns an empty array for XML with no items', () => {
    expect(parseItems('<rss><channel></channel></rss>')).toEqual([])
    expect(parseItems('')).toEqual([])
  })
})

describe('isWithinDays', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toUTCString()

  it('accepts recent dates inside the window', () => {
    expect(isWithinDays(hoursAgo(12), 1)).toBe(true)
    // 71h, not 72h: exactly 3 days ago is the boundary, and the milliseconds
    // between building the date and checking it would push it outside.
    expect(isWithinDays(hoursAgo(71), 3)).toBe(true)
  })

  it('rejects dates outside the window', () => {
    expect(isWithinDays(hoursAgo(25), 1)).toBe(false)
    expect(isWithinDays(hoursAgo(200), 7)).toBe(false)
  })

  it('rejects empty and unparseable dates', () => {
    expect(isWithinDays('', 7)).toBe(false)
    expect(isWithinDays('not a date', 7)).toBe(false)
  })
})

describe('isGeographicMismatch', () => {
  it('keeps articles about the company’s own region', () => {
    expect(isGeographicMismatch('New Houston plant opens', 'Texas')).toBe(false)
    expect(isGeographicMismatch('Austin TX contractor wins bid', 'Texas')).toBe(false)
    expect(isGeographicMismatch('Charlotte firm expands downtown', 'North Carolina')).toBe(false)
    expect(isGeographicMismatch('Detroit utility awards contract', 'Michigan')).toBe(false)
  })

  it('rejects articles placed in a clearly different region', () => {
    expect(isGeographicMismatch('New plant opens in Charlotte', 'Texas')).toBe(true)
    expect(isGeographicMismatch('Detroit utility awards contract', 'Texas')).toBe(true)
    expect(isGeographicMismatch('Chicago contractor wins Illinois bid', 'South Carolina')).toBe(true)
  })

  it('keeps multi-region stories that also mention the home region', () => {
    expect(isGeographicMismatch('Texas firm expands into Charlotte market', 'Texas')).toBe(false)
    expect(isGeographicMismatch('Michigan company buys Detroit and Dallas assets', 'Michigan')).toBe(false)
  })

  it('never rejects when the company has no geography recorded', () => {
    expect(isGeographicMismatch('New plant opens in Charlotte', null)).toBe(false)
    expect(isGeographicMismatch('Detroit utility awards contract', null)).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isGeographicMismatch('NEW PLANT OPENS IN CHARLOTTE', 'Texas')).toBe(true)
    expect(isGeographicMismatch('new houston plant opens', 'Texas')).toBe(false)
  })
})

describe('defaultLookbackDays', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('looks back 3 days on a Monday (covers Fri/Sat/Sun)', () => {
    // Mon 2026-11-09, 07:00 ET
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
    expect(defaultLookbackDays()).toBe(3)
  })

  it('looks back 3 days on a Monday just after midnight ET', () => {
    // Mon 2026-11-09, 00:30 ET = 05:30 UTC
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T05:30:00Z'))
    expect(defaultLookbackDays()).toBe(3)
  })

  it('looks back 1 day on Tuesday through Sunday', () => {
    vi.useFakeTimers()
    // Tue 2026-11-10
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    expect(defaultLookbackDays()).toBe(1)
    // Fri 2026-11-13
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'))
    expect(defaultLookbackDays()).toBe(1)
    // Sun 2026-11-08, 23:30 ET (Mon 04:30 UTC — still Sunday in ET)
    vi.setSystemTime(new Date('2026-11-09T04:30:00Z'))
    expect(defaultLookbackDays()).toBe(1)
  })
})
