/**
 * Category assignment on the income and expense pages (story 30.4b, AC-1/AC-3/AC-5).
 *
 * These are the wiring assertions the picker's own suite cannot make: that the
 * selection reaches the STORE, comes back when the row is re-opened for edit,
 * and shows up in the row's table listing — and that the locked picker inside
 * the real Add/Edit `<Modal>` opens no second dialog (AC-5, the one that is the
 * DEFAULT experience for every non-premium visitor).
 */

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      subscriptionStatus: null,
      isLoading: false,
      error: null,
      isAuthenticated: false,
      ...overrides,
    } satisfies PremiumAccessStatus,
  })
}

const premium = () =>
  mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
const free = () =>
  mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

function category(overrides: Partial<ClientCategory> & { id: string }): ClientCategory {
  return {
    userId: 0,
    profileId: null,
    name: 'Groceries',
    kind: 'expense',
    isDeleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function resetStores(): void {
  useCategoryStore.setState({ categories: [] })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStores()
})

afterEach(() => {
  act(() => {
    resetStores()
  })
})

describe('IncomePage category assignment (AC-1)', () => {
  it('persists the chosen category to the row and shows it in the table', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
    })
    render(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('income-name-input'), 'Salary')
    await user.type(within(dialog).getByTestId('income-amount-input'), '5000')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'i1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    // The STORE holds the id...
    const [row] = useIncomeStore.getState().incomeSources
    expect(row?.categoryId).toBe('i1')
    // ...and the table shows the NAME, never the uuid.
    expect(screen.getByTestId('income-row-category')).toHaveTextContent('Employment')
    expect(screen.queryByText('i1')).not.toBeInTheDocument()
  })

  it('re-opens an edit form on the row’s existing category', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [
        category({ id: 'i1', name: 'Employment', kind: 'income' }),
        category({ id: 'i2', name: 'Dividends', kind: 'income' }),
      ],
    })
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'row-1',
          userId: 0,
          name: 'Salary',
          amount: 500000,
          frequency: 'monthly',
          categoryId: 'i2',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    render(<IncomePage />)

    await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('i2')
  })

  it('does not carry the previous entry’s category into the next Add (found by mutation M32)', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
    })
    render(<IncomePage />)

    // First add: categorized.
    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    let dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('income-name-input'), 'Salary')
    await user.type(within(dialog).getByTestId('income-amount-input'), '5000')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'i1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    // Second add: the form must open back on Uncategorized. Without the reset the
    // picker still shows "Employment" and the next row silently inherits it —
    // the classic sticky-form-state defect, and invisible to every other test
    // here because they each add only ONE row.
    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('')

    await user.type(within(dialog).getByTestId('income-name-input'), 'Bonus')
    await user.type(within(dialog).getByTestId('income-amount-input'), '100')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.name === 'Bonus')?.categoryId).toBeNull()
  })

  it('clearing the category writes null, not the empty-string sentinel', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
    })
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'row-1',
          userId: 0,
          name: 'Salary',
          amount: 500000,
          frequency: 'monthly',
          categoryId: 'i1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    render(<IncomePage />)

    await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Category'), '')
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    expect(useIncomeStore.getState().incomeSources[0]?.categoryId).toBeNull()
    expect(screen.getByTestId('income-row-uncategorized')).toBeInTheDocument()
  })
})

describe('ExpensesPage category assignment (AC-1)', () => {
  it('persists the chosen category to the row and shows it in the table', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('expense-name-input'), 'Tesco run')
    await user.type(within(dialog).getByTestId('expense-amount-input'), '80')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'e1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBe('e1')
    expect(screen.getByTestId('expense-row-category')).toHaveTextContent('Groceries')
  })
})

describe('ExpensesPage EDIT round-trip — the sibling the first pass never tested', () => {
  // ⚠️ ADDED BY CODE REVIEW 30.4b. All three review layers independently found
  // that `ExpensesPage.openEditModal` never seeded `categoryId`, so every expense
  // edit silently wrote `null` over the row's category. The whole suite was green
  // because the edit round-trip was tested on IncomePage ONLY — the same
  // sibling-asymmetry axis that mutation M34 caught in the two pie charts, hit a
  // second time in one story. These mirror the income tests exactly.

  function seedCategorizedExpense(categoryId: string): void {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'row-1',
          userId: 0,
          name: 'Tesco run',
          amount: 8000,
          frequency: 'monthly',
          categoryId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  }

  it('re-opens an edit form on the row’s existing category', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [
        category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
        category({ id: 'e2', name: 'Housing', kind: 'expense' }),
      ],
    })
    seedCategorizedExpense('e2')
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('e2')
  })

  it('an UNRELATED edit preserves the category — the HIGH defect this review caught', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    seedCategorizedExpense('e1')
    render(<ExpensesPage />)

    // Change ONLY the amount, never touching the picker, and save.
    await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByTestId('expense-amount-input'))
    await user.type(within(dialog).getByTestId('expense-amount-input'), '95')
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    const [row] = useExpenseStore.getState().expenses
    expect(row?.amount).toBe(9500)
    // The category MUST survive. Before the fix this was null.
    expect(row?.categoryId).toBe('e1')
    expect(screen.getByTestId('expense-row-category')).toHaveTextContent('Groceries')
  })

  it('clearing the category writes null, not the empty-string sentinel', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    seedCategorizedExpense('e1')
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Category'), '')
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBeNull()
    expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
  })

  it('does not carry the previous entry’s category into the next Add', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    let dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('expense-name-input'), 'Tesco run')
    await user.type(within(dialog).getByTestId('expense-amount-input'), '80')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'e1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('')
  })
})

describe('a dangling reference in the table (AC-3)', () => {
  function seedExpenseRow(categoryId: string | null): void {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'row-1',
          userId: 0,
          name: 'Tesco run',
          amount: 8000,
          frequency: 'monthly',
          categoryId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  }

  it('CAUSE 1 (pull pagination): an id not yet on this device renders uncategorized', () => {
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e-other', name: 'Rent', kind: 'expense' })],
    })
    seedExpenseRow('e-not-yet-pulled')
    render(<ExpensesPage />)

    expect(screen.getByTestId('expense-row-uncategorized')).toHaveTextContent('—')
    expect(screen.queryByText('e-not-yet-pulled')).not.toBeInTheDocument()
    expect(screen.queryByTestId('expense-row-category')).not.toBeInTheDocument()
  })

  it('CAUSE 2 (deleted on another device): a removed category renders uncategorized', () => {
    premium()
    useCategoryStore.setState({ categories: [] })
    seedExpenseRow('e1')
    render(<ExpensesPage />)

    expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
    expect(screen.queryByText('e1')).not.toBeInTheDocument()
  })

  it('CAUSE 3 (soft-deleted locally): a tombstoned category renders uncategorized', () => {
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense', isDeleted: true })],
    })
    seedExpenseRow('e1')
    render(<ExpensesPage />)

    expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
    // The deleted category's NAME must not surface either.
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
  })
})

describe('the free tier: a locked picker, and CRUD that still works (AC-4, AC-5)', () => {
  // ⚠️ Deliberately NOT titled "unchanged" (code review 30.4b): free users' income
  // and expense tables also gained a Category column, which for them can only ever
  // render the "—" placeholder. AC-4 promises their CRUD keeps working
  // uncategorized — not that the page is byte-identical.
  it('AC-5: clicking the locked picker inside the Add Expense modal opens NO second dialog', async () => {
    const user = userEvent.setup()
    free()
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    const locked = screen.getByTestId('expense-category-locked')
    await user.click(locked)

    // Modal.tsx assumes ONE modal at a time; a nested one breaks Escape handling
    // and restores the scroll lock out of order.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: /go premium/i })).not.toBeInTheDocument()
  })

  it('a free user can still add an expense, uncategorized, with no required field added', async () => {
    const user = userEvent.setup()
    free()
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('expense-name-input'), 'Rent')
    await user.type(within(dialog).getByTestId('expense-amount-input'), '1200')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

    const [row] = useExpenseStore.getState().expenses
    expect(row?.name).toBe('Rent')
    expect(row?.categoryId).toBeNull()
    expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
  })
})
