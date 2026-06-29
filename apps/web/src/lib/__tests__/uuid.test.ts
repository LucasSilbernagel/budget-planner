import { describe, expect, it } from 'vitest'
import { generateUUID, withUuidIds } from '../uuid'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('generateUUID', () => {
  it('returns a uuid-shaped string', () => {
    expect(generateUUID()).toMatch(UUID_RE)
  })

  it('returns distinct values', () => {
    expect(generateUUID()).not.toBe(generateUUID())
  })
})

describe('withUuidIds (Story 5-14 review P2 — legacy localStorage migration)', () => {
  it('reassigns a fresh uuid to items with a legacy numeric id', () => {
    const migrated = withUuidIds([
      { id: -10001, name: 'old income' },
      { id: -10002, name: 'older income' },
    ])
    expect(migrated[0].id).toMatch(UUID_RE)
    expect(migrated[1].id).toMatch(UUID_RE)
    expect(migrated[0].id).not.toBe(migrated[1].id)
    // Non-id fields are preserved.
    expect(migrated[0].name).toBe('old income')
  })

  it('leaves items that already have a string uuid id untouched (same reference)', () => {
    const item = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'new income' }
    const migrated = withUuidIds([item])
    expect(migrated[0]).toBe(item) // unchanged reference — no needless rewrite
  })

  it('handles undefined / empty input', () => {
    expect(withUuidIds(undefined)).toEqual([])
    expect(withUuidIds([])).toEqual([])
  })
})
