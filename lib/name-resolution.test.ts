import { describe, it, expect } from 'vitest'
import { resolveByName, normalizeName } from './name-resolution'

const pool = [
  { id: '1', name: 'Project Anchor' },
  { id: '2', name: 'Anchor Bay' },
  { id: '3', name: 'Project Zephyr' },
]

describe('normalizeName', () => {
  it('lowercases, collapses whitespace, strips trailing punctuation', () => {
    expect(normalizeName('  Project   Anchor. ')).toBe('project anchor')
  })
})

describe('resolveByName', () => {
  it('exact match wins even when partial matches also exist', () => {
    const res = resolveByName(pool, 'project anchor')
    expect(res).toEqual({ status: 'one', match: pool[0] })
  })

  it('unique partial (substring) match resolves', () => {
    const res = resolveByName(pool, 'Zephyr')
    expect(res.status).toBe('one')
    if (res.status === 'one') expect(res.match.id).toBe('3')
  })

  it('query longer than the stored name still resolves (reverse substring)', () => {
    const res = resolveByName(pool, 'Project Anchor Holdings')
    expect(res.status).toBe('one')
    if (res.status === 'one') expect(res.match.id).toBe('1')
  })

  it('several partial matches are ambiguous — never a first hit', () => {
    const res = resolveByName(pool, 'Anchor')
    expect(res.status).toBe('many')
    if (res.status === 'many') expect(res.candidates.map(c => c.id)).toEqual(['1', '2'])
  })

  it('duplicate exact names are ambiguous', () => {
    const dupes = [
      { id: 'a', name: 'Project Zephyr' },
      { id: 'b', name: 'Project Zephyr' },
    ]
    const res = resolveByName(dupes, 'Project Zephyr')
    expect(res.status).toBe('many')
    if (res.status === 'many') expect(res.candidates).toHaveLength(2)
  })

  it('no match resolves to none', () => {
    expect(resolveByName(pool, 'Nonexistent Co')).toEqual({ status: 'none' })
    expect(resolveByName(pool, '')).toEqual({ status: 'none' })
  })
})
