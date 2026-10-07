/**
 * Story 107.1 (FR175): the builder compares the scenario against TODAY.
 *
 * The baseline is projected from the user's current store data, mapped by the
 * same functions that seed the builder's rows; the projection from the builder's
 * own (edited) rows. Before the story both came from the edited rows, so raising
 * an investment contribution moved the two lines together and the difference was
 * always 0 (MEASURED at create-story, `621ee31`).
 *
 * Real stores and the real engine; only the initial-sync hook is stubbed, so a
 * test can hold the "first pull still in flight" window open (AC-6).
 */

import type { ForecastingResult } from '@budget-planner/core'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

const syncPending = vi.hoisted(() => ({ value: false }))
vi.mock('../../../hooks/useIsInitialSyncPending', () => ({
  useIsInitialSyncPending: () => syncPending.value,
}))

const ISO = '2026-10-05T00:00:00.000Z'
const PROFILE = 'profile-baseline-today'

function seedStores(): void {
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        profileId: PROFILE,
        userId: 0,
        name: 'Salary',
        amount: 600_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ] as never,
  })
  useExpenseStore.setState({
    expenses: [
      {
        id: 'exp-1',
        profileId: PROFILE,
        userId: 0,
        name: 'Rent',
        amount: 300_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
      {
        id: 'exp-2',
        profileId: PROFILE,
        userId: 0,
        name: 'Car payment',
        amount: 30_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ] as never,
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'sav-1',
        profileId: PROFILE,
        name: 'Emergency fund',
        targetAmount: null,
        currentBalance: 1_000_000,
        allocationMode: 'manual',
        monthlyAllocation: 0,
        sortOrder: 0,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ] as never,
  })
  useBalanceStore.setState({
    entries: [
      {
        id: 'bal-1',
        profileId: PROFILE,
        name: 'Pension',
        type: 'investment',
        currentBalance: 5_000_000,
        monthlyContribution: 50_000,
        frequency: 'monthly',
        sortOrder: 0,
        createdAt: ISO,
        updatedAt: ISO,
      },
      {
        // A debt paid by a linked expense (102.2): the seed MOVES that expense into
        // the debt row, so an unedited scenario only equals the baseline when the
        // baseline is mapped by the same function (AC-5).
        id: 'bal-2',
        profileId: PROFILE,
        name: 'Car loan',
        type: 'debt',
        currentBalance: 600_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        paymentExpenseId: 'exp-2',
        sortOrder: 1,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ] as never,
  })
}

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
}

const onResult = vi.fn()

beforeEach(() => {
  onResult.mockReset()
  syncPending.value = false
  clearStores()
  useProfileStore.setState({ activeProfileId: PROFILE })
})

afterEach(() => {
  clearStores()
  vi.restoreAllMocks()
})

function lastResult(): ForecastingResult {
  const calls = onResult.mock.calls
  const result = calls[calls.length - 1]?.[0] as ForecastingResult | null | undefined
  if (!result) throw new Error('no result lifted yet')
  return result
}

function formatter(): (cents: number) => string {
  return renderHook(() => useFormattedAmount()).result.current
}

/** The fields a baseline row and a projection row both report. */
function comparable(rows: ForecastingResult['baseline']) {
  return rows.map(
    ({
      year,
      income,
      expenses,
      netIncome,
      savings,
      investments,
      netWorth,
      debts,
      balanceAccounts,
      // Story 114.1: both series carry the asset total.
      assets,
    }) => ({
      year,
      income,
      expenses,
      netIncome,
      savings,
      investments,
      netWorth,
      debts,
      balanceAccounts,
      assets,
    })
  )
}

describe('the baseline is today (story 107.1)', () => {
  it('an unedited, flat scenario coincides with the baseline (AC-5)', async () => {
    seedStores()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })

    const result = lastResult()
    expect(comparable(result.baseline)).toEqual(comparable(result.projection))
    // The debt row carries the moved payment, so the case is not vacuous.
    expect(result.baseline.at(-1)?.debts).toBe(0)
  })

  it('raising a contribution moves only the projection, and "vs. today" shows the gap (AC-3, AC-4, AC-8)', async () => {
    seedStores()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
    const before = lastResult()
    onResult.mockClear()

    fireEvent.change(screen.getByLabelText('Contribution for Pension'), {
      target: { value: '3000' },
    })
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
    const after = lastResult()

    expect(after.baseline).toEqual(before.baseline)
    expect(after.projection.at(-1)?.netWorth).not.toBe(before.projection.at(-1)?.netWorth)
    const gap = (after.projection.at(-1)?.netWorth ?? 0) - (after.baseline.at(-1)?.netWorth ?? 0)
    expect(gap).toBeGreaterThan(0)

    const card = screen.getByText('vs. today', { selector: 'dt' }).nextElementSibling
    expect(card?.textContent).toBe(`+${formatter()(gap)}`)
  })

  it('editing an income row moves only the projection (AC-4)', async () => {
    seedStores()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
    const before = lastResult()
    onResult.mockClear()

    // The Income section renders first, so its row's Amount is the first one.
    const salaryAmount = screen.getAllByLabelText('Amount')[0] as HTMLInputElement
    expect(salaryAmount.value).toBe('6,000.00')
    fireEvent.change(salaryAmount, { target: { value: '7000' } })
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
    const after = lastResult()

    expect(after.baseline).toEqual(before.baseline)
    expect(after.projection.at(-1)?.income).toBe(8_400_000)
  })

  it('shows "vs. today" as +0 for an unedited scenario, with the sign guard', async () => {
    seedStores()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
    const card = screen.getByText('vs. today', { selector: 'dt' }).nextElementSibling
    expect(card?.textContent).toBe(`+${formatter()(0)}`)
  })

  it('does not calculate while the first pull is still in flight (AC-6)', async () => {
    syncPending.value = true
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    // Longer than the 500 ms debounce: no result against an empty baseline.
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(onResult).not.toHaveBeenCalled()
    // Positive control: the builder itself rendered.
    expect(screen.getByRole('heading', { name: 'Scenario Builder' })).toBeInTheDocument()
  })
})
