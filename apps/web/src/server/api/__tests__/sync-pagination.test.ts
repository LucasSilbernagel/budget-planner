/**
 * Boundary-safe pagination cap tests (Story 4-18 review P1).
 *
 * The pull cursor is the last returned row's `updatedAt`, and the next pull
 * filters `updatedAt > cursor`. If a page cap split a run of rows sharing one
 * `updatedAt`, the overflow rows at that timestamp would be `== cursor` next
 * time and skipped by the strict `>` forever (silent cross-device data loss).
 * `capChangesAtTimestampBoundary` guarantees the returned page never ends mid
 * timestamp-group.
 */

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
    // cap=2 but rows at index 1 and 2 share updatedAt=5: trim back to the last
    // fully-included timestamp (1) so the next pull (> 1) re-fetches the 5-group.
    const list = [ch(1, 'a'), ch(5, 'b'), ch(5, 'c')]
    const out = capChangesAtTimestampBoundary(list, 2)
    expect(out.map((c) => c.updatedAt)).toEqual([1])
  })

  it('includes the full group when an entire page shares one timestamp (forward progress)', () => {
    // The first 3 rows all share updatedAt=5; include all so the cursor can
    // advance past 5 instead of stalling on an un-drainable boundary.
    const list = [ch(5, 'a'), ch(5, 'b'), ch(5, 'c')]
    const out = capChangesAtTimestampBoundary(list, 2)
    expect(out).toHaveLength(3)
    expect(out.every((c) => c.updatedAt === 5)).toBe(true)
  })

  it('keeps a complete trailing timestamp group intact at the cap', () => {
    const list = [ch(1, 'a'), ch(2, 'b'), ch(2, 'c'), ch(3, 'd')]
    // cap=3: the first excluded row (index 3) has a distinct ts=3, so no split.
    const out = capChangesAtTimestampBoundary(list, 3)
    expect(out.map((c) => c.updatedAt)).toEqual([1, 2, 2])
  })
})
