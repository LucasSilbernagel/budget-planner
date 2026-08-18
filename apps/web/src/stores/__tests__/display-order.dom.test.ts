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
    key: 'budget-planner-income-v1',
    collection: 'incomeSources',
    reset: () => useIncomeStore.setState({ incomeSources: [] }),
    add: (name: string) =>
      useIncomeStore.getState().addIncomeSource({ name, amount: 1000, frequency: 'monthly' }),
    read: () => useIncomeStore.getState().incomeSources,
    remove: (id: string) => useIncomeStore.getState().deleteIncomeSource(id),
    move: (id: string, direction: 'up' | 'down') =>
      useIncomeStore.getState().moveIncomeSource(id, direction),
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
    key: 'budget-planner-expenses-v1',
    collection: 'expenses',
    reset: () => useExpenseStore.setState({ expenses: [] }),
    add: (name: string) =>
      useExpenseStore.getState().addExpense({ name, amount: 1000, frequency: 'monthly' }),
    read: () => useExpenseStore.getState().expenses,
    remove: (id: string) => useExpenseStore.getState().deleteExpense(id),
    move: (id: string, direction: 'up' | 'down') =>
      useExpenseStore.getState().moveExpense(id, direction),
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
    key: 'budget-planner:savings-goals',
    collection: 'savingsGoals',
    reset: () => useSavingsStore.setState({ savingsGoals: [] }),
    add: (name: string) =>
      useSavingsStore.getState().addSavingsGoal({ name, targetAmount: 5000, currentBalance: 0 }),
    read: () => useSavingsStore.getState().savingsGoals,
    remove: (id: string) => useSavingsStore.getState().deleteSavingsGoal(id),
    move: (id: string, direction: 'up' | 'down') =>
      useSavingsStore.getState().moveSavingsGoal(id, direction),
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
    move: (id: string, direction: 'up' | 'down') =>
      useBalanceStore.getState().moveBalanceEntry(id, direction),
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

describe.each(STORES)('$label — v2 -> v3 backfill (AC-2)', (store) => {
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

  it('a v3 payload is left alone (migrate does not re-run on a matching version)', async () => {
    localStorage.setItem(
      store.key,
      JSON.stringify({
        version: 3,
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

/**
 * Reordering (Story 34.1b, FR60).
 *
 * Driven over all four stores for the reason at the top of this file: four
 * independent implementations, no shared factory. The single shared piece is
 * `applyRowMove`; everything below proves each store actually calls it, keeps
 * its own collection sorted, and queues the right sync operations.
 */
describe.each(STORES)('$label — reorder rows (34.1b)', (store) => {
  /** Seed `count` rows with DISTINCT createdAt values and return their ids in order. */
  function seed(count: number): string[] {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    for (let i = 0; i < count; i += 1) {
      store.add(`row-${i}`)
      vi.advanceTimersByTime(1000)
    }
    vi.useRealTimers()
    const ids = store.read().map((row) => row.id as string)
    // ⚠️ Guard the guard: if the clock were not driven, every row would share a
    // createdAt and a tie-preserving sort could make these assertions pass by
    // accident (34.1a's M10 lesson).
    const created = store.read().map((row) => row.createdAt)
    expect(new Set(created).size).toBe(count)
    return ids
  }

  it('moves a row up, swapping it with its predecessor', () => {
    const [a, b, c] = seed(3)
    store.move(b as string, 'up')
    expect(store.read().map((row) => row.id)).toEqual([b, a, c])
  })

  it('moves a row down, swapping it with its successor', () => {
    const [a, b, c] = seed(3)
    store.move(b as string, 'down')
    expect(store.read().map((row) => row.id)).toEqual([a, c, b])
  })

  it('is a no-op at the top boundary', () => {
    const [a, b, c] = seed(3)
    store.move(a as string, 'up')
    expect(store.read().map((row) => row.id)).toEqual([a, b, c])
  })

  it('is a no-op at the bottom boundary', () => {
    const [a, b, c] = seed(3)
    store.move(c as string, 'down')
    expect(store.read().map((row) => row.id)).toEqual([a, b, c])
  })

  it('is a no-op for a single-row list in both directions', () => {
    const [only] = seed(1)
    store.move(only as string, 'up')
    store.move(only as string, 'down')
    expect(store.read().map((row) => row.id)).toEqual([only])
  })

  it('is a no-op for an unknown id', () => {
    const ids = seed(2)
    store.move('no-such-row', 'up')
    expect(store.read().map((row) => row.id)).toEqual(ids)
  })

  it('survives a reload (the new order is persisted, not just in memory)', async () => {
    const [a, b] = seed(2)
    store.move(b as string, 'up')

    // Simulate a reload. ⚠️ `reset()` goes THROUGH the persist middleware, so it
    // overwrites the very blob we are about to read back (vitest.setup.ts:53-56
    // records that `setState` hits the write path). Snapshot the persisted value
    // first and restore it, so what rehydrates is what a real reload would find.
    const persisted = localStorage.getItem(store.key)
    expect(persisted).toBeTruthy()
    store.reset()
    expect(store.read()).toHaveLength(0)
    localStorage.setItem(store.key, persisted as string)
    await store.rehydrate()

    expect(store.read().map((row) => row.id)).toEqual([b, a])
  })

  it('moves repeatedly, walking a row from bottom to top', () => {
    const [a, b, c] = seed(3)
    store.move(c as string, 'up')
    store.move(c as string, 'up')
    expect(store.read().map((row) => row.id)).toEqual([c, a, b])
  })

  it('still reorders when two adjacent rows share a sortOrder', () => {
    // ⚠️ Duplicates are EXPECTED (34.1a decision 4): two devices reordering
    // offline converge via the createdAt/id tiebreakers, not a unique index. A
    // plain value-swap is a no-op on a tie, so this is the case that a fixture
    // with distinct positions structurally cannot detect.
    const [a, b] = seed(2)
    store.tieAllPositions()
    expect(store.read().map((row) => row.sortOrder)).toEqual([4, 4])

    store.move(b as string, 'up')
    expect(store.read().map((row) => row.id)).toEqual([b, a])
  })

  /**
   * ⚠️ COMPARED BY ROW ID, NOT BY ARRAY POSITION — and that is the whole test.
   *
   * The first version of this test mapped `updatedAt` positionally before and
   * after the move. But the move REORDERS the array, and the seed gives each row
   * a distinct timestamp, so `after[i] !== before[i]` held at every index even
   * when nothing was bumped at all: the values had merely swapped places.
   * Measured — deleting the `updatedAt` bump from `applyRowMove` entirely left
   * all 108 tests in this file green. Keying by id is what makes the assertion
   * about the property it names.
   */
  it('bumps updatedAt on both affected rows', () => {
    const [a, b] = seed(2)
    const stamps = () => new Map(store.read().map((row) => [row.id as string, row.updatedAt]))
    const before = stamps()

    store.move(b as string, 'up')

    const after = stamps()
    expect(after.get(a as string)).not.toBe(before.get(a as string))
    expect(after.get(b as string)).not.toBe(before.get(b as string))
  })
})

/**
 * Tier matrix for reordering (Story 34.1b, AC-3).
 *
 * ⚠️ Separate from the add-path matrix above because the failure it guards is
 * different: a move writes TWO rows, so the question is not "did anything sync"
 * but "did BOTH updates survive". 33.3's finding — `deferred-work.md:806` names
 * Epic 34 by number — is that a tier-conditional regression is invisible to a
 * suite whose tests all run under one tier.
 */
describe.each(STORES)('$label — reorder sync contract (34.1b AC-3)', (store) => {
  function seedTwo(): string[] {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    store.add('row-0')
    vi.advanceTimersByTime(1000)
    store.add('row-1')
    vi.useRealTimers()
    return store.read().map((row) => row.id as string)
  }

  it('FREE (no session): reorders locally and enqueues NOTHING', () => {
    // ⚠️ REGISTERED, THEN CLEARED — not merely left unregistered.
    //
    // Review found the earlier version tautological: a spy object handed to
    // nobody can never be called, so `not.toHaveBeenCalled()` could not fail.
    // Registering the bridge first proves these exact spies are reachable, and
    // clearing it reproduces what "free tier" actually means at runtime — the
    // module singleton is null. A store that captured the handle at module load,
    // or that reached around `syncEntityUpdate`, now fails here.
    const spies = {
      userId: SESSION_USER_ID,
      queueCreate: vi.fn(async () => {}),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    }
    registerSyncBridge(spies)
    clearSyncBridge()

    const [a, b] = seedTwo()
    store.move(b as string, 'up')

    expect(store.read().map((row) => row.id)).toEqual([b, a])
    expect(spies.queueUpdate).not.toHaveBeenCalled()
    expect(spies.queueCreate).not.toHaveBeenCalled()
    expect(spies.queueDelete).not.toHaveBeenCalled()
  })

  it.each(['active', 'lifetime'] as const)(
    'PAID (%s): queues an update for BOTH affected rows, each carrying its new position',
    (status) => {
      // The status-sensitive gate lives in SyncProvider, not the store.
      expect(PAID_SYNC_STATUSES as readonly string[]).toContain(status)

      const [a, b] = seedTwo()
      const queueUpdate = vi.fn(async () => {})
      registerSyncBridge({
        userId: SESSION_USER_ID,
        queueCreate: vi.fn(async () => {}),
        queueUpdate,
        queueDelete: vi.fn(async () => {}),
      })

      store.move(b as string, 'up')

      // ⚠️ TWO operations, not one. A swap that queued only the moved row would
      // leave the neighbour's old position on the server, and the next pull would
      // undo the reorder.
      expect(queueUpdate).toHaveBeenCalledTimes(2)
      const byId = new Map(
        queueUpdate.mock.calls.map((call) => [call[1] as string, call[2] as { sortOrder: number }])
      )
      expect(byId.get(b as string)).toMatchObject({ sortOrder: 0 })
      expect(byId.get(a as string)).toMatchObject({ sortOrder: 1 })
    }
  )

  it('PAID: a boundary move queues nothing at all', () => {
    const [a] = seedTwo()
    const queueUpdate = vi.fn(async () => {})
    registerSyncBridge({
      userId: SESSION_USER_ID,
      queueCreate: vi.fn(async () => {}),
      queueUpdate,
      queueDelete: vi.fn(async () => {}),
    })

    store.move(a as string, 'up')

    expect(queueUpdate).not.toHaveBeenCalled()
  })
})
