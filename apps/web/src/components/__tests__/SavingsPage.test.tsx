import {
  assertHasFocusRing,
  assertHasMobileTapTarget,
  assertIsIconOnlyAction,
  collectRetiredTokenViolations,
} from '@/test/responsive-table-tokens'
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
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

/**
 * Money-input sanitization (story 28-1, FR46).
 *
 * All three money fields on this page route through the shared core
 * `sanitizeMoneyInput` helper; these prove the wiring (AC-3).
 */
describe('SavingsPage money inputs reject non-numeric characters', () => {
  beforeEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  it('strips garbage from the target amount but keeps the grouped number', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const targetInput = screen.getByTestId('savings-target-amount-input')
    fireEvent.change(targetInput, { target: { value: 'about $5,000.00 total' } })

    expect(targetInput).toHaveValue('5,000.00')
  })

  it('never lets a typed letter into the current balance field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const balanceInput = screen.getByTestId('savings-current-balance-input')
    await user.type(balanceInput, '9abc9')

    expect(balanceInput).toHaveValue('99')
  })

  it('leaves the goal name field free to accept letters', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const nameInput = screen.getByTestId('savings-name-input')
    await user.type(nameInput, 'Emergency Fund')

    expect(nameInput).toHaveValue('Emergency Fund')
  })
})

/**
 * Visible focus indicator (story 28-1, AC-7).
 *
 * `focus:outline-none` with a ring COLOUR but no `focus:ring-2` WIDTH paints
 * nothing — keyboard users get no focus indicator. Third recurrence of this
 * defect class (Epics 15 and 24), so all four of this page's affected controls
 * carry a structural guard, asserted by class-TOKEN membership (a substring check
 * for "focus:ring-2" also matches "focus:ring-2xl").
 */
describe('SavingsPage form controls have a visible focus ring', () => {
  beforeEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  it('every control that kills the native outline restores a 2px ring', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    // The allocation amount field only renders in manual mode (story 26.1).
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')

    const controls = [
      screen.getByTestId('savings-name-input'),
      screen.getByTestId('savings-target-amount-input'),
      screen.getByTestId('savings-current-balance-input'),
      screen.getByTestId('savings-monthly-allocation-input'),
    ]

    let checked = 0
    for (const control of controls) {
      const tokens = control.className.split(/\s+/)
      expect(tokens, `${control.id} no longer kills the native outline`).toContain(
        'focus:outline-none'
      )
      expect(tokens, `${control.id} has no visible focus ring`).toContain('focus:ring-2')
      checked++
    }
    expect(checked).toBe(controls.length)
  })
})

/**
 * Mobile card presentation (story 31.2, UX-DR36).
 *
 * See `IncomePage.test.tsx` for the full rationale. Savings is the one table
 * with a cell that must STACK rather than sit label-left/value-right: the
 * progress bar is full-width.
 */
describe('SavingsPage mobile card presentation (story 31.2)', () => {
  const ISO_31_2 = '2026-01-01T00:00:00.000Z'

  beforeEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({ entries: [] })
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'goal-1',
          name: 'Vacation',
          targetAmount: 400000,
          currentBalance: 100000,
          allocationMode: 'manual',
          monthlyAllocation: 25000,
          createdAt: ISO_31_2,
          updatedAt: ISO_31_2,
        },
        {
          // Account row: null target ⇒ "No target" + an absent (N/A) progress.
          id: 'acct-1',
          name: 'Buffer',
          targetAmount: null,
          currentBalance: 50000,
          allocationMode: 'manual',
          monthlyAllocation: 0,
          createdAt: ISO_31_2,
          updatedAt: ISO_31_2,
        },
      ],
    })
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({ entries: [] })
  })

  function rowFor(name: string): HTMLElement {
    const row = screen.getByText(name).closest('tr')
    if (!row) throw new Error(`no <tr> ancestor for "${name}"`)
    return row as HTMLElement
  }

  it('carries every column value and both derived badges on the card', () => {
    renderWithProviders(<SavingsPage />)
    const row = rowFor('Vacation')

    expect(within(row).getByText('4,000.00')).toBeInTheDocument()
    expect(within(row).getByText('1,000.00')).toBeInTheDocument()
    expect(within(row).getByTestId('savings-badge-goal-1')).toHaveTextContent('Goal')
    expect(within(row).getByTestId('savings-allocation-goal-1')).toHaveTextContent('250.00')
    expect(within(row).getByTestId('savings-allocation-mode-goal-1')).toHaveTextContent('Fixed')
    expect(within(row).getByText('25%')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Edit Vacation' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete Vacation' })).toBeInTheDocument()
  })

  it('keeps the account row’s absent-target and absent-progress states', () => {
    renderWithProviders(<SavingsPage />)
    const row = rowFor('Buffer')

    expect(within(row).getByTestId('savings-badge-acct-1')).toHaveTextContent('Account')
    expect(within(row).getByText('No target')).toBeInTheDocument()
    expect(within(row).getByTestId('savings-progress-na-acct-1')).toHaveTextContent('N/A')
  })

  it('labels every field on the card (AC-4)', () => {
    renderWithProviders(<SavingsPage />)
    const row = rowFor('Vacation')

    for (const label of [
      'Name',
      'Target',
      'Current Balance',
      'Monthly Allocation',
      'Progress',
      'Actions',
    ]) {
      expect(within(row).getByText(label)).toBeInTheDocument()
      expect([...within(row).getByText(label).classList]).toContain('sm:hidden')
    }
  })

  it('declares a stacked progress cell rather than label-left/value-right', () => {
    renderWithProviders(<SavingsPage />)
    const progressCell = within(rowFor('Vacation'))
      .getByText('Progress')
      .closest('td') as HTMLElement

    expect([...progressCell.classList]).toContain('max-sm:block')
    // A flex row would squeeze the full-width bar into ~150px at 320px.
    expect([...progressCell.classList]).not.toContain('max-sm:flex')
  })

  it('has exactly one table in the DOM — no dual-rendered card list', () => {
    const { container } = renderWithProviders(<SavingsPage />)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(screen.getAllByText('Vacation')).toHaveLength(1)
  })

  it('declares the shared card classes on the table, body and rows (AC-8)', () => {
    const { container } = renderWithProviders(<SavingsPage />)
    const table = container.querySelector('table') as HTMLElement

    expect([...table.classList]).toContain('max-sm:block')
    expect([...(table.querySelector('thead') as HTMLElement).classList]).toContain('max-sm:hidden')
    expect([...(table.querySelector('tbody') as HTMLElement).classList]).toContain('max-sm:block')
    expect([...rowFor('Vacation').classList]).toContain('max-sm:block')
  })

  it('every row Edit/Delete button carries a focus ring with a colour (AC-5)', () => {
    renderWithProviders(<SavingsPage />)
    const row = rowFor('Vacation')
    for (const label of ['Edit Vacation', 'Delete Vacation']) {
      assertHasFocusRing(within(row).getByRole('button', { name: label }), label)
    }
  })

  it('declares a >= 44px mobile tap target on each row action, scoped to max-sm (AC-6)', () => {
    renderWithProviders(<SavingsPage />)
    const row = rowFor('Vacation')
    for (const label of ['Edit Vacation', 'Delete Vacation']) {
      assertHasMobileTapTarget(within(row).getByRole('button', { name: label }), label)
    }
  })

  /**
   * Story 48.2 (AC-1, AC-15) — the actions cell offers EXACTLY Edit and Delete.
   *
   * ⚠️ AN EXACT ARRAY, NOT `queryByRole(/^Move /) -> toBeNull()`. Story 48.2
   * DELETES `RowMoveControls`, and an absence assertion about a deleted component
   * is vacuous by construction: it passes for the same reason whether the removal
   * was done correctly or the render broke entirely. Enumerating what IS offered
   * fails on a re-added arrow AND on a lost Edit/Delete button, so it is
   * falsifiable in both directions (mutation arm M1).
   */
  it('offers exactly Edit and Delete in a row action cell (48.2 AC-1, AC-15)', () => {
    renderWithProviders(<SavingsPage />)
    const cell = rowFor('Vacation').querySelector('td:last-child') as HTMLElement
    expect(
      within(cell)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Edit Vacation', 'Delete Vacation'])
  })

  /**
   * Story 50.1 (AC-1, AC-3, AC-9) — the row actions are ICONS now.
   *
   * ⚠️ THE TEST DIRECTLY ABOVE CANNOT TELL. It reads `aria-label`, which 50.1
   * leaves byte-identical, so it stays green against a button that renders no
   * child at all — despite being titled "offers exactly Edit and Delete". It is
   * the right guard for the accessibility contract and the wrong one for what
   * the row SHOWS. This is the assertion that goes red.
   *
   * See `assertIsIconOnlyAction` for why both halves ship together and why
   * `aria-hidden` is pinned as an attribute rather than through the name.
   */
  it('renders each row action as an aria-hidden icon with no visible label (50.1 AC-1, AC-3, AC-9)', () => {
    renderWithProviders(<SavingsPage />)
    const cell = rowFor('Vacation').querySelector('td:last-child') as HTMLElement
    const geometry = ['Edit Vacation', 'Delete Vacation'].map((label) =>
      assertIsIconOnlyAction(within(cell).getByRole('button', { name: label }), label)
    )
    // ⚠️ EDIT AND DELETE MUST BE DIFFERENT GLYPHS, AND NOTHING ELSE CHECKS THAT.
    // Both icons are `h-5 w-5` `aria-hidden` SVGs from the same module, so pasting
    // `<TrashIcon>` into the Edit slot — the likeliest slip across four copy-pasted
    // call sites — leaves the accessible names, the empty textContent, the icon
    // count, the rendered box and every width baseline untouched. Copied from
    // `SortableColumnHeader.test.tsx`, which pins asc vs desc the same way and says
    // why: "the two states would be visually identical and only a screen reader
    // could tell them apart".
    expect(geometry[0], 'Edit and Delete render the same glyph').not.toBe(geometry[1])
  })

  it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
    const { container } = renderWithProviders(<SavingsPage />)
    const table = container.querySelector('table') as HTMLElement
    expect(collectRetiredTokenViolations(table)).toEqual([])
  })
})

/**
 * Column sorting (Story 34.2, FR61).
 *
 * ⚠️ Written per page rather than once over a table of four: four independent
 * page components, four hand-rolled `<thead>`s, four extractor sets. 30-4b, 33.3
 * and 34.1b each shipped (or nearly shipped) a HIGH by testing one surface and
 * assuming its siblings.
 *
 * ⚠️ NEITHER money column here is frequency-normalized, and that is the subject
 * of a test rather than an omission. A savings balance is a point-in-time STOCK,
 * not a per-period flow (story 32.1 / FR58), and `ClientSavingsGoal` carries no
 * `frequency` field to normalize by.
 */
describe('SavingsPage — sort by column (34.2)', () => {
  /**
   * manual (insertion):  Zeta, Alpha, Mid, Beta
   * by name:             Alpha, Beta, Mid, Zeta
   * by current balance:  Zeta(300) Mid(300) Alpha(500) Beta(800)   <- Zeta/Mid TIE
   * by target:           Beta(200) Mid(400) Zeta(900) Alpha(null)
   * by progress:         Zeta(33) Mid(75) Beta(100) Alpha(null)
   *
   * Zeta and Mid tie on Current Balance while sitting in a known manual order,
   * and the balance order differs from the manual order — so a comparator that
   * silently degraded to "manual order" (which is what routing this column
   * through the normalized path would produce) cannot pass.
   */
  const SEED = [
    { name: 'Zeta', targetAmount: 900_00, currentBalance: 300_00 },
    { name: 'Alpha', targetAmount: null, currentBalance: 500_00 },
    { name: 'Mid', targetAmount: 400_00, currentBalance: 300_00 },
    { name: 'Beta', targetAmount: 200_00, currentBalance: 800_00 },
  ]
  const MANUAL_ORDER = ['Zeta', 'Alpha', 'Mid', 'Beta']

  function seedRows() {
    useSavingsStore.setState({ savingsGoals: [] })
    // Distinct createdAt per row — rows added inside one millisecond tie on the
    // secondary manual key, and a stable sort can then make an ordering
    // assertion pass by accident (34.1a M10, 34.1b M6).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const goal of SEED) {
      useSavingsStore.getState().addSavingsGoal(goal)
      vi.advanceTimersByTime(1000)
    }
    vi.useRealTimers()
  }

  /** Row names top to bottom. The name cell also carries a Goal/Account badge,
   * so the seeded name is matched rather than the whole cell's text. */
  function renderedOrder(): string[] {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => SEED.map((s) => s.name).find((n) => within(row).queryByText(n)) ?? '')
  }

  function header(name: string): HTMLElement {
    return screen.getByRole('columnheader', { name })
  }

  beforeEach(() => {
    seedRows()
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  it('renders in MANUAL order until a header is activated', () => {
    renderWithProviders(<SavingsPage />)
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
  })

  it('offers exactly the sortable columns, and Actions is not one of them', () => {
    renderWithProviders(<SavingsPage />)
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())).toEqual([
      'Name',
      'Target',
      'Current Balance',
      'Monthly Allocation',
      'Progress',
      'Actions',
    ])
    for (const name of ['Name', 'Target', 'Current Balance', 'Monthly Allocation', 'Progress']) {
      expect(within(header(name)).getByRole('button', { name })).toBeInTheDocument()
      expect(header(name)).toHaveAttribute('aria-sort', 'none')
    }
    const actions = header('Actions')
    expect(within(actions).queryByRole('button')).toBeNull()
    expect(actions).not.toHaveAttribute('aria-sort')
  })

  it('cycles a column ascending -> descending -> back to manual order', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    const button = () => within(header('Name')).getByRole('button', { name: 'Name' })

    await user.click(button())
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
    expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])
    await user.click(button())
    expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])
    await user.click(button())
    expect(header('Name')).toHaveAttribute('aria-sort', 'none')
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
  })

  it('sorts Current Balance by the RAW stored value, with ties falling back to manual order', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(
      within(header('Current Balance')).getByRole('button', { name: 'Current Balance' })
    )
    // Zeta and Mid tie at 300_00 and keep their manual relative order.
    expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Alpha', 'Beta'])
    await user.click(
      within(header('Current Balance')).getByRole('button', { name: 'Current Balance' })
    )
    // Descending flips the distinct values but NOT the tied pair.
    expect(renderedOrder()).toEqual(['Beta', 'Alpha', 'Zeta', 'Mid'])
  })

  it('places a goal with no target last under Target, in both directions', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    const button = () => within(header('Target')).getByRole('button', { name: 'Target' })
    await user.click(button())
    expect(renderedOrder()).toEqual(['Beta', 'Mid', 'Zeta', 'Alpha'])
    await user.click(button())
    // 'Alpha' has no target — absent, not smallest, so it stays last.
    expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])
  })

  it('places absent Progress last', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(within(header('Progress')).getByRole('button', { name: 'Progress' }))
    expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])
  })

  it('keeps at most one column active', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(within(header('Target')).getByRole('button', { name: 'Target' }))
    expect(header('Target')).toHaveAttribute('aria-sort', 'ascending')
    await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
    expect(header('Target')).toHaveAttribute('aria-sort', 'none')
  })

  it('keeps focus on the header the user activated', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
    expect(renderedOrder()).not.toEqual(MANUAL_ORDER)
    expect(within(header('Name')).getByRole('button', { name: 'Name' })).toHaveFocus()
  })

  /**
   * The mobile sort control (story 48.1, UX-DR53).
   *
   * ⚠️ This block REPLACES the old "shows the mobile escape hatch only while a
   * sort is active" test, and the replacement is the point. `TableSortNotice`
   * rendered nothing while a table was in manual order, because a sort could
   * only be STARTED at >= 640px (34.2, ratified decision 1). Manual order is
   * exactly the state a phone user needs a control in — it is how they start
   * one — so the control now renders unconditionally and the old assertion
   * would be asserting the opposite of the requirement.
   */
  function sortControl(): HTMLSelectElement {
    return screen.getByRole('combobox', {
      name: 'Sort savings goals and accounts',
    }) as HTMLSelectElement
  }

  it('offers the mobile sort control whether or not a sort is active (48.1 AC-1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    // Present in MANUAL order — the state the old escape hatch rendered nothing in.
    expect(sortControl()).toBeInTheDocument()
    expect(sortControl().value).toBe('manual')

    await user.selectOptions(sortControl(), 'name:asc')
    // And still present once a sort is active, now reporting it.
    expect(sortControl().value).toBe('name:asc')
  })

  it('sorts from the mobile control and drives the SAME state as the headers (48.1 AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    // ⚠️ DESCENDING, chosen directly. Ascending alone cannot tell a `select`
    // from a `toggle`, and name-descending differs from BOTH the manual order
    // and the ascending order for this seed — an order assertion that happened
    // to match one of them could not fail.
    await user.selectOptions(sortControl(), 'name:desc')
    expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

    // ⚠️ THE SINGLE-SOURCE-OF-TRUTH CLAIM. A control wired to its own state
    // would reorder the rows and leave this header reporting `none`.
    expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
  })

  it('returns to manual order from the mobile control (48.1 AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.selectOptions(sortControl(), 'name:desc')
    expect(renderedOrder()).not.toEqual(MANUAL_ORDER)

    await user.selectOptions(sortControl(), 'manual')
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
    expect(header('Name')).toHaveAttribute('aria-sort', 'none')
  })

  it('adds no retired colour tokens to the header row', () => {
    renderWithProviders(<SavingsPage />)
    const table = screen.getAllByRole('table')[0] as HTMLElement
    expect(collectRetiredTokenViolations(table)).toEqual([])
  })

  it('enqueues NOTHING on a PAID session — sorting is read-only over the store (AC-8)', async () => {
    // ⚠️ REGISTERED, not left unregistered. A spy handed to nobody can never be
    // called, so `not.toHaveBeenCalled()` could not fail — the tautology story
    // 34.1b's review caught in the sibling store suite. Registering proves these
    // exact spies are reachable from the code under test.
    //
    // ⚠️ And PAID, not free: `deferred-work.md:822-832` records a mutation that
    // passed 1525 green tests because every test in the suite ran under one tier.
    // Sorting must be inert on the tier that actually has a sync path.
    const spies = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      queueCreate: vi.fn(async () => {}),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    }
    registerSyncBridge(spies)
    try {
      const user = userEvent.setup()
      renderWithProviders(<SavingsPage />)
      const before = useSavingsStore.getState().savingsGoals.map((row) => [row.id, row.sortOrder])

      const button = () => within(header('Target')).getByRole('button', { name: 'Target' })
      await user.click(button())
      await user.click(button())
      await user.click(button())

      expect(spies.queueUpdate).not.toHaveBeenCalled()
      expect(spies.queueCreate).not.toHaveBeenCalled()
      expect(spies.queueDelete).not.toHaveBeenCalled()
      // And the persisted order itself is byte-identical — no `sortOrder` write.
      expect(useSavingsStore.getState().savingsGoals.map((row) => [row.id, row.sortOrder])).toEqual(
        before
      )
    } finally {
      clearSyncBridge()
    }
  })

  it('places a goal added under an active sort in its SORTED position, not at the bottom', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))

    await act(async () => {
      useSavingsStore
        .getState()
        .addSavingsGoal({ name: 'Bravo', targetAmount: 100_00, currentBalance: 0 })
    })

    const names = [...SEED.map((g) => g.name), 'Bravo']
    const rendered = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => names.find((n) => within(row).queryByText(n)) ?? '')
    expect(rendered).toEqual(['Alpha', 'Beta', 'Bravo', 'Mid', 'Zeta'])
    // The MANUAL order still appends it at the bottom — sorting never writes.
    expect(useSavingsStore.getState().savingsGoals.map((g) => g.name)).toEqual([
      ...MANUAL_ORDER,
      'Bravo',
    ])
  })

  it('MOVES each row node rather than relabelling positions (rows keyed by id)', async () => {
    // ⚠️ Replicated per page deliberately: this is the only assertion that fails
    // under `key={index}`, and a regression on one page passes every other suite.
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    const before = screen.getByRole('button', { name: 'Edit Zeta' })
    await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
    expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])
    expect(screen.getByRole('button', { name: 'Edit Zeta' })).toBe(before)
  })

  it('gives every sortable header the standard focus ring', () => {
    renderWithProviders(<SavingsPage />)
    // ⚠️ ENUMERATED, not grepped — a control missing from this array is silently
    // uncovered.
    for (const name of ['Name', 'Target', 'Current Balance', 'Monthly Allocation', 'Progress']) {
      assertHasFocusRing(within(header(name)).getByRole('button', { name }), name)
    }
  })
})

/**
 * Page structure after the Savings at a Glance chart was removed (story 51.1, FR76).
 *
 * ⚠️ This is the RE-HOMED half of the deleted `SavingsPage chart section` block. Its
 * predecessor asserted `main > section` had length 3 with the chart at index 1, and it was
 * the ONLY structural pin on this page anywhere in the repo — unit or e2e. Deleting the
 * chart block wholesale would have left AC-1 ("the page reads summary → leftover breakdown
 * → goals table") with nothing testing it at all, which is exactly what story 43.1's own
 * AC warned about: *a spec that silently stops covering anything is worse than one that
 * fails.* The weaker assertion that would have passed is "no chart testid is present" —
 * true of a page that renders nothing.
 *
 * ⚠️ So the absence pins below never ship alone: they are paired with a positive pin on the
 * exact COUNT and the IDENTITY of the two surviving sections. 48.1's lesson is that
 * deleting a component makes every absence assertion vacuous rather than red.
 */
describe('SavingsPage — page structure (story 51.1)', () => {
  const NOW = '2026-01-01T00:00:00.000Z'
  const goal = (id: string, name: string, currentBalance: number, targetAmount: number | null) => ({
    id,
    name,
    targetAmount,
    currentBalance,
    createdAt: NOW,
    updatedAt: NOW,
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
  })

  it('renders exactly two sections — the summary and then the goals table (AC-1, AC-2)', () => {
    useSavingsStore.setState({ savingsGoals: [goal('a', 'Vacation', 300_00, 900_00)] })
    const { container } = renderWithProviders(<SavingsPage />)

    const sections = [...container.querySelectorAll('main > section')]
    expect(sections).toHaveLength(2)
    // Identified by content that belongs to each, never by index alone — an index-only
    // pin still passes if the two sections swap places.
    expect(sections[0]).toContainElement(screen.getByTestId('savings-leftover-summary'))
    // Identity, not just "a table exists somewhere in it".
    expect(sections[1]).toContainElement(
      screen.getByRole('heading', { name: 'Your Savings Goals' })
    )
    expect(sections[1].querySelector('table')).not.toBeNull()
  })

  // ⚠️ RE-HOMED from `SavingsChart.error-boundary.test.tsx`, which is deleted with the
  // chart. That suite's subject was "the ErrorBoundary contains a chart crash", but the
  // arm proving containment also asserted these three headings and the add-goal flow —
  // and a repo-wide grep at deletion time found NO other test asserting any of them.
  // The add-goal flow is covered ~12× elsewhere in this file; the headings were not
  // covered anywhere at all, so they are pinned here rather than quietly lost (AC-18).
  it('still renders its three headings and an interactive add-goal control (AC-18)', async () => {
    const user = userEvent.setup()
    useSavingsStore.setState({ savingsGoals: [goal('a', 'Vacation', 300_00, 900_00)] })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByRole('heading', { name: 'Savings Goals' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Total Savings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your Savings Goals' })).toBeInTheDocument()
    expect(screen.getByText('Vacation')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // ⚠️ RE-HOMED from `SavingsPage.chart-contract.test.tsx`, deleted with the chart.
  // That suite's stated subject was what the PAGE HANDS THE CHART; the page's own
  // headline total was by-catch in `it('plots balances that sum to the page total')`,
  // and it was the ONLY assertion on that figure's value anywhere in the repo.
  // The figure carries no `data-testid` (deliberately — see `SavingsPage.tsx:520-526`,
  // whose own comment warns "a testid-shaped sweep would have shipped without it"), so
  // no e2e can reach it either. Without this, `formatAmount(totalSavings)` could be
  // changed to `formatAmount(0)` and the whole suite would stay green.
  // ⚠️ No `$`: `vitest.setup.ts` forces `{mode:'none', currency:'NONE'}`, so the unit
  // suite renders amounts currency-less. A unit assertion on a symbol proves nothing.
  it('renders the summed Total Savings headline figure (AC-18)', () => {
    useSavingsStore.setState({
      savingsGoals: [goal('a', 'Vacation', 300_00, 900_00), goal('b', 'Roof', 1_050_00, null)],
    })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByRole('heading', { name: 'Total Savings' })).toBeInTheDocument()
    expect(screen.getByText('1,350.00')).toBeInTheDocument()
  })

  it('renders no Savings at a Glance section, heading or chart testid (AC-1, AC-6)', () => {
    useSavingsStore.setState({ savingsGoals: [goal('a', 'Vacation', 300_00, 900_00)] })
    renderWithProviders(<SavingsPage />)

    // ⚠️ POSITIVE ANCHOR FIRST. Five `queryBy* -> toBeNull()` assertions in a row all
    // pass against a page that rendered nothing at all, and two of them
    // (`savings-chart-skeleton`, `savings-chart-empty`) sit on branches this fixture
    // cannot reach even if the chart came back — hydrated, with one goal. So the
    // absences are anchored to a render this test proves actually happened.
    expect(screen.getByRole('heading', { name: 'Your Savings Goals' })).toBeInTheDocument()
    expect(screen.queryByTestId('savings-chart-section')).toBeNull()
    expect(screen.queryByTestId('savings-chart')).toBeNull()
    expect(screen.queryByTestId('savings-chart-empty')).toBeNull()
    expect(screen.queryByTestId('savings-chart-skeleton')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Savings at a Glance' })).toBeNull()
  })
})

describe('SavingsPage — an asset never feeds the distributable pool (Story 43.4, D2)', () => {
  const ISO2 = '2026-01-01T00:00:00.000Z'
  const assetRow = (monthlyContribution: number, id = 'asset-1') => ({
    id,
    type: 'asset' as const,
    name: 'Condo',
    currentBalance: 40_000_000,
    monthlyContribution,
    frequency: 'monthly' as const,
    createdAt: ISO2,
    updatedAt: ISO2,
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  it('excludes an asset row from investmentContributions, with or without a contribution', () => {
    // ⚠️ This test exists because `SavingsPage.tsx` CLAIMED it existed before it
    // did. The claim was found by review; the comment pointed at coverage that had
    // never been written.
    //
    // The pool filter is `type === 'investment'`, so an asset is excluded either
    // way. The anomalous case is the second one: a contribution on an asset is
    // money being set aside that the pool never deducts. `validateBalanceTracking`
    // now REJECTS that on every store write path — but `applyServerChanges` writes
    // pulled rows in without validation, so it stays reachable from sync.
    useBalanceStore.setState({ entries: [assetRow(0)] })
    const zeroContribution = useBalanceStore
      .getState()
      .entries.filter((e) => e.type === 'investment')
    expect(zeroContribution).toHaveLength(0)

    useBalanceStore.setState({ entries: [assetRow(50_000)] })
    const withContribution = useBalanceStore
      .getState()
      .entries.filter((e) => e.type === 'investment')
    expect(withContribution).toHaveLength(0)
  })

  it('rejects an asset carrying a contribution at the store write path', () => {
    // The layer that actually closes the hole for user- and API-driven writes.
    useBalanceStore.setState({ entries: [] })
    const created = useBalanceStore.getState().addBalanceEntry({
      type: 'asset',
      name: 'Condo',
      currentBalance: 40_000_000,
      monthlyContribution: 50_000,
      frequency: 'monthly',
    })
    expect(created).toBeNull()
    expect(useBalanceStore.getState().entries).toHaveLength(0)
  })
})

/**
 * Story 45.1 (FR72) — the leftover breakdown, its inline toggles, and the
 * detector's decorative highlight.
 */
describe('SavingsPage — leftover breakdown and the FR72 fix (Story 45.1)', () => {
  const ISO = '2026-01-01T00:00:00.000Z'

  const incomeRow = (amount: number, id = 'inc-1') => ({
    id,
    userId: 0,
    name: 'Salary',
    amount,
    frequency: 'monthly' as const,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const expenseRow = (amount: number, name: string, id = 'exp-1') => ({
    id,
    userId: 0,
    name,
    amount,
    frequency: 'monthly' as const,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const investmentRow = (
    monthlyContribution: number,
    name = 'TFSA',
    id = 'inv-1',
    contributionRecordedAsExpense?: boolean
  ) => ({
    id,
    type: 'investment' as const,
    name,
    currentBalance: 0,
    monthlyContribution,
    frequency: 'monthly' as const,
    contributionRecordedAsExpense,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const autoGoal = (id: string) => ({
    id,
    name: id,
    targetAmount: null,
    currentBalance: 0,
    allocationMode: 'automatic' as const,
    monthlyAllocation: null,
    createdAt: ISO,
    updatedAt: ISO,
  })

  const resetStores = () => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({ entries: [] })
    useSavingsStore.setState({ savingsGoals: [] })
  }

  /** The FR72 reproduction: $3,000 income, a $500 TFSA expense AND a $500 TFSA row. */
  const seedReproduction = (recordedAsExpense?: boolean) => {
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(50_000, 'TFSA contribution')] })
    useBalanceStore.setState({
      entries: [investmentRow(50_000, 'TFSA', 'inv-1', recordedAsExpense)],
    })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
  }

  /**
   * The breakdown is collapsed by default and its body is NOT in the DOM until
   * opened — deliberately, so /savings does not publish every balance-entry name
   * as hidden text (it broke nine responsive-320 e2e specs when it did). Every
   * assertion about breakdown contents must therefore open it first.
   */
  const openBreakdown = () => {
    fireEvent.click(screen.getByRole('button', { name: 'How is this worked out?' }))
  }

  beforeEach(resetStores)
  afterEach(resetStores)

  it('keeps the breakdown body OUT of the DOM until it is opened', () => {
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    // ⚠️ The regression guard for the e2e break: a collapsed <details> still
    // renders its children, so this must assert ABSENCE, not invisibility.
    expect(screen.queryByTestId('breakdown-contribution-inv-1')).not.toBeInTheDocument()
    expect(screen.queryByText('TFSA')).not.toBeInTheDocument()
    openBreakdown()
    expect(screen.getByTestId('breakdown-contribution-inv-1')).toBeInTheDocument()
  })

  it('AC-8(a): the breakdown itemises each contribution (story 47.1: no toggle)', () => {
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    expect(screen.getByTestId('savings-leftover-breakdown')).toBeInTheDocument()
    expect(screen.getByTestId('breakdown-contribution-inv-1')).toHaveTextContent(/TFSA/)
    expect(screen.getByTestId('breakdown-contribution-amount-inv-1')).toHaveTextContent(/500\.00/)
    // Story 47.1 removed the per-line toggle. An UNFLAGGED row shows no excluded
    // note. (The strike-through contrast is asserted in the multi-row test below,
    // which has both a flagged and an unflagged row to compare.)
    expect(screen.queryByTestId('breakdown-toggle-inv-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('breakdown-contribution-inv-1')).not.toHaveTextContent(
      /already accounted for/i
    )
  })

  it('AC-8(c): the breakdown arithmetic matches the pool it explains', () => {
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    // ⚠️ Asserted as a RELATION between rendered values, not against a constant:
    // a hard-coded total passes when the breakdown and the pool are wrong together.
    const cents = (testId: string) => {
      const text = screen.getByTestId(testId).textContent ?? ''
      const digits = text.replace(/[^0-9.]/g, '')
      return Math.round(Number.parseFloat(digits) * 100)
    }
    const income = cents('breakdown-income')
    const expenses = cents('breakdown-expenses')
    const contributions = cents('breakdown-contributions')
    const manual = cents('breakdown-manual')
    const leftover = cents('breakdown-leftover')

    expect(income - expenses - contributions - manual).toBe(leftover)
    // And the stated leftover is the SAME figure the summary sentence shows.
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,000\.00/)
    expect(leftover).toBe(200_000)
  })

  it('AC-8(c): the breakdown RECONCILES when the pool clamps to zero', () => {
    // ⚠️ Found by the code-review Blind Hunter, from the diff alone. The four
    // displayed lines are a plain subtraction; `distributablePool` floors at 0.
    // Over-committed, the page showed "1,000.00 − 2,000.00" directly above a
    // "Left over" of "0.00" — numbers that visibly do not add up, in the one
    // affordance whose whole purpose is to make the figure auditable.
    // ⚠️ The original AC-8(c) test used only a POSITIVE-pool fixture, so it
    // could not fail in the clamp case. This is that missing arm.
    useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(200_000, 'Rent')] })
    useBalanceStore.setState({ entries: [] })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    const cents = (testId: string) => {
      const text = screen.getByTestId(testId).textContent ?? ''
      const digits = text.replace(/[^0-9.]/g, '')
      return Math.round(Number.parseFloat(digits) * 100)
    }

    // The subtraction the four lines perform is shown explicitly...
    expect(cents('breakdown-income') - cents('breakdown-expenses')).toBe(-100_000)
    expect(cents('breakdown-raw')).toBe(100_000) // rendered as −$1,000.00
    // ...and the floor is shown as its own line rather than happening invisibly.
    expect(screen.getByTestId('breakdown-clamp')).toHaveTextContent(/1,000\.00/)
    expect(cents('breakdown-leftover')).toBe(0)
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/0\.00/)
  })

  it('AC-8(c): no clamp rows appear when the pool is positive', () => {
    // Acceptance partner: the clamp rows must be ABSENT in the ordinary case,
    // so the guard above cannot pass by rendering them unconditionally.
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    openBreakdown()
    expect(screen.queryByTestId('breakdown-raw')).not.toBeInTheDocument()
    expect(screen.queryByTestId('breakdown-clamp')).not.toBeInTheDocument()
  })

  it('AC-8(c): a corrupt manual allocation does not render NaN in the breakdown', () => {
    // ⚠️ The solver guards with `Number.isFinite`; the breakdown used `?? 0`,
    // which does NOT intercept NaN. The two then disagreed and the page printed
    // a broken figure while "Left over" stayed correct.
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({ entries: [] })
    useSavingsStore.setState({
      savingsGoals: [
        {
          ...autoGoal('manual-1'),
          allocationMode: 'manual' as const,
          monthlyAllocation: Number.NaN,
        },
        autoGoal('auto-1'),
      ],
    })
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    expect(screen.getByTestId('breakdown-manual')).not.toHaveTextContent(/NaN/)
    expect(screen.getByTestId('breakdown-leftover')).not.toHaveTextContent(/NaN/)
    // Corrupt manual amount counts as 0 in BOTH paths, so they still reconcile.
    expect(screen.getByTestId('breakdown-leftover')).toHaveTextContent(/3,000\.00/)
    expect(screen.queryByTestId('breakdown-raw')).not.toBeInTheDocument()
  })

  // ⚠️ Story 47.1 (FR73) DELETED two tests that lived here:
  //   - 'AC-1 via the UI: ticking the inline toggle stops the double deduction'
  //   - 'AC-8(a): the breakdown toggle and the Balance form reach the SAME number'
  // Both drove the flag through the breakdown's per-line checkbox, which 47.1
  // removes. They are NOT silently dropped: the flagged-row → $2,500 assertion they
  // uniquely held now lives in `contribution-flag-cross-page.test.tsx`, which drives
  // the SAME property through the Balance form instead — a stronger arrow, because
  // it crosses the two suites rather than staying inside this one.
  // ⚠️ Note what did NOT need replacing: `'excludes only the flagged row when
  // several contributions exist'` below is store-seeded and still asserts a flagged
  // row is skipped ($2,200). FR72's positive guard never left this file.

  it('AC-2 via the UI: an unflagged row still deducts twice (the different-money user)', () => {
    seedReproduction(false)
    renderWithProviders(<SavingsPage />)
    openBreakdown()
    // ⚠️ The regression fence. This "wrong-looking" $2,000 is CORRECT for a user
    // whose expense and contribution are different money, and epic AC-3 forbids
    // this story from moving it.
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,000\.00/)
  })

  it('AC-12: a same-amount, similar-name pair is HIGHLIGHTED', () => {
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    openBreakdown()
    expect(screen.getByTestId('breakdown-duplicate-hint-inv-1')).toHaveTextContent(
      /TFSA contribution/
    )
  })

  it('AC-6/D2 (47.1 review): a flagged row whose expense line SURVIVES is warned, not reassured', () => {
    // ⚠️⚠️ THE REGRESSION GUARD FOR A FIX THAT WAS DEAD CODE ON FIRST WRITE.
    // `findContributionDuplicateCandidates` skips `recordedAsExpense === true` rows,
    // so the excluded arm could never see a candidate and the first version of this
    // cue never rendered — every test passed straight through it. The component now
    // re-runs the detector with the flags cleared, purely for this cue.
    // Shape C: the user is payroll-deducted AND still lists the contribution on
    // Expenses, so ticking left them wrong by exactly the contribution.
    seedReproduction(true)
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    const cue = screen.getByTestId('breakdown-still-duplicated-inv-1')
    expect(cue).toHaveTextContent(/your\s+expense\s+“TFSA contribution”\s+still\s+subtracts\s+it/i)
    expect(cue).toHaveTextContent(/remove\s+that\s+expense\s+line/i)
    // It must NOT be the reassuring copy — that is the whole point of the branch.
    expect(screen.getByTestId('breakdown-contribution-inv-1')).not.toHaveTextContent(
      /you\s+marked\s+it\s+as\s+already\s+accounted\s+for/i
    )
  })

  it('AC-6/D3 (47.1 review): a flagged row with NO surviving expense gets the plain note and an undo pointer', () => {
    // No matching expense line, so the shape-C warning must NOT fire — this is the
    // negative fence that stops the cue rendering unconditionally.
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(12_345, 'Groceries')] })
    useBalanceStore.setState({ entries: [investmentRow(50_000, 'TFSA', 'inv-1', true)] })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    expect(screen.queryByTestId('breakdown-still-duplicated-inv-1')).not.toBeInTheDocument()
    const row = screen.getByTestId('breakdown-contribution-inv-1')
    expect(row).toHaveTextContent(/you\s+marked\s+it\s+as\s+already\s+accounted\s+for/i)
    // ⚠️ The undo pointer. Without it a user who ticked by mistake — the gross-income
    // shape-D case — sees the exclusion with nowhere to go.
    expect(row).toHaveTextContent(/Change\s+this\s+on\s+its\s+Balance\s+Tracking\s+entry/i)
  })

  it('AC-7 (story 47.1): the duplicate hint points at the control’s real home', () => {
    // The hint used to say "tick this", meaning the inline toggle. 47.1 deletes
    // that toggle, so the sentence would otherwise point at nothing.
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    openBreakdown()
    const hint = screen.getByTestId('breakdown-duplicate-hint-inv-1')

    // ⚠️ Distinguishing: it must NAME the control, not just the page. "Go to the
    // Balance Tracking page" leaves the user hunting for an unnamed checkbox.
    expect(hint.textContent).toMatch(
      /tick\s+“Not\s+taken\s+from\s+the\s+money\s+left\s+over”\s+on\s+its\s+Balance\s+Tracking\s+entry/i
    )
    expect(hint.textContent).not.toMatch(/tick\s+this/i)
  })

  it('AC-2 (story 47.1): /savings never says "net" — a page-wide ban is safe here', () => {
    // ⚠️ Unlike BalancePage, which needs a `net worth` carve-out for eight
    // legitimate hits, SavingsPage contains the word nowhere. Verified by grep at
    // baseline `fe3e574`, so the bare-word form is the honest guard here.
    seedReproduction()
    const { container } = renderWithProviders(<SavingsPage />)
    openBreakdown()
    expect(container.textContent).not.toMatch(/\bnet\b/i)
  })

  it('AC-12: a COINCIDENTAL same-amount match is not highlighted and moves no number', () => {
    // ⚠️ $500 rent and a $500 TFSA contribution match on amount and are unrelated.
    // Highlighting on amount alone would put weight on noise — story D7.
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(50_000, 'Rent')] })
    useBalanceStore.setState({ entries: [investmentRow(50_000, 'TFSA')] })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    expect(screen.queryByTestId('breakdown-duplicate-hint-inv-1')).not.toBeInTheDocument()
    // ...and the pool is untouched by the detector either way.
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,000\.00/)
  })

  it('AC-12: a highlighted pair the user never acts on leaves the pool alone', () => {
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    openBreakdown()
    expect(screen.getByTestId('breakdown-duplicate-hint-inv-1')).toBeInTheDocument()
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,000\.00/)
  })

  it('AC-8(c): an itemised line shows the NORMALIZED monthly value, not the raw amount', () => {
    // ⚠️ A non-monthly cadence is mandatory here. Every other fixture in this
    // describe is monthly, where raw === normalized, so a breakdown that printed
    // `monthlyContribution` verbatim would pass all of them. 11538c/wk × 52/12
    // = 49998.0 → 49998, which is visibly NOT 11538.
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({
      entries: [
        {
          ...investmentRow(11_538, 'TFSA', 'inv-1'),
          frequency: 'weekly' as const,
        },
      ],
    })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    expect(screen.getByTestId('breakdown-contribution-amount-inv-1')).toHaveTextContent(/499\.98/)
    expect(screen.getByTestId('breakdown-contribution-amount-inv-1')).not.toHaveTextContent(
      /115\.38/
    )
    // ...and the itemised line agrees with the "contributions counted" total.
    expect(screen.getByTestId('breakdown-contributions')).toHaveTextContent(/499\.98/)
    // 300000 − 49998 = 250002
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,500\.02/)
  })

  it('excludes only the flagged row when several contributions exist', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(50_000, 'TFSA contribution')] })
    useBalanceStore.setState({
      entries: [
        investmentRow(50_000, 'TFSA', 'inv-1', true),
        investmentRow(30_000, 'RRSP', 'inv-2', false),
      ],
    })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    // net 250000; skip 50000; deduct 30000 → 220000
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,200\.00/)
    // ⚠️ Code review: the deleted 'AC-1 via the UI' block uniquely asserted the
    // BREAKDOWN'S OWN totals in the flagged state, and the cross-page replacement
    // never opens the breakdown. Re-homed here so the panel's internal figures stay
    // pinned under exclusion, not just the page summary.
    expect(screen.getByTestId('breakdown-contributions')).toHaveTextContent(/300\.00/)
    expect(screen.getByTestId('breakdown-leftover')).toHaveTextContent(/2,200\.00/)
    // Story 47.1: the excluded row is marked by COPY and a strike-through, not a
    // checkbox. ⚠️ inv-1 is flagged AND its $500 matches the "TFSA contribution"
    // expense, so this is SHAPE C — the row still has a live duplicate and the
    // review-added warning arm renders instead of the plain excluded note.
    expect(screen.getByTestId('breakdown-still-duplicated-inv-1')).toHaveTextContent(
      /still\s+subtracts\s+it/i
    )
    expect(screen.getByTestId('breakdown-contribution-inv-2')).not.toHaveTextContent(
      /already\s+accounted\s+for/i
    )
    // AC-4: the strike-through is a class TOKEN, never a substring — a raw
    // `toContain('line-through')` would false-match a hypothetical `sm:line-through`.
    expect(
      screen.getByTestId('breakdown-contribution-amount-inv-1').className.split(/\s+/)
    ).toContain('line-through')
    expect(
      screen.getByTestId('breakdown-contribution-amount-inv-2').className.split(/\s+/)
    ).not.toContain('line-through')
  })
})

/**
 * Story 51.2 (UX-DR57) — the leftover breakdown's disclosure AFFORDANCE.
 *
 * ⚠️⚠️ WHY EVERY ASSERTION HERE IS WRITTEN FROM SCRATCH. Before this story the
 * control's ONLY reference anywhere in the repo was `openBreakdown()` in the
 * block above, which locates it by accessible name and clicks it. Sixteen
 * tests route through that helper and not one of them reads a class, a child
 * or a style; no e2e spec mentioned the control at all. **A restyle that
 * changed nothing would have shipped green across all 2411 unit and 355 e2e
 * tests** — measured, not assumed (mutation arm M1). There was nothing to
 * strengthen here, only something to build.
 *
 * ⚠️ `aria-hidden` IS PINNED AS AN ATTRIBUTE BECAUSE NOTHING ELSE CAN SEE IT —
 * and an earlier draft of this comment got the reason wrong, so the corrected
 * version is recorded here rather than quietly replaced. The draft claimed an
 * exposed `<svg>` "would append to the accessible name and break
 * `openBreakdown()`". **Mutation arm M4 refutes that**: deleting `aria-hidden`
 * reddens the attribute pin below and NOTHING else — all sixteen
 * `openBreakdown()` tests stay green, because an `<svg>` with no `<title>` and
 * no text content contributes nothing to the accessible name whether it is
 * hidden or not. `assertIsIconOnlyAction`'s docblock states the same mechanism
 * from the other direction. The consequence is the opposite of reassuring: the
 * name assertion is NOT a second witness for `aria-hidden`, so the attribute
 * pin is the only guard there is. Do not "simplify" it away.
 *
 * ⚠️ jsdom COMPUTES NO LAYOUT, so the checks below are class-token DECLARATION
 * checks and nothing more. The rendered floor is measured in
 * `e2e/responsive-320.spec.ts`. ⚠️ **The story predicted a mutation green here
 * and red there, and no such mutation exists** — arms M8 and M8b both came back
 * green on BOTH halves, because every token these tests pin is also one the
 * rendered box depends on, and the arbitrary-value CSS is emitted from
 * `ResponsiveTable.tsx`'s literal regardless of how this call site spells it.
 * What the e2e assertion adds is narrower: it proves the declared floor PAINTS.
 *
 * ⚠️ A LATER REVISION CORRECTS THE NUMBER THIS DOCBLOCK ONCE CITED. It said the
 * control measures "28px without the floor". That measurement dropped the floor
 * AND `inline-flex` together. Isolated, at 320px: floor only = **44px**,
 * `inline-flex` only = **16px**, neither = 28px. So the floor alone makes the
 * box, and the honest un-floored figure is **16px**.
 *
 * ⚠️ The retired-token sweep in this file is scoped to
 * `container.querySelector('table')` and this control is NOT in a table, so it
 * cannot police these classes (arm M11 is expected green). Widening that sweep
 * is not the fix: `SavingsPage.tsx:552`, an ancestor of this panel, already
 * carries `border-gray-200 dark:border-gray-700` — both blocklisted, both
 * pre-existing and sanctioned. Hence the explicit token pins below.
 */
describe('SavingsPage — leftover breakdown disclosure affordance (Story 51.2)', () => {
  const disclosure = () => screen.getByRole('button', { name: 'How is this worked out?' })
  const tokensOf = (el: Element) => [...el.classList]

  const resetAll = () => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({ entries: [] })
    useSavingsStore.setState({ savingsGoals: [] })
  }

  beforeEach(resetAll)
  afterEach(resetAll)

  // No seeding anywhere in this block, deliberately: the control renders behind
  // `hydrated` (`useStoresHydrated()`), which is data-independent, so the
  // affordance is present with empty stores. Seeding would imply the styling
  // depends on data, which it does not.

  it('reads as a control when closed — accent colour and a PERSISTENT underline (AC-1)', () => {
    renderWithProviders(<SavingsPage />)
    const tokens = tokensOf(disclosure())
    expect(tokens).toContain('text-accent')
    // PERSISTENT, not `hover:underline`: AC-1 requires the affordance without
    // hovering, and hover does not exist on touch (`global.css:102-107`).
    expect(tokens).toContain('underline')
    expect(tokens).not.toContain('hover:underline')
    // The caption colours this story exists to replace. ⚠️ `text-faint` is
    // 2.54:1 on the white `.surface` card and FAILS AA in light — but it is
    // pixel-identical to `text-muted` in DARK (both resolve to gray-400), so a
    // dark-mode screenshot review cannot catch a regression to it. Only this
    // token pin can. (Mutation arm M3.)
    expect(tokens).not.toContain('text-muted')
    expect(tokens).not.toContain('text-faint')
    // ⚠️ BOTH HOVER ARMS, because the pair is load-bearing in opposite themes
    // and the source docblock publishes 8.72:1 / 10.33:1 as measured fact.
    // Drop `dark:hover:text-blue-200` and dark hover falls through to
    // blue-800 `#1e40af` on gray-800 `#1f2937` = 1.68:1 — unreadable, and a
    // 1.4.3 failure that no other assertion in the repo would notice.
    expect(tokens).toContain('hover:text-blue-800')
    expect(tokens).toContain('dark:hover:text-blue-200')
  })

  it('does not take the weight of a primary action (AC-2)', () => {
    renderWithProviders(<SavingsPage />)
    const tokens = tokensOf(disclosure())
    expect(tokens).toContain('text-xs')
    // ⚠️ STRIP VARIANTS BEFORE MATCHING. A `^`-anchored test is blind to
    // exactly the prefixed forms this codebase uses everywhere else in the
    // same className — `hover:bg-blue-600`, `dark:bg-gray-700`,
    // `max-sm:bg-accent`, `sm:font-bold` would all sail past `/^bg-/` and
    // `/^font-/`. `responsive-table-tokens.ts:37-57` does the same stripping
    // for the same reason.
    const base = (t: string) => t.split(':').pop() ?? t
    const bases = tokens.map(base)
    expect(bases.filter((t) => /^bg-/.test(t))).toEqual([])
    expect(bases.filter((t) => /^shadow/.test(t))).toEqual([])
    expect(bases.filter((t) => /^font-(semibold|bold|extrabold|black)$/.test(t))).toEqual([])
    // AC-2's "no `px-4 py-2`-style button padding" clause, which had no
    // assertion at all. `p-1` is required by SC 2.5.8 at desktop widths (see
    // the source comment) and is not button weight; anything on the
    // px-4/py-2 scale is.
    expect(bases.filter((t) => /^p[xy]?-([2-9]|1[0-9])$/.test(t))).toEqual([])
  })

  it('leaves the element, its ARIA wiring and the conditional body untouched (AC-3)', () => {
    renderWithProviders(<SavingsPage />)
    const button = disclosure()
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-controls', 'savings-leftover-breakdown-body')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    // ⚠️ ABSENCE, not invisibility. The docblock above the control explains
    // why it is a <button> and not <details>/<summary>: a collapsed <summary>
    // still renders its children, and publishing every balance-entry name as
    // hidden text broke nine responsive-320 specs once already.
    expect(document.getElementById('savings-leftover-breakdown-body')).toBeNull()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('savings-leftover-breakdown-body')).not.toBeNull()
  })

  it('rotates its chevron to match breakdownOpen, asserted in BOTH states (AC-4)', () => {
    renderWithProviders(<SavingsPage />)
    const button = disclosure()
    // ⚠️ `getAttribute`/`classList`, never `.className.split()`. On an
    // SVGElement `className` is an SVGAnimatedString that stringifies to
    // "[object SVGAnimatedString]" — the exact blindness that made the retired-
    // token sweep unable to see any <svg> until story 50.1 exposed it.
    const chevron = () => button.querySelector('svg') as SVGElement
    expect(tokensOf(chevron())).not.toContain('rotate-180')
    fireEvent.click(button)
    expect(tokensOf(chevron())).toContain('rotate-180')
    // Closed again — a one-way pin would pass on a chevron hard-coded open.
    fireEvent.click(button)
    expect(tokensOf(chevron())).not.toContain('rotate-180')
  })

  it('hides the chevron from the accessible name and gives it real geometry (AC-5)', () => {
    renderWithProviders(<SavingsPage />)
    const button = disclosure()
    const icons = button.querySelectorAll('svg')
    expect(icons.length).toBe(1)
    const icon = icons[0]
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    // `currentColor` is load-bearing twice over: it inherits `.text-accent`, so
    // the glyph needs no colour of its own (which the table-scoped sweep could
    // not have policed), and it keeps the glyph's contrast identical to the
    // text's — 6.70:1 light, 8.14:1 dark, both clearing 1.4.11's 3:1.
    expect(icon.getAttribute('stroke')).toBe('currentColor')
    expect(icon.querySelector('path')?.getAttribute('d')).toBeTruthy()
    // ⚠️ AC-5 says "the button's ONLY non-text child", and `svg count === 1`
    // does not say that — a wrapper <span> or a second <img> satisfies it.
    // `assertIsIconOnlyAction`, the helper this block copies the presence half
    // of, asserts exactly these two.
    expect(button.children.length).toBe(1)
    expect(button.firstElementChild).toBe(icon)
    // ⚠️ SIZE. Neither the assertions above nor the e2e box check can see a
    // zero-sized glyph: jsdom computes no layout, and the Playwright test
    // measures the BUTTON, which is 44px from `min-h` no matter what the icon
    // does. So `h-0 w-0` would ship the affordance invisible with every gate
    // green. This is the hazard `responsive-320.spec.ts:466-473` records for
    // the row-action icons; the same pin belongs here.
    const iconTokens = [...icon.classList]
    expect(iconTokens).toContain('h-3')
    expect(iconTokens).toContain('w-3')
  })

  /**
   * ⚠️ THIS TEST REPLACES A TAUTOLOGY. The previous version asserted
   * `expect(button).toHaveAccessibleName('How is this worked out?')` on an
   * element obtained via `getByRole('button', { name: 'How is this worked
   * out?' })` — a full-string name match that had already thrown if the name
   * differed. It restated its own locator and could not fail, while its comment
   * called it "the pairing that makes the `aria-hidden` pin matter" — the very
   * claim arm M4 refuted.
   *
   * The real content of AC-6 is that the SIXTEEN pre-existing tests reaching
   * this control through `openBreakdown()` still resolve after a chevron was
   * added inside it. That is what this asserts, from outside the story's own
   * describe: locate the button the way the 45.1 block does, and prove the
   * added child did not change what that query returns.
   */
  it('keeps the accessible name the 45.1 block locates it by, chevron and all (AC-6)', () => {
    renderWithProviders(<SavingsPage />)
    const byName = screen.getAllByRole('button', { name: 'How is this worked out?' })
    expect(byName).toHaveLength(1)
    expect(byName[0].querySelector('svg')).not.toBeNull()
    // The name is the VISIBLE TEXT — there is no `aria-label` here — so the
    // glyph must contribute nothing to it. Trailing/leading whitespace from the
    // JSX child is normalised by the accessible-name computation.
    expect(byName[0].textContent?.trim()).toBe('How is this worked out?')
  })

  it('declares a mobile-only 44px target and the flex box that makes it real (AC-8)', () => {
    renderWithProviders(<SavingsPage />)
    assertHasMobileTapTarget(disclosure(), 'the leftover breakdown disclosure')
    // ⚠️ Without a flex display the min-height still applies but the text and
    // the glyph do not centre in the box. The class-token helper above cannot
    // see that and neither can jsdom; `e2e/responsive-320.spec.ts` can.
    expect(tokensOf(disclosure())).toContain('inline-flex')
  })

  it('restores a focus ring after killing the native outline (AC-9)', () => {
    renderWithProviders(<SavingsPage />)
    // Before this story the button had NO focus style at all and relied on the
    // UA default outline. Adding `focus:outline-none` without a ring would have
    // removed its only indicator (WCAG 2.4.7) with every gate still green — the
    // page's focus-ring completeness test at :507 enumerates four modal inputs
    // by testid and is structurally blind to this control.
    assertHasFocusRing(disclosure(), 'the leftover breakdown disclosure')
  })
})
