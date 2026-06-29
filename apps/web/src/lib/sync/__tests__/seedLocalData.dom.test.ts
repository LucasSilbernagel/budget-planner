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

    expect(count).toBe(4)
    expect(handle.queueCreate).toHaveBeenCalledTimes(4)
    const types = handle.queueCreate.mock.calls.map((c) => c[0])
    expect(types).toEqual(
      expect.arrayContaining(['incomeSource', 'expense', 'savingsGoal', 'balanceTracking'])
    )
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
      userId: USER_ID,
    })
  })
})

describe('seedOnce — once-per-user gating', () => {
  it('seeds on the first call and sets the marker AFTER the enqueues resolve', async () => {
    expect(hasSeeded(USER_ID)).toBe(false)
    const count = await seedOnce(USER_ID)
    expect(count).toBe(4)
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
