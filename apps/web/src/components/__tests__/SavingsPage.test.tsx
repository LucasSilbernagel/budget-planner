import { act, renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
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

/**
 * Story 26.3: surface per-account allocations + the leftover split on the Savings
 * page. The page reads four stores (income, expenses, investment contributions,
 * savings accounts), runs the Story 26.2 `solveAutomaticAllocations` solver, and
 * renders each account's effective monthly allocation (the fixed amount for manual
 * accounts, the computed even-share for automatic ones), a leftover-split summary,
 * and a calm over-committed note. All amounts are integer cents.
 */
describe('SavingsPage — leftover allocation split (Story 26.3)', () => {
  const ISO = '2026-01-01T00:00:00.000Z'

  // Fully-typed store fixtures (the shared makeIncomeSource/makeExpense factories
  // omit createdAt/updatedAt, which the Client* store types require).
  const incomeRow = (amount: number, id = 'inc-1') => ({
    id,
    userId: 0,
    name: 'Salary',
    amount,
    frequency: 'monthly' as const,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const expenseRow = (amount: number, id = 'exp-1') => ({
    id,
    userId: 0,
    name: 'Rent',
    amount,
    frequency: 'monthly' as const,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const investmentRow = (monthlyContribution: number, id = 'inv-1') => ({
    id,
    type: 'investment' as const,
    name: 'RRSP',
    currentBalance: 0,
    monthlyContribution,
    frequency: 'monthly' as const,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const savingsRow = (over: {
    id: string
    name?: string
    allocationMode?: 'manual' | 'automatic'
    monthlyAllocation?: number | null
  }) => ({
    name: over.name ?? over.id,
    targetAmount: null,
    currentBalance: 0,
    allocationMode: 'automatic' as 'manual' | 'automatic',
    monthlyAllocation: null as number | null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  })

  const resetStores = () => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({ entries: [] })
    useSavingsStore.setState({ savingsGoals: [] })
  }

  beforeEach(resetStores)
  afterEach(resetStores)

  it('shows the leftover summary and each account’s effective allocation (AC-1, AC-2)', () => {
    // income 500000 − expenses 150000 = net 350000; − 50000 contribution
    // − 130000 manual = pool 170000 across 2 automatic → 85000 each. The manual
    // fixed amount (130000) and the automatic share (85000) are DISTINCT so a
    // manual↔automatic value swap would fail an assertion, not slip through.
    useIncomeStore.setState({ incomeSources: [incomeRow(500000)] })
    useExpenseStore.setState({ expenses: [expenseRow(150000)] })
    useBalanceStore.setState({ entries: [investmentRow(50000)] })
    useSavingsStore.setState({
      savingsGoals: [
        savingsRow({ id: 'manual-1', allocationMode: 'manual', monthlyAllocation: 130000 }),
        savingsRow({ id: 'auto-1', allocationMode: 'automatic' }),
        savingsRow({ id: 'auto-2', allocationMode: 'automatic' }),
      ],
    })
    renderWithProviders(<SavingsPage />)

    // Summary: pool 170000 (“1,700.00”) split across 2 automatic accounts.
    const summary = screen.getByTestId('savings-leftover-summary')
    expect(summary).toHaveTextContent(/1,700\.00/)
    expect(summary).toHaveTextContent(/2 automatic accounts/)

    // Manual account shows its fixed amount (130000 → “1,300.00”), tagged Fixed.
    const manual = screen.getByTestId('savings-allocation-manual-1')
    expect(manual).toHaveTextContent(/1,300\.00/)
    expect(screen.getByTestId('savings-allocation-mode-manual-1')).toHaveTextContent(/Fixed/i)

    // Each automatic account shows the even share (85000 → “850.00”), tagged Auto.
    expect(screen.getByTestId('savings-allocation-auto-1')).toHaveTextContent(/850\.00/)
    expect(screen.getByTestId('savings-allocation-auto-2')).toHaveTextContent(/850\.00/)
    expect(screen.getByTestId('savings-allocation-mode-auto-1')).toHaveTextContent(/Auto/i)

    // No over-committed note when there is a positive pool.
    expect(screen.queryByTestId('savings-overcommitted-note')).not.toBeInTheDocument()
  })

  it('handles a non-divisible pool with exact cents (largest-remainder)', () => {
    // net 100 (“1.00”) across 3 automatic → 34 / 33 / 33, summing to 100.
    useIncomeStore.setState({ incomeSources: [incomeRow(100)] })
    useSavingsStore.setState({
      savingsGoals: [
        savingsRow({ id: 'a', allocationMode: 'automatic' }),
        savingsRow({ id: 'b', allocationMode: 'automatic' }),
        savingsRow({ id: 'c', allocationMode: 'automatic' }),
      ],
    })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByTestId('savings-allocation-a')).toHaveTextContent(/0\.34/)
    expect(screen.getByTestId('savings-allocation-b')).toHaveTextContent(/0\.33/)
    expect(screen.getByTestId('savings-allocation-c')).toHaveTextContent(/0\.33/)
  })

  it('shows 0 for automatic accounts and a calm note when over-committed (AC-4)', () => {
    // net 50000; manual 100000 exceeds it → pool floors to 0; autos get 0.
    useIncomeStore.setState({ incomeSources: [incomeRow(200000)] })
    useExpenseStore.setState({ expenses: [expenseRow(150000)] })
    useSavingsStore.setState({
      savingsGoals: [
        savingsRow({ id: 'manual-1', allocationMode: 'manual', monthlyAllocation: 100000 }),
        savingsRow({ id: 'auto-1', allocationMode: 'automatic' }),
      ],
    })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByTestId('savings-allocation-auto-1')).toHaveTextContent(/0\.00/)
    expect(screen.getByTestId('savings-overcommitted-note')).toBeInTheDocument()
  })

  it('states there are no automatic accounts when every account is manual (AC-2)', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow(500000)] })
    useSavingsStore.setState({
      savingsGoals: [
        savingsRow({ id: 'manual-1', allocationMode: 'manual', monthlyAllocation: 100000 }),
      ],
    })
    renderWithProviders(<SavingsPage />)

    const summary = screen.getByTestId('savings-leftover-summary')
    expect(summary).toHaveTextContent(/no automatic accounts/i)
    expect(summary).not.toHaveTextContent(/split across 0/i)
    // No over-committed note when there are no automatic accounts to receive a split.
    expect(screen.queryByTestId('savings-overcommitted-note')).not.toBeInTheDocument()
  })

  it('recomputes the automatic share live when income changes (AC-3)', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow(100000)] })
    useSavingsStore.setState({
      savingsGoals: [savingsRow({ id: 'auto-1', allocationMode: 'automatic' })],
    })
    renderWithProviders(<SavingsPage />)

    // Pool 100000 → the single automatic account gets all of it.
    expect(screen.getByTestId('savings-allocation-auto-1')).toHaveTextContent(/1,000\.00/)

    // Raise income to 300000; the share updates with no reload.
    act(() => {
      useIncomeStore.setState({ incomeSources: [incomeRow(300000)] })
    })
    expect(screen.getByTestId('savings-allocation-auto-1')).toHaveTextContent(/3,000\.00/)
  })

  it('degrades a corrupt investment frequency to monthly instead of crashing (review)', () => {
    // A corrupt/legacy persisted frequency (localStorage is user-editable; migrate
    // only backfills nullish) must not throw in the solver's normalizer at render.
    useIncomeStore.setState({ incomeSources: [incomeRow(500000)] })
    useBalanceStore.setState({
      entries: [{ ...investmentRow(50000), frequency: 'daily' as unknown as 'monthly' }],
    })
    useSavingsStore.setState({
      savingsGoals: [savingsRow({ id: 'auto-1', allocationMode: 'automatic' })],
    })
    // Renders without throwing; the bad frequency is treated as monthly, so the
    // contribution stays 50000 → pool 450000 → the sole automatic account gets it.
    renderWithProviders(<SavingsPage />)
    expect(screen.getByTestId('savings-allocation-auto-1')).toHaveTextContent(/4,500\.00/)
  })

  it('clamps a corrupt negative manual allocation to 0 in the row (review)', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow(500000)] })
    useSavingsStore.setState({
      savingsGoals: [
        savingsRow({ id: 'manual-1', allocationMode: 'manual', monthlyAllocation: -5000 }),
      ],
    })
    renderWithProviders(<SavingsPage />)
    // Row shows 0.00 (matching the solver's Math.max(0, …) clamp), never "-50.00".
    const manual = screen.getByTestId('savings-allocation-manual-1')
    expect(manual).toHaveTextContent(/0\.00/)
    expect(manual).not.toHaveTextContent(/-/)
  })
})
