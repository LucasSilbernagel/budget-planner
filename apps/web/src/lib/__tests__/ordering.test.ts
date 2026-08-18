/**
 * Unit tests for the shared display-order helpers (Story 34.1a, FR60).
 *
 * These pin the three-key rule (sortOrder -> createdAt -> id) directly, because
 * every other layer in this story delegates to it: the four store write paths,
 * the four persist migrations, and the pull-merge re-sort. A defect here is a
 * defect everywhere, and it would surface as "my list reshuffled itself" rather
 * than as a failing assertion in any one of those places.
 *
 * ⚠️ Expected orders are written out as LITERALS, never derived by mapping over
 * the same input under test (story 33.2's finding: a guard that derives its
 * expectation from the thing it guards cannot fail).
 */

import { describe, expect, it } from 'vitest'
import {
  type DisplayOrdered,
  nextSortOrder,
  planRowMove,
  sortByDisplayOrder,
  stampMissingSortOrder,
} from '../ordering'

/** Build a row. `createdAt`/`sortOrder` are omitted when explicitly undefined. */
function row(id: string, sortOrder?: number, createdAt?: string): DisplayOrdered {
  const out: DisplayOrdered = { id }
  if (sortOrder !== undefined) out.sortOrder = sortOrder
  if (createdAt !== undefined) out.createdAt = createdAt
  return out
}

/** Null-safe on purpose: one test deliberately feeds a null row through. */
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
   * MUTATION KILLED (M7): drop the `createdAt` tiebreaker.
   *
   * This is the AC-5 offline-convergence case. Two devices reordered the same
   * list while offline and both wrote sortOrder 1 — a legitimate, EXPECTED state
   * under last-write-wins, which is why there is no unique constraint. Both
   * devices must still land on the same visible order.
   */
  it('AC-5: breaks a duplicate sortOrder by createdAt ascending', () => {
    const deviceA = [
      row('x', 1, '2026-01-02T00:00:00.000Z'),
      row('y', 1, '2026-01-01T00:00:00.000Z'),
      row('z', 0, '2026-01-03T00:00:00.000Z'),
    ]
    // The SAME rows as they happen to sit in the other device's array — a
    // different incoming order, which must not change the outcome.
    const deviceB = [deviceA[2], deviceA[0], deviceA[1]]

    expect(ids(sortByDisplayOrder(deviceA))).toEqual(['z', 'y', 'x'])
    expect(ids(sortByDisplayOrder(deviceB))).toEqual(['z', 'y', 'x'])
  })

  /**
   * MUTATION KILLED (M6): drop the `id` tiebreaker.
   *
   * `new Date().toISOString()` is millisecond-precision, so two rows added in the
   * same millisecond collide on BOTH sortOrder and createdAt. Without a third key
   * the result depends on incoming array position, i.e. it is not reproducible
   * across devices — the exact property AC-2 calls load-bearing.
   */
  it('AC-2: breaks an identical sortOrder AND createdAt by id ascending', () => {
    const SAME = '2026-01-01T00:00:00.000Z'
    const forwards = [row('bbb', 0, SAME), row('aaa', 0, SAME), row('ccc', 0, SAME)]
    const backwards = [row('ccc', 0, SAME), row('bbb', 0, SAME), row('aaa', 0, SAME)]

    expect(ids(sortByDisplayOrder(forwards))).toEqual(['aaa', 'bbb', 'ccc'])
    // Order-independence is the actual claim: same rows in, same order out.
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
    // Despite being the OLDEST row, 'legacy' does not outrank a real position.
    expect(ids(sorted)).toEqual(['positioned', 'legacy', 'hostile'])
  })

  /**
   * When NOTHING carries a sortOrder — a whole pre-34.1a array handed straight in
   * — every row scores LAST, so the comparison falls through to createdAt ASC.
   * That is precisely the backfill rule, which is what makes it safe for the
   * persist migrations to sort first and assign positions second.
   */
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
   * MUTATION KILLED (M5): change `nextSortOrder` to `list.length`.
   *
   * AC-6: deleting from the middle leaves a GAP on purpose (no reindex — that
   * would emit N sync updates for one deletion). After deleting the row at
   * position 1, `length` is 2 and would COLLIDE with the row still at 2.
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
    // 4 is the only finite numeric value present.
    expect(nextSortOrder(poisoned)).toBe(5)
  })

  it('returns 0 when no row carries a usable sortOrder at all', () => {
    expect(nextSortOrder([row('a', undefined), row('b', undefined)])).toBe(0)
  })

  /**
   * ⚠️ REVERSED BY CODE REVIEW 34.1a. This test previously asserted `-1`, pinning
   * the raw `max + 1`. That value is REJECTED by both sync gates (`.int().min(0)`),
   * and the client gate's rejection is a THROW that `syncBridge` swallows into a
   * `console.error` — so a single hostile persisted row would have silently killed
   * sync for every subsequent add, with the rows rendering fine locally. The clamp
   * keeps the value inside the contract the gates enforce.
   */
  it('clamps a negative max up to 0 rather than emitting a gate-rejected value', () => {
    expect(nextSortOrder([row('a', -5), row('b', -2)])).toBe(0)
  })

  it('truncates a fractional max to an integer the sync gates accept', () => {
    // `.int()` on both gates: 1.5 -> 2.5 would be rejected and swallowed.
    expect(nextSortOrder([row('a', 1.5)])).toBe(2)
  })

  it('always returns a non-negative integer for hostile inputs', () => {
    for (const hostile of [-5, -0.5, 1.5, -1_000_000]) {
      const next = nextSortOrder([row('x', hostile)])
      expect(Number.isInteger(next)).toBe(true)
      expect(next).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('stampMissingSortOrder — self-healing for rows that arrive unpositioned', () => {
  /**
   * ⚠️ THE CONFIRMED AC-3 VIOLATION THIS EXISTS TO FIX, reproduced by probe during
   * review: on a list where NO row carries a position, `nextSortOrder` returns 0,
   * and 0 beats the `LAST` sentinel — so a new local row landed at the TOP.
   * That is precisely what a pull produces while migration 0013 is unapplied.
   */
  it('gives every unpositioned row a position, preserving createdAt order', () => {
    const pulled = [
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
    // Before the fix this was ['NEW', 'a', 'b'].
    expect(withNew.map((r) => r.id)).toEqual(['a', 'b', 'NEW'])
  })

  it('does NOT renumber rows the server already positioned', () => {
    const mixed = [
      { id: 'server', sortOrder: 7, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'orphan', createdAt: '2026-01-02T00:00:00.000Z' },
    ]
    const stamped = stampMissingSortOrder(mixed)
    // 7 is preserved; the unpositioned row is appended ABOVE the max, not renumbered
    // to 0/1 (which would discard the server's authoritative position).
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
    // Same object identities — no needless churn for the common case.
    expect(stamped[0]).toBe(rows[1])
    expect(stamped[1]).toBe(rows[0])
  })

  it('returns [] for null/non-array input', () => {
    expect(stampMissingSortOrder(null)).toEqual([])
  })
})

describe('planRowMove — swap a row with its neighbour (Story 34.1b, AC-2)', () => {
  /** Apply a plan and return the resulting display order, as ids. */
  function applyPlan(rows: DisplayOrdered[], plan: ReturnType<typeof planRowMove>): string[] {
    const byId = new Map(plan.map((change) => [change.id, change.sortOrder]))
    const next = rows.map((r) =>
      byId.has(r.id as string) ? { ...r, sortOrder: byId.get(r.id as string) } : r
    )
    return sortByDisplayOrder(next).map((r) => r.id as string)
  }

  const simple = [row('a', 0, '2026-01-01'), row('b', 1, '2026-01-02'), row('c', 2, '2026-01-03')]

  it('moves a middle row up, swapping it with its predecessor', () => {
    const plan = planRowMove(simple, 'b', 'up')
    expect(applyPlan(simple, plan)).toEqual(['b', 'a', 'c'])
  })

  it('moves a middle row down, swapping it with its successor', () => {
    const plan = planRowMove(simple, 'b', 'down')
    expect(applyPlan(simple, plan)).toEqual(['a', 'c', 'b'])
  })

  it('touches exactly the two affected rows in the ordinary case', () => {
    expect(
      planRowMove(simple, 'b', 'up')
        .map((c) => c.id)
        .sort()
    ).toEqual(['a', 'b'])
  })

  it('is a no-op at the top boundary', () => {
    expect(planRowMove(simple, 'a', 'up')).toEqual([])
  })

  it('is a no-op at the bottom boundary', () => {
    expect(planRowMove(simple, 'c', 'down')).toEqual([])
  })

  it('is a no-op for a single-row list, in both directions', () => {
    const one = [row('solo', 0, '2026-01-01')]
    expect(planRowMove(one, 'solo', 'up')).toEqual([])
    expect(planRowMove(one, 'solo', 'down')).toEqual([])
  })

  it('is a no-op for an unknown id, an empty list, and null input', () => {
    expect(planRowMove(simple, 'nope', 'up')).toEqual([])
    expect(planRowMove([], 'a', 'down')).toEqual([])
    expect(planRowMove(null, 'a', 'down')).toEqual([])
  })

  it('preserves gaps left by a delete rather than reindexing', () => {
    // 34.1a decision 3: deletes leave gaps and that is intended.
    const gapped = [row('a', 0, '2026-01-01'), row('b', 7, '2026-01-02')]
    expect(planRowMove(gapped, 'b', 'up')).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 7 },
    ])
  })

  // ⚠️ THE TIE CASE. A plain value-swap is a NO-OP when both rows share a
  // sortOrder, so a fixture with distinct values cannot detect a regression
  // here (34.1a's M10 lesson: a test exercising a tie cannot detect a change
  // to tie-breaking).
  it('still reorders when the two rows share a sortOrder', () => {
    const tied = [row('a', 3, '2026-01-01'), row('b', 3, '2026-01-02')]
    const plan = planRowMove(tied, 'b', 'up')
    expect(plan.length).toBeGreaterThan(0)
    expect(applyPlan(tied, plan)).toEqual(['b', 'a'])
  })

  it('still reorders when a THIRD row shares the destination sortOrder', () => {
    // Swapping values alone would leave the moved row tied with 'c' and the
    // landing position decided by the createdAt tiebreaker, not by the user.
    const tied = [
      row('a', 0, '2026-01-01'),
      row('b', 2, '2026-01-02'),
      row('c', 2, '2026-01-03'),
      row('d', 5, '2026-01-04'),
    ]
    expect(applyPlan(tied, planRowMove(tied, 'a', 'down'))).toEqual(['b', 'a', 'c', 'd'])
  })

  /**
   * ⚠️ THIS TEST EXISTS BECAUSE MUTATION M6 CAME BACK GREEN WITHOUT IT.
   *
   * Deleting the verify-then-fall-back step left every assertion above passing.
   * The earlier "third row shares the destination" case could not detect it: its
   * createdAt values ascended with its positions, so the naive exchange happened
   * to land in the right place anyway.
   *
   * Here `a` is the NEWEST row while `b` and `c` tie at position 2. Exchanging
   * the two positions moves `a` PAST `b` as well, because `a` then ties with `b`
   * at 2 and loses the createdAt tiebreak — a one-place "move down" that travels
   * two places (measured: `c,b,a,d` instead of `c,a,b,d`). Only re-sorting the
   * candidate and comparing it with the intended order catches that.
   */
  it('moves exactly ONE place when the destination value is shared and the tiebreak works against the moved row', () => {
    const adversarial = [
      row('a', 0, '2026-01-04T00:00:00.000Z'),
      row('b', 2, '2026-01-02T00:00:00.000Z'),
      row('c', 2, '2026-01-01T00:00:00.000Z'),
      row('d', 5, '2026-01-05T00:00:00.000Z'),
    ]
    // Display order is a, c, b, d — c precedes b because they tie on sortOrder
    // and c is older. Moving a down must swap it with c only.
    expect(sortByDisplayOrder(adversarial).map((r) => r.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(applyPlan(adversarial, planRowMove(adversarial, 'a', 'down'))).toEqual([
      'c',
      'a',
      'b',
      'd',
    ])
  })

  /**
   * ⚠️ THE WRITE COUNT IS PART OF THE CONTRACT, not an implementation detail.
   * Ratified decision 5 forbids reindexing precisely because every emitted
   * change is one more sync operation for a single click. The first version of
   * the fallback densely renumbered and emitted THREE changes here — including
   * uninvolved row `d`, whose delete-gap collapsed from 5 to 3. Only the
   * colliding neighbour has to move.
   */
  it('touches only the rows that must move, and preserves an uninvolved delete-gap', () => {
    const adversarial = [
      row('a', 0, '2026-01-04T00:00:00.000Z'),
      row('b', 2, '2026-01-02T00:00:00.000Z'),
      row('c', 2, '2026-01-01T00:00:00.000Z'),
      row('d', 5, '2026-01-05T00:00:00.000Z'),
    ]
    const plan = planRowMove(adversarial, 'a', 'down')

    // The order is still exactly right...
    expect(applyPlan(adversarial, plan)).toEqual(['c', 'a', 'b', 'd'])
    // ...and row `d` was never touched, so its gap at 5 survives.
    expect(plan.map((change) => change.id)).not.toContain('d')
    expect(plan.length).toBeLessThanOrEqual(2)
  })

  it('keeps an ordinary move to exactly two writes, gap intact', () => {
    const gapped = [
      row('a', 0, '2026-01-01T00:00:00.000Z'),
      row('b', 9, '2026-01-02T00:00:00.000Z'),
      row('c', 40, '2026-01-03T00:00:00.000Z'),
    ]
    const plan = planRowMove(gapped, 'c', 'up')
    expect(plan).toHaveLength(2)
    // `a` is untouched: its position and the 0->9 gap are both preserved.
    expect(plan.map((change) => change.id)).not.toContain('a')
    expect(applyPlan(gapped, plan)).toEqual(['a', 'c', 'b'])
  })

  it('reorders a list in which NO row has a sortOrder', () => {
    const unpositioned = [
      row('a', undefined, '2026-01-01'),
      row('b', undefined, '2026-01-02'),
      row('c', undefined, '2026-01-03'),
    ]
    expect(applyPlan(unpositioned, planRowMove(unpositioned, 'c', 'up'))).toEqual(['a', 'c', 'b'])
  })

  it('reorders when only the neighbour lacks a sortOrder', () => {
    const mixed = [row('a', 0, '2026-01-01'), row('b', undefined, '2026-01-02')]
    expect(applyPlan(mixed, planRowMove(mixed, 'b', 'up'))).toEqual(['b', 'a'])
  })

  it('never emits a value the sync gates would reject', () => {
    // Both gates declare .int().min(0).max(PG_INT32_MAX), and the client gate's
    // rejection is swallowed into a console.error — an out-of-contract value
    // renders locally and silently never syncs (34.1a code review).
    const hostile = [
      row('a', -5, '2026-01-01'),
      row('b', 1.5, '2026-01-02'),
      row('c', Number.NaN, '2026-01-03'),
      row('d', 4, '2026-01-04'),
    ]
    for (const id of ['a', 'b', 'c', 'd']) {
      for (const direction of ['up', 'down'] as const) {
        for (const change of planRowMove(hostile, id, direction)) {
          expect(Number.isInteger(change.sortOrder)).toBe(true)
          expect(change.sortOrder).toBeGreaterThanOrEqual(0)
          expect(change.sortOrder).toBeLessThanOrEqual(2_147_483_647)
        }
      }
    }
  })

  it('does not mutate its input', () => {
    const frozen = [row('a', 0, '2026-01-01'), row('b', 1, '2026-01-02')].map((r) =>
      Object.freeze(r)
    )
    expect(() => planRowMove(frozen, 'a', 'down')).not.toThrow()
    expect(frozen[0].sortOrder).toBe(0)
  })
})
