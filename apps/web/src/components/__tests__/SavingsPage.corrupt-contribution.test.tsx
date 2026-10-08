// localStorage is user-editable and pulled rows are unvalidated, so a contribution can be
// NaN, ±Infinity or null; `normalizeToMonthly` throws on all of them.

import { fireEvent, renderWithProviders, screen } from '@/test/utils'
import { solveAutomaticAllocations } from '@budget-planner/core'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { SavingsPage } from '../SavingsPage'
import { ScenarioBuilder } from '../forecasting/scenario-builder'

const ISO = '2026-10-06T00:00:00.000Z'
const PROFILE = 'profile-corrupt'

const incomeRow = (amount: number) => ({
  id: 'inc-1',
  profileId: PROFILE,
  userId: 0,
  categoryId: null,
  name: 'Salary',
  amount,
  frequency: 'monthly' as const,
  createdAt: ISO,
  updatedAt: ISO,
})

// A non-matching expense, so both duplicate detectors actually normalize the
// contribution (they had nothing to compare against otherwise).
const expenseRow = (amount: number) => ({
  id: 'exp-1',
  profileId: PROFILE,
  userId: 0,
  categoryId: null,
  name: 'Rent',
  amount,
  frequency: 'monthly' as const,
  createdAt: ISO,
  updatedAt: ISO,
})

const investmentRow = (monthlyContribution: number, contributionRecordedAsExpense?: boolean) => ({
  id: 'inv-1',
  profileId: PROFILE,
  type: 'investment' as const,
  name: 'TFSA',
  currentBalance: 0,
  monthlyContribution,
  frequency: 'monthly' as const,
  contributionRecordedAsExpense,
  sortOrder: 0,
  createdAt: ISO,
  updatedAt: ISO,
})

const autoGoal = {
  id: 'auto-1',
  profileId: PROFILE,
  name: 'Auto one',
  targetAmount: 1_000_000 as number | null,
  currentBalance: 0,
  allocationMode: 'automatic' as const,
  monthlyAllocation: null,
  sortOrder: 0,
  createdAt: ISO,
  updatedAt: ISO,
}

function seed(monthlyContribution: number, recordedAsExpense?: boolean): void {
  useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
  useExpenseStore.setState({ expenses: [expenseRow(50_000)] })
  useBalanceStore.setState({
    entries: [investmentRow(monthlyContribution, recordedAsExpense)] as never,
  })
  useSavingsStore.setState({ savingsGoals: [autoGoal] })
}

function resetStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useBalanceStore.setState({ entries: [] })
  useSavingsStore.setState({ savingsGoals: [] })
}

const openBreakdown = () => {
  fireEvent.click(screen.getByRole('button', { name: 'How is this worked out?' }))
}

beforeEach(() => {
  resetStores()
  useProfileStore.setState({ activeProfileId: PROFILE })
})

afterEach(resetStores)

const CORRUPT: [string, number][] = [
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['null (a JSON-flattened NaN)', null as unknown as number],
]

describe('SavingsPage with a non-finite stored investment contribution', () => {
  it('positive control: the real solver throws for the raw NaN contribution', () => {
    // So a failure below comes from the /savings memos feeding it, not the stub.
    expect(() =>
      solveAutomaticAllocations({
        incomeSources: [incomeRow(300_000)],
        expenses: [],
        investmentContributions: [{ amount: Number.NaN, frequency: 'monthly' }],
        savingsAccounts: [autoGoal],
      })
    ).toThrow('Amount must be a finite number')
  })

  it('healthy: a $500 contribution is counted and carries no unreadable note', () => {
    seed(50_000)
    renderWithProviders(<SavingsPage />)
    // 3000 − 500 rent − 500 contribution.
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,000\.00/)
    openBreakdown()
    expect(screen.getByTestId('breakdown-contribution-amount-inv-1')).toHaveTextContent(/500\.00/)
    expect(screen.queryByTestId('breakdown-unreadable-inv-1')).not.toBeInTheDocument()
  })

  it.each(CORRUPT)('%s: renders, counts the row as 0 and discloses it', (_label, value) => {
    seed(value)
    renderWithProviders(<SavingsPage />)

    // 3000 − 500 rent − 0.
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,500\.00/)
    expect(screen.getAllByText('Auto one').length).toBeGreaterThan(0)

    openBreakdown()
    expect(screen.getByTestId('breakdown-contribution-inv-1')).toHaveTextContent(/TFSA/)
    expect(screen.getByTestId('breakdown-contribution-amount-inv-1').textContent).toMatch(
      /^[^\d\-−]*0\.00$/
    )
    expect(screen.getByTestId('breakdown-unreadable-inv-1')).toHaveTextContent(
      `Couldn’t read this contribution, so it counts as ${
        screen.getByTestId('breakdown-contribution-amount-inv-1').textContent
      }.`
    )
    expect(screen.getByTestId('breakdown-contributions').textContent).toMatch(/^\D*0\.00$/)
  })

  it('unreadable AND flagged: keeps the struck-through $0.00 and still shows the note', () => {
    seed(Number.NaN, true)
    renderWithProviders(<SavingsPage />)
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,500\.00/)

    openBreakdown()
    const amount = screen.getByTestId('breakdown-contribution-amount-inv-1')
    expect(amount.textContent).toMatch(/^[^\d\-−]*0\.00$/)
    expect(amount.className).toContain('line-through')
    expect(screen.getByTestId('breakdown-contribution-inv-1')).toHaveTextContent(
      /already accounted for/i
    )
    expect(screen.getByTestId('breakdown-unreadable-inv-1')).toBeInTheDocument()
  })
})

describe('ScenarioBuilder seeds the solver share with a non-finite contribution', () => {
  it('seeds the automatic row from the solver (row counted as 0), not the catch’s 0', () => {
    seed(Number.NaN)
    render(<ScenarioBuilder onSave={vi.fn()} />)
    // 3000 − 500 rent − 0 = $2,500 to the single automatic row.
    expect(screen.getByLabelText('Monthly Contribution for Auto one')).toHaveValue('2,500.00')
  })
})
