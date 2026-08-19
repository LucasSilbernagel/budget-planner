import {
  assertHasFocusRing,
  assertHasMobileTapTarget,
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
    for (const label of [
      'Edit Vacation',
      'Delete Vacation',
      'Move Vacation up',
      'Move Vacation down',
    ]) {
      assertHasFocusRing(within(row).getByRole('button', { name: label }), label)
    }
  })

  it('declares a >= 44px mobile tap target on each row action, scoped to max-sm (AC-6)', () => {
    renderWithProviders(<SavingsPage />)
    const row = rowFor('Vacation')
    for (const label of [
      'Edit Vacation',
      'Delete Vacation',
      'Move Vacation up',
      'Move Vacation down',
    ]) {
      assertHasMobileTapTarget(within(row).getByRole('button', { name: label }), label)
    }
  })

  it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
    const { container } = renderWithProviders(<SavingsPage />)
    const table = container.querySelector('table') as HTMLElement
    expect(collectRetiredTokenViolations(table)).toEqual([])
  })
})

/**
 * Row reordering (Story 34.1b, FR60).
 *
 * ⚠️ Written per page rather than once over a table of four. These are four
 * independent page components with four hand-rolled actions cells; stories 30-4b
 * and 33.3 each shipped a HIGH by testing one surface and assuming its siblings.
 */
describe('SavingsPage — reorder rows (34.1b)', () => {
  const NAMES = ['Alpha', 'Beta', 'Gamma']

  function seedRows() {
    useSavingsStore.setState({ savingsGoals: [] })
    // Distinct createdAt per row: rows added inside one millisecond tie on the
    // secondary sort key, and a tie-preserving stable sort can make an ordering
    // assertion pass by accident (34.1a's M10).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const name of NAMES) {
      useSavingsStore.getState().addSavingsGoal({ name, targetAmount: 500000, currentBalance: 0 })
      vi.advanceTimersByTime(1000)
    }
    vi.useRealTimers()
  }

  /** The rendered row names, top to bottom. */
  function renderedOrder(): string[] {
    return screen
      .getAllByRole('row')
      .slice(1) // drop the header row
      .map((row) => NAMES.find((name) => within(row).queryByText(name)))
      .filter((name): name is string => Boolean(name))
  }

  beforeEach(() => {
    localStorage.clear()
    seedRows()
  })

  afterEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
    localStorage.clear()
  })

  it('offers a move-up and move-down control naming each row (AC-1)', () => {
    renderWithProviders(<SavingsPage />)
    for (const name of NAMES) {
      expect(screen.getByRole('button', { name: `Move ${name} up` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Move ${name} down` })).toBeInTheDocument()
    }
  })

  it('moves a row up when its control is activated (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    expect(renderedOrder()).toEqual(NAMES)

    await user.click(screen.getByRole('button', { name: 'Move Beta up' }))

    expect(renderedOrder()).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('moves a row down when its control is activated (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: 'Move Beta down' }))

    expect(renderedOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  /**
   * ⚠️ `aria-disabled`, NOT the native `disabled` attribute (story decision 2).
   * `toBeDisabled()` deliberately does NOT pass here: a natively disabled button
   * cannot hold focus, which would break the focus-retention AC below at exactly
   * the boundary this assertion is about.
   */
  it('marks the boundary controls aria-disabled while keeping them focusable (AC-4)', () => {
    renderWithProviders(<SavingsPage />)
    const firstUp = screen.getByRole('button', { name: 'Move Alpha up' })
    const lastDown = screen.getByRole('button', { name: 'Move Gamma down' })

    expect(firstUp).toHaveAttribute('aria-disabled', 'true')
    expect(lastDown).toHaveAttribute('aria-disabled', 'true')
    // Interior controls are NOT marked — otherwise the assertion above would
    // pass on a component that marks every control.
    expect(screen.getByRole('button', { name: 'Move Beta up' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
    expect(firstUp).not.toBeDisabled()
  })

  it('does nothing when a boundary control is activated (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: 'Move Alpha up' }))
    await user.click(screen.getByRole('button', { name: 'Move Gamma down' }))

    expect(renderedOrder()).toEqual(NAMES)
  })

  it('marks BOTH controls aria-disabled on a single-row list (AC-4)', () => {
    useSavingsStore.setState({ savingsGoals: [] })
    useSavingsStore
      .getState()
      .addSavingsGoal({ name: 'Solo', targetAmount: 500000, currentBalance: 0 })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByRole('button', { name: 'Move Solo up' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Move Solo down' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  /**
   * ⚠️ THE POINT OF THIS TEST IS THAT IT CAN FAIL. It asserts the row actually
   * moved AND that focus stayed on the control the user pressed — "something is
   * focused" would prove nothing. Focus survives because all four tables key
   * rows by `id`, so React moves the existing DOM node instead of remounting it.
   */
  it('keeps focus on the activated control after a keyboard move (AC-6)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    const control = screen.getByRole('button', { name: 'Move Gamma up' })

    control.focus()
    await user.keyboard('{Enter}')

    expect(renderedOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move Gamma up' })).toHaveFocus()
    })
  })

  it('keeps focus on a control that becomes a boundary control (AC-6)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    const control = screen.getByRole('button', { name: 'Move Beta up' })

    control.focus()
    await user.keyboard('{Enter}')

    // Beta is now first, so its move-up control is aria-disabled — and must
    // still hold focus. A native `disabled` here would drop focus to <body>.
    const after = screen.getByRole('button', { name: 'Move Beta up' })
    expect(after).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(after).toHaveFocus())
  })

  it('persists the new order across a reload (AC-2)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<SavingsPage />)
    await user.click(screen.getByRole('button', { name: 'Move Gamma up' }))
    unmount()

    // ⚠️ `setState` goes THROUGH the persist middleware, so clearing in-memory
    // state would overwrite the blob we are about to read back. Snapshot it,
    // clear, restore, then rehydrate — which is what a reload actually does.
    const persisted = localStorage.getItem('budget-planner:savings-goals')
    expect(persisted).toBeTruthy()
    useSavingsStore.setState({ savingsGoals: [] })
    localStorage.setItem('budget-planner:savings-goals', persisted as string)
    await useSavingsStore.persist.rehydrate()

    renderWithProviders(<SavingsPage />)
    expect(renderedOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
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

  it('disables every move control while sorted, and restores them on clear (AC-7)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
    for (const name of MANUAL_ORDER) {
      expect(screen.getByRole('button', { name: `Move ${name} up` })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(screen.getByRole('button', { name: `Move ${name} down` })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
    const sorted = renderedOrder()
    await user.click(screen.getByRole('button', { name: 'Move Mid up' }))
    expect(renderedOrder()).toEqual(sorted)
    expect(useSavingsStore.getState().savingsGoals.map((g) => g.name)).toEqual(MANUAL_ORDER)

    await user.click(screen.getByRole('button', { name: 'Show manual order' }))
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
    await user.click(screen.getByRole('button', { name: 'Move Alpha up' }))
    expect(renderedOrder()).toEqual(['Alpha', 'Zeta', 'Mid', 'Beta'])
  })

  it('shows the mobile escape hatch only while a sort is active', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    expect(screen.queryByText(/^Sorted by /)).toBeNull()
    await user.click(within(header('Target')).getByRole('button', { name: 'Target' }))
    expect(screen.getByText('Sorted by Target')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show manual order' }))
    expect(screen.queryByText(/^Sorted by /)).toBeNull()
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
