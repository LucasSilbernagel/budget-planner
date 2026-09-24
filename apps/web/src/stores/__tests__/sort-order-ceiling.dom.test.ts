/**
 * The int32 ceiling, tested at the CONSEQUENCE rather than the arithmetic
 * (Story 66.4, FR105).
 *
 * ⚠️ WHY THIS FILE EXISTS ALONGSIDE `lib/__tests__/ordering.test.ts`.
 * That file pins the returned integer. An integer assertion cannot fail in the
 * way a user experiences this defect, which is: *the list silently stopped
 * syncing*. The failure chain has five links and only the first is arithmetic:
 *
 *   1. the store computes a position     `incomeStore.ts` + 3 peers -> `nextSortOrder`
 *   2. the bridge builds a payload       `lib/sync/syncBridge.ts` -> `queueCreate`
 *   3. the CLIENT gate parses it         `syncOperationDataSchema.parse`  <- THROWS
 *   4. the rejection is swallowed        `syncBridge.onQueueError` -> `console.error`
 *   5. the user sees                     a row that renders locally and never syncs
 *                                        — and so does every LATER add, via `max + 1`
 *
 * Link 4 is why no existing test caught this and why the product never reported
 * it: a swallowed rejection is indistinguishable from success at every layer
 * above it. So these tests assert at link 3 — they take the payload the bridge
 * ACTUALLY handed the queue and run the REAL gate over it.
 *
 * ⚠️ The gate is imported, never re-expressed. A test that re-stated the bound
 * inline would be a copy asserted against itself (story 33.2), and it would stay
 * green if the schema's bound moved.
 *
 * ⚠️ All four stores, every time. There is no shared store factory — four
 * independent add paths, and story 30-4b shipped a HIGH from testing one and
 * assuming its three siblings.
 *
 * Runs in jsdom (`.dom.test.ts`) because the stores need a real `localStorage`.
 */

import { PG_INT32_MAX, syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useBalanceStore } from '../balanceStore'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'
import { useSavingsStore } from '../savingsStore'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

/**
 * One entry per store: how to reset it, how to add a row through its REAL add
 * path, how to read it back, and how to plant a row already sitting at the
 * ceiling. Written out per store rather than generated, so a store that quietly
 * stops being covered shows up in the diff.
 */
const STORES = [
  {
    label: 'incomeStore',
    collection: 'incomeSources',
    reset: () => useIncomeStore.setState({ incomeSources: [] }),
    add: (name: string) =>
      useIncomeStore.getState().addIncomeSource({ name, amount: 1000, frequency: 'monthly' }),
    read: () => useIncomeStore.getState().incomeSources,
    plantAtCeiling: () => {
      useIncomeStore
        .getState()
        .addIncomeSource({ name: 'pulled', amount: 1000, frequency: 'monthly' })
      useIncomeStore.setState((state) => ({
        incomeSources: state.incomeSources.map((row) => ({ ...row, sortOrder: PG_INT32_MAX })),
      }))
    },
  },
  {
    label: 'expenseStore',
    collection: 'expenses',
    reset: () => useExpenseStore.setState({ expenses: [] }),
    add: (name: string) =>
      useExpenseStore.getState().addExpense({ name, amount: 1000, frequency: 'monthly' }),
    read: () => useExpenseStore.getState().expenses,
    plantAtCeiling: () => {
      useExpenseStore.getState().addExpense({ name: 'pulled', amount: 1000, frequency: 'monthly' })
      useExpenseStore.setState((state) => ({
        expenses: state.expenses.map((row) => ({ ...row, sortOrder: PG_INT32_MAX })),
      }))
    },
  },
  {
    label: 'savingsStore',
    collection: 'savingsGoals',
    reset: () => useSavingsStore.setState({ savingsGoals: [] }),
    add: (name: string) =>
      useSavingsStore.getState().addSavingsGoal({ name, targetAmount: 5000, currentBalance: 0 }),
    read: () => useSavingsStore.getState().savingsGoals,
    plantAtCeiling: () => {
      useSavingsStore
        .getState()
        .addSavingsGoal({ name: 'pulled', targetAmount: 5000, currentBalance: 0 })
      useSavingsStore.setState((state) => ({
        savingsGoals: state.savingsGoals.map((row) => ({ ...row, sortOrder: PG_INT32_MAX })),
      }))
    },
  },
  {
    label: 'balanceStore',
    collection: 'entries',
    reset: () => useBalanceStore.setState({ entries: [] }),
    add: (name: string) =>
      useBalanceStore.getState().addBalanceEntry({
        type: 'investment',
        name,
        currentBalance: 1000,
        monthlyContribution: 0,
        frequency: 'monthly',
      }),
    read: () => useBalanceStore.getState().entries,
    plantAtCeiling: () => {
      useBalanceStore.getState().addBalanceEntry({
        type: 'investment',
        name: 'pulled',
        currentBalance: 1000,
        monthlyContribution: 0,
        frequency: 'monthly',
      })
      useBalanceStore.setState((state) => ({
        entries: state.entries.map((row) => ({ ...row, sortOrder: PG_INT32_MAX })),
      }))
    },
  },
] as const

beforeEach(() => {
  localStorage.clear()
  clearSyncBridge()
  for (const store of STORES) {
    store.reset()
  }
})

describe.each(STORES)('$label — one ceiling row must not stop the list syncing', (store) => {
  /**
   * The precondition is ONE pulled row at `PG_INT32_MAX`, and it is ordinary:
   * `syncOperationDataSchema` bounds `sortOrder` with `.max(PG_INT32_MAX)` and
   * zod's `.max` is INCLUSIVE, so that value is a contractually VALID server row.
   * 66.2's pull guard does not rewrite it (it is verdict-only, and core's
   * per-entity mirrors do not declare `sortOrder` at all), so it reaches the
   * store intact.
   */
  it('the payload the bridge queues still PASSES the real client gate', () => {
    const queued: Record<string, unknown>[] = []
    registerSyncBridge({
      userId: SESSION_USER_ID,
      queueCreate: vi.fn(async (_type, _id, data) => {
        queued.push(data)
      }),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    })

    store.plantAtCeiling()
    queued.length = 0 // discard the planted row's own op; the NEXT add is under test

    store.add('the-add-that-breaks-today')

    expect(queued).toHaveLength(1)
    // The real gate, on the real payload. Pre-66.4 this throws:
    //   "Number must be less than or equal to 2147483647"
    expect(() => syncOperationDataSchema.parse(queued[0])).not.toThrow()
    expect(queued[0]?.sortOrder).toBe(PG_INT32_MAX)
  })

  /**
   * ⚠️ The defect's real shape is that it is CUMULATIVE — `max + 1` over a list
   * that now contains an out-of-range value carries the failure forward to every
   * later add. A single-add test would under-state it.
   */
  it('EVERY later add stays inside the gate, not just the first', () => {
    const queued: Record<string, unknown>[] = []
    registerSyncBridge({
      userId: SESSION_USER_ID,
      queueCreate: vi.fn(async (_type, _id, data) => {
        queued.push(data)
      }),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    })

    store.plantAtCeiling()
    queued.length = 0

    store.add('second')
    store.add('third')
    store.add('fourth')

    expect(queued).toHaveLength(3)
    for (const payload of queued) {
      // ⚠️ Presence is asserted alongside the parse: `syncOperationDataSchema`
      // declares `sortOrder` as `.optional()`, so a payload that DROPPED the key
      // would parse cleanly and pass this loop vacuously.
      expect(payload.sortOrder).toBe(PG_INT32_MAX)
      expect(() => syncOperationDataSchema.parse(payload)).not.toThrow()
    }
  })

  /**
   * Link 4 of the chain, asserted directly: today the queue rejection is
   * swallowed into a bare `console.error` by `syncBridge.onQueueError`, so
   * nothing above it can tell success from loss. This pins that the path is not
   * merely quiet but genuinely not failing.
   */
  it('queues without a swallowed rejection reaching console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerSyncBridge({
      userId: SESSION_USER_ID,
      // The gate runs INSIDE the queue, exactly as `SynchronizationService`
      // does at `validateOperationData` -> `syncOperationDataSchema.parse`.
      queueCreate: vi.fn(async (_type, _id, data) => {
        syncOperationDataSchema.parse(data)
      }),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    })

    try {
      store.plantAtCeiling()
      store.add('the-add-that-breaks-today')
      // `syncEntityCreate` is fire-and-forget; let the rejection settle. Two ticks
      // are MEASURED as sufficient, not assumed: this assertion goes RED on
      // pre-fix code in all four stores, and an independent probe registering an
      // always-throwing `queueCreate` observed the call after exactly two ticks.
      await Promise.resolve()
      await Promise.resolve()

      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      // ⚠️ In a `finally`: a failing assertion would otherwise leak a silenced
      // `console.error` into the remaining three `describe.each` store iterations.
      consoleError.mockRestore()
    }
  })

  /**
   * The ordering half of decision D1, stated as what was MEASURED rather than
   * what was argued.
   *
   * ⚠️⚠️ THE ORIGINAL D1 ARGUMENT WAS WRONG AND THIS TEST IS WHAT CAUGHT IT.
   * The story claimed the `createdAt` -> `id` tiebreaker "reproduces insertion
   * order exactly" when rows collide at the ceiling. It does not. `createdAt` is
   * `new Date().toISOString()` — MILLISECOND resolution — so rows created inside
   * the same millisecond tie on it too, and the comparison falls through to `id`,
   * which is a random uuid. The first run of this test returned
   * `['second', 'third', 'pulled']` for `expenseStore` and
   * `['pulled', 'third', 'second']` for `incomeStore`, and which stores failed
   * VARIED BETWEEN RUNS, because the answer is a uuid sort.
   *
   * What is actually true is the case below: when `createdAt` differs — every
   * human interaction, since a person adding rows is hundreds of ms apart — the
   * tiebreaker does reconstruct insertion order. The same-millisecond case is a
   * real, accepted limitation and is pinned separately, NOT hidden.
   */
  /**
   * ⚠️ REVERT-INSENSITIVE — not clamp coverage. Flagged by all three review layers.
   * On pre-fix code the rows carry `MAX, MAX+1, MAX+2`, strictly ascending, so the
   * expected order holds either way. Its value is as the CONTROL for the
   * same-millisecond case below: together they establish that the ordering depends
   * on `createdAt`, which is the D1 cost. The clamp is pinned by the three
   * gate-parse assertions above, which do go red on main.
   */
  it('rows created at distinct times still read BOTTOM-wards in insertion order', () => {
    vi.useFakeTimers()
    try {
      store.plantAtCeiling()
      vi.advanceTimersByTime(1000)
      store.add('second')
      vi.advanceTimersByTime(1000)
      store.add('third')

      expect(store.read().map((r) => r.name)).toEqual(['pulled', 'second', 'third'])
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * ⚠️ THE ACCEPTED COST OF D1, pinned so it is a recorded limitation rather than
   * a surprise. Rows that collide at the ceiling AND share a `createdAt`
   * millisecond order by uuid, which is arbitrary. This is strictly better than
   * the behaviour it replaces (the list silently stops syncing, permanently), and
   * it is only reachable on a list already poisoned by a ceiling-valued row — but
   * it is not "insertion order", and nothing here should claim it is.
   */
  it('same-millisecond rows at the ceiling keep every row, order NOT guaranteed', () => {
    vi.useFakeTimers()
    try {
      store.plantAtCeiling()
      store.add('second')
      store.add('third')

      const rows = store.read()
      // Every row survives and every position is inside the gate — that is the
      // guarantee. Their relative order among the tied rows is deliberately not
      // asserted, because it is a uuid sort.
      expect([...rows.map((r) => r.name)].sort()).toEqual(['pulled', 'second', 'third'])
      expect(rows.every((r) => r.sortOrder === PG_INT32_MAX)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
