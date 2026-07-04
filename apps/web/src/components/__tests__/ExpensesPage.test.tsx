import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useExpenseStore } from '../../stores/expenseStore'
import { ExpensesPage } from '../ExpensesPage'

/**
 * ExpensesPage inline field-validation tests (story 6-8).
 *
 * Proves invalid add submissions surface themed, accessible inline field errors
 * (no browser alert()), block the store mutation and keep the modal open, and
 * that correcting the fields clears the errors and lets a valid submit proceed.
 */
describe('ExpensesPage inline validation', () => {
  beforeEach(() => {
    useExpenseStore.setState({ expenses: [] })
  })

  afterEach(() => {
    useExpenseStore.setState({ expenses: [] })
  })

  it('shows inline field errors on invalid submit and does not mutate the store', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

    expect(screen.getByTestId('expense-name-error')).toHaveTextContent(
      'Please enter a name for the expense'
    )
    expect(screen.getByTestId('expense-amount-error')).toHaveTextContent(
      'Please enter a valid positive amount'
    )
    const nameInput = screen.getByTestId('expense-name-input')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', 'expense-name-error')
    expect(useExpenseStore.getState().expenses).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('clears the error after correction and a valid submit succeeds (AC-3)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))
    expect(screen.getByTestId('expense-name-error')).toBeInTheDocument()

    await user.type(screen.getByTestId('expense-name-input'), 'Rent')
    await waitFor(() => expect(screen.queryByTestId('expense-name-error')).not.toBeInTheDocument())

    await user.type(screen.getByTestId('expense-amount-input'), '1500')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const expenses = useExpenseStore.getState().expenses
    expect(expenses).toHaveLength(1)
    expect(expenses[0]).toMatchObject({ name: 'Rent', amount: 150000 })
  })
})

/**
 * Danger-color reservation (story 11-3, AC-2).
 *
 * These are additive, non-destructive actions, so they must not wear the
 * danger-red fill that reads as "delete" (red stays reserved for the row Delete
 * control and its ConfirmDialog).
 */
describe('ExpensesPage safe-action buttons are not danger-red', () => {
  beforeEach(() => {
    useExpenseStore.setState({ expenses: [] })
  })

  it('the "+ Add Expense" and modal submit buttons use no red fill', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    const addButton = screen.getByRole('button', { name: '+ Add Expense' })
    expect(addButton.className).not.toMatch(/bg-red-(600|700)/)

    await user.click(addButton)
    const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expense' })
    expect(submit.className).not.toMatch(/bg-red-(600|700)/)
  })
})
