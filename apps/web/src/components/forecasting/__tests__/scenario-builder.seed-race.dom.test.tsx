/**
 * Edits made AFTER hydration but BEFORE the store seed lands survive the seed.
 *
 * The seed (62.1) waits for `!useIsInitialSyncPending`, which on a paid user's
 * first device can be seconds after hydration. Anything the user does in that
 * window must not be replaced, and a money field they are typing in must not be
 * remounted under them (which drops focus). The pending gate is mocked so the
 * window can be held open and then closed on demand.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
  useCurrencyMode: () => 'none',
  useCurrencyCode: () => 'NONE',
}))

const gate = vi.hoisted(() => ({ pending: true }))
vi.mock('../../../hooks/useIsInitialSyncPending', () => ({
  useIsInitialSyncPending: () => gate.pending,
}))

const NOW = '2026-09-22T00:00:00.000Z'
const PROFILE_A = 'profile-a'

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
}

function fillStores(): void {
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        profileId: PROFILE_A,
        userId: 0,
        name: 'Consulting',
        amount: 720_000,
        frequency: 'monthly' as const,
        categoryId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
  useExpenseStore.setState({
    expenses: [
      {
        id: 'exp-1',
        profileId: PROFILE_A,
        userId: 0,
        name: 'Rent',
        amount: 150_000,
        frequency: 'monthly' as const,
        categoryId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'goal-1',
        profileId: PROFILE_A,
        name: 'Emergency fund',
        targetAmount: 1_000_000,
        currentBalance: 345_600,
        allocationMode: 'manual' as const,
        monthlyAllocation: null,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
  useBalanceStore.setState({
    entries: [
      {
        id: 'entry-1',
        profileId: PROFILE_A,
        type: 'investment' as const,
        name: 'Index fund',
        currentBalance: 987_600,
        monthlyContribution: 0,
        frequency: 'monthly' as const,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
}

beforeEach(() => {
  gate.pending = true
  clearStores()
  fillStores()
  useProfileStore.setState({ activeProfileId: PROFILE_A })
})

afterEach(() => {
  clearStores()
  vi.clearAllMocks()
})

const onSave = vi.fn()

/** Close the pending window: the seed lands on the next commit. A FRESH element,
 * because React bails out of re-rendering an identical element reference. */
function landSeed(rerender: (ui: React.ReactElement) => void): void {
  gate.pending = false
  rerender(<ScenarioBuilder onSave={onSave} />)
}

describe('edits made while the seed is still pending survive it', () => {
  it('positive control: with nothing edited, the seed fills every field and row', () => {
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)
    expect(screen.queryByDisplayValue('Consulting')).toBeNull()

    landSeed(rerender)

    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
    expect(screen.getByLabelText('Current Savings')).toHaveValue('3456.00')
    expect(screen.getByLabelText('Current Investments')).toHaveValue('9876.00')
  })

  it('does not remount a Current Savings field the user is typing in, nor replace its value', () => {
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

    const field = screen.getByLabelText('Current Savings') as HTMLInputElement
    field.focus()
    fireEvent.change(field, { target: { value: '1234' } })

    landSeed(rerender)

    // The seed landed (positive control) ...
    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByLabelText('Current Investments')).toHaveValue('9876.00')
    // ... and the savings field is the SAME node, still focused, still the typed text.
    expect(screen.getByLabelText('Current Savings')).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(field).toHaveValue('1234')
  })

  it('does not remount a Current Investments field the user is typing in', () => {
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

    const field = screen.getByLabelText('Current Investments') as HTMLInputElement
    field.focus()
    fireEvent.change(field, { target: { value: '50' } })

    landSeed(rerender)

    expect(screen.getByLabelText('Current Savings')).toHaveValue('3456.00')
    expect(screen.getByLabelText('Current Investments')).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(field).toHaveValue('50')
  })

  it('keeps income rows the user added and edited instead of replacing them', () => {
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add Income' }))
    fireEvent.change(screen.getByDisplayValue('New Income'), { target: { value: 'Salary' } })

    landSeed(rerender)

    expect(screen.getByDisplayValue('Salary')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Consulting')).toBeNull()
    // Expenses were untouched, so they are still seeded.
    expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
  })

  it('keeps the expense rows the user added and deleted instead of re-seeding them', () => {
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

    // Two added rows, one deleted (the builder refuses to delete the last row).
    fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }))
    expect(screen.getAllByDisplayValue('New Expense')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: /delete|remove/i })[0])
    expect(screen.getAllByDisplayValue('New Expense')).toHaveLength(1)

    landSeed(rerender)

    expect(screen.queryByDisplayValue('Rent')).toBeNull()
    expect(screen.getAllByDisplayValue('New Expense')).toHaveLength(1)
    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
  })
})
