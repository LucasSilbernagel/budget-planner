/**
 * Free→paid Seeding Tests (Story 5-15, Task 5)
 *
 * Pins the backlog backfill: every existing local financial row is enqueued as a
 * create through the sync bridge, profiles are NOT seeded, and the per-user marker
 * makes it run exactly once (a re-login does not replay creates → no conflict-count
 * pollution).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useCategoryStore } from '../../../stores/categoryStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { hasSeeded, seedLocalDataToServer, seedMarkerKey, seedOnce } from '../seedLocalData'
import { clearSyncBridge, registerSyncBridge } from '../syncBridge'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeHandle() {
  return {
    userId: USER_ID,
    queueCreate: vi.fn(async () => {}),
    queueUpdate: vi.fn(async () => {}),
    queueDelete: vi.fn(async () => {}),
  }
}

let handle: ReturnType<typeof makeHandle>

function seedStores() {
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        userId: 0,
        name: 'Salary',
        amount: 500000,
        frequency: 'monthly',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  useExpenseStore.setState({
    expenses: [
      {
        id: 'exp-1',
        userId: 0,
        name: 'Rent',
        amount: 100000,
        frequency: 'monthly',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'sav-1',
        userId: 0,
        name: 'Emergency',
        targetAmount: 1000000,
        currentBalance: 250000,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  useCategoryStore.setState({
    categories: [
      {
        id: 'cat-1',
        userId: 0,
        profileId: null,
        name: 'Groceries',
        kind: 'expense',
        isDeleted: false,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  useBalanceStore.setState({
    entries: [
      {
        id: 'bal-1',
        userId: 0,
        type: 'investment',
        name: 'Brokerage',
        currentBalance: 10000,
        monthlyContribution: 500,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
}

beforeEach(() => {
  localStorage.clear()
  handle = makeHandle()
  registerSyncBridge(handle)
  seedStores()
})

afterEach(() => {
  clearSyncBridge()
  vi.restoreAllMocks()
})

describe('seedLocalDataToServer', () => {
  it('enqueues a create for every never-synced financial row', async () => {
    const count = await seedLocalDataToServer(USER_ID)

    expect(count).toBe(5)
    expect(handle.queueCreate).toHaveBeenCalledTimes(5)
    const types = handle.queueCreate.mock.calls.map((c) => c[0])
    expect(types).toEqual(
      expect.arrayContaining([
        'category',
        'incomeSource',
        'expense',
        'savingsGoal',
        'balanceTracking',
      ])
    )
  })

  it('⚠️ enqueues CATEGORIES FIRST — loop order is wire order, and categoryId is a real FK', async () => {
    // Story 30.4a. Each `consider(...)` enqueues immediately and the queue drains
    // in timestamp order (SyncQueue.getReadyOperations sorts ascending;
    // synchronization.ts stamps Date.now() at enqueue), so the ORDER OF THE LOOPS
    // in seedLocalDataToServer is the order operations reach the server.
    //
    // `incomeSources.categoryId` / `expenses.categoryId` are real foreign keys to
    // `categories`. A cashflow row that arrives before its category is rejected on
    // the FK, so an upgrading user's first sync would drop rows.
    //
    // This asserts POSITION, not membership — the arrayContaining check above
    // passes no matter where the category loop sits, which is exactly how this
    // defect would ship unnoticed.
    //
    // ⚠️ SCOPE OF THIS GUARANTEE, corrected by code review 30.4a: ordering is
    // NECESSARY BUT NOT SUFFICIENT. `toServerPayload` emits no `id` and
    // `syncOperationDataSchema` declares none, so the server inserts each
    // category under a fresh uuid; the cashflow row that follows still carries
    // the CLIENT's category uuid and fails the FK (23503) whatever the order.
    // This test pins the ordering so it survives a future tidy-up — it does NOT
    // demonstrate that categorized rows sync. That needs the `profileId` + `id`
    // repair recorded in deferred-work.md.
    await seedLocalDataToServer(USER_ID)

    const types = handle.queueCreate.mock.calls.map((c) => c[0])
    expect(types[0]).toBe('category')
    expect(types.indexOf('category')).toBeLessThan(types.indexOf('incomeSource'))
    expect(types.indexOf('category')).toBeLessThan(types.indexOf('expense'))
  })

  it('does NOT seed a tombstoned category — a deleted one must not come back to life', async () => {
    // Code review 30.4a. `categoryStore` is the only store that keeps
    // soft-deleted rows locally, and `toServerPayload`'s category case does not
    // forward `isDeleted`. Seeding a tombstone therefore inserts it LIVE on the
    // server (column default false), and the next pull flips the user's own
    // deletion back to visible on every device.
    useCategoryStore.setState({
      categories: [
        {
          id: 'cat-deleted',
          userId: 0,
          profileId: null,
          name: 'Deleted',
          kind: 'expense',
          isDeleted: true,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      ],
    })

    await seedLocalDataToServer(USER_ID)

    const categoryCalls = handle.queueCreate.mock.calls.filter((call) => call[0] === 'category')
    expect(categoryCalls).toHaveLength(0)
  })

  it('still seeds LIVE categories — the tombstone filter is not a blanket skip', async () => {
    // Negative control for the test above: proves the filter is keyed on
    // isDeleted rather than having disabled category seeding altogether.
    await seedLocalDataToServer(USER_ID)

    const categoryCalls = handle.queueCreate.mock.calls.filter((call) => call[0] === 'category')
    expect(categoryCalls).toHaveLength(1)
  })

  it('SKIPS rows already on the server (review P6: no create-create conflicts)', async () => {
    // A row whose userId is already the session uuid was overwritten by a prior
    // pull → it is server-backed and must NOT be re-created.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-synced',
          userId: USER_ID, // already server-backed
          name: 'Synced',
          amount: 1,
          frequency: 'monthly',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })
    useCategoryStore.setState({ categories: [] })

    const count = await seedLocalDataToServer(USER_ID)
    expect(count).toBe(0)
    expect(handle.queueCreate).not.toHaveBeenCalled()
  })

  it('does NOT seed profiles (server owns the default profile)', async () => {
    useProfileStore.setState({
      profiles: [{ id: 'p1', userId: USER_ID, name: 'Main', isDefault: true, currency: 'NONE' }],
      activeProfileId: 'p1',
    })
    await seedLocalDataToServer(USER_ID)
    const seededTypes = handle.queueCreate.mock.calls.map((c) => c[0])
    expect(seededTypes).not.toContain('userProfile')
  })

  it('forwards the server payload with the session userId', async () => {
    await seedLocalDataToServer(USER_ID)
    expect(handle.queueCreate).toHaveBeenCalledWith('incomeSource', 'inc-1', {
      name: 'Salary',
      amount: 500000,
      frequency: 'monthly',
      categoryId: null, // Story 30.4a — always forwarded, see syncBridge
      userId: USER_ID,
    })
  })
})

describe('seedOnce — once-per-user gating', () => {
  it('seeds on the first call and sets the marker AFTER the enqueues resolve', async () => {
    expect(hasSeeded(USER_ID)).toBe(false)
    const count = await seedOnce(USER_ID)
    expect(count).toBe(5)
    expect(hasSeeded(USER_ID)).toBe(true)
    expect(localStorage.getItem(seedMarkerKey(USER_ID))).not.toBeNull()
  })

  it('does NOT re-seed on a subsequent call (no conflict-count pollution on re-login)', async () => {
    await seedOnce(USER_ID)
    handle.queueCreate.mockClear()

    const second = await seedOnce(USER_ID)
    expect(second).toBe(0)
    expect(handle.queueCreate).not.toHaveBeenCalled()
  })

  it('does NOT mark when the bridge is inactive (retry next session, no silent loss)', async () => {
    clearSyncBridge()
    const count = await seedOnce(USER_ID)
    // No bridge → nothing queued AND the marker is NOT set, so a later session retries.
    expect(handle.queueCreate).not.toHaveBeenCalled()
    expect(count).toBe(0)
    expect(hasSeeded(USER_ID)).toBe(false)
  })
})
