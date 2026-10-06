/**
 * Edits made AFTER hydration but BEFORE the store seed lands survive the seed.
 *
 * The seed (62.1) waits for `!useIsInitialSyncPending`, which on a paid user's
 * first device can be seconds after hydration. Anything the user does in that
 * window must not be replaced, and a money field they are typing in must not be
 * remounted under them (which drops focus). The pending gate is mocked so the
 * window can be held open and then closed on demand.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
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
    // Story 100.1: savings are rows now, one per store row.
    expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue(3456)
    // Story 100.2: investments are rows too.
    expect(screen.getByLabelText('Balance for Index fund')).toHaveValue(9876)
  })

  /**
   * Story 100.1 replaced the single Current Savings field with rows, so this is
   * now the row version of the old "field the user is typing in" case: a row
   * added before the seed survives it, keeps its node and focus, and the store
   * rows are NOT added on top (D8, parity with income rows).
   */
  it('keeps a savings row the user added and is typing in, and does not add the store rows on top (D8)', () => {
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }))
    const field = screen.getByLabelText('Balance for New Account') as HTMLInputElement
    field.focus()
    fireEvent.change(field, { target: { value: '1234' } })

    landSeed(rerender)

    // The seed landed (positive control) ...
    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByLabelText('Balance for Index fund')).toHaveValue(9876)
    // ... the user's row is the SAME node, still focused, still the typed text ...
    expect(screen.getByLabelText('Balance for New Account')).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(field).toHaveValue(1234)
    // ... and the store's row was not added beside it.
    expect(screen.queryByDisplayValue('Emergency fund')).toBeNull()
    const savings = screen.getByRole('region', { name: 'Savings Accounts' })
    expect(within(savings).getAllByRole('button', { name: /^Remove / })).toHaveLength(1)
  })

  /**
   * Story 100.2 replaced the Current Investments field with investment/debt rows,
   * so this is now the row version of the old "Current Investments field the user
   * is typing in" case, with the same D8 rule as the savings rows: a row added
   * before the seed survives it, keeps its node and focus, and the store's rows
   * are NOT added on top.
   */
  it('keeps an investment/debt row the user added and is typing in, and does not add the store rows on top (D8)', () => {
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    const field = screen.getByLabelText('Balance for New Investment') as HTMLInputElement
    field.focus()
    fireEvent.change(field, { target: { value: '50' } })

    landSeed(rerender)

    // The seed landed (positive control) ...
    expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue(3456)
    // ... the user's row is the same node, focused, with the typed value ...
    expect(screen.getByLabelText('Balance for New Investment')).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(field).toHaveValue(50)
    // ... and the store's Index fund was not added beside it.
    expect(screen.queryByDisplayValue('Index fund')).toBeNull()
    const balances = screen.getByRole('region', { name: 'Investments & Debts' })
    expect(within(balances).getAllByRole('button', { name: /^Remove / })).toHaveLength(1)
  })

  /**
   * Story 100.3: an annual return typed on a row added before the seed survives
   * it too. No new touched flag: the rate edit goes through the same
   * `editBalanceAccounts` that marks the list touched.
   */
  it('keeps an annual return typed on a row added before the seed (story 100.3)', () => {
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    const field = screen.getByLabelText('Annual return for New Investment') as HTMLInputElement
    expect(field).toHaveValue('6.00%')
    field.focus()
    fireEvent.change(field, { target: { value: '3.5' } })

    landSeed(rerender)

    // The seed landed (positive control) ...
    expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue(3456)
    // ... the rate field is the same node, focused, with the typed text ...
    expect(screen.getByLabelText('Annual return for New Investment')).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(field).toHaveValue('3.5')
    // ... and the store's Index fund (seeded at 6.00%) was not added beside it.
    expect(screen.queryByLabelText('Annual return for Index fund')).toBeNull()
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

/**
 * Story 102.2 (AC-8, D5): a debt linked to an expense MOVES that expense into
 * the debt row, but only in the seed pass that creates the debt row. These pin
 * the two orders a pre-seed edit can take.
 */
describe('the linked expense moves only with the debt row that carries it (story 102.2)', () => {
  function addLinkedDebt(): void {
    useExpenseStore.setState({
      expenses: [
        ...useExpenseStore.getState().expenses,
        {
          id: 'exp-loan',
          profileId: PROFILE_A,
          userId: 0,
          name: 'Loan payment',
          amount: 20_000,
          frequency: 'monthly' as const,
          categoryId: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    })
    useBalanceStore.setState({
      entries: [
        ...useBalanceStore.getState().entries,
        {
          id: 'entry-loan',
          profileId: PROFILE_A,
          type: 'debt' as const,
          name: 'Loan',
          currentBalance: 300_000,
          monthlyContribution: 0,
          frequency: 'monthly' as const,
          paymentExpenseId: 'exp-loan',
          sortOrder: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ] as never,
    })
  }

  it('positive control: untouched, the expense leaves the Expenses rows and the debt carries it', () => {
    addLinkedDebt()
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)
    landSeed(rerender)
    expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Loan payment')).toBeNull()
    expect(screen.getByLabelText('Contribution for Loan')).toHaveValue(200)
    expect(screen.getByText('from Expenses: Loan payment')).toBeInTheDocument()
  })

  it('removes nothing when the balance rows were touched first: no debt row carries the payment, so it must stay an expense', () => {
    addLinkedDebt()
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    landSeed(rerender)
    // The Expenses rows seeded (positive control), Loan payment INCLUDED ...
    expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Loan payment')).toBeInTheDocument()
    // ... and the store's debt was not added beside the user's row.
    expect(screen.queryByLabelText('Contribution for Loan')).toBeNull()
  })

  it('keeps Expenses rows touched first, and still seeds the debt with its payment and flag off', () => {
    addLinkedDebt()
    const { rerender } = render(<ScenarioBuilder onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add Expense' }))
    landSeed(rerender)
    expect(screen.getAllByDisplayValue('New Expense')).toHaveLength(1)
    expect(screen.queryByDisplayValue('Rent')).toBeNull()
    expect(screen.getByLabelText('Contribution for Loan')).toHaveValue(200)
    expect(
      screen.getByRole('checkbox', { name: 'Payment already in Expenses, for Loan' })
    ).not.toBeChecked()
  })
})
