/**
 * savingsStore selector tests (story 16-1, FR36).
 *
 * Pins the totals-vs-progress split introduced for goal-less savings accounts
 * (null target): balances of accounts count toward the savings TOTAL, but
 * accounts are excluded from goal-progress math. "No target" must surface as
 * ABSENT progress (null), never 0% (which reads as "0% toward a goal").
 *
 * Runs in jsdom (`.dom.test.ts`) for a real `localStorage` (the store uses the
 * zustand persist middleware).
 */

import type { ClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'
import { beforeEach, describe, expect, it } from 'vitest'
import { SAVINGS_GOALS_STORAGE_KEY, useSavingsStore } from '../savingsStore'

const base = {
  createdAt: new Date('2026-01-01').toISOString(),
  updatedAt: new Date('2026-01-01').toISOString(),
}

const goal: ClientSavingsGoal = {
  id: 'goal-1',
  name: 'Vacation',
  targetAmount: 100000, // $1000
  currentBalance: 60000, // $600 → 60%
  ...base,
}

const account: ClientSavingsGoal = {
  id: 'acc-1',
  name: 'Checking Buffer',
  targetAmount: null, // account: no target
  currentBalance: 250000, // $2500
  ...base,
}

beforeEach(() => {
  localStorage.clear()
  useSavingsStore.setState({ savingsGoals: [] })
})

describe('savingsStore — accounts vs goals (Story 16-1)', () => {
  it('getTotalSavings includes account balances', () => {
    useSavingsStore.setState({ savingsGoals: [goal, account] })
    // 60000 (goal) + 250000 (account)
    expect(useSavingsStore.getState().getTotalSavings()).toBe(310000)
  })

  it('getTotalTargetAmount excludes accounts (null target)', () => {
    useSavingsStore.setState({ savingsGoals: [goal, account] })
    // Only the goal's target counts; the account contributes no target.
    expect(useSavingsStore.getState().getTotalTargetAmount()).toBe(100000)
  })

  it('getSavingsProgress returns null for an account (absent, not 0%)', () => {
    useSavingsStore.setState({ savingsGoals: [account] })
    const progress = useSavingsStore.getState().getSavingsProgress('acc-1')
    expect(progress).toBeNull()
    expect(progress).not.toBe(0)
  })

  it('getSavingsProgress returns the numeric percentage for a goal', () => {
    useSavingsStore.setState({ savingsGoals: [goal] })
    expect(useSavingsStore.getState().getSavingsProgress('goal-1')).toBe(60)
  })

  it('getSavingsProgress returns 0 for an unknown id (unchanged)', () => {
    expect(useSavingsStore.getState().getSavingsProgress('nope')).toBe(0)
  })

  it('getOverallProgress is computed over goals only — an account balance does not move it', () => {
    useSavingsStore.setState({ savingsGoals: [goal] })
    const goalOnly = useSavingsStore.getState().getOverallProgress()
    expect(goalOnly).toBe(60)

    // Adding a large account must NOT inflate goal progress (it has no target).
    useSavingsStore.setState({ savingsGoals: [goal, account] })
    expect(useSavingsStore.getState().getOverallProgress()).toBe(60)
  })

  it('getOverallProgress is 0 when there are only accounts (no targets)', () => {
    useSavingsStore.setState({ savingsGoals: [account] })
    expect(useSavingsStore.getState().getOverallProgress()).toBe(0)
  })
})

/**
 * Story 26.1: non-destructive v1→v2 persist migration. Existing saved rows (no
 * allocation data) must load as 'automatic' with no manual amount, so the free
 * tier matches the DB migration's server-side default.
 */
describe('savingsStore — v1→v2 allocation backfill (Story 26.1)', () => {
  it("backfills allocationMode='automatic' and monthlyAllocation=null for a legacy v1 row", async () => {
    // A v1-shaped persisted payload: uuid ids already, but no allocation fields.
    localStorage.setItem(
      SAVINGS_GOALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          savingsGoals: [
            {
              id: 'legacy-uuid-1',
              name: 'Old Vacation',
              targetAmount: 100000,
              currentBalance: 60000,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      })
    )

    await useSavingsStore.persist.rehydrate()

    const [goal] = useSavingsStore.getState().savingsGoals
    expect(goal.allocationMode).toBe('automatic')
    expect(goal.monthlyAllocation).toBeNull()
    // Existing values are preserved unchanged.
    expect(goal.name).toBe('Old Vacation')
    expect(goal.targetAmount).toBe(100000)
    expect(goal.currentBalance).toBe(60000)
    expect(goal.id).toBe('legacy-uuid-1')
  })

  it('preserves an already-present manual allocation on migration', async () => {
    localStorage.setItem(
      SAVINGS_GOALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          savingsGoals: [
            {
              id: 'legacy-uuid-2',
              name: 'Rent',
              targetAmount: null,
              currentBalance: 0,
              allocationMode: 'manual',
              monthlyAllocation: 50000,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      })
    )

    await useSavingsStore.persist.rehydrate()

    const [goal] = useSavingsStore.getState().savingsGoals
    expect(goal.allocationMode).toBe('manual')
    expect(goal.monthlyAllocation).toBe(50000)
  })
})
