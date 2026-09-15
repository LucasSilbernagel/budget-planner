/**
 * Per-table pagination boundary repro + fix (Story 53.1, AC-3; code-review
 * hardened after the first version of this fix was shown to still lose data).
 *
 * `capChangesAtTimestampBoundary` (Story 4-18 review P1) prevents the
 * CROSS-TABLE merge step in `getSyncChanges` from splitting a same-`updatedAt`
 * group across a page boundary — but that alone left two ways rows could
 * still be permanently lost, both found in code review and reproduced here:
 *
 *  1. A single table with MORE rows sharing one `updatedAt` than fit in its
 *     own page (a raw SQL LIMIT has no notion of timestamp groups).
 *  2. A table's own page ending early (its cap, not real exhaustion) while
 *     ANOTHER table's rows push the returned cursor past that point — the
 *     next pull's `updatedAt > cursor` then skips the first table's
 *     unseen rows forever. This is worse than the pre-review-fix behavior in
 *     some shapes, since the "improved" per-table trim increases how much a
 *     later table's cursor advance can strand.
 *
 * `fetchTableChangesSafely` (in `../sync.ts`) closes both: an over-fetch +
 * supplementary exact-timestamp query recovers a truncated boundary group in
 * full, and `getSyncChanges` takes the MINIMUM safe watermark across all 6
 * tables as the global cursor rather than trusting any one table's own page.
 *
 * This file's mock distinguishes the two query SHAPES `fetchTableChangesSafely`
 * issues per table — a `gt(updatedAt, since)`-style page fetch (respects the
 * `limit` argument) vs an `eq(updatedAt, boundaryTs)`-style full-group fetch
 * (ignores the limit argument, returns everything at that exact timestamp) —
 * by tracking call order per table, since a mock that returns the same canned
 * rows for both calls (as elsewhere in this repo) cannot exercise the
 * supplementary-fetch path at all.
 */

import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Row {
  id: string
  userId: string
  profileId?: string
  name: string
  amount?: string
  targetAmount?: string
  isDeleted: boolean
  createdAt: Date
  updatedAt: Date
}

function row(id: string, ts: number, extra: Partial<Row> = {}): Row {
  return {
    id,
    userId: 'u1',
    profileId: 'p1',
    name: id.toUpperCase(),
    amount: '100',
    isDeleted: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date(ts),
    ...extra,
  }
}

// 4 income rows: one at t=1, THREE sharing t=5 — more than the cap (2) used
// in most tests, so the t=5 group cannot fit inside a single safe page.
const INCOME_ROWS: Row[] = [row('a', 1), row('b', 5), row('c', 5), row('d', 5)]

// A DEGENERATE boundary group: 6 rows ALL sharing t=10 — larger than
// cappedLimit + 1 (cap=2 -> window=3), so the initial page fetch alone
// cannot see the whole group; only the supplementary fetch can.
const DEGENERATE_EXPENSE_ROWS: Row[] = [
  row('e1', 10),
  row('e2', 10),
  row('e3', 10),
  row('e4', 10),
  row('e5', 10),
  row('e6', 10),
]

// For the cross-table cursor test: income defers a group at t=4 (more rows
// than fit in the page), userProfiles has rows reaching further (t=10, t=20)
// that would — pre-fix — push the global cursor past the deferred group.
const CROSS_TABLE_INCOME_ROWS: Row[] = [row('old', 1), row('x1', 4), row('x2', 4), row('x3', 4)]
const CROSS_TABLE_PROFILE_ROWS: Row[] = [row('prof1', 10), row('prof2', 20)]

interface MockState {
  incomeRows: Row[]
  expenseRows: Row[]
  profileRows: Row[]
}

const state: MockState = { incomeRows: [], expenseRows: [], profileRows: [] }
const limitCalls: { table: string; arg: number; callIndex: number }[] = []
const callCountByTable = new Map<string, number>()

vi.mock('@budget-planner/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>

  const rowsFor = (name: string): Row[] => {
    if (name === 'incomeSources') return state.incomeRows
    if (name === 'expenses') return state.expenseRows
    if (name === 'userProfiles') return state.profileRows
    return []
  }

  const builder = (table: unknown) => {
    const name = getTableName(table as Parameters<typeof getTableName>[0])
    const rows = rowsFor(name)
    const callIndex = (callCountByTable.get(name) ?? 0) + 1
    callCountByTable.set(name, callIndex)

    const chain = {
      where: () => chain,
      orderBy: () => chain, // fixtures are already in ascending updatedAt order
      // The FIRST call per table (within one getSyncChanges invocation, reset
      // in beforeEach) is the `gt`-style page fetch and respects `n`. The
      // SECOND+ call is the `eq`-style exact-timestamp fetch: real SQL would
      // filter to only matching rows, so this mock returns exactly the rows
      // sharing the LAST fetched row's timestamp, ignoring `n` (mirroring
      // real behavior: there is no more to filter, `n` just bounds it).
      limit: async (n: number) => {
        limitCalls.push({ table: name, arg: n, callIndex })
        if (callIndex === 1) {
          return rows.slice(0, n)
        }
        const lastPageRow = rows.slice(0, n)[Math.min(n, rows.length) - 1]
        const boundaryTs = lastPageRow?.updatedAt.getTime()
        return rows.filter((r) => r.updatedAt.getTime() === boundaryTs)
      },
    }
    return chain
  }

  return {
    ...actual,
    db: { select: () => ({ from: builder }) },
  }
})

const { getSyncChanges } = await import('../sync')

beforeEach(() => {
  vi.clearAllMocks()
  limitCalls.length = 0
  callCountByTable.clear()
  state.incomeRows = []
  state.expenseRows = []
  state.profileRows = []
})

describe('getSyncChanges — per-table SQL LIMIT boundary (Story 53.1, AC-3)', () => {
  it('does not return a page that ends mid-timestamp-group for a single table', async () => {
    state.incomeRows = INCOME_ROWS
    // cap=2, but the 3-row t=5 group cannot fit — a safe page must stop before
    // it (deferring the whole group to the next pull) rather than returning
    // 'b' alone, which would let the client's cursor advance to 5 and
    // permanently skip 'c' and 'd' (they can never satisfy `updatedAt > 5`).
    const page = await getSyncChanges('u1', null, 2, 'p1')
    const ids = page.map((c) => c.entityId)

    expect(ids).not.toContain('b')
    expect(ids).toEqual(['a'])
  })

  it('over-fetches by one row per table so the boundary trim has visibility into a cut group', async () => {
    state.incomeRows = INCOME_ROWS
    await getSyncChanges('u1', null, 2, 'p1')

    const firstIncomeCall = limitCalls.find((c) => c.table === 'incomeSources' && c.callIndex === 1)
    // MUTATION KILLED: revert to `.limit(cappedLimit)` — the trim below would
    // then always see an already-truncated page and could never detect a cut
    // group, silently reintroducing the defect this file exists to catch.
    expect(firstIncomeCall?.arg).toBe(3)
  })

  it('returns the full group when the cap covers every row', async () => {
    state.incomeRows = INCOME_ROWS
    // cap=4 covers all 4 rows (1 + the 3-row t=5 group), so nothing is deferred.
    const page = await getSyncChanges('u1', null, 4, 'p1')
    expect(page.map((c) => c.entityId).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('recovers a boundary group LARGER than cappedLimit+1 in full, via the supplementary fetch (the degenerate case)', async () => {
    state.expenseRows = DEGENERATE_EXPENSE_ROWS
    // cap=2 -> initial page window = 3 rows, all sharing t=10 (the degenerate
    // case: no safe cutoff exists inside the fetched window at all). Without
    // the supplementary fetch, only 3 of the 6 t=10 rows would ever be seen,
    // and the OLD (pre-review) behavior would return all 3 as "the full
    // group" — wrong, and silently so.
    const page = await getSyncChanges('u1', null, 2, 'p1')
    const ids = page.map((c) => c.entityId).sort()
    expect(ids).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
  })

  it("a table with a tighter safe watermark holds back an EXHAUSTED table's own rows — the cross-table interaction the code review found broken", async () => {
    state.incomeRows = CROSS_TABLE_INCOME_ROWS // ['old'@1, 'x1'@4, 'x2'@4, 'x3'@4]
    state.profileRows = CROSS_TABLE_PROFILE_ROWS // [prof1@10, prof2@20]
    // cap=3: income's own page fetch (limit=4) returns exactly ['old'@1,
    // 'x1'@4, 'x2'@4, 'x3'@4]. 'old' is a safe cutoff below the t=4 group, so
    // income's own safe watermark is 1 (the t=4 group is deferred whole).
    // userProfiles only has 2 rows (<= cap), so it is EXHAUSTED — its own
    // watermark is Infinity, and taken alone it would happily hand back
    // prof1/prof2 up to t=20.
    //
    // The pre-cross-table-fix code (the first version of this story's patch)
    // computed the returned cursor from the MERGED array's own max timestamp
    // — here that would be prof2's t=20 — advancing the global cursor to 20
    // and permanently stranding x1/x2/x3 (they can never satisfy
    // `updatedAt > 20`). The fix takes the MINIMUM watermark across tables
    // (1, from income), so nothing above t=1 may be returned THIS pull —
    // even though userProfiles itself has no reason to hold back.
    const page = await getSyncChanges('u1', null, 3, 'p1')

    const ids = page.map((c) => c.entityId)
    expect(ids).toEqual(['old'])
    // The critical property: userProfiles' own exhausted, otherwise-safe rows
    // must NOT leak into a response whose cursor income cannot vouch for —
    // that leak is exactly what would strand x1/x2/x3 forever.
    expect(ids).not.toContain('prof1')
    expect(ids).not.toContain('prof2')
    expect(Math.max(...page.map((c) => c.updatedAt))).toBe(1)
  })
})
