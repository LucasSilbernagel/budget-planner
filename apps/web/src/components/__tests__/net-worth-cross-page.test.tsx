/**
 * Cross-page net-worth agreement (story 32.2, FR59, AC-5).
 *
 * ⚠️ This file exists because asserting each page against its own hand-computed
 * constant is NOT enough. Two such tests both keep passing when the two pages
 * drift onto different definitions — which is exactly the defect FR59 was raised
 * for (the Overview and the Balance page each re-derived net worth, and the
 * Balance page's copy could not even see the savings store). The only assertion
 * that can fail on drift is one seed, both pages, one comparison.
 *
 * The Net Worth Projection page's "Current Net Worth" card is included for the
 * same reason: it is a third surface showing the user the same claim.
 *
 * Harness note: the two page suites do not share one. `HomePage.test.tsx` uses a
 * bare `render` plus a `vi.mock` of `usePremiumAccess` (without it the Overview's
 * premium section reaches the network); `BalancePage.test.tsx` uses
 * `renderWithProviders`. Both conditions are reproduced here rather than unified.
 */

import { renderWithProviders, screen } from '@/test/utils'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { type OverviewDuration, useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { HomePage } from '../HomePage'
import { NetWorthProjectionPage } from '../NetWorthProjectionPage'

const TS = '2026-08-15T00:00:00.000Z'

function mockFreeTier(): void {
  const status: PremiumAccessStatus = {
    hasAccess: false,
    subscriptionStatus: 'free',
    isLoading: false,
    error: null,
    isAuthenticated: false,
  }
  usePremiumAccess.mockReturnValue({ status })
}

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useBalanceStore.setState({ entries: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useOverviewDurationStore.setState({ duration: 'annually' })
}

/**
 * ONE fixture, seeded once, read by all three surfaces.
 *
 * investments 2,000,000c + savings 300,000c − debts 15,000,000c = −12,700,000c
 * (the pre-32.2 definition gave −13,000,000c on every one of them).
 */
function seedSharedFixture(): void {
  useBalanceStore.setState({
    entries: [
      {
        id: 'inv-1',
        type: 'investment',
        name: 'ISA',
        currentBalance: 800_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'inv-2',
        type: 'investment',
        name: 'Pension',
        currentBalance: 1_200_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'debt-1',
        type: 'debt',
        name: 'Mortgage',
        currentBalance: 15_000_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'sav-1',
        name: 'Emergency fund',
        targetAmount: 1_000_000,
        currentBalance: 250_000,
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'sav-2',
        name: 'Rainy day',
        targetAmount: null,
        currentBalance: 50_000,
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  })
}

/** Render one surface in isolation and return its net-worth text. */
function netWorthTextFrom(surface: 'overview' | 'balance' | 'projection'): string {
  const testId =
    surface === 'overview'
      ? 'overview-net-worth'
      : surface === 'balance'
        ? 'stat-net-worth'
        : 'projection-current-net-worth'

  if (surface === 'overview') {
    render(<HomePage />)
  } else if (surface === 'balance') {
    renderWithProviders(<BalancePage />)
  } else {
    renderWithProviders(<NetWorthProjectionPage />)
  }

  const text = screen.getByTestId(testId).textContent ?? ''
  // Properly UNMOUNT between surfaces (code review 32.2). Wiping
  // `document.body.innerHTML` detaches the container while leaving the React root
  // mounted and still subscribed to the shared zustand stores, so `clearStores()`
  // in `afterEach` re-renders trees into detached DOM. `cleanup()` tears the roots
  // down, and also guarantees the next `getByTestId` cannot match a leftover.
  cleanup()
  return text.trim()
}

describe('net worth agrees across every surface that shows it (story 32.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFreeTier()
    clearStores()
  })

  afterEach(clearStores)

  it('AC-5: the Overview and the Balance page show the SAME figure for one seed', () => {
    seedSharedFixture()

    const overview = netWorthTextFrom('overview')
    const balance = netWorthTextFrom('balance')

    expect(overview).toBe(balance)
    // Pinned to the hand-computed value too, so an agreement on a WRONG shared
    // number (e.g. both reverting together) still fails.
    expect(overview).toContain('-127,000.00')
  })

  it('AC-5/AC-7: the Net Worth Projection page agrees with both', () => {
    seedSharedFixture()

    const overview = netWorthTextFrom('overview')
    const projection = netWorthTextFrom('projection')

    expect(projection).toBe(overview)
  })

  it('AC-6: all three agree for a savings-only user, where they used to show zero', () => {
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'sav-1',
          name: 'Emergency fund',
          targetAmount: 1_000_000,
          currentBalance: 250_000,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })

    const overview = netWorthTextFrom('overview')
    const balance = netWorthTextFrom('balance')
    const projection = netWorthTextFrom('projection')

    expect(overview).toContain('2,500.00')
    expect(balance).toBe(overview)
    expect(projection).toBe(overview)
  })

  /**
   * Story 32.3 — net worth is POINT-IN-TIME and must stay period-invariant.
   *
   * ⚠️ NEW AXIS, and the reason this is an extension rather than a repeat. Every
   * case above renders at the default period with no flows seeded, so all three
   * surfaces were only ever measured at ONE point on the duration axis — the same
   * blindness-by-construction 31.5 recorded. 32.3 puts a single period control in
   * charge of the whole Overview, which is exactly the change that could sweep
   * net worth up with the flow totals; if it ever did, the card would read
   * −$29,307.69 at weekly — round(−12,700,000 × 12/52) = −2,930,769c — and
   * −$1,524,000.00 at annually, while the Balance page held at −$127,000.00.
   * (The weekly figure read −$29,230.77 until code review 32.3 re-derived it:
   * that value divides −1,520,000 rather than the fixture's −1,524,000. No
   * assertion depended on it, but a hand-computed comment whose only job is to
   * be an audit trail must be right, or it costs the next reader time.)
   *
   * Flows ARE seeded here (the fixture from the 32.3 reconciliation) so the two
   * kinds of number sit on screen together, which is the condition under which a
   * mistaken denormalization would be written.
   */
  it('32.3: all three surfaces hold the same net worth at every duration, with flows on screen', () => {
    seedSharedFixture()
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-salary',
          userId: 0,
          name: 'Salary',
          amount: 200_000,
          frequency: 'biweekly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
    useExpenseStore.setState({
      expenses: [
        {
          id: 'exp-groceries',
          userId: 0,
          name: 'Groceries',
          amount: 20_000,
          frequency: 'weekly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })

    const durations: readonly OverviewDuration[] = ['weekly', 'biweekly', 'monthly', 'annually']
    for (const duration of durations) {
      useOverviewDurationStore.setState({ duration })

      const overview = netWorthTextFrom('overview')
      const balance = netWorthTextFrom('balance')
      const projection = netWorthTextFrom('projection')

      expect(balance).toBe(overview)
      expect(projection).toBe(overview)
      // Pinned as well as compared: three surfaces agreeing on a period-scaled
      // WRONG figure would satisfy the equalities on their own.
      expect(overview).toContain('-127,000.00')
    }
  })
})
