// One seed through both pages, so the form's write key and the pool's read key cannot
// drift together. The balance store singleton survives `unmount()` within one `it`.

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

function seedIncomeExpensesAndGoal(): void {
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        userId: 0,
        categoryId: null,
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
        userId: 0,
        categoryId: null,
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
        targetAmount: 1_000_000,
        currentBalance: 0,
        allocationMode: 'automatic',
        monthlyAllocation: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
}

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

    // net = 3000 − 500 = 2500; the flagged contribution is not subtracted again.
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

    // Without this arm a pool stuck at 2,500 for any input would pass.
    await waitFor(() =>
      expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,000\.00/)
    )
  })
})
