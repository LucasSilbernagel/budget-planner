import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useCategoryStore } from '../../../stores/categoryStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { hasSeeded, seedLocalDataToServer, seedMarkerKey, seedOnce } from '../seedLocalData'
import { type SyncBridgeHandle, clearSyncBridge, registerSyncBridge } from '../syncBridge'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeHandle() {
  return {
    userId: USER_ID,
    queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
    queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
    queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
  }
}

let handle: ReturnType<typeof makeHandle>

function seedStores() {
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        userId: 0,
        categoryId: null,
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
        categoryId: null,
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
        type: 'investment',
        name: 'Brokerage',
        currentBalance: 10000,
        monthlyContribution: 500,
        frequency: 'monthly',
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
    // Categories must be seeded before cashflow rows: those reference them by foreign key,
    // and the queue drains in enqueue order.
    await seedLocalDataToServer(USER_ID)

    const types = handle.queueCreate.mock.calls.map((c) => c[0])
    expect(types[0]).toBe('category')
    expect(types.indexOf('category')).toBeLessThan(types.indexOf('incomeSource'))
    expect(types.indexOf('category')).toBeLessThan(types.indexOf('expense'))
  })

  it('does NOT seed a tombstoned category — a deleted one must not come back to life', async () => {
    // The category payload drops `isDeleted`, so seeding a tombstone would resurrect it on the server.
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
    await seedLocalDataToServer(USER_ID)

    const categoryCalls = handle.queueCreate.mock.calls.filter((call) => call[0] === 'category')
    expect(categoryCalls).toHaveLength(1)
  })

  it('SKIPS rows already on the server (review P6: no create-create conflicts)', async () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-synced',
          userId: USER_ID,
          categoryId: null,
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
      categoryId: null,
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
    expect(handle.queueCreate).not.toHaveBeenCalled()
    expect(count).toBe(0)
    expect(hasSeeded(USER_ID)).toBe(false)
  })
})

describe("seedOnce — another account's rows on a shared browser (story 86.2, AC 3)", () => {
  // A's pulled rows carry A's uuid, which is "not the session user" just as a free-tier `0` is.
  const OTHER_ACCOUNT = '86286286-2862-4862-8862-862862862862'
  const ISO = '2026-06-01T00:00:00.000Z'

  beforeEach(() => {
    useCategoryStore.setState({
      categories: [
        {
          id: 'cat-a',
          // A pulled row carries its owner's uuid; the client type still says number.
          userId: OTHER_ACCOUNT as unknown as number,
          profileId: 'profile-a',
          name: 'Their category',
          kind: 'expense',
          isDeleted: false,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
    })
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-a',
          userId: OTHER_ACCOUNT,
          categoryId: null,
          name: 'Their salary',
          amount: 1,
          frequency: 'monthly',
          createdAt: ISO,
          updatedAt: ISO,
        },
        {
          id: 'inc-free',
          userId: 0,
          categoryId: null,
          name: 'My salary',
          amount: 2,
          frequency: 'monthly',
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
    })
    useExpenseStore.setState({
      expenses: [
        {
          id: 'exp-a',
          userId: OTHER_ACCOUNT,
          categoryId: null,
          name: 'Their rent',
          amount: 1,
          frequency: 'monthly',
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
    })
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'sav-a',
          userId: OTHER_ACCOUNT,
          name: 'Their goal',
          targetAmount: 1,
          currentBalance: 0,
          createdAt: ISO,
          updatedAt: ISO,
        } as never,
      ],
    })
    useBalanceStore.setState({
      entries: [
        {
          id: 'bal-a',
          userId: OTHER_ACCOUNT,
          type: 'investment',
          name: 'Their brokerage',
          currentBalance: 1,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: ISO,
          updatedAt: ISO,
        } as never,
      ],
    })
  })

  it("enqueues only the free-tier row, none of the other account's", async () => {
    const count = await seedOnce(USER_ID)

    expect(handle.queueCreate.mock.calls.map((call) => call[1])).toEqual(['inc-free'])
    expect(count).toBe(1)
  })
})
