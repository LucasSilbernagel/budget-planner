/**
 * Savings accounts as what-if rows in the Scenario Builder (story 100.1, FR164).
 *
 * Integration tests: the real builder, the real stores, the real engine and the
 * real currency store. Only the clock-free debounce is waited on.
 *
 * ⚠️ What a contribution edit can and cannot change: rows SPLIT savings (every cent
 * of net income already lands in savings), so totals, net worth and the summary
 * never move. The per-row `After N years` line is the visible outcome (D5), which
 * is why most cases here read that line rather than the summary.
 */

import { renderWithProviders } from '@/test/utils'
import { solveAutomaticAllocations } from '@budget-planner/core'
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { useBalanceStore, useTotalInvestmentBalance } from '../../../stores/balanceStore'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import {
  SAVINGS_GOALS_STORAGE_KEY,
  useSavingsStore,
  useTotalSavings,
} from '../../../stores/savingsStore'
import { SavingsPage } from '../../SavingsPage'
import { ScenarioBuilder } from '../scenario-builder'

const ISO = '2026-10-05T00:00:00.000Z'
const PROFILE = 'profile-rows'

function income(amount: number, over: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    profileId: PROFILE,
    userId: 0,
    name: 'Salary',
    amount,
    frequency: 'monthly' as const,
    categoryId: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  }
}

function expense(amount: number) {
  return {
    id: 'exp-1',
    profileId: PROFILE,
    userId: 0,
    name: 'Rent',
    amount,
    frequency: 'monthly' as const,
    categoryId: null,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function goal(over: {
  id: string
  name: string
  currentBalance?: number
  allocationMode?: 'manual' | 'automatic'
  monthlyAllocation?: number | null
  targetAmount?: number | null
  sortOrder?: number
}) {
  return {
    profileId: PROFILE,
    targetAmount: 1_000_000 as number | null,
    currentBalance: 0,
    allocationMode: 'automatic' as 'manual' | 'automatic',
    monthlyAllocation: null as number | null,
    sortOrder: 0,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  }
}

function investment(over: {
  id: string
  name: string
  currentBalance?: number
  monthlyContribution?: number
  frequency?: string
  contributionRecordedAsExpense?: boolean
}) {
  return {
    profileId: PROFILE,
    type: 'investment' as const,
    currentBalance: 0,
    monthlyContribution: 0,
    frequency: 'monthly',
    sortOrder: 0,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  }
}

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
}

beforeEach(() => {
  clearStores()
  useProfileStore.setState({ activeProfileId: PROFILE })
})

afterEach(() => {
  clearStores()
  vi.restoreAllMocks()
})

/** The `$`-or-not formatter the builder itself uses, for the current store state. */
function formatter(): (cents: number) => string {
  return renderHook(() => useFormattedAmount()).result.current
}

/** Wait for the first debounced recompute: the summary renders only with a result. */
async function waitForResult() {
  await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
}

/** A displayed amount (`$1,234.56` or `1,234.56`) back to cents. */
function centsOf(text: string): number {
  return Math.round(Number(text.replace(/[^0-9.-]/g, '')) * 100)
}

describe('rows replace the single savings total (AC-1, AC-9)', () => {
  it('lists one row per active-profile savings row, in display order, with name, balance and contribution', () => {
    // The store keeps its array in display order on every write
    // (`sortByDisplayOrder`), so the fixture is written in that order too.
    useSavingsStore.setState({
      savingsGoals: [
        goal({
          id: 'g-1',
          name: 'Emergency fund',
          currentBalance: 345_600,
          allocationMode: 'manual',
          monthlyAllocation: 20_000,
          targetAmount: null,
          sortOrder: 0,
        }),
        {
          ...goal({ id: 'g-other', name: 'Other profile', sortOrder: 1 }),
          profileId: 'someone-else',
        },
        goal({ id: 'g-2', name: 'House fund', currentBalance: 250_000, sortOrder: 2 }),
      ],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)

    const section = screen.getByRole('region', { name: 'Savings Accounts' })
    // Store display order, goals and target-less accounts alike, and only the
    // active profile's rows.
    const names = within(section)
      .getAllByLabelText(/^Account Name, row \d+$/)
      .map((input) => (input as HTMLInputElement).value)
    expect(names).toEqual(['Emergency fund', 'House fund'])
    expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue(3456)
    expect(screen.getByLabelText('Monthly Contribution for Emergency fund')).toHaveValue(200)
    expect(screen.getByLabelText('Balance for House fund')).toHaveValue(2500)

    // The single total is gone. (Current Investments went too, in story 100.2:
    // `scenario-builder.balance-rows.test.tsx`.)
    expect(screen.queryByLabelText('Current Savings')).toBeNull()
    expect(screen.getByRole('region', { name: 'Investments & Debts' })).toBeInTheDocument()
  })

  it('carries the what-if note under the heading (copy pin, AC-9)', () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)
    const section = screen.getByRole('region', { name: 'Savings Accounts' })
    expect(
      within(section).getByText("What-if only: changes here don't change your Savings page.")
    ).toBeInTheDocument()
  })
})

describe('the starting figure is unchanged (AC-2)', () => {
  it('shows a Starting Net Worth equal to the savings total plus investments', async () => {
    useSavingsStore.setState({
      savingsGoals: [
        goal({ id: 'g-1', name: 'A', currentBalance: 345_601, sortOrder: 0 }),
        goal({ id: 'g-2', name: 'B', currentBalance: 0, sortOrder: 1 }),
        goal({ id: 'g-3', name: 'C', currentBalance: 1_000_000, sortOrder: 2 }),
      ],
    })
    useBalanceStore.setState({
      entries: [investment({ id: 'inv-1', name: 'Index', currentBalance: 987_600 })] as never,
    })
    const totals = renderHook(() => ({
      savings: useTotalSavings(),
      investments: useTotalInvestmentBalance(),
    })).result.current
    // Independent of the hooks: 345601 + 0 + 1000000 + 987600.
    expect(totals.savings + totals.investments).toBe(2_333_201)
    const format = formatter()

    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    const card = screen.getByText('Starting Net Worth').nextElementSibling as HTMLElement
    expect(card.textContent).toBe(format(totals.savings + totals.investments))
  })
})

describe('contributions seed from the same figures /savings shows (AC-3)', () => {
  /**
   * income 500001 − expense 150000 = net 350001. Counted contributions: 50000
   * (monthly) + 10000 (a corrupt `quarterly` cadence degrades to monthly); the
   * 20000/wk row is recorded as an expense, so it is NOT counted. Manual 130000.
   * Pool 350001 − 60000 − 130000 = 160001 across 3 automatic rows: 53334, 53334,
   * 53333 (the remainder cents go to the first rows in order).
   */
  function fillParityFixture(): void {
    useIncomeStore.setState({ incomeSources: [income(500_001)] })
    useExpenseStore.setState({ expenses: [expense(150_000)] })
    useBalanceStore.setState({
      entries: [
        investment({ id: 'inv-1', name: 'RRSP', monthlyContribution: 50_000 }),
        investment({
          id: 'inv-2',
          name: 'Pension',
          monthlyContribution: 20_000,
          frequency: 'weekly',
          contributionRecordedAsExpense: true,
        }),
        investment({
          id: 'inv-3',
          name: 'Odd',
          monthlyContribution: 10_000,
          frequency: 'quarterly',
        }),
      ] as never,
    })
    useSavingsStore.setState({
      savingsGoals: [
        goal({
          id: 'manual-1',
          name: 'Fixed pot',
          allocationMode: 'manual',
          monthlyAllocation: 130_000,
          sortOrder: 0,
        }),
        goal({ id: 'auto-1', name: 'Auto one', sortOrder: 1 }),
        goal({ id: 'auto-2', name: 'Auto two', targetAmount: null, sortOrder: 2 }),
        goal({ id: 'auto-3', name: 'Auto three', sortOrder: 3 }),
      ],
    })
  }

  const ROWS = [
    { id: 'manual-1', name: 'Fixed pot', cents: 130_000 },
    { id: 'auto-1', name: 'Auto one', cents: 53_334 },
    { id: 'auto-2', name: 'Auto two', cents: 53_334 },
    { id: 'auto-3', name: 'Auto three', cents: 53_333 },
  ]

  it('seeds every row with the figure /savings shows for it, for the same store state', () => {
    fillParityFixture()

    const savings = renderWithProviders(<SavingsPage />)
    const shown = ROWS.map((row) =>
      centsOf(screen.getByTestId(`savings-allocation-${row.id}`).textContent ?? '')
    )
    savings.unmount()

    render(<ScenarioBuilder onSave={vi.fn()} />)
    const seeded = ROWS.map((row) =>
      Math.round(
        Number(
          (screen.getByLabelText(`Monthly Contribution for ${row.name}`) as HTMLInputElement).value
        ) * 100
      )
    )

    expect(seeded, 'builder vs /savings').toEqual(shown)
    // Both against the hand-computed split, so a shared wrong figure cannot pass.
    expect(shown).toEqual(ROWS.map((row) => row.cents))
  })

  it('seeds automatic rows 0 and still renders when the solver throws on a corrupt amount', () => {
    useIncomeStore.setState({ incomeSources: [income(Number.NaN)] })
    useSavingsStore.setState({
      savingsGoals: [
        goal({
          id: 'manual-1',
          name: 'Fixed pot',
          allocationMode: 'manual',
          monthlyAllocation: 130_000,
          sortOrder: 0,
        }),
        goal({ id: 'auto-1', name: 'Auto one', sortOrder: 1 }),
      ],
    })
    // Positive control (review): the solver really throws for this fixture, so
    // the builder's `catch` is the path under test.
    expect(() =>
      solveAutomaticAllocations({
        incomeSources: useIncomeStore.getState().incomeSources,
        expenses: [],
        investmentContributions: [],
        savingsAccounts: useSavingsStore.getState().savingsGoals,
      })
    ).toThrow()
    render(<ScenarioBuilder onSave={vi.fn()} />)

    expect(screen.getByLabelText('Scenario Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Monthly Contribution for Fixed pot')).toHaveValue(1300)
    expect(screen.getByLabelText('Monthly Contribution for Auto one')).toHaveValue(0)
  })

  it('coerces a corrupt manual allocation to 0, as the solver counts it', () => {
    useSavingsStore.setState({
      savingsGoals: [
        goal({
          id: 'm-1',
          name: 'Negative',
          allocationMode: 'manual',
          monthlyAllocation: -500,
          sortOrder: 0,
        }),
        goal({
          id: 'm-2',
          name: 'Not a number',
          allocationMode: 'manual',
          monthlyAllocation: Number.NaN,
          sortOrder: 1,
        }),
      ],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)

    expect(screen.getByLabelText('Monthly Contribution for Negative')).toHaveValue(0)
    expect(screen.getByLabelText('Monthly Contribution for Not a number')).toHaveValue(0)
  })
})

describe('what-if only: nothing reaches the savings store (AC-4, D0)', () => {
  it('a full edit sequence calls no savings-store action and leaves the persisted bytes unchanged', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useSavingsStore.setState({
      savingsGoals: [
        goal({ id: 'g-1', name: 'Emergency fund', currentBalance: 100_000, sortOrder: 0 }),
        goal({ id: 'g-2', name: 'House fund', currentBalance: 200_000, sortOrder: 1 }),
      ],
    })
    const before = localStorage.getItem(SAVINGS_GOALS_STORAGE_KEY)
    const stateBefore = useSavingsStore.getState().savingsGoals
    // Positive control: the key really is persisted, so "unchanged" is a claim.
    expect(before).toContain('Emergency fund')

    const state = useSavingsStore.getState() as unknown as Record<string, unknown>
    const actions = Object.keys(state)
      .filter((key) => typeof state[key] === 'function')
      .map((key) => vi.spyOn(state as Record<string, () => unknown>, key))
    expect(actions.length).toBeGreaterThan(3)
    const setState = vi.spyOn(useSavingsStore, 'setState')

    render(<ScenarioBuilder onSave={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Emergency fund'), {
      target: { value: 'Rainy day' },
    })
    fireEvent.change(screen.getByLabelText('Balance for Rainy day'), { target: { value: '9999' } })
    fireEvent.change(screen.getByLabelText('Monthly Contribution for Rainy day'), {
      target: { value: '50' },
    })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove House fund' }))
    await waitForResult()

    for (const spy of actions) expect(spy).not.toHaveBeenCalled()
    expect(setState).not.toHaveBeenCalled()
    expect(localStorage.getItem(SAVINGS_GOALS_STORAGE_KEY)).toBe(before)
    expect(useSavingsStore.getState().savingsGoals).toBe(stateBefore)
  })
})

describe('add and remove rows (AC-5)', () => {
  it('adds a New Account row at 0/0, names each remove button after its row, and can empty the list', () => {
    useSavingsStore.setState({
      savingsGoals: [goal({ id: 'g-1', name: 'Emergency fund', currentBalance: 100_000 })],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }))
    expect(screen.getByDisplayValue('New Account')).toBeInTheDocument()
    expect(screen.getByLabelText('Balance for New Account')).toHaveValue(0)
    expect(screen.getByLabelText('Monthly Contribution for New Account')).toHaveValue(0)

    // A blank name falls back to a generic, still-meaningful name.
    fireEvent.change(screen.getByDisplayValue('New Account'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Remove account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Balance for account')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Emergency fund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))

    // No "at least one item" rule for savings rows.
    expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
    expect(screen.queryByText('At least one item is required')).toBeNull()
  })
})

describe('the per-row outcome (AC-7, AC-8, D5)', () => {
  /** 5,000.00/mo in, 4,000.00/mo out: 12,000.00 a year left over. */
  function fillOutcomeFixture(contributionCents: number): void {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [expense(400_000)] })
    useSavingsStore.setState({
      savingsGoals: [
        goal({
          id: 'g-1',
          name: 'House fund',
          currentBalance: 100_000,
          allocationMode: 'manual',
          monthlyAllocation: contributionCents,
        }),
      ],
    })
  }

  it('shows each row after N years and the part not assigned to any account', async () => {
    fillOutcomeFixture(20_000)
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    const row = screen.getByLabelText('Balance for House fund').closest('.surface') as HTMLElement
    // 1,000.00 + 200.00 × 12 × 10.
    await waitFor(() =>
      expect(within(row).getByText(/^After 10 years:/).textContent).toBe(
        `After 10 years: ${format(2_500_000)}`
      )
    )
    // (12,000.00 − 2,400.00) × 10.
    expect(screen.getByTestId('savings-unassigned').textContent).toBe(
      `Not assigned to an account after 10 years: ${format(9_600_000)}`
    )
    // Plain text, not a live region (AC-16).
    expect(
      within(row)
        .getByText(/^After 10 years:/)
        .closest('[aria-live]')
    ).toBeNull()
  })

  it('moves the row figure when its contribution is edited, while the summary stays put', async () => {
    fillOutcomeFixture(20_000)
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    const ending = () =>
      (screen.getByText('Ending Net Worth').nextElementSibling as HTMLElement).textContent
    const endingBefore = ending()

    fireEvent.change(screen.getByLabelText('Monthly Contribution for House fund'), {
      target: { value: '500' },
    })
    // 1,000.00 + 500.00 × 12 × 10.
    await waitFor(
      () =>
        expect(screen.getByText(/^After 10 years:/).textContent).toBe(
          `After 10 years: ${format(6_100_000)}`
        ),
      { timeout: 3000 }
    )
    expect(ending(), 'a contribution only splits savings').toBe(endingBefore)
  })

  it('says by how much contributions exceed what is left over, in amber, when they do', async () => {
    fillOutcomeFixture(150_000)
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    const line = screen.getByTestId('savings-unassigned')
    // (18,000.00 − 12,000.00) × 10, applied in full (AC-7).
    expect(line.textContent).toBe(
      `Your contributions are ${format(6_000_000)} more than you have left over by year 10`
    )
    expect(line.className).toContain('text-amber-800')
    expect(line.className).not.toContain('text-red')
    // The row still gets every contribution: 1,000.00 + 1,500.00 × 12 × 10.
    expect(screen.getByText(/^After 10 years:/).textContent).toBe(
      `After 10 years: ${format(18_100_000)}`
    )
  })

  it('reads "1 year" for a one-year period', async () => {
    fillOutcomeFixture(20_000)
    render(<ScenarioBuilder onSave={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Projection Period (years)'), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByText(/^After 1 year:/)).toBeInTheDocument(), {
      timeout: 3000,
    })
  })
})

describe('each money field reports its own validity (AC-10)', () => {
  it('two bad fields in one row both block Save, and fixing one does not unblock the other', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useSavingsStore.setState({
      savingsGoals: [goal({ id: 'g-1', name: 'House fund', currentBalance: 100_000 })],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    const balance = screen.getByLabelText('Balance for House fund')
    const contribution = screen.getByLabelText('Monthly Contribution for House fund')
    const reason = () => screen.queryByTestId('save-blocked-reason')?.textContent ?? null

    fireEvent.change(balance, { target: { value: '-5' } })
    fireEvent.change(contribution, { target: { value: '-1' } })
    expect(balance).toHaveAttribute('aria-invalid', 'true')
    expect(contribution).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText('Enter an amount of 0 or more.')).toHaveLength(2)
    expect(reason()).toBe('Fix the highlighted fields to save')

    fireEvent.change(balance, { target: { value: '5' } })
    expect(balance).not.toHaveAttribute('aria-invalid')
    expect(reason(), 'the contribution is still bad').toBe('Fix the highlighted fields to save')

    fireEvent.change(contribution, { target: { value: '1' } })
    expect(reason()).toBeNull()
  })

  it('refuses an overflowing value with the field own message', async () => {
    useSavingsStore.setState({
      savingsGoals: [goal({ id: 'g-1', name: 'House fund', currentBalance: 100_000 })],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Balance for House fund'), {
      target: { value: '1e308' },
    })
    expect(screen.getByText('Enter a smaller amount.')).toBeInTheDocument()
  })

  it('withdraws a removed row report, so a deleted bad row cannot keep Save blocked', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useSavingsStore.setState({
      savingsGoals: [goal({ id: 'g-1', name: 'House fund', currentBalance: 100_000 })],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    fireEvent.change(screen.getByLabelText('Balance for House fund'), { target: { value: '-5' } })
    expect(screen.getByTestId('save-blocked-reason')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove House fund' }))
    expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
  })
})

describe('save writes the rows and the total (AC-11)', () => {
  it('hands onSave the rows in order and savings as their sum', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useSavingsStore.setState({
      savingsGoals: [
        goal({
          id: 'g-1',
          name: 'Emergency fund',
          currentBalance: 100_000,
          allocationMode: 'manual',
          monthlyAllocation: 20_000,
          sortOrder: 0,
        }),
        goal({
          id: 'g-2',
          name: 'House fund',
          currentBalance: 250_001,
          allocationMode: 'manual',
          monthlyAllocation: 0,
          sortOrder: 1,
        }),
      ],
    })
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)

    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const { inputs } = onSave.mock.calls[0][0]
    expect(inputs.savingsAccounts).toEqual([
      { name: 'Emergency fund', balance: 100_000, monthlyContribution: 20_000 },
      { name: 'House fund', balance: 250_001, monthlyContribution: 0 },
    ])
    expect(inputs.savings).toBe(350_001)
  })
})

/** A saved forecast for the builder's `initialForecast`, with the given inputs and result. */
function savedForecast(inputs: unknown, result?: SavedForecast['result']): SavedForecast {
  return {
    id: 'saved-1',
    name: 'Plan',
    scenario: {
      name: 'Plan',
      incomeGrowthRate: 0,
      expenseGrowthRate: 0,
      newIncome: [{ amount: 500_000, frequency: 'monthly' }],
    },
    result: result ?? {
      scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
      baseline: [],
      projection: [],
      summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
    },
    inputs: inputs as SavedForecast['inputs'],
    createdAt: ISO,
    updatedAt: ISO,
  }
}

describe('code review fixes (2026-10-05)', () => {
  it('flags a negative saved balance on the field from the start, and holds Save and the engine (Lucas decision)', async () => {
    // A v1 forecast saved when the old Current Savings field accepted `-5`.
    render(
      <ScenarioBuilder
        onSave={vi.fn()}
        initialForecast={savedForecast({ savings: -500, investments: 0, years: 10 })}
      />
    )
    const balance = screen.getByLabelText('Balance for Savings')
    expect(balance).toHaveValue(-5)
    expect(balance).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter an amount of 0 or more.')).toBeInTheDocument()
    // The saved result is on screen, so the Save area renders: blocked, with the reason.
    expect(screen.getByTestId('save-blocked-reason').textContent).toBe(
      'Fix the highlighted fields to save'
    )
    // The recompute is held, so no engine refusal banner either.
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(screen.queryByTestId('calculation-error')).toBeNull()

    // Fixing the field releases both.
    fireEvent.change(balance, { target: { value: '5' } })
    expect(balance).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
  })

  it('does not blame contributions when net income itself is negative and nothing is contributed', async () => {
    useIncomeStore.setState({ incomeSources: [income(400_000)] })
    useExpenseStore.setState({ expenses: [expense(500_000)] })
    useSavingsStore.setState({
      savingsGoals: [
        goal({
          id: 'g-1',
          name: 'House fund',
          currentBalance: 100_000,
          allocationMode: 'manual',
          monthlyAllocation: 0,
        }),
      ],
    })
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    const line = screen.getByTestId('savings-unassigned')
    // (4,000.00 − 5,000.00) × 12 × 10 = −120,000.00, none of it contributed.
    expect(line.textContent).toBe(
      `Not assigned to an account after 10 years: ${format(-12_000_000)}`
    )
    expect(line.className).not.toContain('text-amber')
  })

  it('shows no not-assigned line when the scenario has no savings rows', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
    expect(screen.queryByTestId('savings-unassigned')).toBeNull()
  })

  it('hides the not-assigned line while the result no longer matches the rows', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useSavingsStore.setState({
      savingsGoals: [goal({ id: 'g-1', name: 'House fund', currentBalance: 100_000 })],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    expect(screen.getByTestId('savings-unassigned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }))
    // Before the debounced recompute: the result describes one row, the list has two.
    expect(screen.queryByTestId('savings-unassigned')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('savings-unassigned')).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  it('shows a loaded forecast per-row lines straight away, from its saved result', () => {
    const rows = [{ name: 'House fund', balance: 100_000, monthlyContribution: 20_000 }]
    const projection = [
      {
        year: 1,
        income: 0,
        expenses: 0,
        netIncome: 0,
        savings: 340_000,
        investments: 0,
        netWorth: 340_000,
        savingsAccounts: [340_000],
        unallocatedSavings: 0,
      },
    ]
    const format = formatter()
    render(
      <ScenarioBuilder
        onSave={vi.fn()}
        initialForecast={savedForecast(
          { savings: 100_000, investments: 0, years: 1, savingsAccounts: rows },
          {
            scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
            baseline: [],
            projection,
            summary: {
              startingNetWorth: 100_000,
              endingNetWorth: 340_000,
              totalGrowth: 240_000,
              averageAnnualGrowth: 240_000,
            },
          }
        )}
      />
    )
    // No waiting for the debounce: the saved result already covers these rows.
    expect(screen.getByText(/^After 1 year:/).textContent).toBe(`After 1 year: ${format(340_000)}`)
    expect(screen.getByTestId('savings-unassigned')).toBeInTheDocument()
  })

  it('survives a null entry and a non-array savingsAccounts handed straight to the builder', () => {
    render(
      <ScenarioBuilder
        onSave={vi.fn()}
        initialForecast={savedForecast({
          savings: 1_000,
          investments: 0,
          years: 10,
          savingsAccounts: [null, { name: 'Ok', balance: 1_000, monthlyContribution: 0 }],
        })}
      />
    )
    expect(screen.getByLabelText('Balance for Ok')).toHaveValue(10)
    expect(screen.getAllByLabelText(/^Account Name, row \d+$/)).toHaveLength(2)
    cleanupAndRender(
      savedForecast({ savings: 1_234, investments: 0, years: 10, savingsAccounts: 'oops' })
    )
    // Not an array: loads as the v1 total.
    expect(screen.getByLabelText('Balance for Savings')).toHaveValue(12.34)
  })

  it('names each row name field by its position and turns autofill off on every row input', () => {
    useSavingsStore.setState({
      savingsGoals: [
        goal({ id: 'g-1', name: 'Same name', sortOrder: 0 }),
        goal({ id: 'g-2', name: 'Same name', sortOrder: 1 }),
      ],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Account Name, row 1')).toHaveValue('Same name')
    expect(screen.getByLabelText('Account Name, row 2')).toHaveValue('Same name')
    const section = screen.getByRole('region', { name: 'Savings Accounts' })
    for (const input of within(section).getAllByRole('textbox')) {
      expect(input).toHaveAttribute('autocomplete', 'off')
    }
    for (const input of within(section).getAllByRole('spinbutton')) {
      expect(input).toHaveAttribute('autocomplete', 'off')
    }
  })
})

function cleanupAndRender(forecast: SavedForecast): void {
  document.body.innerHTML = ''
  render(<ScenarioBuilder onSave={vi.fn()} initialForecast={forecast} />)
}

describe('rounding cents are not over-contribution (story 111.1 review, D1)', () => {
  /**
   * The forecast annualises exactly (111.1) while an automatic row's allocation is
   * monthly-canonical. 100.00/wk is 520,000 a year exactly but 43,333 × 12 =
   * 519,996 monthly-canonical: 4 cents a year the allocation over-counts the
   * left-over, 40 by year 10. Tolerance: 6 × 1 non-monthly entry × 10 years = 60.
   */
  it('a fully allocated automatic row shows no amber line, and 0.00 unassigned', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [{ ...expense(10_000), frequency: 'weekly' as const }] })
    useSavingsStore.setState({
      savingsGoals: [goal({ id: 'g-1', name: 'House fund', allocationMode: 'automatic' })],
    })
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    await waitFor(() =>
      expect(screen.getByTestId('savings-unassigned').textContent).toBe(
        `Not assigned to an account after 10 years: ${format(0)}`
      )
    )
  })

  /** 5,000.00/mo in, one ANNUAL expense, a manual 4,000.00/mo row: 12 × 400,000 − net. */
  function fillShortfallFixture(annualExpenseCents: number): void {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({
      expenses: [{ ...expense(annualExpenseCents), frequency: 'annually' as const }],
    })
    useSavingsStore.setState({
      savingsGoals: [
        goal({
          id: 'g-1',
          name: 'House fund',
          allocationMode: 'manual',
          monthlyAllocation: 400_000,
        }),
      ],
    })
  }

  it('a shortfall exactly at the tolerance stays quiet', async () => {
    // Net 6,000,000 − 1,200,006 = 4,799,994; contributions 4,800,000: 6 a year, 60 = tolerance.
    fillShortfallFixture(1_200_006)
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    await waitFor(() =>
      expect(screen.getByTestId('savings-unassigned').textContent).toBe(
        `Not assigned to an account after 10 years: ${format(0)}`
      )
    )
  })

  it('a shortfall one step above the tolerance still warns, with the full amount', async () => {
    // Net 4,799,993; contributions 4,800,000: 7 a year, 70 > 60.
    fillShortfallFixture(1_200_007)
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    await waitFor(() =>
      expect(screen.getByTestId('savings-unassigned').textContent).toBe(
        `Your contributions are ${format(70)} more than you have left over by year 10`
      )
    )
  })
})
