// The mock tells the gt-style page fetch from the eq-style exact-timestamp fetch by call order,
// so the supplementary-fetch path is exercised.

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

const INCOME_ROWS: Row[] = [row('a', 1), row('b', 5), row('c', 5), row('d', 5)]

// Six rows at t=10, more than the cap+1 window, so only the supplementary fetch sees them all.
const DEGENERATE_EXPENSE_ROWS: Row[] = [
  row('e1', 10),
  row('e2', 10),
  row('e3', 10),
  row('e4', 10),
  row('e5', 10),
  row('e6', 10),
]

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
      orderBy: () => chain,
      // The first call per table is the page fetch (respects n); later calls are the exact-timestamp fetch.
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
    // Returning 'b' alone would advance the cursor to 5 and skip 'c' and 'd' forever.
    const page = await getSyncChanges('u1', null, 2, 'p1')
    const ids = page.map((c) => c.entityId)

    expect(ids).not.toContain('b')
    expect(ids).toEqual(['a'])
  })

  it('over-fetches by one row per table so the boundary trim has visibility into a cut group', async () => {
    state.incomeRows = INCOME_ROWS
    await getSyncChanges('u1', null, 2, 'p1')

    const firstIncomeCall = limitCalls.find((c) => c.table === 'incomeSources' && c.callIndex === 1)
    // With `.limit(cappedLimit)` the trim could never detect a cut group.
    expect(firstIncomeCall?.arg).toBe(3)
  })

  it('returns the full group when the cap covers every row', async () => {
    state.incomeRows = INCOME_ROWS
    const page = await getSyncChanges('u1', null, 4, 'p1')
    expect(page.map((c) => c.entityId).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('recovers a boundary group LARGER than cappedLimit+1 in full, via the supplementary fetch (the degenerate case)', async () => {
    state.expenseRows = DEGENERATE_EXPENSE_ROWS
    const page = await getSyncChanges('u1', null, 2, 'p1')
    const ids = page.map((c) => c.entityId).sort()
    expect(ids).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
  })

  it("a table with a tighter safe watermark holds back an EXHAUSTED table's own rows — the cross-table interaction the code review found broken", async () => {
    state.incomeRows = CROSS_TABLE_INCOME_ROWS
    state.profileRows = CROSS_TABLE_PROFILE_ROWS
    // Income's watermark is 1 (its t=4 group is deferred); taking the merged max (20) would strand
    // x1-x3 forever.
    const page = await getSyncChanges('u1', null, 3, 'p1')

    const ids = page.map((c) => c.entityId)
    expect(ids).toEqual(['old'])
    expect(ids).not.toContain('prof1')
    expect(ids).not.toContain('prof2')
    expect(Math.max(...page.map((c) => c.updatedAt))).toBe(1)
  })
})
