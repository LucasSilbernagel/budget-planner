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

/**
 * Story 16-1: goal-less savings accounts (null target). The account toggle hides
 * the target field, an account submits with targetAmount: null and no target
 * error, and an account row renders no progress bar (N/A) instead of "0%".
 */
describe('SavingsPage — savings accounts (Story 16-1)', () => {
  beforeEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  it('account toggle hides the target amount field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    expect(screen.getByTestId('savings-target-amount-input')).toBeInTheDocument()

    await user.click(screen.getByTestId('savings-is-account-toggle'))
    expect(screen.queryByTestId('savings-target-amount-input')).not.toBeInTheDocument()
  })

  it('submits an account with targetAmount: null and no target error', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')

    await user.type(screen.getByTestId('savings-name-input'), 'Checking Buffer')
    await user.click(screen.getByTestId('savings-is-account-toggle'))
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('savings-target-amount-error')).not.toBeInTheDocument()

    const goals = useSavingsStore.getState().savingsGoals
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({ name: 'Checking Buffer', targetAmount: null })
  })

  it('renders no progress bar (N/A) and an "Account" badge for an account row', () => {
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'acc-1',
          name: 'Checking Buffer',
          targetAmount: null,
          currentBalance: 250000,
          createdAt: new Date('2026-01-01').toISOString(),
          updatedAt: new Date('2026-01-01').toISOString(),
        },
      ],
    })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByTestId('savings-progress-na-acc-1')).toHaveTextContent('N/A')
    expect(screen.getByTestId('savings-badge-acc-1')).toHaveTextContent('Account')
    // No "%" progress readout is rendered for an account.
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })
})

/**
 * Story 26.1: per-account monthly allocation + mode. Automatic (default) hides the
 * manual amount input and stores monthlyAllocation: null; manual reveals the input
 * and stores the parsed cents; switching back to automatic ignores a typed amount.
 */
describe('SavingsPage — monthly allocation (Story 26.1)', () => {
  beforeEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  it('defaults to automatic — the manual amount input is hidden and it stores null', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')

    // Automatic is selected by default; the manual amount input is not rendered.
    expect(screen.getByTestId('savings-allocation-mode-select')).toHaveValue('automatic')
    expect(screen.queryByTestId('savings-monthly-allocation-input')).not.toBeInTheDocument()

    await user.type(screen.getByTestId('savings-name-input'), 'Leftover')
    await user.click(screen.getByTestId('savings-is-account-toggle'))
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const goals = useSavingsStore.getState().savingsGoals
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({
      name: 'Leftover',
      allocationMode: 'automatic',
      monthlyAllocation: null,
    })
  })

  it('manual mode reveals the amount input and stores the parsed cents', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')

    await user.type(screen.getByTestId('savings-name-input'), 'Rent Fund')
    await user.click(screen.getByTestId('savings-is-account-toggle'))
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')

    const amountInput = screen.getByTestId('savings-monthly-allocation-input')
    expect(amountInput).toBeInTheDocument()
    await user.type(amountInput, '250')
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const goals = useSavingsStore.getState().savingsGoals
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({
      name: 'Rent Fund',
      allocationMode: 'manual',
      monthlyAllocation: 25000, // $250 → cents
    })
  })

  it('switching manual → automatic ignores a typed amount and stores null', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')

    await user.type(screen.getByTestId('savings-name-input'), 'Flexible')
    await user.click(screen.getByTestId('savings-is-account-toggle'))
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
    await user.type(screen.getByTestId('savings-monthly-allocation-input'), '999')
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'automatic')

    // The amount input is hidden again once automatic is re-selected.
    expect(screen.queryByTestId('savings-monthly-allocation-input')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const goals = useSavingsStore.getState().savingsGoals
    expect(goals[0]).toMatchObject({ allocationMode: 'automatic', monthlyAllocation: null })
  })
})
