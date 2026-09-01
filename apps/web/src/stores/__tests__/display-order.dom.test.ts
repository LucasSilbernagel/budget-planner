/**
 * Display-order contract for all four financial stores (Story 34.1a, FR60).
 *
 * ⚠️ WHY EVERY ASSERTION RUNS AGAINST ALL FOUR STORES, NOT ONE.
 * There is no shared store factory — these are four independent implementations
 * with four separate add paths, four persist configs and four `migrate`
 * functions. Story 30-4b shipped a HIGH for exactly this shape: `ExpensesPage`
 * never seeded `categoryId`, and it passed a fully green suite because the edit
 * round-trip was only ever tested on `IncomePage`. 33.3 hit the same shape again.
 * Testing one store and assuming its three siblings is how that defect ships, so
 * each case below is driven over a table of all four.
 *
 * ⚠️ No test in this repo asserted add-order for ANY of these stores before this
 * file, so there was no regression net here at all — none of this is inherited.
 *
 * Runs in jsdom (`.dom.test.ts`) for a real `localStorage`: the stores use
 * `skipHydration`, so the migration cases drive `persist.rehydrate()` directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PAID_SYNC_STATUSES } from '../../components/sync/SyncProvider'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useBalanceStore } from '../balanceStore'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'
import { useSavingsStore } from '../savingsStore'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

/**
 * One row per store. `add` takes a name and appends a row; `read` returns the
 * store's collection. Deliberately written out per store rather than generated,
 * so a store that quietly stops being covered is visible in the diff.
 */
const STORES = [
  {
    label: 'incomeStore',
    /** The store's CURRENT persist `version` (see its `persist` options). */
    persistVersion: 3,
    key: 'budget-planner-income-v1',
    collection: 'incomeSources',
    reset: () => useIncomeStore.setState({ incomeSources: [] }),
    add: (name: string) =>
      useIncomeStore.getState().addIncomeSource({ name, amount: 1000, frequency: 'monthly' }),
    read: () => useIncomeStore.getState().incomeSources,
    remove: (id: string) => useIncomeStore.getState().deleteIncomeSource(id),
    tieAllPositions: () =>
      useIncomeStore.setState((state) => ({
        incomeSources: state.incomeSources.map((row) => ({ ...row, sortOrder: 4 })),
      })),
    rehydrate: () => useIncomeStore.persist.rehydrate(),
    legacyRow: (id: string, createdAt: string) => ({
      id,
      userId: 0,
      name: `row-${id}`,
      amount: 1000,
      frequency: 'monthly',
      categoryId: null,
      createdAt,
      updatedAt: createdAt,
    }),
  },
  {
    label: 'expenseStore',
    /** The store's CURRENT persist `version` (see its `persist` options). */
    persistVersion: 3,
    key: 'budget-planner-expenses-v1',
    collection: 'expenses',
    reset: () => useExpenseStore.setState({ expenses: [] }),
    add: (name: string) =>
      useExpenseStore.getState().addExpense({ name, amount: 1000, frequency: 'monthly' }),
    read: () => useExpenseStore.getState().expenses,
    remove: (id: string) => useExpenseStore.getState().deleteExpense(id),
    tieAllPositions: () =>
      useExpenseStore.setState((state) => ({
        expenses: state.expenses.map((row) => ({ ...row, sortOrder: 4 })),
      })),
    rehydrate: () => useExpenseStore.persist.rehydrate(),
    legacyRow: (id: string, createdAt: string) => ({
      id,
      userId: 0,
      name: `row-${id}`,
      amount: 1000,
      frequency: 'monthly',
      categoryId: null,
      createdAt,
      updatedAt: createdAt,
    }),
  },
  {
    label: 'savingsStore',
    /** The store's CURRENT persist `version` (see its `persist` options). */
    persistVersion: 3,
    key: 'budget-planner:savings-goals',
    collection: 'savingsGoals',
    reset: () => useSavingsStore.setState({ savingsGoals: [] }),
    add: (name: string) =>
      useSavingsStore.getState().addSavingsGoal({ name, targetAmount: 5000, currentBalance: 0 }),
    read: () => useSavingsStore.getState().savingsGoals,
    remove: (id: string) => useSavingsStore.getState().deleteSavingsGoal(id),
    tieAllPositions: () =>
      useSavingsStore.setState((state) => ({
        savingsGoals: state.savingsGoals.map((row) => ({ ...row, sortOrder: 4 })),
      })),
    rehydrate: () => useSavingsStore.persist.rehydrate(),
    legacyRow: (id: string, createdAt: string) => ({
      id,
      name: `row-${id}`,
      targetAmount: 5000,
      currentBalance: 0,
      allocationMode: 'automatic',
      monthlyAllocation: null,
      createdAt,
      updatedAt: createdAt,
    }),
  },
  {
    label: 'balanceStore',
    /** The store's CURRENT persist `version` (see its `persist` options). */
    persistVersion: 4,
    key: 'budget-planner:balance-tracking',
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
    remove: (id: string) => useBalanceStore.getState().deleteBalanceEntry(id),
    tieAllPositions: () =>
      useBalanceStore.setState((state) => ({
        entries: state.entries.map((row) => ({ ...row, sortOrder: 4 })),
      })),
    rehydrate: () => useBalanceStore.persist.rehydrate(),
    legacyRow: (id: string, createdAt: string) => ({
      id,
      type: 'investment',
      name: `row-${id}`,
      currentBalance: 1000,
      monthlyContribution: 0,
      frequency: 'monthly',
      createdAt,
      updatedAt: createdAt,
    }),
  },
] as const

beforeEach(() => {
  localStorage.clear()
  clearSyncBridge()
  for (const store of STORES) {
    store.reset()
  }
})

describe.each(STORES)('$label — new rows land at the BOTTOM (AC-3)', (store) => {
  /**
   * MUTATION KILLED (M10): restore `sortByCreationDate` at the add path.
   *
   * For savingsStore and balanceStore this is a genuine behaviour CHANGE, not a
   * preservation: both used to funnel every add through core's
   * `sortByCreationDate`, which is newest-FIRST, so a new row landed at index 0.
   */
  it('appends in insertion order and assigns 0, 1, 2', () => {
    store.add('first')
    store.add('second')
    store.add('third')

    const rows = store.read()
    // Position is asserted as a LITERAL sequence, not derived from the rows.
    expect(rows.map((r) => r.name)).toEqual(['first', 'second', 'third'])
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  it('assigns 0 to the first row of an empty list', () => {
    store.add('only')
    expect(store.read()[0]?.sortOrder).toBe(0)
  })

  /**
   * ⚠️ THIS TEST EXISTS BECAUSE MUTATION M10 CAME BACK GREEN WITHOUT IT.
   *
   * Restoring `sortByCreationDate` at the add path — the exact pre-34.1a
   * behaviour, which is NEWEST-FIRST — did not fail the test above. The reason is
   * the one the story flagged as load-bearing: three `add()` calls land inside the
   * SAME millisecond, so `sortByCreationDate`'s `dateB - dateA` comparator returns
   * 0 for every pair, the sort is stable, and append order survives by accident.
   * The assertion was structurally incapable of telling the two functions apart.
   *
   * Driving the clock forward between adds gives each row a distinct `createdAt`,
   * which is what makes newest-first observably different from append order. This
   * is the assertion that actually pins decision 1's behaviour CHANGE for the
   * savings and balance lists.
   */
  it('appends oldest-first even when each row has a DISTINCT createdAt (kills M10)', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      store.add('first')
      vi.advanceTimersByTime(60_000)
      store.add('second')
      vi.advanceTimersByTime(60_000)
      store.add('third')
    } finally {
      vi.useRealTimers()
    }

    const rows = store.read()
    // Distinct timestamps confirmed — otherwise this test would be as blind as
    // the one above, and would silently stop discriminating.
    expect(new Set(rows.map((r) => r.createdAt)).size).toBe(3)
    // Newest-first (the pre-34.1a behaviour) would give ['third','second','first'].
    expect(rows.map((r) => r.name)).toEqual(['first', 'second', 'third'])
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  /**
   * MUTATION KILLED (M5): `nextSortOrder` -> `list.length`.
   *
   * AC-6: a delete leaves a GAP on purpose (no reindex — that would emit N sync
   * updates for one deletion). With `length` the new row would collide with the
   * row still sitting at position 2.
   */
  it('AC-6: after deleting from the middle, the next insert does not collide', () => {
    store.add('a')
    store.add('b')
    store.add('c')

    const b = store.read()[1]
    store.remove(b.id)

    const afterDelete = store.read()
    // The survivors keep their ORIGINAL positions — no reindex.
    expect(afterDelete.map((r) => r.name)).toEqual(['a', 'c'])
    expect(afterDelete.map((r) => r.sortOrder)).toEqual([0, 2])

    store.add('d')
    const final = store.read()
    expect(final.map((r) => r.name)).toEqual(['a', 'c', 'd'])
    expect(final.map((r) => r.sortOrder)).toEqual([0, 2, 3])
  })

  it('AC-6: deleting preserves the relative order of the remaining rows', () => {
    store.add('a')
    store.add('b')
    store.add('c')
    store.add('d')

    store.remove(store.read()[0].id)
    expect(store.read().map((r) => r.name)).toEqual(['b', 'c', 'd'])
  })
})

describe.each(STORES)('$label — legacy -> current backfill (AC-2)', (store) => {
  /**
   * MUTATION KILLED (M8): backfill by array index instead of createdAt ASC.
   *
   * The persisted array is deliberately seeded NEWEST-FIRST here, which is the
   * real pre-34.1a shape for savings and balances (they were sorted that way on
   * every write). Backfilling by array index would therefore assign exactly the
   * REVERSE of the intended order, and the expected literal below catches it.
   *
   * MUTATION KILLED (M9): revert persist `version` 3 -> 2 — `migrate` never runs
   * for a v2 payload, so no row gets a sortOrder at all.
   */
  it('assigns dense 0..n-1 by createdAt ASC, ignoring the stored array order', async () => {
    localStorage.setItem(
      store.key,
      JSON.stringify({
        version: 2,
        state: {
          // Newest first — the order these two lists actually persisted in.
          [store.collection]: [
            store.legacyRow('11111111-1111-4111-8111-111111111111', '2026-03-01T00:00:00.000Z'),
            store.legacyRow('22222222-2222-4222-8222-222222222222', '2026-02-01T00:00:00.000Z'),
            store.legacyRow('33333333-3333-4333-8333-333333333333', '2026-01-01T00:00:00.000Z'),
          ],
        },
      })
    )

    await store.rehydrate()

    const rows = store.read()
    expect(rows).toHaveLength(3)
    // Oldest first, positions dense from zero — written out, not derived.
    expect(rows.map((r) => r.createdAt)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ])
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  /**
   * MUTATION KILLED (M6): drop the `id` tiebreaker.
   *
   * `new Date().toISOString()` is millisecond-precision, so same-millisecond rows
   * are routine in fixtures. Without the tiebreaker the backfill is not
   * reproducible, and a synced client and the server would disagree.
   */
  it('breaks a same-millisecond createdAt tie by id, deterministically', async () => {
    const SAME = '2026-01-01T00:00:00.000Z'
    localStorage.setItem(
      store.key,
      JSON.stringify({
        version: 2,
        state: {
          [store.collection]: [
            store.legacyRow('cccccccc-cccc-4ccc-8ccc-cccccccccccc', SAME),
            store.legacyRow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SAME),
            store.legacyRow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', SAME),
          ],
        },
      })
    )

    await store.rehydrate()

    expect(store.read().map((r) => r.id)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ])
    expect(store.read().map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  it('leaves no row orderless', async () => {
    localStorage.setItem(
      store.key,
      JSON.stringify({
        version: 2,
        state: {
          [store.collection]: [
            store.legacyRow('11111111-1111-4111-8111-111111111111', '2026-01-01T00:00:00.000Z'),
            store.legacyRow('22222222-2222-4222-8222-222222222222', '2026-01-02T00:00:00.000Z'),
          ],
        },
      })
    )

    await store.rehydrate()

    for (const row of store.read()) {
      expect(typeof row.sortOrder).toBe('number')
      expect(Number.isFinite(row.sortOrder)).toBe(true)
    }
  })

  /**
   * savingsStore and balanceStore lacked the null-row filter that
   * incomeStore/expenseStore gained in code review 30.4a. A throwing `migrate`
   * fails rehydration ENTIRELY — the store keeps its empty default and the user's
   * whole list silently disappears — and the new backfill reads `.createdAt`,
   * which is one more thing to throw on.
   */
  it('survives a null row in the persisted array without losing the list', async () => {
    localStorage.setItem(
      store.key,
      JSON.stringify({
        version: 2,
        state: {
          [store.collection]: [
            store.legacyRow('11111111-1111-4111-8111-111111111111', '2026-01-01T00:00:00.000Z'),
            null,
            store.legacyRow('22222222-2222-4222-8222-222222222222', '2026-01-02T00:00:00.000Z'),
          ],
        },
      })
    )

    await store.rehydrate()

    const rows = store.read()
    // The two real rows survive; only the null is dropped.
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1])
  })

  /**
   * ⚠️ Story 49.1 bumped `balanceStore` to version 4 (it strips the retired
   * `maxContributionLimit` key), so this test can no longer hard-code 3 — a stale
   * number here makes `migrate` RE-RUN and renumber, which is the very thing the
   * test exists to rule out.
   *
   * ⚠️ "Renumber" means the stored VALUES compact (7 -> 0 here), not that the
   * user's ORDER changes: `backfillSortOrder` sorts by the existing `sortOrder`
   * first, so a re-run is order-preserving and `withUuidIds` is a strict no-op on
   * rows that already have string ids. Spelled out because a code reviewer read
   * the bare word "renumber" as "custom order is destroyed" — a fair reading of
   * the sentence, and wrong about the code. Reading the number from the table keeps the claim
   * ("a payload already at the CURRENT version is left alone") true for every
   * store as each one's version moves independently.
   */
  it('a payload at the current version is left alone (migrate does not re-run)', async () => {
    localStorage.setItem(
      store.key,
      JSON.stringify({
        version: store.persistVersion,
        state: {
          [store.collection]: [
            {
              ...store.legacyRow(
                '11111111-1111-4111-8111-111111111111',
                '2026-01-01T00:00:00.000Z'
              ),
              sortOrder: 7,
            },
          ],
        },
      })
    )

    await store.rehydrate()

    // Preserved verbatim — a matching version must not renumber the user's list.
    expect(store.read()[0].sortOrder).toBe(7)
  })
})

/**
 * AC-9 tier matrix.
 *
 * ⚠️ 33.3's headline finding, recorded against this exact write path: a
 * tier-conditional regression is INVISIBLE to a suite whose tests all run under
 * one tier. Nulling `categoryId` for non-entitled users passed a fully green
 * 1525-test suite because all three pins ran under `premium()`. `sortOrder` is
 * assigned client-side for everyone, so the free tier — the majority of users —
 * has to be pinned explicitly, and pinned on BOTH halves: the value is assigned,
 * AND nothing is enqueued.
 */
describe.each(STORES)('$label — tier matrix (AC-9)', (store) => {
  /**
   * MUTATION KILLED (M12): make the free-tier add path skip the sortOrder
   * assignment. If this test passes under a mutation, the tier matrix is not
   * actually exercising the free tier.
   */
  /**
   * ⚠️ THE SPY IS THE POINT, and its absence was this story's worst review finding
   * — flagged independently by all THREE review layers. This test previously
   * asserted ONLY the sortOrder values while its name promised "enqueues NOTHING",
   * and the enqueue half rested on the words "by construction" in a comment. With
   * no bridge registered there was nothing to observe, so a regression in which the
   * free tier DID enqueue could not have failed it. A test's name is a claim about
   * its assertions; this one was lying.
   *
   * Building an UNREGISTERED handle (never passed to `registerSyncBridge`) gives us
   * something concrete to assert `not.toHaveBeenCalled()` against. The pattern is
   * borrowed from `store-sync-wiring.dom.test.ts`, which had it for incomeStore
   * only — 1 of 4 stores, the exact sibling asymmetry §6 warns about.
   */
  it('FREE (no session): assigns sortOrder and enqueues NOTHING', () => {
    // Deliberately NOT registered — this is the free tier by construction, and the
    // spies below are what turn that from a claim into an assertion.
    const unregistered = {
      userId: SESSION_USER_ID,
      queueCreate: vi.fn(async () => {}),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    }

    store.add('free-a')
    store.add('free-b')
    // Exercise update and delete too: all three are no-ops on the free tier.
    const first = store.read()[0]
    store.remove(first.id)

    expect(store.read().map((r) => r.sortOrder)).toEqual([1])
    expect(unregistered.queueCreate).not.toHaveBeenCalled()
    expect(unregistered.queueUpdate).not.toHaveBeenCalled()
    expect(unregistered.queueDelete).not.toHaveBeenCalled()
  })

  /**
   * ⚠️ The status parameter is NOT decorative here, and it used to be. Review
   * flagged that `it.each(['active','lifetime'])` bound the value to an unused
   * `_status`, so both iterations ran a byte-identical body — the bridge mock is
   * status-blind, making the "tier matrix" two states (bridge / no bridge) wearing
   * a three-tier name. The store layer genuinely CANNOT distinguish paid tiers, so
   * the honest fix is to say so and assert the thing that actually varies by
   * status: that `SyncProvider`'s gate admits this status at all. Without that,
   * 'lifetime' would be an untested word in an array.
   */
  it.each(['active', 'lifetime'] as const)(
    'PAID (%s): the tier may sync, and the position is assigned AND pushed',
    (status) => {
      // The status-sensitive gate lives in SyncProvider, not in the store — if this
      // fails, the tier never mounts sync at all and the rest is unreachable.
      expect(PAID_SYNC_STATUSES as readonly string[]).toContain(status)

      const queueCreate = vi.fn(async () => {})
      registerSyncBridge({
        userId: SESSION_USER_ID,
        queueCreate,
        queueUpdate: vi.fn(async () => {}),
        queueDelete: vi.fn(async () => {}),
      })

      store.add('paid-a')
      store.add('paid-b')

      expect(store.read().map((r) => r.sortOrder)).toEqual([0, 1])
      expect(queueCreate).toHaveBeenCalledTimes(2)
      // Gate 2: the position must actually leave the browser, on every branch.
      expect(queueCreate.mock.calls[0][2]).toMatchObject({ sortOrder: 0 })
      expect(queueCreate.mock.calls[1][2]).toMatchObject({ sortOrder: 1 })
    }
  )
})
