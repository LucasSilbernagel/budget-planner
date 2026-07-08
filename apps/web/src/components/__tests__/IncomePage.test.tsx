import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'
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

/**
 * IncomePage inline field-validation tests (story 6-8).
 *
 * Proves invalid add submissions surface themed, accessible inline field errors
 * (no browser alert()), block the store mutation and keep the modal open, and
 * that correcting the fields clears the errors and lets a valid submit proceed.
 */
describe('IncomePage inline validation', () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  it('shows inline field errors on invalid submit and does not mutate the store', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    // Both field errors render with the exact preserved messages.
    expect(screen.getByTestId('income-name-error')).toHaveTextContent(
      'Please enter a name for the income source'
    )
    expect(screen.getByTestId('income-amount-error')).toHaveTextContent(
      'Please enter a valid positive amount'
    )
    // Errors are programmatically associated (AC-2).
    const nameInput = screen.getByTestId('income-name-input')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', 'income-name-error')
    // No store mutation and the modal stays open (AC-1).
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('clears the error after correction and a valid submit succeeds (AC-3)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))
    expect(screen.getByTestId('income-name-error')).toBeInTheDocument()

    // Correct the name — its error clears as the user types (re-validate on change).
    await user.type(screen.getByTestId('income-name-input'), 'Freelance')
    await waitFor(() => expect(screen.queryByTestId('income-name-error')).not.toBeInTheDocument())

    await user.type(screen.getByTestId('income-amount-input'), '100')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const sources = useIncomeStore.getState().incomeSources
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ name: 'Freelance', amount: 10000 })
  })
})

/**
 * IncomePage currency-input formatting tests (story 14-3).
 *
 * Proves the amount input shows the selected currency's symbol only in symbols
 * mode (never a hard-coded "$"), and that a locale-grouped entry both parses to
 * the correct integer cents on submit and re-echoes grouped on blur. This is the
 * representative wiring for the four money add/edit forms.
 */
describe('IncomePage currency input formatting (story 14-3)', () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  })

  it('shows no currency symbol on the amount input in currency-less mode', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('$')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('€')).not.toBeInTheDocument()
  })

  it('shows the selected currency symbol (not $) on the amount input in symbols mode', async () => {
    useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('€')).toBeInTheDocument()
    expect(within(dialog).queryByText('$')).not.toBeInTheDocument()
  })

  it('parses a grouped amount to the correct integer cents on submit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('income-name-input'), 'Bonus')
    await user.type(within(dialog).getByTestId('income-amount-input'), '1,234,567.89')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useIncomeStore.getState().incomeSources[0]).toMatchObject({
      name: 'Bonus',
      amount: 123456789,
    })
  })

  it('re-echoes the amount with locale grouping on blur', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    const amountInput = within(dialog).getByTestId('income-amount-input')
    await user.type(amountInput, '1234567.89')
    await user.tab()

    await waitFor(() => expect(amountInput).toHaveValue('1,234,567.89'))
  })

  it('does not clobber non-numeric input to "0.00" on blur (review patch)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    const amountInput = within(dialog).getByTestId('income-amount-input')
    await user.type(amountInput, 'abc')
    await user.tab()

    // The typo is left visible for inline validation, not silently rewritten.
    await waitFor(() => expect(amountInput).toHaveValue('abc'))
  })
})
