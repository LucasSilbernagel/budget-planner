import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

/**
 * ScenarioBuilder tests (story bug-3).
 *
 * These lock the input-defect fixes (AC-1 currency-mode-aware amount prefix,
 * AC-2 savings/investments cents round-trip) and the reload hydration (AC-4).
 * The component was previously untested.
 */

// Control the currency mode/currency/locale without touching the real zustand
// persist store (whose createJSONStorage binds localStorage at import time).
const mockCurrency = vi.hoisted(() => ({
  mode: 'none' as 'none' | 'symbol',
  currency: 'NONE',
  locale: 'en-US',
}))

vi.mock('../../../stores/currencyStore', () => ({
  // Symbol-less, grouped-less formatter so the only currency symbols on screen
  // come from the amount-prefix under test (not from formatCurrency).
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ ...mockCurrency }),
  useCurrencyMode: () => mockCurrency.mode,
  useCurrencyCode: () => mockCurrency.currency,
}))

const ISO = '2026-09-22T00:00:00.000Z'
const PROFILE = 'profile-test'

/**
 * ⚠️ Story 62.1 (FR94) DELETED `DEFAULT_INCOME` / `DEFAULT_EXPENSES` /
 * `DEFAULT_SAVINGS` / `DEFAULT_INVESTMENTS` — a fresh builder now seeds from the
 * user's own stores.
 *
 * Every test below predates that and used those constants purely as scaffolding:
 * they exercise currency parsing, money-input sanitization, labelling and
 * zero-clamping, none of which care WHERE the starting values came from. Seeding
 * the stores with the identical figures ($5,000 savings, $10,000 investments, a
 * $5,000/mo Salary and the three expense rows) keeps every assertion below
 * meaning exactly what it meant before, rather than re-baselining them to new
 * numbers and losing the ability to compare against the pre-62.1 record.
 *
 * The seed lands during `render()` because RTL flushes effects inside `act`; see
 * `scenario-builder.seeding.dom.test.tsx` for why it is an effect and not a lazy
 * initializer.
 */
function seedBuilderStartingValues(): void {
  useProfileStore.setState({ activeProfileId: PROFILE })
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        profileId: PROFILE,
        userId: 0,
        name: 'Salary',
        amount: 500_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
  useExpenseStore.setState({
    expenses: [
      {
        id: 'exp-1',
        profileId: PROFILE,
        userId: 0,
        name: 'Rent/Mortgage',
        amount: 150_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
      {
        id: 'exp-2',
        profileId: PROFILE,
        userId: 0,
        name: 'Utilities',
        amount: 20_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
      {
        id: 'exp-3',
        profileId: PROFILE,
        userId: 0,
        name: 'Groceries',
        amount: 60_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'goal-1',
        profileId: PROFILE,
        name: 'Savings',
        targetAmount: 1_000_000,
        currentBalance: 500_000,
        allocationMode: 'manual',
        monthlyAllocation: null,
        sortOrder: 0,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
  useBalanceStore.setState({
    entries: [
      {
        id: 'entry-1',
        profileId: PROFILE,
        type: 'investment',
        name: 'Investments',
        currentBalance: 1_000_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        sortOrder: 0,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
}

beforeEach(() => {
  mockCurrency.mode = 'none'
  mockCurrency.currency = 'NONE'
  mockCurrency.locale = 'en-US'
  seedBuilderStartingValues()
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  vi.clearAllMocks()
})

describe('ScenarioBuilder amount prefix (bug-3 AC-1)', () => {
  it('shows no currency symbol on amount inputs in currency-less mode', () => {
    mockCurrency.mode = 'none'
    render(<ScenarioBuilder onSave={vi.fn()} />)
    // The old hard-coded `$` is gone, and neutral mode shows no symbol at all.
    expect(screen.queryByText('$')).toBeNull()
    expect(screen.queryByText('€')).toBeNull()
  })

  it('uses the selected currency symbol (not a literal $) in symbol mode', () => {
    mockCurrency.mode = 'symbol'
    mockCurrency.currency = 'EUR'
    render(<ScenarioBuilder onSave={vi.fn()} />)
    // Income + expense rows each render the EUR symbol as the amount prefix.
    expect(screen.getAllByText('€').length).toBeGreaterThan(0)
    expect(screen.queryByText('$')).toBeNull()
  })
})

describe('ScenarioBuilder savings/investments parsing (bug-3 AC-2)', () => {
  it('stores a typed savings amount as exact cents, without the double-×100 bug', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)

    // Default savings renders as 5000.00; change it to 7500.
    fireEvent.change(screen.getByDisplayValue('5000.00'), { target: { value: '7500' } })

    // The Save button appears only once the debounced forecast has computed.
    const saveButton = await screen.findByRole(
      'button',
      { name: /save forecast/i },
      { timeout: 2000 }
    )
    fireEvent.click(saveButton)

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    // 7500 → 750000 cents. The old parseFloat + ×100-in-handler bug produced
    // 75000000 ($500,000).
    expect(onSave.mock.calls[0][0].inputs.savings).toBe(750000)
  })

  // Helper: type `typed` into Current Savings, save, and return the persisted cents.
  async function savingsCentsAfterTyping(typed: string): Promise<number> {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    fireEvent.change(screen.getByDisplayValue('5000.00'), { target: { value: typed } })
    const saveButton = await screen.findByRole(
      'button',
      { name: /save forecast/i },
      { timeout: 2000 }
    )
    fireEvent.click(saveButton)
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    return onSave.mock.calls[0][0].inputs.savings
  }

  it('parses a GROUPED value without the parseFloat truncation bug', async () => {
    // The exact case AC-2 calls out: parseFloat('12,345.67') === 12 (truncates at
    // the comma). parseFromInput must strip grouping → 1234567 cents.
    expect(await savingsCentsAfterTyping('12,345.67')).toBe(1234567)
  })

  it('parses a symbol- and group-formatted value in symbol mode', async () => {
    // In symbol mode the field can display/edit a symbol+grouping string; the
    // core parser strips both. €7,500.50 → 750050 cents (not NaN, not truncated).
    mockCurrency.mode = 'symbol'
    mockCurrency.currency = 'EUR'
    expect(await savingsCentsAfterTyping('€7,500.50')).toBe(750050)
  })
})

describe('ScenarioBuilder reload hydration (bug-3 AC-4)', () => {
  const savedForecast: SavedForecast = {
    id: 'saved-1',
    name: 'My Saved Plan',
    description: 'A loaded scenario',
    scenario: {
      name: 'My Saved Plan',
      description: 'A loaded scenario',
      incomeGrowthRate: 0.05,
      expenseGrowthRate: 0.03,
      newIncome: [{ name: 'Consulting', amount: 800000, frequency: 'monthly' }],
      newExpenses: [{ name: 'Rent', amount: 250000, frequency: 'monthly' }],
      oneTimeEvents: [{ year: 3, amount: 1000000, name: 'Bonus' }],
    },
    result: {
      scenario: { name: 'My Saved Plan', incomeGrowthRate: 0.05, expenseGrowthRate: 0.03 },
      baseline: [],
      projection: [],
      summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
    },
    inputs: { savings: 1234500, investments: 6789000, years: 15 },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }

  it('seeds every field from a loaded forecast, including savings/investments/years', () => {
    render(<ScenarioBuilder onSave={vi.fn()} initialForecast={savedForecast} />)

    expect(screen.getByDisplayValue('My Saved Plan')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bonus')).toBeInTheDocument()
    // savings 1234500 → 12345.00, investments 6789000 → 67890.00 (mock formatter)
    expect(screen.getByDisplayValue('12345.00')).toBeInTheDocument()
    expect(screen.getByDisplayValue('67890.00')).toBeInTheDocument()
    // years seeded from inputs
    expect(screen.getByDisplayValue('15')).toBeInTheDocument()
  })

  it('defaults savings/investments/years for an older saved row with no persisted inputs', () => {
    const olderRow: SavedForecast = { ...savedForecast, inputs: undefined }
    render(<ScenarioBuilder onSave={vi.fn()} initialForecast={olderRow} />)

    // Name still seeds from the scenario, and the missing inputs fall back
    // without throwing.
    //
    // ⚠️ AMENDED by story 62.1 (FR94). The fallback used to be the demo
    // constants (savings 500000 → 5000.00, investments 1000000 → 10000.00);
    // those are deleted, and the replacement is ZERO — deliberately NOT the live
    // stores, which hold 5000.00/10000.00 here via `seedBuilderStartingValues`.
    // Reading them for a LOADED forecast would silently re-baseline a scenario
    // saved months ago to today's figures, which 62.1 AC-7 forbids. `years`
    // still falls back to `DEFAULT_FORM.years`, which survives.
    expect(screen.getByDisplayValue('My Saved Plan')).toBeInTheDocument()
    expect(screen.getAllByDisplayValue('0.00').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByDisplayValue('10')).toBeInTheDocument()
    // The live stores did not leak in.
    expect(screen.queryByDisplayValue('5000.00')).toBeNull()
    expect(screen.queryByDisplayValue('10000.00')).toBeNull()
  })
})

/**
 * Money-input sanitization (story 28-1, AC-6).
 *
 * `InputField` is shared by seven fields here, only two of which hold money, so
 * the filter is an opt-in `sanitize` prop passed from those two call sites — not
 * something inferred from `inputMode`/`type` inside the component.
 */
describe('ScenarioBuilder money inputs reject non-numeric characters (story 28-1)', () => {
  it('strips letters and symbols from Current Savings', () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)

    const savingsInput = screen.getByDisplayValue('5000.00')
    fireEvent.change(savingsInput, { target: { value: '$7,500abc' } })

    expect(savingsInput).toHaveValue('7,500')
  })

  it('strips letters and symbols from Current Investments', () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)

    const investmentsInput = screen.getByDisplayValue('10000.00')
    fireEvent.change(investmentsInput, { target: { value: 'about 25000 usd' } })

    expect(investmentsInput).toHaveValue('25000')
  })

  it('persists the sanitized value, so display and stored cents agree', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)

    fireEvent.change(screen.getByDisplayValue('5000.00'), { target: { value: '12,345.67abc' } })
    const saveButton = await screen.findByRole(
      'button',
      { name: /save forecast/i },
      { timeout: 2000 }
    )
    fireEvent.click(saveButton)

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].inputs.savings).toBe(1234567)
  })

  it('leaves the non-money Scenario Name field accepting letters', () => {
    // The guard against sanitizing inside InputField unconditionally.
    render(<ScenarioBuilder onSave={vi.fn()} />)

    const nameInput = screen.getByPlaceholderText('My Financial Forecast')
    fireEvent.change(nameInput, { target: { value: 'Early Retirement Plan' } })

    expect(nameInput).toHaveValue('Early Retirement Plan')
  })
})

describe('One-time events can be an outflow (story forecast-1, AC-1/AC-3)', () => {
  /**
   * ⚠️ WHY THIS EXISTS. Story 57.1 shipped Overview copy promising "a big one-off
   * cost" and had to retract it in review: a one-time event could only ever ADD
   * money. The engine was never the problem — `calculateFinancialForecast` sums
   * signed amounts and always has (pinned in
   * `packages/core/src/finance/__tests__/forecasting.test.ts`) — the input path
   * clamped every amount to >= 0.
   *
   * The row now carries an explicit direction. `amount` stays SIGNED on the wire
   * (negative = out), so neither the engine nor the saved JSON shape changes; the
   * Amount input holds a MAGNITUDE, which is why it legitimately keeps `min={0}`.
   */
  function addAnEvent(): void {
    fireEvent.click(screen.getByRole('button', { name: /add event/i }))
  }

  /**
   * Scope every field query to the ONE-TIME-EVENT row.
   *
   * ⚠️ These used to be bare `eventAmount()` calls, which
   * resolved uniquely only because `FinancialItemRow`'s labels were NOT
   * associated with their inputs. Story `forecast-2` associated them — the a11y
   * fix the `forecast-1` review deferred — and every one of these queries became
   * "found multiple elements", exactly as that deferral predicted. Anchoring on
   * the Direction control (which only the event row has) makes them independent
   * of the neighbouring rows' labelling.
   */
  function eventRow(): HTMLElement {
    const direction = screen.getByLabelText(/direction/i)
    const row = direction.closest('div.surface')
    if (!row) throw new Error('one-time-event row not found')
    return row as HTMLElement
  }

  const eventAmount = (): HTMLElement => within(eventRow()).getByLabelText(/amount/i)
  const eventDirection = (): HTMLElement => within(eventRow()).getByLabelText(/direction/i)
  const eventName = (): HTMLElement => within(eventRow()).getByLabelText(/event name/i)

  it('AC-1: sends a NEGATIVE amount once the direction is set to money out', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    addAnEvent()

    fireEvent.change(eventAmount(), { target: { value: '5000' } })
    fireEvent.change(eventDirection(), { target: { value: 'out' } })

    // The magnitude stays positive on screen; only the stored sign flips.
    expect(eventAmount()).toHaveValue(5000)

    // The Save button appears only once the debounced forecast has computed —
    // the same `findByRole` wait every other test in this file uses.
    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const { scenario } = onSave.mock.calls[0][0]
    expect(scenario.oneTimeEvents[0].amount).toBe(-500000)
  })

  it('AC-1: keeps a POSITIVE amount when the direction is money in', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    addAnEvent()

    fireEvent.change(eventAmount(), { target: { value: '5000' } })

    // The Save button appears only once the debounced forecast has computed —
    // the same `findByRole` wait every other test in this file uses.
    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(500000)
  })

  it('AC-1: flipping direction AFTER typing re-signs the existing amount', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    addAnEvent()

    fireEvent.change(eventAmount(), { target: { value: '250' } })
    fireEvent.change(eventDirection(), { target: { value: 'out' } })
    fireEvent.change(eventDirection(), { target: { value: 'in' } })
    fireEvent.change(eventDirection(), { target: { value: 'out' } })

    // The Save button appears only once the debounced forecast has computed —
    // the same `findByRole` wait every other test in this file uses.
    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(-25000)
  })

  it('AC-1: flipping BACK to money in re-signs positive (the out -> in path)', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    addAnEvent()

    // ⚠️ The sibling test above ends on 'out', so an implementation whose
    // direction handler only ever NEGATES would pass it. This one ends on 'in'
    // with a non-zero amount, which only a real re-sign satisfies.
    fireEvent.change(eventAmount(), { target: { value: '250' } })
    fireEvent.change(eventDirection(), { target: { value: 'out' } })
    fireEvent.change(eventDirection(), { target: { value: 'in' } })

    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(25000)
  })

  it('AC-1: the persisted event keeps its exact shape — no direction field leaks', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    addAnEvent()

    fireEvent.change(eventName(), { target: { value: 'Deposit' } })
    fireEvent.change(eventAmount(), { target: { value: '400' } })
    fireEvent.change(eventDirection(), { target: { value: 'out' } })

    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    // The comments claim the saved JSON shape is unchanged; assert it rather than
    // asserting only `.amount`. `direction` is component state and must NOT be
    // persisted — the sign IS the persisted representation.
    // `toStrictEqual`, not `toEqual`: the latter ignores keys whose value is
    // `undefined`, so a leaked `direction: undefined` would pass the very check
    // this test exists to make.
    expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0]).toStrictEqual({
      year: 1,
      amount: -40000,
      name: 'Deposit',
    })
  })

  it('AC-1: a direction chosen BEFORE typing still applies (the amount-0 trap)', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    addAnEvent()

    // A new event starts at amount 0, where the sign carries no information.
    // Direction must be remembered independently, or setting "out" first and
    // typing second silently produces an inflow.
    fireEvent.change(eventDirection(), { target: { value: 'out' } })
    fireEvent.change(eventAmount(), { target: { value: '750' } })

    // The Save button appears only once the debounced forecast has computed —
    // the same `findByRole` wait every other test in this file uses.
    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(-75000)
  })

  it('AC-1: a saved NEGATIVE event reloads as money out, showing its magnitude', () => {
    const withCost: SavedForecast = {
      id: 'saved-cost',
      name: 'House deposit',
      scenario: {
        name: 'House deposit',
        incomeGrowthRate: 0,
        expenseGrowthRate: 0,
        oneTimeEvents: [{ year: 2, amount: -4000000, name: 'Deposit' }],
      },
      result: {
        scenario: { name: 'House deposit', incomeGrowthRate: 0, expenseGrowthRate: 0 },
        baseline: [],
        projection: [],
        summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
      },
      inputs: { savings: 0, investments: 0, years: 10 },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }

    render(<ScenarioBuilder onSave={vi.fn()} initialForecast={withCost} />)

    expect(screen.getByLabelText(/direction/i)).toHaveValue('out')
    // Magnitude on screen, never a minus sign in the money field.
    expect(eventAmount()).toHaveValue(40000)
  })

  it('forecast-2: a typed minus SELECTS money out instead of erasing the entry', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    render(<ScenarioBuilder onSave={onSave} />)
    addAnEvent()

    // The old handler clamped any negative to 0, silently discarding the digits —
    // and with a "Money out" control sitting beside the field, `-500` is the
    // natural thing for a user to type.
    fireEvent.change(eventAmount(), { target: { value: '-500' } })

    // The magnitude is kept, and the direction control reflects the intent.
    expect(eventAmount()).toHaveValue(500)
    expect(eventDirection()).toHaveValue('out')

    fireEvent.click(
      await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(-50000)
  })

  it('forecast-2: a typed minus does NOT flip an already-outgoing row back to money in', () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)
    addAnEvent()

    fireEvent.change(eventDirection(), { target: { value: 'out' } })
    fireEvent.change(eventAmount(), { target: { value: '-500' } })

    // Minus means "out", never "toggle" — typing it twice must not oscillate.
    expect(eventDirection()).toHaveValue('out')
    expect(eventAmount()).toHaveValue(500)
  })

  it('forecast-2: every financial-item control is labelled for assistive tech', () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)

    // FOUR default financial-item rows (1 income + 3 expenses) carry an Amount,
    // and none of them was named to AT until this story. Query them through their
    // labels — only possible now — and assert there are several, so this cannot
    // pass by finding a single row.
    // ⚠️ No `toHaveAccessibleName()` loop here: an element found BY LABEL has an
    // accessible name by construction, so that assertion could never fail. The
    // count is the real guard — it drops the moment an association is removed.
    expect(screen.getAllByLabelText(/^amount$/i)).toHaveLength(4)

    expect(screen.getAllByLabelText(/^name$/i).length).toBeGreaterThanOrEqual(4)
    expect(screen.getAllByLabelText(/^frequency$/i).length).toBeGreaterThanOrEqual(4)
  })

  it('AC-3: income and expense amounts still clamp at zero', () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)

    // The financial-item clamp is a SEPARATE handler from the one-time-event one
    // (two `handleAmountChange` functions live in this file). An income/expense
    // amount is a magnitude whose sign is carried by which LIST it sits in, so it
    // must NOT gain an outflow affordance when the one-time-event row does.
    //
    // ⚠️ Queried by display value, not by label. When this test was written
    // (`forecast-1`) `FinancialItemRow`'s labels were not associated with their
    // inputs, so a label query was impossible. Story `forecast-2` associated them,
    // and this query is kept BY CHOICE: display value is what distinguishes the
    // salary row from the three expense rows, which a shared `/^amount$/i` label
    // cannot.
    const salaryAmount = screen.getByDisplayValue('5000') // DEFAULT_INCOME, cents/100
    fireEvent.change(salaryAmount, { target: { value: '-500' } })
    expect(salaryAmount).toHaveValue(0)

    // Positive control: the same field accepts an ordinary positive edit, so the
    // clamp above is a clamp and not an input that rejects everything.
    fireEvent.change(salaryAmount, { target: { value: '6000' } })
    expect(salaryAmount).toHaveValue(6000)
  })

  it('AC-3: the one-time-event row does NOT give income rows a direction control', () => {
    const { container } = render(<ScenarioBuilder onSave={vi.fn()} />)
    addAnEvent()

    // ⚠️ COUNTED AS RAW `<select>` ELEMENTS, NOT VIA `getAllByLabelText`. The
    // earlier form counted labelled controls and was PROVEN NOT TO DISCRIMINATE
    // (arm W5, story `forecast-1`): at the time `FinancialItemRow` associated none
    // of its labels, so a hoisted `<label>Direction</label><select>` copying that
    // row's convention was invisible to `getAllByLabelText` — the count stayed 1
    // and the suite stayed green with the affordance leaked into every row.
    // `forecast-2` has since associated those labels, so that specific blind spot
    // is closed; the raw-element count is kept because it does not depend on
    // labelling remaining correct.
    //
    // Derived, not a magic number: every `<select>` on the page is either a
    // frequency picker (financial-item rows) or THE one direction control. A
    // hoisted direction control would add one that is neither counted as
    // frequency nor allowed as the single direction — so the partition fails.
    const selects = [...container.querySelectorAll('select')]
    const isDirection = (s: HTMLSelectElement) =>
      [...s.options].some((o) => /money out/i.test(o.textContent ?? ''))
    const isFrequency = (s: HTMLSelectElement) =>
      [...s.options].some((o) => /monthly/i.test(o.textContent ?? ''))

    expect(selects.filter(isDirection)).toHaveLength(1)
    // Positive control: there ARE other selects, so the line above is not the
    // whole population by accident.
    expect(selects.filter(isFrequency).length).toBeGreaterThan(0)
    // The partition is total — no select is both, and none is neither.
    expect(selects.every((s) => isDirection(s) !== isFrequency(s))).toBe(true)
  })
})
