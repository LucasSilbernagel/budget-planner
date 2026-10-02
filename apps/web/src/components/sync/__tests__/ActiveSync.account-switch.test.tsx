/**
 * B's sync removes A's data from this browser before it starts (story 86.2, D2).
 *
 * Account A synced on this browser and signed out (nothing resets the stores on
 * sign-out); account B signs in. Every persisted store still holds A's profiles
 * and rows. Before 86.2, B's session ran on A's active profile, showed A's rows,
 * uploaded A's profiles and seeded A's rows into B's account.
 *
 * Everything here is real except the network: the real `ActiveSync`, `useSync`,
 * core service, queue, seed and stores, and the real Income page beside them.
 * The test anchors on a request that really went out (the free-tier row's seed
 * create) before it asserts what did not.
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/api/client', () => ({
  fetchServerChangesWithMeta: vi.fn(),
  sendSyncOperation: vi.fn(),
}))

import { IncomePage } from '@/components/IncomePage'
import { fetchServerChangesWithMeta, sendSyncOperation } from '@/features/api/client'
import { resetSyncStore } from '@/hooks/useSync'
import { resetSessionStatusStore } from '@/lib/sync/sessionStatusStore'
import { clearSyncBridge } from '@/lib/sync/syncBridge'
import { useBalanceStore } from '@/stores/balanceStore'
import { useCategoryStore } from '@/stores/categoryStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import { useSavingsStore } from '@/stores/savingsStore'
import { ActiveSync } from '../ActiveSync'

const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000862'
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000862'
const A_MAIN = 'aaaaaaaa-1111-4111-8111-111111111111'
const A_SIDE = 'aaaaaaaa-2222-4222-8222-222222222222'
const B_MAIN = 'bbbbbbbb-1111-4111-8111-111111111111'
const A_INCOME = 'aaaaaaaa-3333-4333-8333-333333333333'
const A_EXPENSE = 'aaaaaaaa-4444-4444-8444-444444444444'
const A_SAVINGS = 'aaaaaaaa-5555-4555-8555-555555555555'
const A_BALANCE = 'aaaaaaaa-6666-4666-8666-666666666666'
const A_CATEGORY = 'aaaaaaaa-7777-4777-8777-777777777777'
/** Added on the free tier after A signed out, so stamped with A's active profile. */
const FREE_INCOME = 'cccccccc-3333-4333-8333-333333333333'
const A_IDS = [A_MAIN, A_SIDE, A_INCOME, A_EXPENSE, A_SAVINGS, A_BALANCE, A_CATEGORY]
const A_QUEUE_KEY = `bp-sync-queue-${ACCOUNT_A}`
const A_QUEUE = JSON.stringify([{ id: 'op-a', entityType: 'expense', entityId: A_EXPENSE }])
const ISO = '2026-09-01T00:00:00.000Z'

const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const B_MAIN_CHANGE: ServerChange = {
  entityType: 'userProfile',
  entityId: B_MAIN,
  data: { id: B_MAIN, userId: ACCOUNT_B, name: 'Main Profile', isDefault: true, currency: 'NONE' },
  updatedAt: 1000,
  isDeleted: false,
}

function income(id: string, userId: string | number, name: string) {
  return {
    id,
    userId,
    profileId: A_SIDE,
    name,
    amount: 100_000,
    frequency: 'monthly' as const,
    categoryId: null,
    sortOrder: id === FREE_INCOME ? 1 : 0,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

/** A row of A's in a store whose row type this test does not need in full. */
function aRow(id: string, extra: Record<string, unknown>) {
  return { id, userId: ACCOUNT_A, profileId: A_SIDE, createdAt: ISO, updatedAt: ISO, ...extra }
}

/** The ops that really went out, as `type entityType id profileId`. */
function sent(): string[] {
  return send.mock.calls.map(([op]) => {
    const { type, entityType, entityId, profileId } = op as Record<string, string>
    return `${type} ${entityType} ${entityId} ${profileId}`
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSyncStore()
  resetSessionStatusStore()
  clearSyncBridge()
  localStorage.clear()
  // A device that has synced before, so the Income page renders rows, not a
  // first-pull loading state (`useIsInitialSyncPending`).
  localStorage.setItem('sync:hasCompletedInitialPull', '1')
  localStorage.setItem(A_QUEUE_KEY, A_QUEUE)

  // A's profile was active when A signed out.
  useProfileStore.setState({
    profiles: [
      { id: A_MAIN, userId: ACCOUNT_A, name: 'Their main', isDefault: true, currency: 'NONE' },
      { id: A_SIDE, userId: ACCOUNT_A, name: 'Their side', isDefault: false, currency: 'NONE' },
    ],
    activeProfileId: A_SIDE,
  })
  useIncomeStore.setState({
    incomeSources: [
      income(A_INCOME, ACCOUNT_A, 'Their salary'),
      income(FREE_INCOME, 0, 'My salary'),
    ],
  })
  useExpenseStore.setState({
    expenses: [aRow(A_EXPENSE, { name: 'Their rent', amount: 1, frequency: 'monthly' }) as never],
  })
  useSavingsStore.setState({
    savingsGoals: [aRow(A_SAVINGS, { name: 'Their goal', targetAmount: 1 }) as never],
  })
  useBalanceStore.setState({
    entries: [aRow(A_BALANCE, { type: 'investment', name: 'Their brokerage' }) as never],
  })
  useCategoryStore.setState({
    categories: [aRow(A_CATEGORY, { name: 'Theirs', kind: 'expense', isDeleted: false }) as never],
  })

  fetchMeta.mockResolvedValue({ changes: [B_MAIN_CHANGE], profileIds: [B_MAIN] })
  send.mockResolvedValue({ success: true })
})

afterEach(() => {
  cleanup()
  clearSyncBridge()
})

describe("B's sync on a browser holding A's data (story 86.2, AC 4)", () => {
  it("removes A's profiles and rows, uploads none of them, and shows none of them", async () => {
    render(
      <>
        <ActiveSync userId={ACCOUNT_B} />
        <IncomePage />
      </>
    )

    // Positive anchor: B's session reconciled AND the free-tier row's seed
    // create really went out (debounced by `useSync`), under B's profile.
    await waitFor(() => expect(sent()).toContain(`create incomeSource ${FREE_INCOME} ${B_MAIN}`), {
      timeout: 6000,
    })

    expect(sent().filter((op) => A_IDS.some((id) => op.includes(id)))).toEqual([])
    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([B_MAIN])
    expect(useProfileStore.getState().activeProfileId).toBe(B_MAIN)
    expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toEqual([FREE_INCOME])
    expect(useExpenseStore.getState().expenses).toEqual([])
    expect(useSavingsStore.getState().savingsGoals).toEqual([])
    expect(useBalanceStore.getState().entries).toEqual([])
    expect(useCategoryStore.getState().categories).toEqual([])
    expect(localStorage.getItem(A_QUEUE_KEY)).toBe(A_QUEUE)

    // The free-tier row is B's to adopt (D4) and shows; nothing of A's does.
    expect(screen.getByText('My salary')).toBeInTheDocument()
    expect(screen.queryByText('Their salary')).not.toBeInTheDocument()
  }, 10_000)
})
