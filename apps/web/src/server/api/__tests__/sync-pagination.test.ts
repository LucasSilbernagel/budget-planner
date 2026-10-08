import type { ServerChange } from '@budget-planner/core/sync'
import { describe, expect, it } from 'vitest'
import { capChangesAtTimestampBoundary } from '../sync'

function ch(updatedAt: number, entityId: string): ServerChange {
  return { entityType: 'incomeSource', entityId, data: {}, updatedAt, isDeleted: false }
}

describe('capChangesAtTimestampBoundary (Story 4-18 review P1)', () => {
  it('returns the list unchanged when within the cap', () => {
    const list = [ch(1, 'a'), ch(2, 'b')]
    expect(capChangesAtTimestampBoundary(list, 5)).toHaveLength(2)
  })

  it('caps at the boundary when the boundary timestamps are distinct', () => {
    const list = [ch(1, 'a'), ch(2, 'b'), ch(3, 'c')]
    const out = capChangesAtTimestampBoundary(list, 2)
    expect(out.map((c) => c.updatedAt)).toEqual([1, 2])
  })

  it('does NOT split a same-timestamp group across the boundary (no data loss)', () => {
    // Trim back to t=1 so the next pull re-fetches the whole t=5 group.
    const list = [ch(1, 'a'), ch(5, 'b'), ch(5, 'c')]
    const out = capChangesAtTimestampBoundary(list, 2)
    expect(out.map((c) => c.updatedAt)).toEqual([1])
  })

  it('includes the full group when an entire page shares one timestamp (forward progress)', () => {
    // All rows share t=5: include them all so the cursor can advance.
    const list = [ch(5, 'a'), ch(5, 'b'), ch(5, 'c')]
    const out = capChangesAtTimestampBoundary(list, 2)
    expect(out).toHaveLength(3)
    expect(out.every((c) => c.updatedAt === 5)).toBe(true)
  })

  it('keeps a complete trailing timestamp group intact at the cap', () => {
    const list = [ch(1, 'a'), ch(2, 'b'), ch(2, 'c'), ch(3, 'd')]
    const out = capChangesAtTimestampBoundary(list, 3)
    expect(out.map((c) => c.updatedAt)).toEqual([1, 2, 2])
  })
})
