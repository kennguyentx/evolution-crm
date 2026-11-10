// ── Name resolution for email commands ──────────────────────────────────────
// Shared by the email command executor (lib/email-command-actions.ts) so a
// deal or contact named in an email resolves the same way everywhere:
//
//   exact match (case-insensitive) → act
//   exactly one partial/substring match → act
//   zero matches → failed outcome
//   more than one → DO NOT act; the caller queues with candidates
//
// Pure and side-effect free: callers fetch a candidate pool (rows whose name
// could plausibly match) and hand it here. Matching is deliberately simple —
// normalized exact equality first, then substring in either direction (the
// "Project Anchor" vs "Project Anchor LLC" case) — mirroring the loose
// includes() matching the intake flows already use, but with the ambiguity
// made explicit instead of first-hit-wins.

export interface NamedEntity {
  id: string
  name: string
}

export type NameResolution<T extends NamedEntity> =
  | { status: 'one'; match: T }
  | { status: 'none' }
  | { status: 'many'; candidates: T[] }

export function normalizeName(s: string): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve `query` against a candidate pool.
 * Exact (normalized) equality wins outright; if several rows share the exact
 * name that is ambiguity, not a first-hit. Otherwise substring matches in
 * either direction: one hit acts, several queue, zero fails.
 */
export function resolveByName<T extends NamedEntity>(pool: readonly T[], query: string): NameResolution<T> {
  const q = normalizeName(query)
  if (!q) return { status: 'none' }

  const exact = pool.filter(e => normalizeName(e.name) === q)
  if (exact.length === 1) return { status: 'one', match: exact[0] }
  if (exact.length > 1) return { status: 'many', candidates: exact }

  const partial = pool.filter(e => {
    const n = normalizeName(e.name)
    return n.includes(q) || q.includes(n)
  })
  if (partial.length === 1) return { status: 'one', match: partial[0] }
  if (partial.length > 1) return { status: 'many', candidates: partial }
  return { status: 'none' }
}
