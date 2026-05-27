/**
 * lib/ai-json.ts
 * Robust JSON extraction from Claude's raw text output.
 *
 * Handles the common failure modes:
 *   - Markdown code fences (```json … ```)
 *   - Surrounding prose before/after the JSON object
 *   - Trailing commas before } or ] (invalid JSON)
 *   - Unquoted top-level keys (simple subset)
 *
 * Usage:
 *   import { parseAiJson } from '@/lib/ai-json'
 *   const data = parseAiJson<MyType>(response.content[0].text)
 */

/** Extract the raw text block from a Claude content array. */
export function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('')
}

/** Strip markdown fences and pull out the first {...} block. */
export function extractJsonBlock(raw: string): string {
  let s = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // If there's surrounding prose, extract just the JSON object
  if (!s.startsWith('{') && !s.startsWith('[')) {
    const obj = s.match(/\{[\s\S]*\}/)
    const arr = s.match(/\[[\s\S]*\]/)
    if (obj && (!arr || obj.index! <= arr.index!)) s = obj[0]
    else if (arr) s = arr[0]
  }

  return s
}

/** Attempt common structural repairs on malformed JSON. */
function repair(s: string): string {
  return s
    .replace(/,(\s*[}\]])/g, '$1')           // trailing commas
    .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // unquoted simple keys
}

/**
 * Parse JSON from a Claude API text response.
 * Throws a descriptive error on failure (never returns undefined).
 */
export function parseAiJson<T = unknown>(raw: string): T {
  const block = extractJsonBlock(raw)

  try {
    return JSON.parse(block) as T
  } catch {
    // one repair pass
  }

  try {
    return JSON.parse(repair(block)) as T
  } catch {
    const preview = raw.slice(0, 300).replace(/\n/g, '↵')
    throw new Error(`AI JSON parse failed. Raw preview: ${preview}`)
  }
}

/**
 * Like parseAiJson but returns null instead of throwing.
 * Use when a bad parse should degrade gracefully (e.g. email body note).
 */
export function tryParseAiJson<T = unknown>(raw: string): T | null {
  try {
    return parseAiJson<T>(raw)
  } catch {
    return null
  }
}
