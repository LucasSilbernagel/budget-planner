import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useIncomeStore } from '../../stores/incomeStore'
import { IncomePage } from '../IncomePage'

/**
 * IncomePage delete-confirmation tests (story 6-3).
 *
 * Proves the destructive delete now flows through the themed ConfirmDialog
 * (alertdialog) instead of a browser `confirm()`: opening the dialog, aborting
 * on Cancel (nothing deleted), and proceeding on Confirm (row removed). This is
 * the representative end-to-end wiring for the four converted page components.
 */
describe('IncomePage delete confirmation', () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Salary', amount: 500000, frequency: 'monthly' })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  it('opens a themed alertdialog instead of a browser confirm', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Confirm Delete' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Salary')
  })

  it('Cancel aborts the delete — the row remains', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByTestId('delete-confirm-cancel'))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('Salary')).toBeInTheDocument()
    expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
  })

  it('Confirm performs the delete — the row is removed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByTestId('delete-confirm-confirm'))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Salary')).not.toBeInTheDocument()
    expect(screen.getByText('No income sources yet')).toBeInTheDocument()
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })
})
