/**
 * Investments and debts as what-if rows in the Scenario Builder (story 100.2,
 * FR165).
 *
 * Integration tests: the real builder, the real stores, the real engine and the
 * real currency store. Only the debounce is waited on. The one thing mocked is
 * `useIsInitialSyncPending`, as a pass-through spy, so the `nothingToSeed`
 * argument the builder hands it can be read (AC-6).
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

function entry(over: {
  id: string
  name: string
  type?: 'investment' | 'debt' | 'asset'
  currentBalance?: number
  monthlyContribution?: number
  frequency?: string
  contributionRecordedAsExpense?: boolean
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

beforeEach(() => {
  clearStores()
  syncPendingCalls.length = 0
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
    expect(screen.getByLabelText('Balance for Pension')).toHaveValue(10000)
    expect(screen.getByLabelText('Contribution for Pension')).toHaveValue(50)
    expect(screen.getByLabelText('Frequency for Pension')).toHaveValue('monthly')
    // The flag on investment rows only.
    expect(
      screen.getByLabelText('Not taken from the money left over, for Pension')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Not taken from the money left over, for Car loan')).toBeNull()
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
    for (const control of within(section()).getAllByRole('spinbutton')) {
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
    expect(screen.getByLabelText('Contribution for Weekly')).toHaveValue(25)
    expect(screen.getByLabelText('Frequency for Weekly')).toHaveValue('weekly')
    expect(screen.getByLabelText('Contribution for Yearly')).toHaveValue(6000)
    expect(screen.getByLabelText('Frequency for Yearly')).toHaveValue('annually')
    // An unrecognised frequency degrades to monthly.
    expect(screen.getByLabelText('Frequency for Odd')).toHaveValue('monthly')
  })

  it('seeds a negative stored debt as its magnitude, and a negative investment as 0 (D6)', () => {
    setEntries([
      entry({ id: 'e-1', name: 'Mortgage', type: 'debt', currentBalance: -98_765_432_100 }),
      entry({ id: 'e-2', name: 'Bad fund', currentBalance: -500 }),
      entry({ id: 'e-3', name: 'NaN debt', type: 'debt', currentBalance: Number.NaN }),
      // ⚠️ A NON-FINITE stored contribution is not in this fixture: it throws
      // upstream, in the store's `withTimeline` (reached through
      // `useInvestmentEntries`, read since story 100.1), before the seed runs.
      // MEASURED in this file's first run. Pre-existing; `deferred-work.md`.
      entry({ id: 'e-5', name: 'Neg contrib', type: 'debt', monthlyContribution: -100 }),
    ])
    render(<ScenarioBuilder onSave={vi.fn()} />)
    expect(screen.getByLabelText('Balance for Mortgage')).toHaveValue(987654321)
    expect(screen.getByLabelText('Balance for Mortgage')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByLabelText('Balance for Bad fund')).toHaveValue(0)
    expect(screen.getByLabelText('Balance for NaN debt')).toHaveValue(0)
    expect(screen.getByLabelText('Contribution for Neg contrib')).toHaveValue(0)
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
    expect(screen.getByLabelText('Balance for New Investment')).toHaveValue(0)
    expect(screen.getByLabelText('Contribution for New Investment')).toHaveValue(0)
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

  it('switching a row to Debt clears and hides its flag, and the save carries false', async () => {
    setEntries([entry({ id: 'e-1', name: 'Pension', contributionRecordedAsExpense: true })])
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Type for Pension'), { target: { value: 'debt' } })
    expect(screen.queryByLabelText('Not taken from the money left over, for Pension')).toBeNull()
    // Back to Investment: the flag is unchecked, not restored.
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
   * 12,000.00 a year left over. Over 2 years, BY HAND:
   *   Fund: 1000.00 → round(1070.00) + 1200.00 = 2270.00 → round(2428.90) + 1200.00 = 3628.90.
   *   Loan: 3000.00 − 2400.00 = 600.00 → max(0, −1800.00) = 0 (paid off).
   *   Card: 500.00, no payment, stays 500.00.
   *   Savings: 2 × (12,000.00 − 1,200.00 counted) = 21,600.00.
   *   Ending net worth: 21,600.00 + 3,628.90 − 500.00 = 24,728.90.
   *   Starting: 0 + 1,000.00 − 3,500.00 = −2,500.00.
   */
  function fillOutcomeFixture(): void {
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
        `After 2 years: ${format(362_890)}`
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
    expect(card('Ending Net Worth')).toBe(format(2_472_890))
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
    await waitFor(() => expect(card('Ending Net Worth')).toBe(format(2_472_890)))

    fireEvent.change(screen.getByLabelText('Contribution for Fund'), { target: { value: '200' } })
    // Fund: 1000.00 → 1070.00 + 2400.00 = 3470.00 → round(3712.90) + 2400.00 = 6112.90.
    // Savings: 2 × (12,000.00 − 2,400.00) = 19,200.00. Ending: 19,200.00 + 6,112.90 − 500.00.
    await waitFor(() => expect(card('Ending Net Worth')).toBe(format(2_481_290)), {
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

  it('grouped text the browser cannot hold (badInput) is refused, never saved as 0 (replaces bug-3 AC-2, code review)', async () => {
    // The bug-3 grouped (`12,345.67`) / symbol (`€7,500.50`) cases guarded a
    // TEXT money field that is gone. On a `type="number"` row field Chromium
    // reports such text as value "" with `validity.badInput` (MEASURED, 81.1);
    // jsdom never does, so the browser's report is stubbed. Without the badInput
    // check `useMoneyDraft` would read "" as an emptied field and write 0.
    useIncomeStore.setState({ incomeSources: [income(500_000)] })
    setEntries([entry({ id: 'e-1', name: 'Fund', currentBalance: 100_000 })])
    const format = formatter()
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitForResult()
    await waitFor(() => expect(card('Starting Net Worth')).toBe(format(100_000)))
    const balance = screen.getByLabelText('Balance for Fund')
    Object.defineProperty(balance, 'validity', {
      configurable: true,
      get: () => ({ badInput: true }),
    })

    fireEvent.change(balance, { target: { value: '' } })

    expect(balance).toHaveAttribute('aria-invalid', 'true')
    expect(within(balance.closest('.surface') as HTMLElement).getByText('Enter a number.')).toBeTruthy()
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
    expect(screen.getByLabelText('Balance for Ok')).toHaveValue(10)

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
    expect(screen.getByLabelText('Balance for Investments')).toHaveValue(12.34)
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
      entry({
        id: 'e-2',
        name: 'Loan',
        type: 'debt',
        currentBalance: 300_000,
        monthlyContribution: 20_000,
      }),
    ])
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
      },
      {
        name: 'Loan',
        type: 'debt',
        balance: 300_000,
        contribution: 20_000,
        frequency: 'monthly',
        contributionRecordedAsExpense: false,
      },
    ])
    expect(inputs.investments).toBe(1_000_001)
  })
})
