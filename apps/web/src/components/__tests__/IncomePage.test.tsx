import { fireEvent, renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
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

  it('never lets letters into the field, and blur leaves it empty rather than "0.00" (story 28-1)', async () => {
    // Retargeted from the original review patch: the letters used to survive
    // on-blur as visible garbage; on-input sanitization now stops them reaching
    // state at all. The load-bearing half of that patch's intent — blur must NOT
    // rewrite the field to a validating "0.00" — is what is pinned here.
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    const amountInput = within(dialog).getByTestId('income-amount-input')
    await user.type(amountInput, 'abc')

    expect(amountInput).toHaveValue('')

    await user.tab()
    await waitFor(() => expect(amountInput).toHaveValue(''))
    expect(amountInput).not.toHaveValue('0.00')
  })

  it('keeps a lone "-" on blur instead of zeroing it (the no-digit guard arm)', async () => {
    // The sanitizer deliberately preserves digit-free partials so a negative can
    // be typed one character at a time. That makes the `!/\d/` arm of the blur
    // guard genuinely reachable: without it, "-" would parse to 0 and echo back
    // as "0.00", turning an unfinished entry into a valid-looking zero.
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    const amountInput = within(dialog).getByTestId('income-amount-input')
    await user.type(amountInput, '-')
    await user.tab()

    await waitFor(() => expect(amountInput).toHaveValue('-'))
  })

  it('strips pasted garbage down to the numeric part in one change event (AC-5)', async () => {
    // A paste arrives as a single change event carrying the whole string — the
    // reason the filter lives in onChange rather than a keystroke handler.
    renderWithProviders(<IncomePage />)

    await userEvent.setup().click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    const amountInput = within(dialog).getByTestId('income-amount-input')
    fireEvent.change(amountInput, { target: { value: 'USD 1,234.56 per month' } })

    expect(amountInput).toHaveValue('1,234.56')
  })

  it('prefills the edit modal with a grouped, locale-aware amount (story 28-1)', async () => {
    const user = userEvent.setup()
    useIncomeStore.setState({ incomeSources: [] })
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Salary', amount: 123456789, frequency: 'monthly' })
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog')

    // Not "1234567.89" — the prefill goes through the same formatter as the blur
    // echo, so re-saving without editing cannot shift the stored cents.
    expect(within(dialog).getByTestId('income-amount-input')).toHaveValue('1,234,567.89')
  })
})

/**
 * Visible focus indicator (story 28-1, AC-7).
 *
 * `focus:outline-none` removes the browser's native focus ring, so a
 * `focus:ring-<color>` without `focus:ring-2` sets a ring colour of zero width —
 * keyboard users get no visible focus indicator at all. Third recurrence of this
 * defect class (Epics 15 and 24), hence a structural guard rather than a manual
 * check only.
 *
 * Asserted by class-TOKEN membership, not substring: a substring check for
 * "focus:ring-2" also matches tokens like "focus:ring-2xl" and would pass on a
 * class list that has no 2px ring at all.
 */
describe('IncomePage form controls have a visible focus ring', () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  it('every control that kills the native outline restores a 2px ring', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')

    const controls = [
      within(dialog).getByTestId('income-name-input'),
      within(dialog).getByTestId('income-amount-input'),
      within(dialog).getByLabelText('Frequency *'),
    ]

    // Count the controls actually asserted on: a bare `if (tokens.includes(...))`
    // guard silently asserts NOTHING the day `focus:outline-none` moves or the
    // class string is reshaped, which is exactly how this defect class recurs.
    let checked = 0
    for (const control of controls) {
      const tokens = control.className.split(/\s+/)
      expect(tokens, `${control.id} no longer kills the native outline`).toContain(
        'focus:outline-none'
      )
      expect(tokens, `${control.id} has no visible focus ring`).toContain('focus:ring-2')
      // And the ring must carry a real COLOUR — `focus:ring-offset-*` / `-inset`
      // satisfy a naive "starts with focus:ring-" check while painting nothing.
      expect(
        tokens.some((t) => /^focus:ring-(?!offset-|inset$)[a-z]+-\d+$/.test(t)),
        `${control.id} has a ring width but no ring colour`
      ).toBe(true)
      checked++
    }
    expect(checked).toBe(controls.length)
  })
})
