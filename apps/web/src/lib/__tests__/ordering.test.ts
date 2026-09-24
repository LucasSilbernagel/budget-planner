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

import { PG_INT32_MAX } from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import {
  type DisplayOrdered,
  nextSortOrder,
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

  /**
   * ⚠️⚠️ THE UPPER BOUND IS ASSERTED SEPARATELY AND DELIBERATELY (story 66.4).
   * Adding `PG_INT32_MAX` to the array below and stopping there is the obvious
   * move and it is VACUOUS: the pre-66.4 return for that input is
   * `2_147_483_648`, which IS an integer and IS `>= 0`, so both assertions in
   * this test pass over the exact value the story exists to reject. A bound is
   * only pinned by an assertion in the direction of the bound.
   */
  it('always returns a non-negative integer for hostile inputs', () => {
    for (const hostile of [-5, -0.5, 1.5, -1_000_000]) {
      const next = nextSortOrder([row('x', hostile)])
      expect(Number.isInteger(next)).toBe(true)
      expect(next).toBeGreaterThanOrEqual(0)
    }
  })

  /**
   * ⚠️⚠️ THE INT32 CEILING (story 66.4, FR105).
   *
   * `PG_INT32_MAX` is imported from the gate that rejects, NOT re-declared here.
   * A test carrying its own copy of the bound would keep passing if the gate's
   * bound moved — it would be a copy asserted against itself, which is a recorded
   * failure mode in this repo (story 33.2).
   *
   * Reachability, so nobody re-derives the "needs 2.1 billion inserts" mistake
   * that 48.2's review had to correct: zod's `.max` is INCLUSIVE, so a server row
   * carrying `sortOrder: PG_INT32_MAX` is contractually VALID, and nothing on the
   * pull path rewrites it (66.2's guard is verdict-only and does not even declare
   * the key). ONE such row is the whole precondition.
   */
  it('clamps a ceiling-valued max to PG_INT32_MAX rather than overflowing it', () => {
    expect(nextSortOrder([row('a', PG_INT32_MAX)])).toBe(PG_INT32_MAX)
  })

  it('clamps a max ALREADY above the ceiling back down to it', () => {
    // A hostile or corrupt persisted row, not just the exact boundary.
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
    // The clamp must not drag ordinary values up to the ceiling.
    expect(nextSortOrder([row('a', PG_INT32_MAX - 2)])).toBe(PG_INT32_MAX - 1)
  })

  /**
   * ⚠️⚠️ ACCEPTED BEHAVIOUR (b) — found by the repo-aware EDGE review layer.
   *
   * A row persisted ABOVE the ceiling is never healed: `stampMissingSortOrder`
   * leaves positioned rows untouched and early-returns on a fully positioned list.
   * The next add clamps to `MAX`, which is BELOW it, so the new row renders ABOVE
   * the corrupt one — "append at the bottom" inverts for that list.
   *
   * Accepted for the same reason as (a): `3e9` cannot come from the `integer`
   * column or past either gate, so only a hand-edited localStorage blob produces
   * it — and pre-clamp that same add went to `3e9 + 1` and never synced at all.
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

  /**
   * ⚠️⚠️ THE CLAMP IN `nextSortOrder` DOES NOT REACH THIS LOOP (story 66.4, AC-2).
   *
   * `stampMissingSortOrder` seeds `next` from `nextSortOrder` and then does a bare
   * `next += 1` per unpositioned row. Bounding only the seed fixes the FIRST
   * stamped row and leaves the second at `PG_INT32_MAX + 1`, the third at `+2`,
   * and so on — every one of them a value the client queue gate throws on.
   *
   * This is not a hypothetical pairing. This function runs on the PULL path
   * (`applyServerChanges.ts` -> `resortCollection`), which is the same path that
   * delivers the ceiling-valued row in the first place, and a pull that mixes one
   * positioned server row with unpositioned ones is the ordinary pre-0013 shape.
   */
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
    // The server's authoritative position is still preserved, and the orphans
    // collide AT the ceiling rather than overflowing past it (decision D1).
    expect(stamped.map((r) => [r.id, r.sortOrder])).toEqual([
      ['at-ceiling', PG_INT32_MAX],
      ['orphan-1', PG_INT32_MAX],
      ['orphan-2', PG_INT32_MAX],
      ['orphan-3', PG_INT32_MAX],
    ])
  })

  /**
   * D1's READ-ORDER direction.
   *
   * ⚠️ THIS TEST IS REVERT-INSENSITIVE and must not be cited as clamp coverage.
   * All three review layers flagged it. On pre-fix code the rows carry
   * `MAX, MAX+1, MAX+2` — strictly ascending — so the expected order results
   * either way. It guards the tiebreaker's direction, nothing about the ceiling.
   * The clamp itself is pinned by `keeps every stamped position inside the int32
   * ceiling` and by the dom file's gate-parse assertions, which DO go red on main.
   *
   * ⚠️ Note what this does and does NOT establish. The rows below carry DISTINCT
   * `createdAt` values, so the tiebreaker has a real key to work with and
   * reconstructs insertion order. Rows that collide at the ceiling AND share a
   * `createdAt` millisecond fall through to `id` — a random uuid — and their
   * order is arbitrary. Story 66.4 originally claimed the tiebreaker reproduced
   * insertion order "exactly"; that was refuted by measurement, and the
   * same-millisecond case is pinned in
   * `stores/__tests__/sort-order-ceiling.dom.test.ts`.
   */
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
   * ⚠️⚠️ ACCEPTED BEHAVIOUR (a) — the saturation case the story's original twenty
   * tests could not see, because every one of them dated its orphans NEWER than
   * the ceiling row. Found by the BLIND review layer, which had no repo access.
   *
   * At the ceiling an orphan is stamped EQUAL to the ceiling row rather than above
   * it, so the two TIE and `createdAt` decides — an OLDER orphan therefore sorts
   * FIRST. This contradicts the "unpositioned rows sort last" promise, which now
   * holds only below saturation, and the docblock says so.
   *
   * Accepted rather than fixed (Lucas, 2026-09-24): unreachable from the server
   * (the column is int32 and both gates reject `> MAX`), and strictly better than
   * the pre-clamp behaviour, where the whole list silently stopped syncing.
   */
  it('AT the ceiling an OLDER orphan ties and sorts FIRST — accepted, not fixed', () => {
    const stamped = stampMissingSortOrder([
      { id: 'srv', sortOrder: PG_INT32_MAX, createdAt: '2026-05-01T00:00:00.000Z' },
      { id: 'old', createdAt: '2025-01-01T00:00:00.000Z' },
    ])
    // Stamped EQUAL, not above — there is no headroom left.
    expect(stamped.map((r) => [r.id, r.sortOrder])).toEqual([
      ['srv', PG_INT32_MAX],
      ['old', PG_INT32_MAX],
    ])
    // ...so the read order inverts relative to the below-saturation contrast.
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
