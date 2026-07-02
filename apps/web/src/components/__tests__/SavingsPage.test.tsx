import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSavingsStore } from '../../stores/savingsStore'
import { SavingsPage } from '../SavingsPage'

/**
 * SavingsPage inline field-validation tests (story 6-8).
 *
 * Proves invalid add submissions surface themed, accessible inline field errors
 * (no browser alert()), block the store mutation and keep the modal open, and
 * that correcting the fields clears the errors and lets a valid submit proceed.
 */
describe('SavingsPage inline validation', () => {
  beforeEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  it('shows inline field errors on invalid submit and does not mutate the store', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    expect(screen.getByTestId('savings-name-error')).toHaveTextContent(
      'Please enter a name for the savings goal'
    )
    expect(screen.getByTestId('savings-target-amount-error')).toHaveTextContent(
      'Please enter a valid positive target amount'
    )
    // Empty current balance defaults to 0 → valid, so no error is shown for it.
    expect(screen.queryByTestId('savings-current-balance-error')).not.toBeInTheDocument()

    const nameInput = screen.getByTestId('savings-name-input')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', 'savings-name-error')
    expect(useSavingsStore.getState().savingsGoals).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('clears the error after correction and a valid submit succeeds (AC-3)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))
    expect(screen.getByTestId('savings-name-error')).toBeInTheDocument()

    await user.type(screen.getByTestId('savings-name-input'), 'Emergency Fund')
    await waitFor(() => expect(screen.queryByTestId('savings-name-error')).not.toBeInTheDocument())

    await user.type(screen.getByTestId('savings-target-amount-input'), '5000')
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const goals = useSavingsStore.getState().savingsGoals
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({ name: 'Emergency Fund', targetAmount: 500000 })
  })
})
