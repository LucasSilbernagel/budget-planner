import { PG_INT32_MAX } from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import {
  type DisplayOrdered,
  nextSortOrder,
  sortByDisplayOrder,
  stampMissingSortOrder,
} from '../ordering'

function row(id: string, sortOrder?: number, createdAt?: string): DisplayOrdered {
  const out: DisplayOrdered = { id }
  if (sortOrder !== undefined) out.sortOrder = sortOrder
  if (createdAt !== undefined) out.createdAt = createdAt
  return out
}

const ids = (rows: DisplayOrdered[]) => rows.map((r) => r?.id)

describe('sortByDisplayOrder — the canonical three-key rule', () => {
  it('orders by sortOrder ascending', () => {
    const sorted = sortByDisplayOrder([row('c', 2), row('a', 0), row('b', 1)])
    expect(ids(sorted)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate its input', () => {
    const input = [row('c', 2), row('a', 0)]
    const snapshot = ids(input)
    sortByDisplayOrder(input)
    expect(ids(input)).toEqual(snapshot)
  })

  it('returns [] for null/undefined/non-array input', () => {
    expect(sortByDisplayOrder(null)).toEqual([])
    expect(sortByDisplayOrder(undefined as unknown as DisplayOrdered[])).toEqual([])
    expect(sortByDisplayOrder('nope' as unknown as DisplayOrdered[])).toEqual([])
  })

  /**
   * Two devices reordered offline and both wrote sortOrder 1, which is expected under
   * last-write-wins. Both must land on the same visible order.
   */
  it('AC-5: breaks a duplicate sortOrder by createdAt ascending', () => {
    const deviceA = [
      row('x', 1, '2026-01-02T00:00:00.000Z'),
      row('y', 1, '2026-01-01T00:00:00.000Z'),
      row('z', 0, '2026-01-03T00:00:00.000Z'),
    ]
    const deviceB = [deviceA[2], deviceA[0], deviceA[1]]

    expect(ids(sortByDisplayOrder(deviceA))).toEqual(['z', 'y', 'x'])
    expect(ids(sortByDisplayOrder(deviceB))).toEqual(['z', 'y', 'x'])
  })

  /** Two rows added in the same millisecond collide on both sortOrder and createdAt. */
  it('AC-2: breaks an identical sortOrder AND createdAt by id ascending', () => {
    const SAME = '2026-01-01T00:00:00.000Z'
    const forwards = [row('bbb', 0, SAME), row('aaa', 0, SAME), row('ccc', 0, SAME)]
    const backwards = [row('ccc', 0, SAME), row('bbb', 0, SAME), row('aaa', 0, SAME)]

    expect(ids(sortByDisplayOrder(forwards))).toEqual(['aaa', 'bbb', 'ccc'])
    expect(ids(sortByDisplayOrder(backwards))).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('sorts an unparseable or missing createdAt LAST, not first', () => {
    const sorted = sortByDisplayOrder([
      row('bad', 0, 'not-a-date'),
      row('good', 0, '2026-01-01T00:00:00.000Z'),
      row('absent', 0, undefined),
    ])
    // Both unusable rows land after the readable one; they then tie on createdAt
    // and settle by id ('absent' < 'bad').
    expect(ids(sorted)).toEqual(['good', 'absent', 'bad'])
  })

  it('sorts a missing/non-numeric sortOrder LAST, so a legacy row cannot jump to the top', () => {
    const sorted = sortByDisplayOrder([
      row('legacy', undefined, '2020-01-01T00:00:00.000Z'),
      row('positioned', 5, '2026-01-01T00:00:00.000Z'),
      { id: 'hostile', sortOrder: Number.NaN, createdAt: '2021-01-01T00:00:00.000Z' },
    ])
    expect(ids(sorted)).toEqual(['positioned', 'legacy', 'hostile'])
  })

  it('falls through to createdAt ASC when no row has a sortOrder', () => {
    const sorted = sortByDisplayOrder([
      row('newest', undefined, '2026-03-01T00:00:00.000Z'),
      row('oldest', undefined, '2026-01-01T00:00:00.000Z'),
      row('middle', undefined, '2026-02-01T00:00:00.000Z'),
    ])
    expect(ids(sorted)).toEqual(['oldest', 'middle', 'newest'])
  })

  it('tolerates null entries inside the array without throwing', () => {
    const sorted = sortByDisplayOrder([
      row('b', 1, '2026-01-01T00:00:00.000Z'),
      null as unknown as DisplayOrdered,
      row('a', 0, '2026-01-01T00:00:00.000Z'),
    ])
    expect(sorted).toHaveLength(3)
    expect(ids(sorted).slice(0, 2)).toEqual(['a', 'b'])
  })
})

describe('nextSortOrder — append at the bottom', () => {
  it('returns 0 for an empty list', () => {
    expect(nextSortOrder([])).toBe(0)
  })

  it('returns 0 for null/undefined/non-array input', () => {
    expect(nextSortOrder(null)).toBe(0)
    expect(nextSortOrder(undefined as unknown as DisplayOrdered[])).toBe(0)
  })

  it('returns max + 1, not length', () => {
    expect(nextSortOrder([row('a', 0), row('b', 1), row('c', 2)])).toBe(3)
  })

  /**
   * Deleting leaves a gap on purpose (no reindex). After deleting position 1, `length` is 2
   * and would collide with the row still at 2.
   */
  it('AC-6: is gap-tolerant after a delete from the middle', () => {
    const afterDelete = [row('a', 0), row('c', 2)]
    expect(afterDelete).toHaveLength(2)
    expect(nextSortOrder(afterDelete)).toBe(3)
  })

  it('ignores the array order — it reads the max, not the last element', () => {
    expect(nextSortOrder([row('c', 7), row('a', 0), row('b', 3)])).toBe(8)
  })

  it('ignores rows whose sortOrder is missing or non-numeric rather than yielding NaN', () => {
    const poisoned = [
      row('a', 4),
      row('legacy', undefined),
      { id: 'nan', sortOrder: Number.NaN },
      { id: 'str', sortOrder: '9' as unknown as number },
      { id: 'inf', sortOrder: Number.POSITIVE_INFINITY },
    ]
    expect(nextSortOrder(poisoned)).toBe(5)
  })

  it('returns 0 when no row carries a usable sortOrder at all', () => {
    expect(nextSortOrder([row('a', undefined), row('b', undefined)])).toBe(0)
  })

  /**
   * A negative value is rejected by both sync gates, and the client rejection is swallowed,
   * so one bad row would silently stop sync for every later add.
   */
  it('clamps a negative max up to 0 rather than emitting a gate-rejected value', () => {
    expect(nextSortOrder([row('a', -5), row('b', -2)])).toBe(0)
  })

  it('truncates a fractional max to an integer the sync gates accept', () => {
    // `.int()` on both gates: 1.5 -> 2.5 would be rejected and swallowed.
    expect(nextSortOrder([row('a', 1.5)])).toBe(2)
  })

  /** The upper bound needs its own assertion: 2_147_483_648 is an integer and >= 0. */
  it('always returns a non-negative integer for hostile inputs', () => {
    for (const hostile of [-5, -0.5, 1.5, -1_000_000]) {
      const next = nextSortOrder([row('x', hostile)])
      expect(Number.isInteger(next)).toBe(true)
      expect(next).toBeGreaterThanOrEqual(0)
    }
  })

  /** zod's `.max` is inclusive, so a server row at `PG_INT32_MAX` is valid and reaches the client. */
  it('clamps a ceiling-valued max to PG_INT32_MAX rather than overflowing it', () => {
    expect(nextSortOrder([row('a', PG_INT32_MAX)])).toBe(PG_INT32_MAX)
  })

  it('clamps a max ALREADY above the ceiling back down to it', () => {
    expect(nextSortOrder([row('a', 3_000_000_000)])).toBe(PG_INT32_MAX)
  })

  it('never returns a value the sync gates would reject, at either end', () => {
    for (const hostile of [-5, -0.5, 1.5, -1_000_000, PG_INT32_MAX, PG_INT32_MAX + 1, 9e15]) {
      const next = nextSortOrder([row('x', hostile)])
      expect(Number.isInteger(next)).toBe(true)
      expect(next).toBeGreaterThanOrEqual(0)
      expect(next).toBeLessThanOrEqual(PG_INT32_MAX)
    }
  })

  it('still appends normally one step below the ceiling', () => {
    expect(nextSortOrder([row('a', PG_INT32_MAX - 2)])).toBe(PG_INT32_MAX - 1)
  })

  /**
   * Accepted: a row persisted above the ceiling is never healed, so a new row renders above it.
   * Only a hand-edited localStorage blob can produce one.
   */
  it('an above-ceiling row is NOT healed, so the next add sorts above it', () => {
    const rows = [row('corrupt', 3_000_000_000, '2025-01-01T00:00:00.000Z')]
    const next = nextSortOrder(rows)
    expect(next).toBe(PG_INT32_MAX)
    const after = sortByDisplayOrder([...rows, row('added', next, '2026-06-01T00:00:00.000Z')])
    expect(after.map((r) => r.id)).toEqual(['added', 'corrupt'])
  })
})

describe('stampMissingSortOrder — self-healing for rows that arrive unpositioned', () => {
  /** With no positioned rows, 0 would beat the LAST sentinel and put the new row at the top. */
  it('gives every unpositioned row a position, preserving createdAt order', () => {
    const pulled: { id: string; createdAt: string; sortOrder?: number }[] = [
      { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    const stamped = stampMissingSortOrder(pulled)
    expect(stamped.map((r) => r.id)).toEqual(['a', 'b'])
    expect(stamped.map((r) => r.sortOrder)).toEqual([0, 1])
  })

  it('AC-3 holds after stamping: the next added row goes to the BOTTOM', () => {
    const stamped = stampMissingSortOrder([
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' },
    ])
    const next = nextSortOrder(stamped)
    const withNew = sortByDisplayOrder([
      ...stamped,
      { id: 'NEW', createdAt: '2026-01-03T00:00:00.000Z', sortOrder: next },
    ])
    expect(withNew.map((r) => r.id)).toEqual(['a', 'b', 'NEW'])
  })

  it('does NOT renumber rows the server already positioned', () => {
    const mixed = [
      { id: 'server', sortOrder: 7, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'orphan', createdAt: '2026-01-02T00:00:00.000Z' },
    ]
    const stamped = stampMissingSortOrder(mixed)
    expect(stamped.map((r) => [r.id, r.sortOrder])).toEqual([
      ['server', 7],
      ['orphan', 8],
    ])
  })

  it('is a no-op (beyond sorting) when every row already has a position', () => {
    const rows = [
      { id: 'b', sortOrder: 1, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'a', sortOrder: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    const stamped = stampMissingSortOrder(rows)
    expect(stamped.map((r) => r.sortOrder)).toEqual([0, 1])
    expect(stamped[0]).toBe(rows[1])
    expect(stamped[1]).toBe(rows[0])
  })

  it('returns [] for null/non-array input', () => {
    expect(stampMissingSortOrder(null)).toEqual([])
  })

  /** The loop increments past the clamped seed, so every stamped row must be clamped too. */
  it('keeps every stamped position inside the int32 ceiling', () => {
    const stamped = stampMissingSortOrder([
      { id: 'at-ceiling', sortOrder: PG_INT32_MAX, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'orphan-1', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'orphan-2', createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'orphan-3', createdAt: '2026-01-04T00:00:00.000Z' },
    ])
    for (const stampedRow of stamped) {
      expect(stampedRow.sortOrder).toBeLessThanOrEqual(PG_INT32_MAX)
      expect(stampedRow.sortOrder).toBeGreaterThanOrEqual(0)
    }
    expect(stamped.map((r) => [r.id, r.sortOrder])).toEqual([
      ['at-ceiling', PG_INT32_MAX],
      ['orphan-1', PG_INT32_MAX],
      ['orphan-2', PG_INT32_MAX],
      ['orphan-3', PG_INT32_MAX],
    ])
  })

  /** Revert-insensitive: pre-fix positions are ascending too, so this pins only the tiebreaker direction. */
  it('collided ceiling rows with distinct timestamps READ in insertion order', () => {
    const stamped = stampMissingSortOrder([
      { id: 'at-ceiling', sortOrder: PG_INT32_MAX, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'orphan-2', createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'orphan-1', createdAt: '2026-01-02T00:00:00.000Z' },
    ])
    expect(sortByDisplayOrder(stamped).map((r) => r.id)).toEqual([
      'at-ceiling',
      'orphan-1',
      'orphan-2',
    ])
  })

  /**
   * Accepted: at the ceiling an orphan ties the ceiling row, so an older orphan sorts first.
   * Unreachable from the server, which rejects values above the max.
   */
  it('AT the ceiling an OLDER orphan ties and sorts FIRST — accepted, not fixed', () => {
    const stamped = stampMissingSortOrder([
      { id: 'srv', sortOrder: PG_INT32_MAX, createdAt: '2026-05-01T00:00:00.000Z' },
      { id: 'old', createdAt: '2025-01-01T00:00:00.000Z' },
    ])
    expect(stamped.map((r) => [r.id, r.sortOrder])).toEqual([
      ['srv', PG_INT32_MAX],
      ['old', PG_INT32_MAX],
    ])
    expect(sortByDisplayOrder(stamped).map((r) => r.id)).toEqual(['old', 'srv'])
  })

  it('BELOW saturation the same shape keeps the orphan LAST (the contrast)', () => {
    const stamped = stampMissingSortOrder([
      { id: 'srv', sortOrder: 7, createdAt: '2026-05-01T00:00:00.000Z' },
      { id: 'old', createdAt: '2025-01-01T00:00:00.000Z' },
    ])
    expect(stamped.map((r) => [r.id, r.sortOrder])).toEqual([
      ['srv', 7],
      ['old', 8],
    ])
    expect(sortByDisplayOrder(stamped).map((r) => r.id)).toEqual(['srv', 'old'])
  })

  it('does not drag ordinary stamped positions up to the ceiling', () => {
    const stamped = stampMissingSortOrder([
      { id: 'server', sortOrder: 7, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'orphan-1', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'orphan-2', createdAt: '2026-01-03T00:00:00.000Z' },
    ])
    expect(stamped.map((r) => r.sortOrder)).toEqual([7, 8, 9])
  })
})
