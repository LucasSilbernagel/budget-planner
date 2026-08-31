/**
 * The contribution flag survives the trip from the Balance form to the Savings pool
 * (Story 47.1, FR73, AC-16).
 *
 * ## What this replaces, and why the obvious replacement is not enough
 *
 * Story 45.1 shipped `SavingsPage.test.tsx`'s "the breakdown toggle and the Balance
 * form reach the SAME number", which drove the flag through the inline breakdown
 * toggle. Story 47.1 deletes that toggle, so the test goes with it.
 *
 * ⚠️ A store-seeded replacement on `/savings` alone would NOT be a replacement. The
 * form writes `contributionRecordedAsExpense` (the persisted name); the pool reads
 * `recordedAsExpense` (the calculation's name); the single translation between them
 * is one line in `SavingsPage.tsx` (`contributionItems`). Today that seam IS covered
 * — but only by two tests in SERIES, in two different suites: `BalancePage.test.tsx`
 * proves the form writes the flag to the store, and `SavingsPage.test.tsx` proves a
 * seeded flag moves the pool. Nothing joins them, so a future divergence can hide in
 * the gap between the two suites.
 *
 * This file closes that gap: one seed, both pages, one arrow.
 *
 * ⚠️ Be precise about what it buys, because an earlier draft of this docblock said
 * both "a divergence can hide in the gap" AND "not a new guarantee" — which cannot
 * both be true. Accurately: the two in-series tests DO cover the seam today, so
 * nothing is currently unguarded. What they cannot catch is a future edit that
 * changes both sides in a consistent-looking but wrong way — the key the form writes
 * and the key the pool reads drifting together. Only a single arrow through both
 * pages fails then. A real gain, and a narrow one.
 *
 * Harness note: `renderWithProviders` is a bare `render` with no router, and neither
 * page imports anything from `@tanstack/react-router`, so both mount unwrapped. The
 * balance store is a module singleton that `vitest.setup.ts` does not reset, so its
 * state survives `unmount()` inside one `it` — which is what makes the hand-off real
 * rather than simulated. Same shape as `table-sort-persistence.dom.test.tsx`.
 */

import { renderWithProviders, screen, waitFor, within } from '@/test/utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { SavingsPage } from '../SavingsPage'

const ISO = '2026-08-15T00:00:00.000Z'

function resetStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useBalanceStore.setState({ entries: [] })
  useSavingsStore.setState({ savingsGoals: [] })
}

/** $3,000/mo income, a $500/mo "TFSA contribution" expense, one automatic goal. */
function seedIncomeExpensesAndGoal(): void {
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        name: 'Salary',
        amount: 300_000,
        frequency: 'monthly',
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
  useExpenseStore.setState({
    expenses: [
      {
        id: 'exp-1',
        name: 'TFSA contribution',
        amount: 50_000,
        frequency: 'monthly',
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'auto-1',
        name: 'auto-1',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'automatic',
        monthlyAllocation: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
}

/** Fills the Balance add form with a $500/mo TFSA contribution and saves it. */
async function addTfsaViaForm(
  user: ReturnType<typeof userEvent.setup>,
  { tick }: { tick: boolean }
): Promise<void> {
  await user.click(screen.getByTestId('balance-add-button'))
  const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
  await user.type(within(dialog).getByLabelText(/name/i), 'TFSA')
  await user.type(within(dialog).getByTestId('balance-current-balance-input'), '10000')
  await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '500')
  if (tick) {
    await user.click(within(dialog).getByTestId('balance-contribution-recorded-as-expense'))
  }
  await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

describe('contribution flag — Balance form to Savings pool (Story 47.1, AC-16)', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('ticking the box on the Balance form stops the double deduction on the Savings page', async () => {
    const user = userEvent.setup()
    seedIncomeExpensesAndGoal()

    const balance = renderWithProviders(<BalancePage />)
    await addTfsaViaForm(user, { tick: true })
    balance.unmount()

    renderWithProviders(<SavingsPage />)

    // net = 3000 − 500 = 2500; the flagged contribution is NOT subtracted again.
    // `waitFor` rather than a bare assertion so the pool is read after mount has
    // settled. ⚠️ It does NOT silence the act() warning SavingsPage logs on mount —
    // that is pre-existing and repo-wide (the same 5 warnings appear when running
    // `SavingsPage.test.tsx` alone at this baseline). Measured, not assumed.
    await waitFor(() =>
      expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,500\.00/)
    )
    expect(screen.getByTestId('savings-allocation-auto-1')).toHaveTextContent(/2,500\.00/)
  })

  it('leaving it unticked deducts twice — the regression fence for the different-money user', async () => {
    const user = userEvent.setup()
    seedIncomeExpensesAndGoal()

    const balance = renderWithProviders(<BalancePage />)
    await addTfsaViaForm(user, { tick: false })
    balance.unmount()

    renderWithProviders(<SavingsPage />)

    // ⚠️ The arm that makes the test above meaningful. Without it, a pool stuck at
    // 2,500 for ANY input would pass. This figure must not move: it is correct for
    // a user whose expense line and contribution are different money.
    await waitFor(() =>
      expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,000\.00/)
    )
  })
})
