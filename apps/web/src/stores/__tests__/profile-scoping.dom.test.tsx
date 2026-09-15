/**
 * Profile scoping of the four financial stores (story 54.4, FR79).
 *
 * ⚠️ THE DEFECT. `switchProfile` changes `activeProfileId` and nothing else, and
 * every selector hook returned its store's WHOLE array — so after a switch, the
 * previous profile's rows (and their money, in every total and in net worth)
 * stayed on screen. Every assertion here is about ABSENCE of profile A: a
 * presence-only test passes on the broken code, because both profiles' rows were
 * shown together.
 *
 * ⚠️ Fixture amounts for A and B are DISTINCT and chosen so A+B can never equal
 * B alone, so a total that silently includes A cannot match the B-only figure.
 *
 * Runs in jsdom (`.dom.test.tsx`) for a real `localStorage` — the stores use the
 * zustand persist middleware, whose `setState` goes through the WRITE path.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useNetWorth } from '../../hooks/useNetWorth'
import {
  useBalanceEntries,
  useBalanceEntryCount,
  useBalanceStore,
  useFilteredBalanceEntries,
  useInvestmentEntries,
  useTotalAssetBalance,
  useTotalDebtBalance,
  useTotalInvestmentBalance,
} from '../balanceStore'
import {
  useExpenseByFrequency,
  useExpenseStore,
  useExpenses,
  useTotalExpenses,
  useUnreadableExpenseCount,
} from '../expenseStore'
import {
  useIncomeByFrequency,
  useIncomeSources,
  useIncomeStore,
  useTotalIncome,
  useUnreadableIncomeCount,
} from '../incomeStore'
import { useProfileStore } from '../profileStore'
import {
  useOverallSavingsProgress,
  useSavingsGoals,
  useSavingsGoalsWithProgress,
  useSavingsStore,
  useTotalSavings,
  useTotalTargetAmount,
} from '../savingsStore'

const TS = '2026-09-15T00:00:00.000Z'
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'

function seedProfiles(active: string = A): void {
  useProfileStore.setState({
    profiles: [
      { id: A, userId: 'u-1', name: 'Personal', isDefault: true, currency: 'NONE' },
      { id: B, userId: 'u-1', name: 'Business', isDefault: false, currency: 'NONE' },
    ],
    activeProfileId: active,
    error: null,
  })
}

function balance(
  id: string,
  profileId: string | undefined,
  type: 'investment' | 'debt' | 'asset',
  currentBalance: number
) {
  return {
    id,
    ...(profileId === undefined ? {} : { profileId }),
    type,
    name: id,
    currentBalance,
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    createdAt: TS,
    updatedAt: TS,
  }
}

/**
 * Profile A:  income 100,000 · expense 10,000 · savings 1,000 ·
 *             investment 700 · asset 30 · debt 5
 * Profile B:  income 200,000 · expense 20,000 · savings 2,000 ·
 *             investment 800 · asset 40 · debt 6
 * (all monthly, so the normalized totals equal the raw sums)
 *
 * B-only net worth = 800 + 2,000 + 40 − 6 = 2,834
 * A+B net worth    = 1,500 + 3,000 + 70 − 11 = 4,559
 */
function seedTwoProfiles(): void {
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-a',
        profileId: A,
        userId: 0,
        name: 'Salary A',
        amount: 100_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'inc-b',
        profileId: B,
        userId: 0,
        name: 'Salary B',
        amount: 200_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  })
  useExpenseStore.setState({
    expenses: [
      {
        id: 'exp-a',
        profileId: A,
        userId: 0,
        name: 'Rent A',
        amount: 10_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'exp-b',
        profileId: B,
        userId: 0,
        name: 'Rent B',
        amount: 20_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'sav-a',
        profileId: A,
        name: 'Fund A',
        targetAmount: null,
        currentBalance: 1_000,
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'sav-b',
        profileId: B,
        name: 'Fund B',
        targetAmount: null,
        currentBalance: 2_000,
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  })
  useBalanceStore.setState({
    entries: [
      balance('inv-a', A, 'investment', 700),
      balance('inv-b', B, 'investment', 800),
      balance('asset-a', A, 'asset', 30),
      balance('asset-b', B, 'asset', 40),
      balance('debt-a', A, 'debt', 5),
      balance('debt-b', B, 'debt', 6),
    ],
  })
}

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
}

/** Everything a page reads, in one hook so one render sees one consistent snapshot. */
function useEverything() {
  return {
    income: useIncomeSources().map((row) => row.id),
    expenses: useExpenses().map((row) => row.id),
    savings: useSavingsGoals().map((row) => row.id),
    balances: useBalanceEntries().map((row) => row.id),
    investments: useInvestmentEntries().map((row) => row.id),
    totalIncome: useTotalIncome(),
    totalExpenses: useTotalExpenses(),
    totalSavings: useTotalSavings(),
    totalInvestments: useTotalInvestmentBalance(),
    totalAssets: useTotalAssetBalance(),
    totalDebts: useTotalDebtBalance(),
    netWorth: useNetWorth(),
  }
}

beforeEach(() => {
  clearStores()
  seedProfiles()
})

afterEach(() => {
  act(() => {
    clearStores()
  })
})

describe('switching profile re-scopes every selector (AC-2, AC-3)', () => {
  it('shows ONLY profile A before the switch — the probe can see A (positive control)', () => {
    seedTwoProfiles()
    const { result } = renderHook(() => useEverything())

    expect(result.current.income).toEqual(['inc-a'])
    expect(result.current.expenses).toEqual(['exp-a'])
    expect(result.current.savings).toEqual(['sav-a'])
    expect(result.current.balances).toEqual(['inv-a', 'asset-a', 'debt-a'])
  })

  it('after switching A → B, no row of profile A remains in any array hook', () => {
    seedTwoProfiles()
    const { result } = renderHook(() => useEverything())

    act(() => {
      useProfileStore.getState().switchProfile(B)
    })

    expect(result.current.income).not.toContain('inc-a')
    expect(result.current.expenses).not.toContain('exp-a')
    expect(result.current.savings).not.toContain('sav-a')
    expect(result.current.balances).not.toContain('inv-a')
    expect(result.current.balances).not.toContain('asset-a')
    expect(result.current.balances).not.toContain('debt-a')
    expect(result.current.investments).not.toContain('inv-a')

    expect(result.current.income).toEqual(['inc-b'])
    expect(result.current.expenses).toEqual(['exp-b'])
    expect(result.current.savings).toEqual(['sav-b'])
    expect(result.current.balances).toEqual(['inv-b', 'asset-b', 'debt-b'])
    expect(result.current.investments).toEqual(['inv-b'])
  })

  it('after switching A → B, every total and net worth excludes profile A money', () => {
    seedTwoProfiles()
    const { result } = renderHook(() => useEverything())

    act(() => {
      useProfileStore.getState().switchProfile(B)
    })

    expect(result.current.totalIncome).toBe(200_000)
    expect(result.current.totalExpenses).toBe(20_000)
    expect(result.current.totalSavings).toBe(2_000)
    expect(result.current.totalInvestments).toBe(800)
    expect(result.current.totalAssets).toBe(40)
    expect(result.current.totalDebts).toBe(6)
    // 800 + 2,000 + 40 − 6. A+B would be 4,559.
    expect(result.current.netWorth).toBe(2_834)
  })

  it('keeps array identity stable across a re-render with no store change (AC-8)', () => {
    seedTwoProfiles()
    const { result, rerender } = renderHook(() => ({
      income: useIncomeSources(),
      expenses: useExpenses(),
      savings: useSavingsGoals(),
      balances: useBalanceEntries(),
      investments: useInvestmentEntries(),
    }))
    const first = result.current
    rerender()
    expect(result.current.income).toBe(first.income)
    expect(result.current.expenses).toBe(first.expenses)
    expect(result.current.savings).toBe(first.savings)
    expect(result.current.balances).toBe(first.balances)
    expect(result.current.investments).toBe(first.investments)
  })
})

describe('create paths stamp the active profile (AC-4)', () => {
  it('stamps a row added under B with B, and it is invisible after switching back to A', () => {
    seedProfiles(B)
    act(() => {
      useIncomeStore
        .getState()
        .addIncomeSource({ name: 'New income', amount: 1, frequency: 'monthly' })
      useExpenseStore
        .getState()
        .addExpense({ name: 'New expense', amount: 1, frequency: 'monthly' })
      useSavingsStore
        .getState()
        .addSavingsGoal({ name: 'New fund', targetAmount: null, currentBalance: 1 })
      useBalanceStore.getState().addBalanceEntry({
        type: 'investment',
        name: 'New investment',
        currentBalance: 1,
        monthlyContribution: 0,
        frequency: 'monthly',
      })
    })

    expect(useIncomeStore.getState().incomeSources[0]?.profileId).toBe(B)
    expect(useExpenseStore.getState().expenses[0]?.profileId).toBe(B)
    expect(useSavingsStore.getState().savingsGoals[0]?.profileId).toBe(B)
    expect(useBalanceStore.getState().entries[0]?.profileId).toBe(B)

    const { result } = renderHook(() => useEverything())
    expect(result.current.income).toHaveLength(1)

    act(() => {
      useProfileStore.getState().switchProfile(A)
    })

    expect(result.current.income).toEqual([])
    expect(result.current.expenses).toEqual([])
    expect(result.current.savings).toEqual([])
    expect(result.current.balances).toEqual([])
  })

  it('an update neither strips nor changes the stamp', () => {
    seedTwoProfiles()
    act(() => {
      useIncomeStore.getState().updateIncomeSource('inc-b', { name: 'Renamed', amount: 5 })
      useExpenseStore.getState().updateExpense('exp-b', { name: 'Renamed' })
      useSavingsStore.getState().updateSavingsGoal('sav-b', { name: 'Renamed' })
      useBalanceStore.getState().updateBalanceEntry('inv-b', { name: 'Renamed' })
    })

    const find = <T extends { id: string }>(rows: T[], id: string) => rows.find((r) => r.id === id)
    expect(find(useIncomeStore.getState().incomeSources, 'inc-b')?.profileId).toBe(B)
    expect(find(useExpenseStore.getState().expenses, 'exp-b')?.profileId).toBe(B)
    expect(find(useSavingsStore.getState().savingsGoals, 'sav-b')?.profileId).toBe(B)
    expect(find(useBalanceStore.getState().entries, 'inv-b')?.profileId).toBe(B)
  })
})

describe('free tier is unchanged (AC-5)', () => {
  it('a single default profile with legacy rows lacking profileId sees every row and total', () => {
    useProfileStore.setState({
      profiles: [{ id: A, userId: '', name: 'Main Profile', isDefault: true, currency: 'NONE' }],
      activeProfileId: A,
    })
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'legacy-inc',
          userId: 0,
          name: 'Legacy',
          amount: 300,
          frequency: 'monthly',
          categoryId: null,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'legacy-sav',
          name: 'Legacy',
          targetAmount: null,
          currentBalance: 50,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
    useBalanceStore.setState({ entries: [balance('legacy-debt', undefined, 'debt', 20)] })

    const { result } = renderHook(() => useEverything())
    expect(result.current.income).toEqual(['legacy-inc'])
    expect(result.current.savings).toEqual(['legacy-sav'])
    expect(result.current.balances).toEqual(['legacy-debt'])
    expect(result.current.totalIncome).toBe(300)
    expect(result.current.netWorth).toBe(30)

    // A free user's NEW row is stamped with their default profile and stays visible.
    act(() => {
      useIncomeStore.getState().addIncomeSource({ name: 'New', amount: 1, frequency: 'monthly' })
    })
    expect(result.current.income).toHaveLength(2)
    expect(result.current.totalIncome).toBe(301)
  })
})

/**
 * The remaining row-derived hooks (code review 54.4). Each had scoping added with
 * no absence test, so dropping `scopeToActiveProfile` from any of them was silent
 * green. One fixture per hook where A and B are distinguishable:
 *   - unreadable counts: profile A holds one UNREADABLE row (corrupt frequency),
 *     B holds none — scoped to B the count must be 0, not 1.
 *   - savings targets: A 10,000 target / 1,000 saved; B 4,000 target / 2,000 saved
 *     → B total target 4,000 (A+B 14,000); B progress round(2,000/4,000) = 50%
 *     (A+B round(3,000/14,000) = 21%).
 */
describe('every other row-derived hook is scoped too (code review 54.4)', () => {
  function seedDistinguishing(): void {
    seedTwoProfiles()
    const corrupt = { frequency: 'fortnightly' as unknown as 'monthly' }
    useIncomeStore.setState({
      incomeSources: [
        ...useIncomeStore.getState().incomeSources,
        {
          id: 'inc-a-bad',
          profileId: A,
          userId: 0,
          name: 'Bad A',
          amount: 1,
          categoryId: null,
          createdAt: TS,
          updatedAt: TS,
          ...corrupt,
        },
      ],
    })
    useExpenseStore.setState({
      expenses: [
        ...useExpenseStore.getState().expenses,
        {
          id: 'exp-a-bad',
          profileId: A,
          userId: 0,
          name: 'Bad A',
          amount: 1,
          categoryId: null,
          createdAt: TS,
          updatedAt: TS,
          ...corrupt,
        },
      ],
    })
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'sav-a',
          profileId: A,
          name: 'Goal A',
          targetAmount: 10_000,
          currentBalance: 1_000,
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'sav-b',
          profileId: B,
          name: 'Goal B',
          targetAmount: 4_000,
          currentBalance: 2_000,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function useRemaining() {
    return {
      unreadableIncome: useUnreadableIncomeCount(),
      unreadableExpenses: useUnreadableExpenseCount(),
      incomeMonthly: useIncomeByFrequency('monthly').map((row) => row.id),
      expensesMonthly: useExpenseByFrequency('monthly').map((row) => row.id),
      withProgress: useSavingsGoalsWithProgress().map((row) => row.id),
      totalTarget: useTotalTargetAmount(),
      overallProgress: useOverallSavingsProgress(),
      filteredBalances: useFilteredBalanceEntries().map((row) => row.id),
      balanceCount: useBalanceEntryCount(),
    }
  }

  it('sees profile A through every hook before the switch (positive control)', () => {
    seedDistinguishing()
    const { result } = renderHook(() => useRemaining())

    expect(result.current.unreadableIncome).toBe(1)
    expect(result.current.unreadableExpenses).toBe(1)
    expect(result.current.incomeMonthly).toEqual(['inc-a'])
    expect(result.current.expensesMonthly).toEqual(['exp-a'])
    expect(result.current.withProgress).toEqual(['sav-a'])
    expect(result.current.totalTarget).toBe(10_000)
    expect(result.current.overallProgress).toBe(10)
    expect(result.current.filteredBalances).toEqual(['inv-a', 'asset-a', 'debt-a'])
    expect(result.current.balanceCount).toBe(3)
  })

  it('excludes profile A from every hook after switching to B', () => {
    seedDistinguishing()
    const { result } = renderHook(() => useRemaining())

    act(() => {
      useProfileStore.getState().switchProfile(B)
    })

    expect(result.current.unreadableIncome).toBe(0)
    expect(result.current.unreadableExpenses).toBe(0)
    expect(result.current.incomeMonthly).toEqual(['inc-b'])
    expect(result.current.expensesMonthly).toEqual(['exp-b'])
    expect(result.current.withProgress).toEqual(['sav-b'])
    expect(result.current.totalTarget).toBe(4_000)
    expect(result.current.overallProgress).toBe(50)
    expect(result.current.filteredBalances).toEqual(['inv-b', 'asset-b', 'debt-b'])
    expect(result.current.balanceCount).toBe(3)
  })
})
