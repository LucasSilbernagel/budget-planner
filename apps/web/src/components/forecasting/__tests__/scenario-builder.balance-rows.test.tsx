/**
 * Investments and debts as what-if rows in the Scenario Builder (story 100.2,
 * FR165).
 *
 * Integration tests: the real builder, the real stores, the real engine and the
 * real currency store. Only the debounce is waited on. The one thing mocked is
 * `useIsInitialSyncPending`, as a pass-through spy, so the `nothingToSeed`
 * argument the builder hands it can be read (AC-6). The engine is the REAL one,
 * wrapped only to record each call's balance rows (story 100.3: a bad rate must
 * never reach it).
 *
 * Story 100.3: every investment row now compounds at its OWN annual return,
 * seeded at 6%. Every figure below that involves investment growth was re-derived
 * by hand at 6% (it was 7% in 100.2).
 *
 * Unlike the savings rows (100.1), these rows MOVE totals: a counted investment
 * contribution moves money from savings into investments, a debt lowers net
 * worth and falls by its payment.
 */

import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore, useTotalInvestmentBalance } from '../../../stores/balanceStore'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

const engineRows = vi.hoisted(() => [] as unknown[][])
vi.mock('@budget-planner/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@budget-planner/core')>()
  return {
    ...real,
    calculateFinancialForecast: (...args: Parameters<typeof real.calculateFinancialForecast>) => {
      engineRows.push([...(args[0].balanceAccounts ?? [])])
      return real.calculateFinancialForecast(...args)
    },
  }
})

const syncPendingCalls = vi.hoisted(() => [] as boolean[])
vi.mock('../../../hooks/useIsInitialSyncPending', () => ({
  useIsInitialSyncPending: (isCollectionEmpty: boolean) => {
    syncPendingCalls.push(isCollectionEmpty)
    return false
  },
}))

const ISO = '2026-10-05T00:00:00.000Z'
const PROFILE = 'profile-balance-rows'
const BALANCE_STORAGE_KEY = 'budget-planner:balance-tracking'

function income(amount: number) {
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
  }
}

function expense(
  amount: number,
  over: {
    id?: string
    name?: string
    frequency?: 'weekly' | 'biweekly' | 'monthly' | 'annually'
    profileId?: string
  } = {}
) {
  return {
    id: 'exp-1',
    profileId: PROFILE,
    userId: 0,
    name: 'Rent',
    amount,
    frequency: 'monthly' as 'weekly' | 'biweekly' | 'monthly' | 'annually',
    categoryId: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  }
}

function entry(over: {
  id: string
  name: string
  type?: 'investment' | 'debt' | 'asset'
  currentBalance?: number
  monthlyContribution?: number
  frequency?: string
  contributionRecordedAsExpense?: boolean
  paymentExpenseId?: unknown
  profileId?: string
  sortOrder?: number
}) {
  return {
    profileId: PROFILE,
    type: 'investment' as 'investment' | 'debt' | 'asset',
    currentBalance: 0,
    monthlyContribution: 0,
    frequency: 'monthly',
    sortOrder: 0,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  }
}

function savingsRow(over: { id: string; name: string; currentBalance?: number }) {
  return {
    profileId: PROFILE,
    targetAmount: null,
    currentBalance: 0,
    allocationMode: 'manual' as const,
    monthlyAllocation: 0,
    sortOrder: 0,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  }
}

function setEntries(entries: ReturnType<typeof entry>[]): void {
  useBalanceStore.setState({ entries: entries as never })
}

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
}

/** Every result the builder lifts to the page (story 102.2 reads its yearly figures). */
const onResult = vi.fn()

beforeEach(() => {
  onResult.mockReset()
  clearStores()
  syncPendingCalls.length = 0
  engineRows.length = 0
  useProfileStore.setState({ activeProfileId: PROFILE })
})

afterEach(() => {
  clearStores()
  vi.restoreAllMocks()
})

function formatter(): (cents: number) => string {
  return renderHook(() => useFormattedAmount()).result.current
}

async function waitForResult() {
  await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
}

function section(): HTMLElement {
  return screen.getByRole('region', { name: 'Investments & Debts' })
}

function rowNames(): string[] {
  return within(section())
    .queryAllByLabelText(/^Balance Name, row \d+$/)
    .map((input) => (input as HTMLInputElement).value)
}

function card(label: string): string {
  return (screen.getByText(label).nextElementSibling as HTMLElement).textContent ?? ''
}

async function setYears(years: number) {
  fireEvent.change(screen.getByLabelText('Projection Period (years)'), {
    target: { value: String(years) },
  })
  await waitFor(
    () =>
      expect(within(section()).getAllByText(new RegExp(`${years} years?`)).length).toBeGreaterThan(
        0
      ),
    { timeout: 3000 }
  )
}

describe('rows replace the investments total (AC-1, AC-11)', () => {
  it('lists the active profile investments and debts in store order, with every field; assets and other profiles are left out', () => {
    setEntries([
      entry({ id: 'e-1', name: 'Pension', currentBalance: 1_000_000, monthlyContribution: 5_000 }),
      entry({ id: 'e-2', name: 'House', type: 'asset', currentBalance: 30_000_000 }),
      entry({ id: 'e-3', name: 'Car loan', type: 'debt', currentBalance: 400_000 }),
      entry({ id: 'e-4', name: 'Other profile fund', profileId: 'someone-else' }),
      entry({ id: 'e-5', name: 'ISA', currentBalance: 50_000 }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)

    expect(rowNames()).toEqual(['Pension', 'Car loan', 'ISA'])
    expect(screen.getByLabelText('Type for Pension')).toHaveValue('investment')
    expect(screen.getByLabelText('Type for Car loan')).toHaveValue('debt')
    expect(screen.getByLabelText('Balance for Pension')).toHaveValue('10,000.00')
    expect(screen.getByLabelText('Contribution for Pension')).toHaveValue('50.00')
    expect(screen.getByLabelText('Frequency for Pension')).toHaveValue('monthly')
    // The flag on investment rows only.
    expect(
      screen.getByLabelText('Not taken from the money left over, for Pension')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Not taken from the money left over, for Car loan')).toBeNull()
    // A debt row carries its own label for the same flag (story 102.2, D2).
    expect(screen.getByLabelText('Payment already in Expenses, for Car loan')).not.toBeChecked()
    // The single total is gone.
    expect(screen.queryByLabelText('Current Investments')).toBeNull()
  })

  it('carries the heading and the what-if note (copy pin, AC-11)', () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(
      within(section()).getByRole('heading', { name: 'Investments & Debts' })
    ).toBeInTheDocument()
    expect(
      within(section()).getByText(
        "What-if only: changes here don't change your Balance Tracking page. Debts count against your starting net worth. Things you own outright (assets) aren't included."
      )
    ).toBeInTheDocument()
  })

  it('names every control after its row and turns autofill off (AC-15)', () => {
    setEntries([
      entry({ id: 'e-1', name: 'Same', sortOrder: 0 }),
      entry({ id: 'e-2', name: 'Same', type: 'debt', sortOrder: 1 }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Balance Name, row 1')).toHaveValue('Same')
    expect(screen.getByLabelText('Balance Name, row 2')).toHaveValue('Same')
    for (const control of within(section()).getAllByRole('textbox')) {
      expect(control).toHaveAttribute('autocomplete', 'off')
    }
    // The money fields were spinbuttons until story 109.1; they are textboxes now,
    // so the loop above covers them. Pin the COUNT, so the loop cannot pass
    // without them: a Balance and a Contribution on each of the two rows.
    const money = within(section()).getAllByLabelText(/^(Balance|Contribution) for Same$/)
    expect(money).toHaveLength(4)
    for (const control of money) {
      expect(control).toHaveRole('textbox')
      expect(control).toHaveAttribute('autocomplete', 'off')
    }
    // The checkbox keeps its visible label text inside its accessible name.
    const flag = screen.getByRole('checkbox', {
      name: 'Not taken from the money left over, for Same',
    })
    expect(flag).toHaveAttribute('autocomplete', 'off')
    // Stacks at 320 px, a grid from md (jsdom cannot lay out: pin the classes).
    const grid = flag.closest('.surface')?.querySelector('.grid') as HTMLElement
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('md:grid-cols-3')
  })
})

describe('the seed (AC-6)', () => {
  it('shows each contribution at its own frequency, as /balance does', () => {
    setEntries([
      entry({ id: 'e-1', name: 'Weekly', monthlyContribution: 2_500, frequency: 'weekly' }),
      entry({ id: 'e-2', name: 'Yearly', monthlyContribution: 600_000, frequency: 'annually' }),
      entry({ id: 'e-3', name: 'Odd', monthlyContribution: 1_000, frequency: 'quarterly' }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Contribution for Weekly')).toHaveValue('25.00')
    expect(screen.getByLabelText('Frequency for Weekly')).toHaveValue('weekly')
    expect(screen.getByLabelText('Contribution for Yearly')).toHaveValue('6,000.00')
    expect(screen.getByLabelText('Frequency for Yearly')).toHaveValue('annually')
    // An unrecognised frequency degrades to monthly.
    expect(screen.getByLabelText('Frequency for Odd')).toHaveValue('monthly')
  })

  it('seeds a negative stored debt as its magnitude, and a negative investment as 0 (D6)', () => {
    setEntries([
      entry({ id: 'e-1', name: 'Mortgage', type: 'debt', currentBalance: -98_765_432_100 }),
      entry({ id: 'e-2', name: 'Bad fund', currentBalance: -500 }),
      entry({ id: 'e-3', name: 'NaN debt', type: 'debt', currentBalance: Number.NaN }),
      entry({ id: 'e-5', name: 'Neg contrib', type: 'debt', monthlyContribution: -100 }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Balance for Mortgage')).toHaveValue('987,654,321.00')
    expect(screen.getByLabelText('Balance for Mortgage')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByLabelText('Balance for Bad fund')).toHaveValue('0.00')
    expect(screen.getByLabelText('Balance for NaN debt')).toHaveValue('0.00')
    expect(screen.getByLabelText('Contribution for Neg contrib')).toHaveValue('0.00')
  })

  it('survives a non-finite stored investment contribution and seeds it as 0', async () => {
    // It used to throw in the store's `withTimeline` (reached through
    // `useInvestmentEntries`) before the seed ran, taking the whole builder down.
    setEntries([
      entry({ id: 'e-1', name: 'NaN fund', monthlyContribution: Number.NaN }),
      entry({ id: 'e-2', name: 'Null fund', monthlyContribution: null as unknown as number }),
      entry({ id: 'e-4', name: 'Inf fund', monthlyContribution: Number.POSITIVE_INFINITY }),
      entry({ id: 'e-3', name: 'Pension', currentBalance: 1_000_000, monthlyContribution: 5_000 }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(rowNames()).toEqual(['NaN fund', 'Null fund', 'Inf fund', 'Pension'])
    expect(screen.getByLabelText('Contribution for NaN fund')).toHaveValue('0.00')
    expect(screen.getByLabelText('Contribution for Null fund')).toHaveValue('0.00')
    expect(screen.getByLabelText('Contribution for Inf fund')).toHaveValue('0.00')
    expect(screen.getByLabelText('Contribution for Pension')).toHaveValue('50.00')
    await waitForResult()
  })

  it('keeps the flag on an investment only', async () => {
    setEntries([
      entry({ id: 'e-1', name: 'Pension', contributionRecordedAsExpense: true }),
      // A sync-applied debt can carry the flag (it is only enforced on write).
      entry({ id: 'e-2', name: 'Loan', type: 'debt', contributionRecordedAsExpense: true }),
    ])
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    expect(screen.getByLabelText('Not taken from the money left over, for Pension')).toBeChecked()
    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0][0].inputs.balanceAccounts
    expect(
      saved.map((a: { contributionRecordedAsExpense: boolean }) => a.contributionRecordedAsExpense)
    ).toEqual([true, false])
  })

  it('counts a debt-only user as something to seed (nothingToSeed reads rows, not the investment total)', () => {
    setEntries([entry({ id: 'e-1', name: 'Loan', type: 'debt', currentBalance: 100_000 })])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(syncPendingCalls.length).toBeGreaterThan(0)
    expect(syncPendingCalls.every((empty) => empty === false)).toBe(true)
    // Control: an asset alone is NOT something to seed.
    syncPendingCalls.length = 0
    document.body.innerHTML = ''
    setEntries([entry({ id: 'e-2', name: 'House', type: 'asset', currentBalance: 100_000 })])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(syncPendingCalls.at(-1)).toBe(true)
  })
})

describe('a debt seeds its payment from its linked expense (story 102.1, AC-10)', () => {
  it('seeds the linked expense amount at the expense’s own frequency', () => {
    useExpenseStore.setState({
      expenses: [expense(15_000, { id: 'exp-car', name: 'Car payment', frequency: 'biweekly' })],
    })
    setEntries([
      entry({
        id: 'e-1',
        name: 'Car loan',
        type: 'debt',
        currentBalance: 900_000,
        paymentExpenseId: 'exp-car',
      }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Contribution for Car loan')).toHaveValue('150.00')
    expect(screen.getByLabelText('Frequency for Car loan')).toHaveValue('biweekly')
  })

  it('⚠️ never seeds a debt from its own stored contribution (pre-102.1 rows)', () => {
    setEntries([
      entry({
        id: 'e-1',
        name: 'Old loan',
        type: 'debt',
        currentBalance: 900_000,
        monthlyContribution: 30_000,
      }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Contribution for Old loan')).toHaveValue('0.00')
  })

  it.each([
    ['a deleted or never-pulled expense', 'exp-gone'],
    ['another profile’s expense', 'exp-other'],
    ['a corrupt non-string value', 7],
  ])('seeds 0 for a link to %s', (_case, paymentExpenseId) => {
    useExpenseStore.setState({
      expenses: [expense(15_000, { id: 'exp-other', profileId: 'someone-else' })],
    })
    setEntries([
      entry({ id: 'e-1', name: 'Loan', type: 'debt', currentBalance: 900_000, paymentExpenseId }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Contribution for Loan')).toHaveValue('0.00')
  })

  it('seeds 0 for a linked expense whose stored amount is unreadable', () => {
    useExpenseStore.setState({
      expenses: [expense(Number.NaN, { id: 'exp-car', name: 'Car payment' })],
    })
    setEntries([
      entry({
        id: 'e-1',
        name: 'Loan',
        type: 'debt',
        currentBalance: 900_000,
        paymentExpenseId: 'exp-car',
      }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Contribution for Loan')).toHaveValue('0.00')
  })
})

/**
 * The linked expense MOVES into the debt row (story 102.2, FR170, AC-1, AC-8).
 * The payment becomes one cash line, the debt row's, taken from net income only
 * while the debt is owed.
 */
describe('the linked expense moves into the debt row (story 102.2)', () => {
  /** Every Expenses row name the builder shows, in order. */
  function expenseRowNames(): string[] {
    const expenses = screen.getByRole('heading', { name: 'Expense Categories' }).closest('section')
    if (!expenses) throw new Error('no Expense Categories section')
    return within(expenses)
      .queryAllByLabelText('Name')
      .map((input) => (input as HTMLInputElement).value)
  }

  function linkedFixture(): void {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({
      expenses: [expense(380_000), expense(20_000, { id: 'exp-loan', name: 'Loan payment' })],
    })
    setEntries([
      entry({
        id: 'e-1',
        name: 'Loan',
        type: 'debt',
        currentBalance: 300_000,
        paymentExpenseId: 'exp-loan',
      }),
    ])
  }

  it('leaves the expense out of the Expenses rows, labels the debt row, keeps its flag off and hidden, and keeps year 1 as it was (AC-1)', async () => {
    linkedFixture()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    expect(expenseRowNames()).toEqual(['Rent'])
    expect(screen.getByLabelText('Contribution for Loan')).toHaveValue('200.00')
    const label = within(section()).getByText('from Expenses: Loan payment')
    expect(label.className.split(/\s+/)).toContain('text-faint')
    // Code review 102.2 (Lucas): a labelled debt row has NO flag checkbox (its
    // payment is visibly the row's own; ticking it would count it nowhere).
    expect(within(section()).queryAllByRole('checkbox')).toHaveLength(0)
    await waitForResult()
    // Year 1 netIncome 1,200,000 and expenses 4,800,000: MEASURED at T0 by running
    // the UNCHANGED engine (main `f6f1e96`, core `src` through tsx) with Rent
    // 3,800.00 and Loan payment 200.00 both as expenses and the debt under 100.2
    // D4 (the run that produced `V4_RESULT` below; its extra investment row does
    // not touch `netIncome` or `expenses`). Not a run of the old builder itself.
    // The money moved, it did not change.
    await waitFor(() => expect(engineRows.length).toBeGreaterThan(0))
    const year1 = onResult.mock.calls.at(-1)?.[0]?.projection[0]
    expect(year1?.netIncome).toBe(1_200_000)
    expect(year1?.expenses).toBe(4_800_000)
  })

  it('lets one expense pay ONE debt: a second debt linked to it seeds unlinked, so it is never counted twice (AC-8)', () => {
    linkedFixture()
    setEntries([
      entry({
        id: 'e-1',
        name: 'Loan',
        type: 'debt',
        currentBalance: 300_000,
        paymentExpenseId: 'exp-loan',
        sortOrder: 0,
      }),
      entry({
        id: 'e-2',
        name: 'Twin',
        type: 'debt',
        currentBalance: 300_000,
        paymentExpenseId: 'exp-loan',
        sortOrder: 1,
      }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    expect(screen.getByLabelText('Contribution for Loan')).toHaveValue('200.00')
    expect(screen.getByLabelText('Contribution for Twin')).toHaveValue('0.00')
    expect(within(section()).getAllByText(/^from Expenses:/)).toHaveLength(1)
    expect(expenseRowNames()).toEqual(['Rent'])
  })

  it('removes no expense for a dangling link, and shows no label (AC-8)', () => {
    linkedFixture()
    setEntries([
      entry({
        id: 'e-1',
        name: 'Loan',
        type: 'debt',
        currentBalance: 300_000,
        paymentExpenseId: 'exp-gone',
      }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    expect(expenseRowNames()).toEqual(['Rent', 'Loan payment'])
    expect(screen.getByLabelText('Contribution for Loan')).toHaveValue('0.00')
    expect(within(section()).queryByText(/^from Expenses:/)).toBeNull()
  })

  it('an unlinked what-if debt pays from cash too: no row creates money (AC-4)', async () => {
    // 12,000.00 a year left over; + Add Balance → Debt 1,000.00 paying 100.00/mo.
    // Year 1, by hand: 1,000.00 paid (1,200.00 > the balance) → net 11,000.00.
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [expense(400_000)] })
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    await waitForResult()
    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    fireEvent.change(screen.getByLabelText('Type for New Investment'), {
      target: { value: 'debt' },
    })
    expect(
      screen.getByRole('checkbox', { name: 'Payment already in Expenses, for New Investment' })
    ).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('Balance for New Investment'), {
      target: { value: '1000' },
    })
    fireEvent.change(screen.getByLabelText('Contribution for New Investment'), {
      target: { value: '100' },
    })
    await waitFor(
      () => expect(onResult.mock.calls.at(-1)?.[0]?.projection[0]?.netIncome).toBe(1_100_000),
      { timeout: 3000 }
    )
  })

  it('on an UNLINKED debt whose payment is also an Expenses row, ticking the checkbox stops the double count, by hand (D2)', async () => {
    // Rent 3,800.00 + Car payment 200.00 (NOT linked) = 4,000.00 a month, so
    // 12,000.00 a year left over. Car loan 3,000.00, its payment typed as 200.00.
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({
      expenses: [expense(380_000), expense(20_000, { id: 'exp-car', name: 'Car payment' })],
    })
    setEntries([entry({ id: 'e-1', name: 'Car loan', type: 'debt', currentBalance: 300_000 })])
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    await waitForResult()
    await setYears(2)
    fireEvent.change(screen.getByLabelText('Contribution for Car loan'), {
      target: { value: '200' },
    })
    // Unflagged, 2 years: Y1 pays 2,400.00 → 9,600.00 kept; Y2 pays the 600.00
    // remainder → 11,400.00 kept. Savings 21,000.00, debt 0: ending 21,000.00.
    await waitFor(() => expect(card('Ending Net Worth')).toBe(format(2_100_000)), {
      timeout: 3000,
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Payment already in Expenses, for Car loan' })
    )
    // Flagged: the Expenses row alone takes the payment: 2 × 12,000.00 = 24,000.00.
    await waitFor(() => expect(card('Ending Net Worth')).toBe(format(2_400_000)), {
      timeout: 3000,
    })
  })

  it('shows no debt checkbox on an investment row, and the investment flag on no debt row (AC-9)', () => {
    setEntries([
      entry({ id: 'e-1', name: 'Pension', currentBalance: 100_000 }),
      entry({ id: 'e-2', name: 'Card', type: 'debt', currentBalance: 50_000 }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.queryByLabelText('Payment already in Expenses, for Pension')).toBeNull()
    expect(screen.getByLabelText('Not taken from the money left over, for Pension')).toBeTruthy()
    expect(screen.queryByLabelText('Not taken from the money left over, for Card')).toBeNull()
    expect(screen.getByLabelText('Payment already in Expenses, for Card')).toBeTruthy()
  })

  it.each([
    ['a paid-off debt (balance 0)', { currentBalance: 0 }, 20_000],
    ['a corrupt debt balance (seeds 0, D6)', { currentBalance: Number.NaN }, 20_000],
    ['a negative linked expense', { currentBalance: 300_000 }, -20_000],
    ['an unreadable linked amount', { currentBalance: 300_000 }, Number.NaN],
  ])(
    'does not move the expense for %s: the money stays an Expenses row (code review)',
    (_case, debt, amount) => {
      useExpenseStore.setState({
        expenses: [expense(380_000), expense(amount, { id: 'exp-loan', name: 'Loan payment' })],
      })
      setEntries([
        entry({ id: 'e-1', name: 'Loan', type: 'debt', paymentExpenseId: 'exp-loan', ...debt }),
      ])
      render(<ScenarioBuilder onSave={vi.fn()} />)
      expect(expenseRowNames()).toEqual(['Rent', 'Loan payment'])
      expect(screen.getByLabelText('Contribution for Loan')).toHaveValue('0.00')
      expect(within(section()).queryByText(/^from Expenses:/)).toBeNull()
      // Unlabelled, so the row offers its flag as any debt does.
      expect(screen.getByLabelText('Payment already in Expenses, for Loan')).not.toBeChecked()
    }
  )

  it('hides the label on an investment and shows it again back on Debt; editing the payment keeps it (D6, D7)', () => {
    linkedFixture()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
    fireEvent.change(screen.getByLabelText('Contribution for Loan'), { target: { value: '350' } })
    expect(within(section()).getByText('from Expenses: Loan payment')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Type for Loan'), { target: { value: 'investment' } })
    expect(within(section()).queryByText(/^from Expenses:/)).toBeNull()
    // As an investment the row offers ITS flag (the label is hidden, kept in state).
    expect(screen.getByLabelText('Not taken from the money left over, for Loan')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Type for Loan'), { target: { value: 'debt' } })
    expect(within(section()).getByText('from Expenses: Loan payment')).toBeInTheDocument()
    expect(within(section()).queryAllByRole('checkbox')).toHaveLength(0)
  })
})

describe('the starting figures (AC-2)', () => {
  it('investment rows add up to the investment total, and Starting Net Worth subtracts the debts', async () => {
    useSavingsStore.setState({
      savingsGoals: [savingsRow({ id: 'g-1', name: 'Pot', currentBalance: 123_456 })],
    })
    setEntries([
      entry({ id: 'e-1', name: 'Pension', currentBalance: 1_000_001 }),
      entry({ id: 'e-2', name: 'Loan', type: 'debt', currentBalance: -400_000 }),
      entry({ id: 'e-3', name: 'ISA', currentBalance: 50_000 }),
    ])
    const total = renderHook(() => useTotalInvestmentBalance()).result.current
    // Independent of the hook: 1000001 + 50000.
    expect(total).toBe(1_050_001)
    const format = formatter()
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    await waitForResult()

    // 123456 + 1050001 − 400000.
    expect(card('Starting Net Worth')).toBe(format(773_457))
    fireEvent.click(screen.getByRole('button', { name: /save forecast/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].inputs.investments).toBe(total)
  })
})

describe('a debt seeds as the amount owed, whatever its stored sign (Story 103.1, FR171/AC-3)', () => {
  // The builder's half of `components/__tests__/debt-sign-agreement.test.tsx`:
  // the same fixture there gives 5,000.00 on the Overview, /balance and the
  // Report for both signs. Hand-computed: 2,000,000 − 1,500,000 = 500,000c.
  for (const sign of [1, -1] as const) {
    it(`Starting Net Worth is 500,000c with the debt stored ${
      sign > 0 ? '+' : '−'
    }1,500,000`, async () => {
      setEntries([
        entry({ id: 'e-1', name: 'Pension', currentBalance: 2_000_000 }),
        entry({ id: 'e-2', name: 'Car loan', type: 'debt', currentBalance: sign * 1_500_000 }),
      ])
      const format = formatter()
      render(<ScenarioBuilder onSave={vi.fn()} />)
      await waitForResult()
      expect(card('Starting Net Worth')).toBe(format(500_000))
    })
  }
})

describe('what-if only: nothing reaches the balance store (AC-7, D0)', () => {
  it('a full edit sequence calls no balance-store action and leaves the persisted bytes unchanged', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    setEntries([
      entry({ id: 'e-1', name: 'Pension', currentBalance: 100_000 }),
      entry({ id: 'e-2', name: 'Loan', type: 'debt', currentBalance: 200_000 }),
    ])
    const before = localStorage.getItem(BALANCE_STORAGE_KEY)
    const stateBefore = useBalanceStore.getState().entries
    // Positive control: the key really is persisted.
    expect(before).toContain('Pension')

    const state = useBalanceStore.getState() as unknown as Record<string, unknown>
    const actions = Object.keys(state)
      .filter((key) => typeof state[key] === 'function')
      .map((key) => vi.spyOn(state as Record<string, () => unknown>, key))
    expect(actions.length).toBeGreaterThan(3)
    const setState = vi.spyOn(useBalanceStore, 'setState')

    render(<ScenarioBuilder onSave={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Pension'), { target: { value: 'RRSP' } })
    fireEvent.change(screen.getByLabelText('Balance for RRSP'), { target: { value: '9999' } })
    fireEvent.change(screen.getByLabelText('Contribution for RRSP'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Frequency for RRSP'), { target: { value: 'weekly' } })
    // Story 100.3: the rate is what-if only too (no rate field on /balance, D2).
    fireEvent.change(screen.getByLabelText('Annual return for RRSP'), { target: { value: '3' } })
    fireEvent.click(screen.getByLabelText('Not taken from the money left over, for RRSP'))
    fireEvent.change(screen.getByLabelText('Type for Loan'), { target: { value: 'investment' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Loan' }))
    await waitForResult()

    for (const spy of actions) expect(spy).not.toHaveBeenCalled()
    expect(setState).not.toHaveBeenCalled()
    expect(localStorage.getItem(BALANCE_STORAGE_KEY)).toBe(before)
    expect(useBalanceStore.getState().entries).toBe(stateBefore)
  })
})

describe('add, remove and type switch (AC-8)', () => {
  it('adds a New Investment row, names each remove button after its row, and can empty the list', () => {
    setEntries([entry({ id: 'e-1', name: 'Pension', currentBalance: 100_000 })])
    render(<ScenarioBuilder onSave={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    expect(rowNames()).toEqual(['Pension', 'New Investment'])
    expect(screen.getByLabelText('Type for New Investment')).toHaveValue('investment')
    expect(screen.getByLabelText('Balance for New Investment')).toHaveValue('0.00')
    expect(screen.getByLabelText('Contribution for New Investment')).toHaveValue('0.00')
    expect(screen.getByLabelText('Frequency for New Investment')).toHaveValue('monthly')
    expect(
      screen.getByLabelText('Not taken from the money left over, for New Investment')
    ).not.toBeChecked()

    fireEvent.change(screen.getByDisplayValue('New Investment'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Remove balance' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Pension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove balance' }))
    expect(screen.getByText('No investments or debts in this scenario')).toBeInTheDocument()
    expect(screen.queryByText('At least one item is required')).toBeNull()
  })

  it('any type switch clears the flag, both ways, and relabels it; the save carries false (story 102.2, D8)', async () => {
    setEntries([entry({ id: 'e-1', name: 'Pension', contributionRecordedAsExpense: true })])
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Type for Pension'), { target: { value: 'debt' } })
    expect(screen.queryByLabelText('Not taken from the money left over, for Pension')).toBeNull()
    // A debt row has its own flag (story 102.2, D2), cleared by the switch.
    const debtFlag = screen.getByRole('checkbox', {
      name: 'Payment already in Expenses, for Pension',
    })
    expect(debtFlag).not.toBeChecked()
    // Ticked on the debt, then back to Investment: cleared again (D8).
    fireEvent.click(debtFlag)
    expect(debtFlag).toBeChecked()
    fireEvent.change(screen.getByLabelText('Type for Pension'), { target: { value: 'investment' } })
    expect(
      screen.getByLabelText('Not taken from the money left over, for Pension')
    ).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('Type for Pension'), { target: { value: 'debt' } })
    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls.at(-1)?.[0].inputs.balanceAccounts).toEqual([
      {
        name: 'Pension',
        type: 'debt',
        balance: 0,
        contribution: 0,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
      },
    ])
  })
})

describe('the per-row outcome and the totals (AC-10)', () => {
  /**
   * 12,000.00 a year left over. Over 2 years, BY HAND, Fund at the seeded 6%
   * (story 100.3; at 100.2's 7% it was 3628.90 and 24,728.90):
   *   Fund: 1000.00 → round(1060.00) + 1200.00 = 2260.00 → round(2395.60) + 1200.00 = 3595.60.
   *   Loan: 3000.00 − 2400.00 = 600.00 → max(0, −1800.00) = 0 (paid off).
   *   Card: 500.00, no payment, stays 500.00.
   *   Starting: 0 + 1,000.00 − 3,500.00 = −2,500.00.
   *
   * Story 102.1: the Loan's 200.00 payment is its LINKED Expenses row, so Rent is
   * 3,800.00 and the two total 4,000.00 a month.
   *
   * ⚠️ RE-PINNED by story 102.2 (FR170): the linked row moves into the Loan, so
   * the Expenses rows hold Rent alone (14,400.00 a year left over) and the Loan
   * pays from cash only while owed:
   *   Y1: Loan pays 2,400.00 → net 12,000.00; savings + 12,000 − 1,200 = 10,800.00.
   *   Y2: Loan pays the 600.00 remainder → net 13,800.00; savings + 12,600.00.
   *   Savings 23,400.00 (was 21,600.00 under 100.2 D4: the 1,800.00 the paid-off
   *   Loan no longer takes in year 2).
   *   Ending net worth: 23,400.00 + 3,595.60 − 500.00 = 26,495.60 (was 24,695.60).
   */
  function fillOutcomeFixture(): void {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({
      expenses: [expense(380_000), expense(20_000, { id: 'exp-loan', name: 'Loan payment' })],
    })
    setEntries([
      entry({ id: 'e-1', name: 'Fund', currentBalance: 100_000, monthlyContribution: 10_000 }),
      entry({
        id: 'e-2',
        name: 'Loan',
        type: 'debt',
        currentBalance: 300_000,
        paymentExpenseId: 'exp-loan',
      }),
      entry({ id: 'e-3', name: 'Card', type: 'debt', currentBalance: 50_000 }),
    ])
  }

  it('shows each row after N years, "Paid off" for a debt at 0, and the totals by hand', async () => {
    fillOutcomeFixture()
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    await setYears(2)

    const row = (name: string) =>
      screen.getByLabelText(`Balance for ${name}`).closest('.surface') as HTMLElement
    await waitFor(() =>
      expect(within(row('Fund')).getByText(/^After 2 years:/).textContent).toBe(
        `After 2 years: ${format(359_560)}`
      )
    )
    expect(within(row('Loan')).getByText('Paid off within 2 years')).toBeInTheDocument()
    expect(within(row('Loan')).queryByText(/^After /)).toBeNull()
    expect(within(row('Card')).getByText(/^After 2 years:/).textContent).toBe(
      `After 2 years: ${format(50_000)}`
    )
    // Plain text, not a live region.
    expect(
      within(row('Fund'))
        .getByText(/^After 2 years:/)
        .closest('[aria-live]')
    ).toBeNull()
    expect(card('Starting Net Worth')).toBe(format(-250_000))
    expect(card('Ending Net Worth')).toBe(format(2_649_560))
  })

  it('a debt that starts at 0 is not "Paid off" (nothing was owed; code review)', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    setEntries([entry({ id: 'e-1', name: 'Settled', type: 'debt', currentBalance: 0 })])
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    const row = screen.getByLabelText('Balance for Settled').closest('.surface') as HTMLElement
    await waitFor(() =>
      expect(within(row).getByText(/^After 10 years:/).textContent).toBe(
        `After 10 years: ${format(0)}`
      )
    )
    expect(within(row).queryByText(/^Paid off/)).toBeNull()
  })

  it('raising a contribution moves money into investments and raises the ending net worth', async () => {
    fillOutcomeFixture()
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    await setYears(2)
    await waitFor(() => expect(card('Ending Net Worth')).toBe(format(2_649_560)))

    fireEvent.change(screen.getByLabelText('Contribution for Fund'), { target: { value: '200' } })
    // At 6% (story 100.3; 6112.90 and 24,812.90 at 7%):
    // Fund: 1000.00 → 1060.00 + 2400.00 = 3460.00 → round(3667.60) + 2400.00 = 6067.60.
    // Savings (story 102.2, Loan paying from cash while owed): (12,000.00 − 2,400.00)
    // + (13,800.00 − 2,400.00) = 21,000.00. Ending: 21,000.00 + 6,067.60 − 500.00.
    await waitFor(() => expect(card('Ending Net Worth')).toBe(format(2_656_760)), {
      timeout: 3000,
    })
  })

  it('blames counted investment contributions in the savings section when they exceed what is left over', async () => {
    // 1,000.00/mo left over, 1,500.00/mo into an investment NOT flagged as an
    // expense, and a savings row contributing nothing.
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [expense(400_000)] })
    useSavingsStore.setState({
      savingsGoals: [savingsRow({ id: 'g-1', name: 'Pot', currentBalance: 100_000 })],
    })
    setEntries([entry({ id: 'e-1', name: 'Fund', monthlyContribution: 150_000 })])
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    const line = screen.getByTestId('savings-unassigned')
    // (12,000.00 − 18,000.00) × 10.
    expect(line.textContent).toBe(
      `Your contributions are ${format(6_000_000)} more than you have left over by year 10`
    )
    expect(line.className).toContain('text-amber-800')
  })
})

describe('over-contribution without savings rows (story 112.1, FR180)', () => {
  it('blames counted investment contributions even when there are no savings rows (AC-1)', async () => {
    // The fixture above without its savings row: 1,000.00/mo left over, 1,500.00/mo
    // into an investment NOT flagged as an expense.
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [expense(400_000)] })
    setEntries([entry({ id: 'e-1', name: 'Fund', monthlyContribution: 150_000 })])
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
    const line = await screen.findByTestId('savings-unassigned')
    // (12,000.00 − 18,000.00) × 10.
    expect(line.textContent).toBe(
      `Your contributions are ${format(6_000_000)} more than you have left over by year 10`
    )
    expect(line.className).toContain('text-amber-800')
  })

  it('shows no line without savings rows when the deficit is in the income itself (AC-3)', async () => {
    useIncomeStore.setState({ incomeSources: [income(400_000)] })
    useExpenseStore.setState({ expenses: [expense(500_000)] })
    setEntries([entry({ id: 'e-1', name: 'Fund', monthlyContribution: 0 })])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    expect(screen.queryByTestId('savings-unassigned')).toBeNull()
  })

  it('shows no line without savings rows for a rounding-only shortfall (111.1 review D1)', async () => {
    // 5,000.00/mo in, 100.00/wk out: 4,566.67/mo left over once rounded monthly,
    // 54,800.00 a year exactly. Contributing the rounded 4,566.67/mo takes 54,800.04
    // a year: −0.04 a year, −0.40 by year 10, within the 0.60 drift tolerance
    // (6¢ × 1 weekly entry × 10 years). Not over-contribution.
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [expense(10_000, { frequency: 'weekly' })] })
    setEntries([entry({ id: 'e-1', name: 'Fund', monthlyContribution: 456_667 })])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()

    expect(screen.queryByTestId('savings-unassigned')).toBeNull()
  })

  it('hides the line when the last savings row goes until the recompute, then shows the no-rows figure (AC-4)', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [expense(400_000)] })
    useSavingsStore.setState({
      savingsGoals: [savingsRow({ id: 'g-1', name: 'Pot', currentBalance: 100_000 })],
    })
    setEntries([entry({ id: 'e-1', name: 'Fund', monthlyContribution: 150_000 })])
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    expect(screen.getByTestId('savings-unassigned').className).toContain('text-amber-800')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Pot' }))
    // Before the debounced recompute: the result describes one row, the list has none.
    expect(screen.queryByTestId('savings-unassigned')).toBeNull()
    await waitFor(
      () =>
        expect(screen.getByTestId('savings-unassigned').textContent).toBe(
          `Your contributions are ${format(6_000_000)} more than you have left over by year 10`
        ),
      { timeout: 3000 }
    )
    expect(screen.getByTestId('savings-unassigned').className).toContain('text-amber-800')
  })

  it('hides the no-rows line when the first savings row is added until the recompute (AC-4)', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [expense(400_000)] })
    setEntries([entry({ id: 'e-1', name: 'Fund', monthlyContribution: 150_000 })])
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    expect(screen.getByTestId('savings-unassigned').className).toContain('text-amber-800')

    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }))
    // Before the debounced recompute: the result describes no rows, the list has one.
    expect(screen.queryByTestId('savings-unassigned')).toBeNull()
    // The new row holds 0 and contributes 0, so the remainder is unchanged.
    await waitFor(
      () =>
        expect(screen.getByTestId('savings-unassigned').textContent).toBe(
          `Your contributions are ${format(6_000_000)} more than you have left over by year 10`
        ),
      { timeout: 3000 }
    )
  })
})

describe('each money field reports its own validity (AC-9)', () => {
  it('two bad fields in one row both block Save, and fixing one does not unblock the other', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    setEntries([entry({ id: 'e-1', name: 'Fund', currentBalance: 100_000 })])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    const balance = screen.getByLabelText('Balance for Fund')
    const contribution = screen.getByLabelText('Contribution for Fund')
    const reason = () => screen.queryByTestId('save-blocked-reason')?.textContent ?? null

    fireEvent.change(balance, { target: { value: '-5' } })
    fireEvent.change(contribution, { target: { value: '-1' } })
    expect(balance).toHaveAttribute('aria-invalid', 'true')
    expect(contribution).toHaveAttribute('aria-invalid', 'true')
    expect(reason()).toBe('Fix the highlighted fields to save')

    fireEvent.change(balance, { target: { value: '5' } })
    expect(reason(), 'the contribution is still bad').toBe('Fix the highlighted fields to save')
    fireEvent.change(contribution, { target: { value: '1' } })
    expect(reason()).toBeNull()
  })

  it('text that cannot be read (1.2.3) is refused, never saved as 0 (replaces bug-3 AC-2, code review)', async () => {
    // The bug-3 grouped (`12,345.67`) / symbol (`€7,500.50`) cases guarded a
    // TEXT money field. Until story 109.1 the row fields were `type="number"`,
    // where Chromium reports such text as value "" with `validity.badInput`
    // (MEASURED, 81.1), and this case stubbed that report. The fields are text
    // again (story 109.1): grouped text is READ now, and text that cannot be
    // read arrives as itself. Without the "Enter a number." rule `parseFromInput`
    // would read it as 0 and the row would be written 0.
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    setEntries([entry({ id: 'e-1', name: 'Fund', currentBalance: 100_000 })])
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    await waitFor(() => expect(card('Starting Net Worth')).toBe(format(100_000)))
    const balance = screen.getByLabelText('Balance for Fund')

    fireEvent.change(balance, { target: { value: '1.2.3' } })

    expect(balance).toHaveAttribute('aria-invalid', 'true')
    expect(
      within(balance.closest('.surface') as HTMLElement).getByText('Enter a number.')
    ).toBeTruthy()
    expect(screen.getByTestId('save-blocked-reason').textContent).toBe(
      'Fix the highlighted fields to save'
    )
    // The last good figure stands: nothing recomputed the start at 0.
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(card('Starting Net Worth')).toBe(format(100_000))
  })

  it('withdraws a removed row report, so a deleted bad row cannot keep Save blocked', async () => {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    setEntries([entry({ id: 'e-1', name: 'Fund', currentBalance: 100_000 })])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    fireEvent.change(screen.getByLabelText('Contribution for Fund'), { target: { value: '-5' } })
    expect(screen.getByTestId('save-blocked-reason')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fund' }))
    expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
  })
})

describe('the builder is defensive on its own (AC-14, 100.1 review)', () => {
  it('drops an entry of unknown type and survives a null entry or a non-array handed straight to it', () => {
    const forecast = (inputs: unknown) =>
      ({
        id: 'saved-1',
        name: 'Plan',
        scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
        result: {
          scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
          baseline: [],
          projection: [],
          summary: {
            startingNetWorth: 0,
            endingNetWorth: 0,
            totalGrowth: 0,
            averageAnnualGrowth: 0,
          },
        },
        inputs,
        createdAt: ISO,
        updatedAt: ISO,
      }) as never
    render(
      <ScenarioBuilder
        onSave={vi.fn()}
        initialForecast={forecast({
          savings: 0,
          investments: 1_000,
          years: 10,
          balanceAccounts: [
            null,
            { name: 'House', type: 'asset', balance: 5_000 },
            { name: 'Ok', type: 'investment', balance: 1_000, contribution: 0 },
          ],
        })}
      />
    )
    expect(rowNames()).toEqual(['Ok'])
    expect(screen.getByLabelText('Balance for Ok')).toHaveValue('10.00')

    document.body.innerHTML = ''
    render(
      <ScenarioBuilder
        onSave={vi.fn()}
        initialForecast={forecast({
          savings: 0,
          investments: 1_234,
          years: 10,
          balanceAccounts: 'oops',
        })}
      />
    )
    // Not an array: loads as the v1/v2 total.
    expect(rowNames()).toEqual(['Investments'])
    expect(screen.getByLabelText('Balance for Investments')).toHaveValue('12.34')

    // Story 100.3 code review: the builder's OWN rate coercion
    // (`annualReturnFromSaved`), with no mapper in front of it to strip the bad
    // values first. null / a string / NaN → 6%; a finite in-range rate kept.
    document.body.innerHTML = ''
    const investment = (name: string, annualReturn: unknown) => ({
      name,
      type: 'investment',
      balance: 1_000,
      contribution: 0,
      frequency: 'monthly',
      annualReturn,
    })
    render(
      <ScenarioBuilder
        onSave={vi.fn()}
        initialForecast={forecast({
          savings: 0,
          investments: 4_000,
          years: 10,
          balanceAccounts: [
            investment('Null', null),
            investment('Text', '0.07'),
            investment('NaN', Number.NaN),
            investment('Kept', 0.03),
          ],
        })}
      />
    )
    const rate = (name: string) => screen.getByLabelText(`Annual return for ${name}`)
    expect(rate('Null')).toHaveValue('6.00%')
    expect(rate('Text')).toHaveValue('6.00%')
    expect(rate('NaN')).toHaveValue('6.00%')
    expect(rate('Kept')).toHaveValue('3.00%')
    for (const name of ['Null', 'Text', 'NaN', 'Kept']) {
      expect(rate(name)).not.toHaveAttribute('aria-invalid')
    }
  })
})

/**
 * A forecast saved before version 5 keeps its figures (story 102.2, AC-6, D1).
 *
 * ⚠️ `V4_RESULT` was MEASURED at T0, before any engine change: the pre-story
 * engine (main `f6f1e96`, core `src` run through tsx) on exactly the inputs the
 * builder sends for `V4_INPUTS` below, 5 years. It is NOT recomputed here, so it
 * cannot agree with the new code by construction.
 */
const V4_RESULT = {
  baseline: [
    {
      year: 1,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 1180000,
      investments: 226000,
      netWorth: 1346000,
      debts: 60000,
      balanceAccounts: [226000, 60000],
    },
    {
      year: 2,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 2260000,
      investments: 359560,
      netWorth: 2619560,
      debts: 0,
      balanceAccounts: [359560, 0],
    },
    {
      year: 3,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 3340000,
      investments: 501134,
      netWorth: 3841134,
      debts: 0,
      balanceAccounts: [501134, 0],
    },
    {
      year: 4,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 4420000,
      investments: 651202,
      netWorth: 5071202,
      debts: 0,
      balanceAccounts: [651202, 0],
    },
    {
      year: 5,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 5500000,
      investments: 810274,
      netWorth: 6310274,
      debts: 0,
      balanceAccounts: [810274, 0],
    },
  ],
  projection: [
    {
      year: 1,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 1180000,
      investments: 226000,
      netWorth: 1346000,
      savingsAccounts: [100000],
      unallocatedSavings: 1080000,
      debts: 60000,
      balanceAccounts: [226000, 60000],
    },
    {
      year: 2,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 2260000,
      investments: 359560,
      netWorth: 2619560,
      savingsAccounts: [100000],
      unallocatedSavings: 2160000,
      debts: 0,
      balanceAccounts: [359560, 0],
    },
    {
      year: 3,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 3340000,
      investments: 501134,
      netWorth: 3841134,
      savingsAccounts: [100000],
      unallocatedSavings: 3240000,
      debts: 0,
      balanceAccounts: [501134, 0],
    },
    {
      year: 4,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 4420000,
      investments: 651202,
      netWorth: 5071202,
      savingsAccounts: [100000],
      unallocatedSavings: 4320000,
      debts: 0,
      balanceAccounts: [651202, 0],
    },
    {
      year: 5,
      income: 6000000,
      expenses: 4800000,
      netIncome: 1200000,
      savings: 5500000,
      investments: 810274,
      netWorth: 6310274,
      savingsAccounts: [100000],
      unallocatedSavings: 5400000,
      debts: 0,
      balanceAccounts: [810274, 0],
    },
  ],
  summary: {
    startingNetWorth: -100000,
    endingNetWorth: 6310274,
    totalGrowth: 6410274,
    averageAnnualGrowth: 1282054.8,
  },
}

const V4_INPUTS = {
  savings: 100_000,
  investments: 100_000,
  years: 5,
  savingsAccounts: [{ name: 'Pot', balance: 100_000, monthlyContribution: 0 }],
  balanceAccounts: [
    {
      name: 'Fund',
      type: 'investment',
      balance: 100_000,
      contribution: 10_000,
      frequency: 'monthly',
      contributionRecordedAsExpense: false,
      annualReturn: 0.06,
    },
    // Saved under 100.2 D4: the flag `false`, the payment ALSO an Expenses row.
    {
      name: 'Loan',
      type: 'debt',
      balance: 300_000,
      contribution: 20_000,
      frequency: 'monthly',
      contributionRecordedAsExpense: false,
    },
  ],
}

function legacyForecast(version: number | undefined) {
  const scenario = {
    name: 'Legacy plan',
    incomeGrowthRate: 0,
    expenseGrowthRate: 0,
    newIncome: [{ name: 'Salary', amount: 500_000, frequency: 'monthly' as const }],
    newExpenses: [
      { name: 'Rent', amount: 380_000, frequency: 'monthly' as const },
      { name: 'Loan payment', amount: 20_000, frequency: 'monthly' as const },
    ],
  }
  return {
    id: 'saved-legacy',
    name: 'Legacy plan',
    scenario,
    result: { scenario, ...V4_RESULT },
    inputs: V4_INPUTS,
    ...(version === undefined ? {} : { version }),
    createdAt: ISO,
    updatedAt: ISO,
  } as never
}

describe('a forecast saved before version 5 keeps its figures (story 102.2, AC-6)', () => {
  it.each([
    ['version 4', 4],
    ['version 3', 3],
    ['no version', undefined],
  ])(
    '%s: the debt reloads flagged and recomputes exactly the T0 figures',
    async (_label, version) => {
      render(
        <ScenarioBuilder
          onSave={vi.fn()}
          onResultChange={onResult}
          initialForecast={legacyForecast(version)}
        />
      )
      expect(
        screen.getByRole('checkbox', { name: 'Payment already in Expenses, for Loan' })
      ).toBeChecked()
      // Investment rows are untouched by the legacy rule.
      expect(
        screen.getByLabelText('Not taken from the money left over, for Fund')
      ).not.toBeChecked()
      await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
      const recomputed = onResult.mock.calls.at(-1)?.[0]
      // Story 107.1 (D2): the BASELINE is today's data (empty stores here), not the
      // saved rows', so only the scenario's own figures are the T0 ones.
      expect({
        projection: recomputed?.projection,
        summary: recomputed?.summary,
      }).toEqual({ projection: V4_RESULT.projection, summary: V4_RESULT.summary })
    }
  )

  it('version 5: the same saved row is unflagged, so the payment leaves cash and the figures differ', async () => {
    render(
      <ScenarioBuilder
        onSave={vi.fn()}
        onResultChange={onResult}
        initialForecast={legacyForecast(5)}
      />
    )
    expect(
      screen.getByRole('checkbox', { name: 'Payment already in Expenses, for Loan' })
    ).not.toBeChecked()
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
    // Year 1, by hand: the Loan payment is ALSO in Expenses here, so it is now
    // counted twice (what the legacy flag exists to prevent): 1,200,000 − 240,000.
    expect(onResult.mock.calls.at(-1)?.[0]?.projection[0]?.netIncome).toBe(960_000)
  })

  it('saves a reloaded legacy debt with its flag ON, so it stays legacy after a v5 save', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} initialForecast={legacyForecast(4)} />)
    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const debt = onSave.mock.calls[0][0].inputs.balanceAccounts[1]
    expect(debt).toEqual({
      name: 'Loan',
      type: 'debt',
      balance: 300_000,
      contribution: 20_000,
      frequency: 'monthly',
      contributionRecordedAsExpense: true,
    })
  })

  it('a saved debt that is flagged (legacy, or a corrupt v5 save) drops its label, so a ticked box is never hidden (code review)', () => {
    const withLabel = (version: number, flag: boolean) =>
      ({
        ...(legacyForecast(version) as object),
        inputs: {
          ...V4_INPUTS,
          investments: 0,
          balanceAccounts: [
            {
              ...V4_INPUTS.balanceAccounts[1],
              contributionRecordedAsExpense: flag,
              paidByExpenseName: 'Loan payment',
            },
          ],
        },
      }) as never
    for (const [version, flag] of [
      [4, false],
      [5, true],
    ] as const) {
      document.body.innerHTML = ''
      render(<ScenarioBuilder onSave={vi.fn()} initialForecast={withLabel(version, flag)} />)
      expect(within(section()).queryByText(/^from Expenses:/)).toBeNull()
      expect(
        screen.getByRole('checkbox', { name: 'Payment already in Expenses, for Loan' })
      ).toBeChecked()
    }
  })

  it('reloads a v5 label and keeps only a non-empty string (the builder is defensive on its own)', () => {
    const v5 = (paidByExpenseName: unknown) =>
      ({
        ...(legacyForecast(5) as object),
        inputs: {
          ...V4_INPUTS,
          balanceAccounts: [{ ...V4_INPUTS.balanceAccounts[1], paidByExpenseName }],
          investments: 0,
        },
      }) as never
    render(<ScenarioBuilder onSave={vi.fn()} initialForecast={v5('  Loan payment ')} />)
    expect(within(section()).getByText('from Expenses: Loan payment')).toBeInTheDocument()
    for (const bad of ['', '   ', 7, null]) {
      document.body.innerHTML = ''
      render(<ScenarioBuilder onSave={vi.fn()} initialForecast={v5(bad)} />)
      expect(within(section()).queryByText(/^from Expenses:/)).toBeNull()
    }
  })
})

describe('save writes the rows and the investment total (AC-12)', () => {
  it('hands onSave every row field in order, and investments as the investment rows sum', async () => {
    setEntries([
      entry({
        id: 'e-1',
        name: 'Pension',
        currentBalance: 1_000_001,
        monthlyContribution: 2_500,
        frequency: 'weekly',
        contributionRecordedAsExpense: true,
      }),
      // Story 102.1: the debt's payment comes from its linked expense.
      entry({
        id: 'e-2',
        name: 'Loan',
        type: 'debt',
        currentBalance: 300_000,
        paymentExpenseId: 'exp-loan',
      }),
    ])
    useExpenseStore.setState({
      expenses: [expense(20_000, { id: 'exp-loan', name: 'Loan payment' })],
    })
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const { inputs } = onSave.mock.calls[0][0]
    expect(inputs.balanceAccounts).toEqual([
      {
        name: 'Pension',
        type: 'investment',
        balance: 1_000_001,
        contribution: 2_500,
        frequency: 'weekly',
        contributionRecordedAsExpense: true,
        // Story 100.3: the seeded 6%, on the investment row only (D8).
        annualReturn: 0.06,
      },
      // A debt is saved WITHOUT a rate (`toEqual` fails on an extra defined key),
      // and since story 102.2 (version 5) WITH the name of the Expenses row its
      // payment came from (D6).
      {
        name: 'Loan',
        type: 'debt',
        balance: 300_000,
        contribution: 20_000,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
        paidByExpenseName: 'Loan payment',
      },
    ])
    expect(inputs.investments).toBe(1_000_001)
  })
})

/**
 * Each investment row's own annual return (story 100.3, FR166). Every figure is
 * derived BY HAND in the comment beside it. The fixture is the AC-10 one above:
 * 12,000.00 a year left over; Fund 1000.00 contributing 100.00/mo; Loan 3000.00
 * paying 200.00/mo; Card 500.00. Two years.
 */
describe('each investment row has its own annual return (story 100.3)', () => {
  function fillFixture(): void {
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    useExpenseStore.setState({ expenses: [expense(400_000)] })
    setEntries([
      entry({ id: 'e-1', name: 'Fund', currentBalance: 100_000, monthlyContribution: 10_000 }),
      entry({
        id: 'e-2',
        name: 'Loan',
        type: 'debt',
        currentBalance: 300_000,
        monthlyContribution: 20_000,
      }),
    ])
  }
  const rateField = (name: string) => screen.getByLabelText(`Annual return for ${name}`)
  const reason = () => screen.queryByTestId('save-blocked-reason')?.textContent ?? null
  const fundLine = () =>
    within(screen.getByLabelText('Balance for Fund').closest('.surface') as HTMLElement).getByText(
      /^After 2 years:/
    ).textContent

  it('seeds 6.00% on every investment row, + Add Balance too, and shows no rate on a debt (AC-7, AC-8)', () => {
    setEntries([
      entry({ id: 'e-1', name: 'Pension' }),
      entry({ id: 'e-2', name: 'Loan', type: 'debt' }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(rateField('Pension')).toHaveValue('6.00%')
    expect(rateField('Pension')).toHaveAttribute('type', 'text')
    expect(rateField('Pension')).toHaveAttribute('inputmode', 'decimal')
    expect(rateField('Pension')).toHaveAttribute('autocomplete', 'off')
    // The debt row has no rate field (positive control: its row is there).
    expect(screen.getByLabelText('Balance for Loan')).toBeInTheDocument()
    expect(screen.queryByLabelText('Annual return for Loan')).toBeNull()
    expect(within(section()).getAllByLabelText(/^Annual return for /)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '+ Add Balance' }))
    expect(rateField('New Investment')).toHaveValue('6.00%')
    // A blank name reads "unnamed balance", like the row's other controls.
    fireEvent.change(screen.getByDisplayValue('New Investment'), { target: { value: '' } })
    expect(rateField('unnamed balance')).toHaveValue('6.00%')
  })

  it('typing a rate changes the row, by hand; 7, 7% and 7.00% all mean 7%', async () => {
    fillFixture()
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    await setYears(2)
    // 6%: 1000.00 → 1060.00 + 1200.00 = 2260.00 → round(2395.60) + 1200.00 = 3595.60.
    await waitFor(() => expect(fundLine()).toBe(`After 2 years: ${format(359_560)}`))

    fireEvent.change(rateField('Fund'), { target: { value: '5' } })
    // 5%: 1000.00 → 1050.00 + 1200.00 = 2250.00 → round(2362.50) + 1200.00 = 3562.50.
    await waitFor(() => expect(fundLine()).toBe(`After 2 years: ${format(356_250)}`), {
      timeout: 3000,
    })
    // 7%: 1000.00 → 1070.00 + 1200.00 = 2270.00 → round(2428.90) + 1200.00 = 3628.90.
    for (const typed of ['7', '7%', '7.00%']) {
      fireEvent.change(rateField('Fund'), { target: { value: '5' } })
      await waitFor(() => expect(fundLine()).toBe(`After 2 years: ${format(356_250)}`), {
        timeout: 3000,
      })
      fireEvent.change(rateField('Fund'), { target: { value: typed } })
      await waitFor(() => expect(fundLine()).toBe(`After 2 years: ${format(362_890)}`), {
        timeout: 3000,
      })
      expect(rateField('Fund')).not.toHaveAttribute('aria-invalid')
    }
    // Seven debounced recomputes (500 ms each): measured 5195 ms under a full
    // sequential gate run, past the 5 s default.
  }, 15_000)

  // `5abc`, `1,5` and `1e2` (code review): `parseFloat` alone would read 5%, 1%
  // and 100% from them, silently.
  for (const bad of ['', 'abc', '150', '-101', '5abc', '1,5', '1e2']) {
    it(`"${bad}" is refused: error on the field, recompute and Save held, last result kept (AC-9)`, async () => {
      fillFixture()
      const format = formatter()
      render(<ScenarioBuilder onSave={vi.fn()} />)
      await waitForResult()
      await setYears(2)
      await waitFor(() => expect(fundLine()).toBe(`After 2 years: ${format(359_560)}`))
      const calls = engineRows.length

      fireEvent.change(rateField('Fund'), { target: { value: bad } })

      const field = rateField('Fund')
      expect(field).toHaveValue(bad)
      expect(field).toHaveAttribute('aria-invalid', 'true')
      const message = within(field.closest('div') as HTMLElement).getByText(
        'Enter an annual return from -100% to 100%.'
      )
      expect(field).toHaveAttribute('aria-describedby', message.id)
      expect(message.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['text-xs', 'text-red-600', 'dark:text-red-300'])
      )
      expect(reason()).toBe('Fix the highlighted fields to save')
      // Past the debounce: no engine call at all, so the bad rate never reached it,
      // and the last good figure stands.
      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(engineRows.length).toBe(calls)
      expect(fundLine()).toBe(`After 2 years: ${format(359_560)}`)

      // Fixing it recomputes (4%: 1000.00 → 1040.00 + 1200.00 = 2240.00 →
      // round(2329.60) + 1200.00 = 3529.60).
      fireEvent.change(rateField('Fund'), { target: { value: '4' } })
      expect(reason()).toBeNull()
      expect(rateField('Fund')).not.toHaveAttribute('aria-invalid')
      await waitFor(() => expect(fundLine()).toBe(`After 2 years: ${format(352_960)}`), {
        timeout: 3000,
      })
      // Every row the engine ever saw carried a usable investment rate, and the
      // bad text never became one (`5abc` → 0.05, `1,5` → 0.01, `1e2` → 1 would).
      let investmentRowsSeen = 0
      for (const rows of engineRows) {
        for (const row of rows as Array<{ type: string; annualReturn?: unknown }>) {
          if (row.type === 'investment') {
            investmentRowsSeen++
            expect(typeof row.annualReturn).toBe('number')
            expect([0.06, 0.04]).toContain(row.annualReturn)
          }
        }
      }
      expect(investmentRowsSeen).toBeGreaterThan(0)
      // Several debounced recomputes in one test: 5 s is too tight under gate load.
    }, 15_000)
  }

  it('a bad balance and a bad rate in one row both block Save; fixing one leaves the other (AC-9)', async () => {
    fillFixture()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    fireEvent.change(screen.getByLabelText('Balance for Fund'), { target: { value: '-5' } })
    fireEvent.change(rateField('Fund'), { target: { value: '200' } })
    expect(reason()).toBe('Fix the highlighted fields to save')
    fireEvent.change(screen.getByLabelText('Balance for Fund'), { target: { value: '5' } })
    expect(reason(), 'the rate is still bad').toBe('Fix the highlighted fields to save')
    fireEvent.change(rateField('Fund'), { target: { value: '3' } })
    expect(reason()).toBeNull()
  })

  it('switching to Debt withdraws a bad rate and hides the field; back to Investment shows the last VALID rate (AC-10, D8)', async () => {
    fillFixture()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    fireEvent.change(rateField('Fund'), { target: { value: '4' } })
    fireEvent.change(rateField('Fund'), { target: { value: '150' } })
    expect(reason()).toBe('Fix the highlighted fields to save')

    fireEvent.change(screen.getByLabelText('Type for Fund'), { target: { value: 'debt' } })
    expect(screen.queryByLabelText('Annual return for Fund')).toBeNull()
    expect(reason(), 'the unmounted field withdrew its report').toBeNull()

    fireEvent.change(screen.getByLabelText('Type for Fund'), { target: { value: 'investment' } })
    expect(rateField('Fund')).toHaveValue('4.00%')
    expect(rateField('Fund')).not.toHaveAttribute('aria-invalid')
  })

  it('saves the typed rate on the investment row and none on a debt (AC-11)', async () => {
    fillFixture()
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    await waitForResult()
    fireEvent.change(rateField('Fund'), { target: { value: '5.5' } })
    // A debt row that was an investment keeps no rate in the save either.
    fireEvent.change(screen.getByLabelText('Type for Loan'), { target: { value: 'investment' } })
    fireEvent.change(rateField('Loan'), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('Type for Loan'), { target: { value: 'debt' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save forecast/i })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: /save forecast/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls.at(-1)?.[0].inputs.balanceAccounts
    expect(saved[0].annualReturn).toBe(0.055)
    expect(saved[1].type).toBe('debt')
    expect(Object.keys(saved[1])).not.toContain('annualReturn')
  })
})
