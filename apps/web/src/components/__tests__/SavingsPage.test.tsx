import {
  assertHasFocusRing,
  assertHasMobileTapTarget,
  assertIsIconOnlyAction,
  collectRetiredTokenViolations,
} from '@/test/responsive-table-tokens'
import { expectSortHeaderAnnouncements } from '@/test/sort-announcements'
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
import { SAVINGS_GOALS_STORAGE_KEY, useSavingsStore } from '../../stores/savingsStore'
import { SavingsPage } from '../SavingsPage'

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
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })
})

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
    await user.type(screen.getByTestId('savings-target-amount-input'), '5000')
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
    await user.type(screen.getByTestId('savings-target-amount-input'), '5000')
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
    await user.type(screen.getByTestId('savings-monthly-allocation-input'), '999')
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'automatic')

    expect(screen.queryByTestId('savings-monthly-allocation-input')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const goals = useSavingsStore.getState().savingsGoals
    expect(goals[0]).toMatchObject({ allocationMode: 'automatic', monthlyAllocation: null })
  })
})

describe('SavingsPage — leftover allocation split (Story 26.3)', () => {
  const ISO = '2026-01-01T00:00:00.000Z'

  // Fully-typed store fixtures (the shared makeIncomeSource/makeExpense factories
  // omit createdAt/updatedAt, which the Client* store types require).
  const incomeRow = (amount: number, id = 'inc-1') => ({
    id,
    userId: 0,
    categoryId: null,
    name: 'Salary',
    amount,
    frequency: 'monthly' as const,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const expenseRow = (amount: number, id = 'exp-1') => ({
    id,
    userId: 0,
    categoryId: null,
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
  const GOAL_TARGET = 10_000_00
  const savingsRow = (over: {
    id: string
    name?: string
    targetAmount?: number | null
    allocationMode?: 'manual' | 'automatic'
    monthlyAllocation?: number | null
  }) => ({
    name: over.name ?? over.id,
    targetAmount: GOAL_TARGET as number | null,
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
    // net 350000 − 50000 contribution − 130000 manual = pool 170000 / 2 automatic = 85000 each.
    // Fixed and automatic amounts differ, so a manual/automatic swap fails.
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

    const summary = screen.getByTestId('savings-leftover-summary')
    expect(summary).toHaveTextContent(/1,700\.00/)
    expect(summary).toHaveTextContent(/split across 2 automatic entries/)
    expect(summary).not.toHaveTextContent(/automatic accounts?\b/)

    const manual = screen.getByTestId('savings-allocation-manual-1')
    expect(manual).toHaveTextContent(/1,300\.00/)
    expect(screen.getByTestId('savings-allocation-mode-manual-1')).toHaveTextContent(/Fixed/i)

    expect(screen.getByTestId('savings-allocation-auto-1')).toHaveTextContent(/850\.00/)
    expect(screen.getByTestId('savings-allocation-auto-2')).toHaveTextContent(/850\.00/)
    expect(screen.getByTestId('savings-allocation-mode-auto-1')).toHaveTextContent(/Auto/i)

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
    const note = screen.getByTestId('savings-overcommitted-note')
    expect(note).toHaveTextContent(/automatic entries receive/)
    expect(note).not.toHaveTextContent(/automatic accounts/)
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
    // Anchored on the distinguishing clause, not on "automatic", which survives every rewrite.
    expect(summary).toHaveTextContent(/nothing is set to receive it/i)
    expect(summary).toHaveTextContent(/Set an entry to .Automatic. to divide it up/i)
    expect(summary).not.toHaveTextContent(/with a target/i)
    expect(summary).not.toHaveTextContent(/split across 0/i)
    expect(screen.queryByTestId('savings-overcommitted-note')).not.toBeInTheDocument()
  })

  it('recomputes the automatic share live when income changes (AC-3)', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow(100000)] })
    useSavingsStore.setState({
      savingsGoals: [savingsRow({ id: 'auto-1', allocationMode: 'automatic' })],
    })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByTestId('savings-allocation-auto-1')).toHaveTextContent(/1,000\.00/)

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

describe('SavingsPage — target-less entries are allocated like goals (Story 72.1, reverses FR98)', () => {
  const ISO = '2026-01-01T00:00:00.000Z'
  const accountRow = (over: {
    id: string
    allocationMode?: 'manual' | 'automatic'
    monthlyAllocation?: number | null
  }) => ({
    name: over.id,
    targetAmount: null as number | null,
    currentBalance: 0,
    allocationMode: 'automatic' as 'manual' | 'automatic',
    monthlyAllocation: null as number | null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  })
  const goalRow = (id: string) => ({
    id,
    name: id,
    targetAmount: 1_000_000 as number | null,
    currentBalance: 0,
    allocationMode: 'automatic' as 'manual' | 'automatic',
    monthlyAllocation: null as number | null,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const salary = (amount: number) => ({
    id: 'i',
    userId: 0,
    categoryId: null,
    name: 'Salary',
    amount,
    frequency: 'monthly' as const,
    createdAt: ISO,
    updatedAt: ISO,
  })

  const resetStores = () => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({ entries: [] })
    useSavingsStore.setState({ savingsGoals: [] })
  }
  beforeEach(resetStores)
  afterEach(resetStores)

  it('keeps the allocation mode select and the manual amount when the box is ticked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))

    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
    expect(screen.getByTestId('savings-monthly-allocation-input')).toBeInTheDocument()

    await user.click(screen.getByTestId('savings-is-account-toggle'))
    expect(screen.getByTestId('savings-allocation-mode-select')).toBeInTheDocument()
    expect(screen.getByTestId('savings-monthly-allocation-input')).toBeInTheDocument()
    expect(screen.queryByTestId('savings-target-amount-input')).not.toBeInTheDocument()
  })

  it('ticking and unticking changes neither allocation value (green on both sides)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))

    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
    await user.type(screen.getByTestId('savings-monthly-allocation-input'), '250')
    await user.click(screen.getByTestId('savings-is-account-toggle'))
    await user.click(screen.getByTestId('savings-is-account-toggle'))

    expect(screen.getByTestId('savings-allocation-mode-select')).toHaveValue('manual')
    // '250.00', not '250': clicking the checkbox blurs the input, which reformats it.
    expect(screen.getByTestId('savings-monthly-allocation-input')).toHaveValue('250.00')
  })

  it('the mode helper speaks of an ENTRY, for accounts too (AC-12, D3)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    await user.click(screen.getByTestId('savings-is-account-toggle'))
    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveTextContent(
      'This entry receives an even share of whatever is left over each month.'
    )
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
    expect(dialog).toHaveTextContent('This entry gets the fixed amount you set below each month.')
    expect(dialog).not.toHaveTextContent(/This goal (receives|gets)/)
  })

  it('⚠️ persists manual / 25000 for an account (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')

    await user.type(screen.getByTestId('savings-name-input'), 'Chequing')
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
    await user.type(screen.getByTestId('savings-monthly-allocation-input'), '250')
    await user.click(screen.getByTestId('savings-is-account-toggle'))
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const goals = useSavingsStore.getState().savingsGoals
    expect(goals).toHaveLength(1)
    // 250 → 25000 cents.
    expect(goals[0]).toMatchObject({
      name: 'Chequing',
      targetAmount: null,
      allocationMode: 'manual',
      monthlyAllocation: 25000,
    })
  })

  it('⚠️ reverses FR98: an automatic account takes an even share beside a goal', () => {
    // The pool of 500.00 is split over 2 automatic rows ⇒ 250.00 each.
    useIncomeStore.setState({ incomeSources: [salary(500_00)] })
    useSavingsStore.setState({ savingsGoals: [goalRow('goal-1'), accountRow({ id: 'acct-1' })] })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByTestId('savings-allocation-goal-1')).toHaveTextContent('250.00')
    expect(screen.getByTestId('savings-allocation-acct-1')).toHaveTextContent('250.00')
    expect(screen.getByTestId('savings-allocation-mode-acct-1')).toHaveTextContent(/Auto/i)
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(
      /split across 2 automatic entries/
    )
  })

  it('⚠️ an account stored as manual 300.00 shows 300.00 and a Fixed pill (AC-7)', () => {
    useSavingsStore.setState({
      savingsGoals: [
        accountRow({ id: 'acct-1', allocationMode: 'manual', monthlyAllocation: 300_00 }),
      ],
    })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByTestId('savings-allocation-acct-1')).toHaveTextContent('300.00')
    expect(screen.getByTestId('savings-allocation-acct-1')).not.toHaveTextContent('—')
    expect(screen.getByTestId('savings-allocation-mode-acct-1')).toHaveTextContent(/Fixed/i)
    expect(screen.getByTestId('savings-badge-acct-1')).toHaveTextContent('Account')
  })

  it('a GOAL still shows its figure and pill — the negative control', () => {
    useSavingsStore.setState({ savingsGoals: [goalRow('goal-1')] })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByTestId('savings-allocation-goal-1')).not.toHaveTextContent('—')
    expect(screen.getByTestId('savings-allocation-mode-goal-1')).toHaveTextContent(/Auto/i)
  })

  it('an automatic account on its own RECEIVES the whole pool', () => {
    // Sole automatic row ⇒ the whole 500.00, "split across 1 automatic entry" (singular).
    useIncomeStore.setState({ incomeSources: [salary(500_00)] })
    useSavingsStore.setState({ savingsGoals: [accountRow({ id: 'acct-1' })] })
    renderWithProviders(<SavingsPage />)

    expect(screen.getByTestId('savings-allocation-acct-1')).toHaveTextContent('500.00')
    const summary = screen.getByTestId('savings-leftover-summary')
    expect(summary).toHaveTextContent(/split across 1 automatic entry\b/)
    expect(summary).not.toHaveTextContent(/automatic (accounts?|entries)\b/)
    expect(summary).not.toHaveTextContent(/don.t receive allocations/i)
  })

  it('all-manual accounts get the D3 remedy: set an ENTRY to Automatic', () => {
    // 500.00 − 100.00 fixed = 400.00 left over, nothing automatic to receive it.
    useIncomeStore.setState({ incomeSources: [salary(500_00)] })
    useSavingsStore.setState({
      savingsGoals: [
        accountRow({ id: 'acct-1', allocationMode: 'manual', monthlyAllocation: 100_00 }),
      ],
    })
    renderWithProviders(<SavingsPage />)

    const summary = screen.getByTestId('savings-leftover-summary')
    expect(summary).toHaveTextContent(/400\.00/)
    expect(summary).toHaveTextContent(/nothing is set to receive it/i)
    expect(summary).toHaveTextContent(/Set an entry to .Automatic. to divide it up/i)
    expect(summary).not.toHaveTextContent(/with a target/i)
    expect(summary).not.toHaveTextContent(/don.t receive allocations/i)
  })

  it('an empty page gets the D3 remedy: add a savings goal OR ACCOUNT', () => {
    useIncomeStore.setState({ incomeSources: [salary(500_00)] })
    renderWithProviders(<SavingsPage />)

    const summary = screen.getByTestId('savings-leftover-summary')
    expect(summary).toHaveTextContent(/Add a savings goal or account to divide it up/i)
    expect(summary).not.toHaveTextContent(/with a target/i)
    expect(summary).not.toHaveTextContent(/Set an entry/i)
  })

  it('⚠️ refuses a NEGATIVE manual amount on an account with a visible error (AC-5)', async () => {
    // A leading '-' is legal in `sanitizeMoneyInput`, so this is typeable.
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')

    await user.type(screen.getByTestId('savings-name-input'), 'Chequing')
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
    await user.type(screen.getByTestId('savings-monthly-allocation-input'), '-5')
    await user.click(screen.getByTestId('savings-is-account-toggle'))
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    expect(screen.getByTestId('savings-monthly-allocation-error')).toBeVisible()
    expect(useSavingsStore.getState().savingsGoals).toHaveLength(0)
  })

  it('still refuses a negative amount on a GOAL — the negative control', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const dialog = screen.getByRole('dialog')

    await user.type(screen.getByTestId('savings-name-input'), 'Rent Fund')
    await user.type(screen.getByTestId('savings-target-amount-input'), '5000')
    await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
    await user.type(screen.getByTestId('savings-monthly-allocation-input'), '-5')
    await user.click(within(dialog).getByRole('button', { name: 'Add Savings Goal' }))

    expect(screen.getByTestId('savings-monthly-allocation-error')).toBeInTheDocument()
    expect(useSavingsStore.getState().savingsGoals).toHaveLength(0)
  })

  it('⚠️ editing an account opens with its STORED manual / 300.00 (AC-6)', () => {
    useSavingsStore.setState({
      savingsGoals: [
        accountRow({ id: 'acct-1', allocationMode: 'manual', monthlyAllocation: 300_00 }),
      ],
    })
    renderWithProviders(<SavingsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit acct-1' }))

    expect(screen.getByTestId('savings-is-account-toggle')).toBeChecked()
    expect(screen.getByTestId('savings-allocation-mode-select')).toHaveValue('manual')
    expect(screen.getByTestId('savings-monthly-allocation-input')).toHaveValue('300.00')
  })

  it('⚠️ an UNTOUCHED Save of a manual account keeps manual / 30000 (the AC-6 trap)', async () => {
    // The discriminating input: prefill and reset-to-automatic diverge only when the user changes nothing.
    const user = userEvent.setup()
    useSavingsStore.setState({
      savingsGoals: [
        accountRow({ id: 'acct-1', allocationMode: 'manual', monthlyAllocation: 300_00 }),
      ],
    })
    renderWithProviders(<SavingsPage />)
    await user.click(screen.getByRole('button', { name: 'Edit acct-1' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useSavingsStore.getState().savingsGoals[0]).toMatchObject({
      id: 'acct-1',
      targetAmount: null,
      allocationMode: 'manual',
      monthlyAllocation: 30000,
    })
  })

  it('⚠️ the breakdown’s fixed-allocation line includes a manual ACCOUNT (AC-10)', () => {
    // Fixed line = 100.00 + 300.00 = 400.00.
    useIncomeStore.setState({ incomeSources: [salary(500_00)] })
    useSavingsStore.setState({
      savingsGoals: [
        goalRow('goal-1'),
        accountRow({ id: 'acct-1', allocationMode: 'manual', monthlyAllocation: 300_00 }),
        { ...goalRow('goal-fixed'), allocationMode: 'manual' as const, monthlyAllocation: 100_00 },
      ],
    })
    renderWithProviders(<SavingsPage />)
    // The breakdown body is not in the DOM until opened.
    fireEvent.click(screen.getByRole('button', { name: 'How is this worked out?' }))

    expect(screen.getByTestId('breakdown-manual')).toHaveTextContent('400.00')
    // And it reconciles: 500.00 − 400.00 = 100.00 left over, all to goal-1.
    expect(screen.getByTestId('savings-allocation-goal-1')).toHaveTextContent('100.00')
  })

  it('⚠️ D1: stored target-less rows resume with their stored mode, no data change (AC-14)', async () => {
    // One row per stored shape: legacy (keys absent, backfilled by migrate), chosen (manual 300.00),
    // forced (automatic/null). 1,000.00 − 300.00 = 700.00 over 2 automatic ⇒ 350.00 each.
    localStorage.setItem(
      SAVINGS_GOALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          savingsGoals: [
            {
              id: 'legacy',
              name: 'legacy',
              targetAmount: null,
              currentBalance: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'chosen',
              name: 'chosen',
              targetAmount: null,
              currentBalance: 0,
              allocationMode: 'manual',
              monthlyAllocation: 30000,
              createdAt: '2026-01-02T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
            {
              id: 'forced',
              name: 'forced',
              targetAmount: null,
              currentBalance: 0,
              allocationMode: 'automatic',
              monthlyAllocation: null,
              createdAt: '2026-01-03T00:00:00.000Z',
              updatedAt: '2026-01-03T00:00:00.000Z',
            },
          ],
        },
      })
    )
    try {
      await useSavingsStore.persist.rehydrate()
      expect(
        useSavingsStore
          .getState()
          .savingsGoals.map(({ id, allocationMode, monthlyAllocation }) => ({
            id,
            allocationMode,
            monthlyAllocation,
          }))
      ).toEqual([
        { id: 'legacy', allocationMode: 'automatic', monthlyAllocation: null },
        { id: 'chosen', allocationMode: 'manual', monthlyAllocation: 30000 },
        { id: 'forced', allocationMode: 'automatic', monthlyAllocation: null },
      ])
      useIncomeStore.setState({ incomeSources: [salary(1_000_00)] })
      renderWithProviders(<SavingsPage />)

      expect(screen.getByTestId('savings-allocation-legacy')).toHaveTextContent('350.00')
      expect(screen.getByTestId('savings-allocation-forced')).toHaveTextContent('350.00')
      expect(screen.getByTestId('savings-allocation-chosen')).toHaveTextContent('300.00')
      expect(screen.getByTestId('savings-allocation-mode-chosen')).toHaveTextContent(/Fixed/i)
    } finally {
      localStorage.removeItem(SAVINGS_GOALS_STORAGE_KEY)
    }
  })
})

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

  it('never lets a typed letter into the TARGET amount field (was e2e money-input-sanitization:130)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    const targetInput = screen.getByTestId('savings-target-amount-input')
    await user.type(targetInput, '9abc9')

    expect(targetInput).toHaveValue('99')
    expect(targetInput).toHaveFocus()
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

// `focus:outline-none` with a ring colour but no `focus:ring-2` width paints nothing.
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

  it('offers exactly Edit and Delete in a row action cell (48.2 AC-1, AC-15)', () => {
    renderWithProviders(<SavingsPage />)
    const cell = rowFor('Vacation').querySelector('td:last-child') as HTMLElement
    expect(
      within(cell)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Edit Vacation', 'Delete Vacation'])
  })

  it('renders each row action as an aria-hidden icon with no visible label (50.1 AC-1, AC-3, AC-9)', () => {
    renderWithProviders(<SavingsPage />)
    const cell = rowFor('Vacation').querySelector('td:last-child') as HTMLElement
    const geometry = ['Edit Vacation', 'Delete Vacation'].map((label) =>
      assertIsIconOnlyAction(within(cell).getByRole('button', { name: label }), label)
    )
    // Edit and Delete must be different glyphs; nothing else would catch the wrong icon pasted in.
    expect(geometry[0], 'Edit and Delete render the same glyph').not.toBe(geometry[1])
  })

  it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
    const { container } = renderWithProviders(<SavingsPage />)
    const table = container.querySelector('table') as HTMLElement
    expect(collectRetiredTokenViolations(table)).toEqual([])
  })
})

describe('SavingsPage — sort by column (34.2)', () => {
  // Zeta and Mid tie on Current Balance in a known manual order, so a comparator that
  // degraded to manual order cannot pass.
  const SEED = [
    { name: 'Zeta', targetAmount: 900_00, currentBalance: 300_00 },
    { name: 'Alpha', targetAmount: null, currentBalance: 500_00 },
    { name: 'Mid', targetAmount: 400_00, currentBalance: 300_00 },
    { name: 'Beta', targetAmount: 200_00, currentBalance: 800_00 },
  ]
  const MANUAL_ORDER = ['Zeta', 'Alpha', 'Mid', 'Beta']

  function seedRows() {
    useSavingsStore.setState({ savingsGoals: [] })
    // Distinct createdAt per row: ties on the manual key could make an ordering assertion pass by accident.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const goal of SEED) {
      useSavingsStore.getState().addSavingsGoal(goal)
      vi.advanceTimersByTime(1000)
    }
    vi.useRealTimers()
  }

  /** The name cell also carries a Goal/Account badge, so match the seeded name. */
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

  it('describes its headers and announces a header click, not a picker change (120.1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    await expectSortHeaderAnnouncements(user, 'Sort savings goals and accounts')
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

  function sortControl(): HTMLSelectElement {
    return screen.getByRole('combobox', {
      name: 'Sort savings goals and accounts',
    }) as HTMLSelectElement
  }

  it('offers the mobile sort control whether or not a sort is active (48.1 AC-1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    expect(sortControl()).toBeInTheDocument()
    expect(sortControl().value).toBe('manual')

    await user.selectOptions(sortControl(), 'name:asc')
    expect(sortControl().value).toBe('name:asc')
  })

  it('sorts from the mobile control and drives the SAME state as the headers (48.1 AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    // Descending: ascending alone can't tell `select` from `toggle`.
    await user.selectOptions(sortControl(), 'name:desc')
    expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

    // A control wired to its own state would reorder rows and leave this header reporting `none`.
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
    // Registered spies on the PAID tier (which has a sync path), so `not.toHaveBeenCalled()` can fail.
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
    expect(useSavingsStore.getState().savingsGoals.map((g) => g.name)).toEqual([
      ...MANUAL_ORDER,
      'Bravo',
    ])
  })

  it('MOVES each row node rather than relabelling positions (rows keyed by id)', async () => {
    // The only assertion that fails under `key={index}`.
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    const before = screen.getByRole('button', { name: 'Edit Zeta' })
    await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
    expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])
    expect(screen.getByRole('button', { name: 'Edit Zeta' })).toBe(before)
  })

  it('gives every sortable header the standard focus ring', () => {
    renderWithProviders(<SavingsPage />)
    for (const name of ['Name', 'Target', 'Current Balance', 'Monthly Allocation', 'Progress']) {
      assertHasFocusRing(within(header(name)).getByRole('button', { name }), name)
    }
  })
})

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
    expect(sections[1]).toContainElement(
      screen.getByRole('heading', { name: 'Your Savings Goals' })
    )
    expect(sections[1].querySelector('table')).not.toBeNull()
  })

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

  // No `$`: the unit suite renders amounts currency-less.
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

    // Positive anchor first: the absence assertions below would pass on an empty render.
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
    // `applyServerChanges` writes pulled rows unvalidated, so a contribution on an asset stays
    // reachable from sync.
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

describe('SavingsPage — leftover breakdown and the FR72 fix (Story 45.1)', () => {
  const ISO = '2026-01-01T00:00:00.000Z'

  const incomeRow = (amount: number, id = 'inc-1') => ({
    id,
    userId: 0,
    categoryId: null,
    name: 'Salary',
    amount,
    frequency: 'monthly' as const,
    createdAt: ISO,
    updatedAt: ISO,
  })
  const expenseRow = (amount: number, name: string, id = 'exp-1') => ({
    id,
    userId: 0,
    categoryId: null,
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
    targetAmount: 1_000_000 as number | null,
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

  const seedReproduction = (recordedAsExpense?: boolean) => {
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(50_000, 'TFSA contribution')] })
    useBalanceStore.setState({
      entries: [investmentRow(50_000, 'TFSA', 'inv-1', recordedAsExpense)],
    })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
  }

  /** The breakdown body is not in the DOM until opened, so assertions must open it first. */
  const openBreakdown = () => {
    fireEvent.click(screen.getByRole('button', { name: 'How is this worked out?' }))
  }

  beforeEach(resetStores)
  afterEach(resetStores)

  it('keeps the breakdown body OUT of the DOM until it is opened', () => {
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    // A collapsed <details> still renders its children, so assert ABSENCE, not invisibility.
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
    expect(screen.queryByTestId('breakdown-toggle-inv-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('breakdown-contribution-inv-1')).not.toHaveTextContent(
      /already accounted for/i
    )
  })

  it('AC-8(c): the breakdown arithmetic matches the pool it explains', () => {
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    // A relation between rendered values: a hard-coded total passes when breakdown and pool are wrong together.
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
    expect(screen.getByTestId('savings-leftover-summary')).toHaveTextContent(/2,000\.00/)
    expect(leftover).toBe(200_000)
  })

  it('AC-8(c): the breakdown RECONCILES when the pool clamps to zero', () => {
    // `distributablePool` floors at 0; over-committed, the plain subtraction would not add up to
    // the displayed "Left over".
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

    expect(cents('breakdown-income') - cents('breakdown-expenses')).toBe(-100_000)
    expect(cents('breakdown-raw')).toBe(100_000) // rendered as −$1,000.00
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
    // The solver guards with `Number.isFinite`; `?? 0` does not intercept NaN.
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

  it('AC-2 via the UI: an unflagged row still deducts twice (the different-money user)', () => {
    seedReproduction(false)
    renderWithProviders(<SavingsPage />)
    openBreakdown()
    // This $2,000 is correct for a user whose expense and contribution are different money.
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
    // `findContributionDuplicateCandidates` skips flagged rows, so the component re-runs the detector
    // with flags cleared just for this cue.
    seedReproduction(true)
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    const cue = screen.getByTestId('breakdown-still-duplicated-inv-1')
    expect(cue).toHaveTextContent(/your\s+expense\s+“TFSA contribution”\s+still\s+subtracts\s+it/i)
    expect(cue).toHaveTextContent(/remove\s+that\s+expense\s+line/i)
    expect(screen.getByTestId('breakdown-contribution-inv-1')).not.toHaveTextContent(
      /you\s+marked\s+it\s+as\s+already\s+accounted\s+for/i
    )
  })

  it('AC-6/D3 (47.1 review): a flagged row with NO surviving expense gets the plain note and an undo pointer', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(12_345, 'Groceries')] })
    useBalanceStore.setState({ entries: [investmentRow(50_000, 'TFSA', 'inv-1', true)] })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    expect(screen.queryByTestId('breakdown-still-duplicated-inv-1')).not.toBeInTheDocument()
    const row = screen.getByTestId('breakdown-contribution-inv-1')
    expect(row).toHaveTextContent(/you\s+marked\s+it\s+as\s+already\s+accounted\s+for/i)
    expect(row).toHaveTextContent(/Change\s+this\s+on\s+its\s+Balance\s+Tracking\s+entry/i)
  })

  it('AC-7 (story 47.1): the duplicate hint points at the control’s real home', () => {
    seedReproduction()
    renderWithProviders(<SavingsPage />)
    openBreakdown()
    const hint = screen.getByTestId('breakdown-duplicate-hint-inv-1')

    expect(hint.textContent).toMatch(
      /tick\s+“Not\s+taken\s+from\s+the\s+money\s+left\s+over”\s+on\s+its\s+Balance\s+Tracking\s+entry/i
    )
    expect(hint.textContent).not.toMatch(/tick\s+this/i)
  })

  it('AC-2 (story 47.1): /savings never says "net" — a page-wide ban is safe here', () => {
    seedReproduction()
    const { container } = renderWithProviders(<SavingsPage />)
    openBreakdown()
    expect(container.textContent).not.toMatch(/\bnet\b/i)
  })

  it('AC-12: a COINCIDENTAL same-amount match is not highlighted and moves no number', () => {
    // $500 rent and a $500 contribution match on amount but are unrelated.
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(50_000, 'Rent')] })
    useBalanceStore.setState({ entries: [investmentRow(50_000, 'TFSA')] })
    useSavingsStore.setState({ savingsGoals: [autoGoal('auto-1')] })
    renderWithProviders(<SavingsPage />)
    openBreakdown()

    expect(screen.queryByTestId('breakdown-duplicate-hint-inv-1')).not.toBeInTheDocument()
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
    // Non-monthly cadence: 11538c/wk × 52/12 = 49998, visibly not 11538.
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
    expect(screen.getByTestId('breakdown-contributions')).toHaveTextContent(/300\.00/)
    expect(screen.getByTestId('breakdown-leftover')).toHaveTextContent(/2,200\.00/)
    expect(screen.getByTestId('breakdown-still-duplicated-inv-1')).toHaveTextContent(
      /still\s+subtracts\s+it/i
    )
    expect(screen.getByTestId('breakdown-contribution-inv-2')).not.toHaveTextContent(
      /already\s+accounted\s+for/i
    )
    // Class token, not substring: `toContain` would false-match `sm:line-through`.
    expect(
      screen.getByTestId('breakdown-contribution-amount-inv-1').className.split(/\s+/)
    ).toContain('line-through')
    expect(
      screen.getByTestId('breakdown-contribution-amount-inv-2').className.split(/\s+/)
    ).not.toContain('line-through')
  })
})

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

  // No seeding: the control renders behind `hydrated`, which is data-independent.

  it('reads as a control when closed — accent colour and a PERSISTENT underline (AC-1)', () => {
    renderWithProviders(<SavingsPage />)
    const tokens = tokensOf(disclosure())
    expect(tokens).toContain('text-accent')
    // Persistent, not `hover:underline`: hover doesn't exist on touch.
    expect(tokens).toContain('underline')
    expect(tokens).not.toContain('hover:underline')
    expect(tokens).not.toContain('text-muted')
    expect(tokens).not.toContain('text-faint')
    // Both hover arms: without `dark:hover:text-blue-200`, dark hover contrast is 1.68:1.
    expect(tokens).toContain('hover:text-blue-800')
    expect(tokens).toContain('dark:hover:text-blue-200')
  })

  it('does not take the weight of a primary action (AC-2)', () => {
    renderWithProviders(<SavingsPage />)
    const tokens = tokensOf(disclosure())
    expect(tokens).toContain('text-xs')
    // Strip variants before matching: a `^`-anchored test misses `hover:bg-…`, `dark:bg-…` and the like.
    const base = (t: string) => t.split(':').pop() ?? t
    const bases = tokens.map(base)
    expect(bases.filter((t) => /^bg-/.test(t))).toEqual([])
    expect(bases.filter((t) => /^shadow/.test(t))).toEqual([])
    expect(bases.filter((t) => /^font-(semibold|bold|extrabold|black)$/.test(t))).toEqual([])
    expect(bases.filter((t) => /^p[xy]?-([2-9]|1[0-9])$/.test(t))).toEqual([])
  })

  it('leaves the element, its ARIA wiring and the conditional body untouched (AC-3)', () => {
    renderWithProviders(<SavingsPage />)
    const button = disclosure()
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-controls', 'savings-leftover-breakdown-body')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('savings-leftover-breakdown-body')).toBeNull()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('savings-leftover-breakdown-body')).not.toBeNull()
  })

  it('rotates its chevron to match breakdownOpen, asserted in BOTH states (AC-4)', () => {
    renderWithProviders(<SavingsPage />)
    const button = disclosure()
    // `getAttribute`/`classList`: on an SVGElement `className` is an SVGAnimatedString.
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
    // `currentColor` inherits `.text-accent`, keeping the glyph's contrast equal to the text's.
    expect(icon.getAttribute('stroke')).toBe('currentColor')
    expect(icon.querySelector('path')?.getAttribute('d')).toBeTruthy()
    expect(button.children.length).toBe(1)
    expect(button.firstElementChild).toBe(icon)
    // Neither jsdom nor a button-box check can see a zero-sized glyph, so pin the size.
    const iconTokens = [...icon.classList]
    expect(iconTokens).toContain('h-3')
    expect(iconTokens).toContain('w-3')
  })

  it('keeps the accessible name the 45.1 block locates it by, chevron and all (AC-6)', () => {
    renderWithProviders(<SavingsPage />)
    const byName = screen.getAllByRole('button', { name: 'How is this worked out?' })
    expect(byName).toHaveLength(1)
    expect(byName[0].querySelector('svg')).not.toBeNull()
    // The name is the visible text (no `aria-label`), so the glyph must contribute nothing.
    expect(byName[0].textContent?.trim()).toBe('How is this worked out?')
  })

  it('declares a mobile-only 44px target and the flex box that makes it real (AC-8)', () => {
    renderWithProviders(<SavingsPage />)
    assertHasMobileTapTarget(disclosure(), 'the leftover breakdown disclosure')
    // Without a flex display the text and glyph don't centre in the min-height box.
    expect(tokensOf(disclosure())).toContain('inline-flex')
  })

  it('restores a focus ring after killing the native outline (AC-9)', () => {
    renderWithProviders(<SavingsPage />)
    // `focus:outline-none` without a ring would remove the button's only focus indicator.
    assertHasFocusRing(disclosure(), 'the leftover breakdown disclosure')
  })
})
