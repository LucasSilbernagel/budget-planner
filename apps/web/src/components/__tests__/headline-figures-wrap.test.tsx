import { renderWithProviders, screen } from '@/test/utils'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { useBalanceStore } from '../../stores/balanceStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { HomePage } from '../HomePage'
import { IncomePage } from '../IncomePage'
import { RetirementAccumulationPlanner } from '../RetirementAccumulationPlanner'
import { SavingsPage } from '../SavingsPage'

const TS = '2026-08-15T00:00:00.000Z'

const flow = (id: string, amount: number) => ({
  id,
  userId: 0,
  name: id,
  amount,
  frequency: 'monthly' as const,
  categoryId: null,
  createdAt: TS,
  updatedAt: TS,
})

const balance = (id: string, type: 'investment' | 'debt' | 'asset', currentBalance: number) => ({
  id,
  type,
  name: id,
  currentBalance,
  monthlyContribution: 0,
  frequency: 'monthly' as const,
  createdAt: TS,
  updatedAt: TS,
})

function seed(): void {
  useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
  useOverviewDurationStore.setState({ duration: 'monthly' })
  useIncomeStore.setState({ incomeSources: [flow('inc', 1_234_567_890)] })
  useExpenseStore.setState({ expenses: [flow('exp', 987_654_321)] })
  useBalanceStore.setState({
    entries: [
      balance('inv', 'investment', 1_111_111_111),
      balance('debt', 'debt', 98_765_432_100),
      balance('condo', 'asset', 2_222_222_222),
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'sav',
        name: 'sav',
        targetAmount: null,
        currentBalance: 333_333_333,
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  })
}

function runs(testId: string): string[] {
  return runsOf(screen.getByTestId(testId))
}

function runsOf(el: Element): string[] {
  const out = ['']
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeName === 'WBR') out.push('')
    else out[out.length - 1] += node.textContent ?? ''
  }
  return out
}

beforeEach(() => {
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      subscriptionStatus: 'free',
      isLoading: false,
      error: null,
      isAuthenticated: false,
    },
  })
  seed()
})

afterEach(() => {
  cleanup()
  useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useBalanceStore.setState({ entries: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useOverviewDurationStore.setState({ duration: 'annually' })
})

describe('headline figures break only between digit groups (story 88.1)', () => {
  it('the Overview: income, expenses and net worth', () => {
    render(<HomePage />)
    expect(runs('overview-total-income')).toEqual(['$12,', '345,', '678.90'])
    expect(runs('overview-total-expenses')).toEqual(['$9,', '876,', '543.21'])
    expect(runs('overview-net-worth')).toEqual(['-$950,', '987,', '654.34'])
  })

  it('/balance: the four input cards and net worth', () => {
    renderWithProviders(<BalancePage />)
    expect(runs('stat-total-investments')).toEqual(['$11,', '111,', '111.11'])
    expect(runs('stat-total-savings')).toEqual(['$3,', '333,', '333.33'])
    expect(runs('stat-total-assets')).toEqual(['$22,', '222,', '222.22'])
    expect(runs('stat-total-debts')).toEqual(['$987,', '654,', '321.00'])
    expect(runs('stat-net-worth')).toEqual(['-$950,', '987,', '654.34'])
  })

  it('PeriodTotal on /income and /expenses', () => {
    renderWithProviders(<IncomePage />)
    expect(runs('period-total-amount')).toEqual(['$12,', '345,', '678.90'])
    cleanup()
    renderWithProviders(<ExpensesPage />)
    expect(runs('period-total-amount')).toEqual(['$9,', '876,', '543.21'])
  })
})

describe('the remaining headline figures break only between digit groups (story 88.4)', () => {
  it('/savings: the Total Savings figure', () => {
    renderWithProviders(<SavingsPage />)
    expect(runs('savings-total')).toEqual(['$3,', '333,', '333.33'])
  })

  it('Retirement: Current Amount Saved and Monthly Savings', () => {
    useBalanceStore.setState({
      entries: [
        { ...balance('inv', 'investment', 1_111_111_111), monthlyContribution: 123_456_789 },
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)
    const figure = (id: string) => screen.getByTestId(id).querySelector('dd > span') as HTMLElement
    expect(runsOf(figure('derived-current-saved'))).toEqual(['$11,', '111,', '111.11'])
    expect(runsOf(figure('derived-monthly-savings'))).toEqual(['$1,', '234,', '567.89'])
    for (const id of ['derived-current-saved', 'derived-monthly-savings']) {
      const dd = screen.getByTestId(id).querySelector('dd') as HTMLElement
      expect(dd.getAttribute('aria-live'), id).toBe('polite')
      expect(dd.getAttribute('aria-atomic'), id).toBe('true')
    }
  })
})
