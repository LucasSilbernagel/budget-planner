/**
 * The scenario builder seeds a FRESH scenario from the user's own finances
 * (story 62.1, FR94).
 *
 * ## ⚠️ Why the hydration case here is the one that matters
 *
 * Every one of the four seeding hooks is a zustand selector, and zustand passes
 * `getInitialState` to React as `getServerSnapshot`. During the hydration pass
 * React uses that snapshot, so `useIncomeSources()` and friends report
 * EMPTY/ZERO on the first client render **however full localStorage is** — the
 * distinction story 38.1 (BUG-F) turned on, measured in
 * `hooks/useStoresHydrated.ts`'s docblock (`liveSavings=1` beside
 * `snapshotSavings=0`).
 *
 * So a lazy `useState` initializer, which runs exactly once during that render,
 * would capture the empty value and **never recover** — and an empty builder is
 * indistinguishable from the legitimate empty-user state below. The seed is
 * therefore an effect gated on `useStoresHydrated()`, and
 * `hydrateAfterStoresFill` is what proves it: a test that merely `render()`s
 * against populated stores CANNOT tell the two implementations apart, because
 * RTL has no separate hydration pass.
 *
 * ## ⚠️ Filename
 *
 * `vitest.config.ts` selects the environment by filename. `.dom.test.tsx` keeps
 * this in jsdom explicitly, matching `stores/__tests__/store-selector-hydration.dom.test.tsx`,
 * whose harness this borrows.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetStoresHydratedForTests } from '../../../hooks/useStoresHydrated'
import type { SavedForecast } from '../../../routes/forecasting'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

// Same currency stub as `scenario-builder.test.tsx`: a symbol-less, grouping-less
// formatter so a displayed amount is exactly `cents / 100` to two places and the
// assertions below read as money rather than as formatter output.
vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
  useCurrencyMode: () => 'none',
  useCurrencyCode: () => 'NONE',
}))

const NOW = '2026-09-22T00:00:00.000Z'
const PROFILE_A = 'profile-a'
const PROFILE_B = 'profile-b'

function incomeRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inc-1',
    profileId: PROFILE_A,
    userId: 0,
    name: 'Consulting',
    amount: 720_000, // $7,200
    frequency: 'monthly' as const,
    categoryId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function expenseRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'exp-1',
    profileId: PROFILE_A,
    userId: 0,
    name: 'Mortgage',
    amount: 210_000, // $2,100
    frequency: 'monthly' as const,
    categoryId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function savingsGoal(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'goal-1',
    profileId: PROFILE_A,
    name: 'Emergency fund',
    targetAmount: 1_000_000,
    currentBalance: 345_600, // $3,456
    allocationMode: 'manual' as const,
    monthlyAllocation: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function investmentEntry(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'entry-1',
    profileId: PROFILE_A,
    type: 'investment' as const,
    name: 'Index fund',
    currentBalance: 987_600, // $9,876
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
}

/** The user's own finances, all under PROFILE_A. */
function fillStores(): void {
  useIncomeStore.setState({ incomeSources: [incomeRow()] })
  useExpenseStore.setState({ expenses: [expenseRow()] })
  useSavingsStore.setState({ savingsGoals: [savingsGoal()] })
  useBalanceStore.setState({ entries: [investmentEntry()] })
}

beforeEach(() => {
  clearStores()
  useProfileStore.setState({ activeProfileId: PROFILE_A })
  // ⚠️ Required: the gate's module flag is set by any earlier `render()` in this
  // module instance, which would make the hydration case start RESOLVED and pass
  // for the wrong reason.
  __resetStoresHydratedForTests()
})

afterEach(() => {
  clearStores()
  vi.clearAllMocks()
})

describe('a fresh scenario seeds from the user own finances (62.1)', () => {
  it('seeds the savings rows and investments from the user own data, not from demo constants', () => {
    fillStores()
    render(<ScenarioBuilder onSave={vi.fn()} />)

    // $3,456 of savings (one row since story 100.1) and $9,876 of investments —
    // and explicitly NOT the retired DEFAULT_SAVINGS ($5,000) /
    // DEFAULT_INVESTMENTS ($10,000).
    expect(screen.getByDisplayValue('Emergency fund')).toBeInTheDocument()
    expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('3,456.00')
    // One investment ROW since story 100.2.
    expect(screen.getByLabelText('Balance for Index fund')).toHaveValue('9,876.00')
    expect(screen.queryByDisplayValue('5000')).toBeNull()
    expect(screen.queryByDisplayValue('10000')).toBeNull()
  })

  it('seeds income and expense rows with their real name, amount and frequency', () => {
    fillStores()
    render(<ScenarioBuilder onSave={vi.fn()} />)

    expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Mortgage')).toBeInTheDocument()
    // Amounts arrive in cents and render through the row editor's own divisor.
    expect(screen.getByDisplayValue('7,200.00')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2,100.00')).toBeInTheDocument()
    // The demo rows are gone for good.
    expect(screen.queryByDisplayValue('Salary')).toBeNull()
    expect(screen.queryByDisplayValue('Rent/Mortgage')).toBeNull()
    expect(screen.queryByDisplayValue('Groceries')).toBeNull()
  })

  /**
   * ⚠️⚠️ THIS TEST WAS VACUOUS AND ITS TITLE NAMED THE DEFECT IT COULD NOT CATCH
   * (code review 62.1, MEASURED). It asserted `.closest('div')` is non-null
   * (always true for an input inside a div) and that an element found BY display
   * value has that display value (a tautology). Forcing
   * `frequency: 'monthly'` in `itemsFromStore` left the whole 5-file suite
   * 49/49 GREEN — an implementation that flattened every weekly row to monthly,
   * making the engine read $500/week as $500/month, would have shipped.
   *
   * The frequency `<select>` is the only thing that can see it.
   */
  it('carries a non-monthly frequency through rather than flattening it', () => {
    useIncomeStore.setState({
      incomeSources: [incomeRow({ name: 'Freelance', amount: 50_000, frequency: 'weekly' })],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)

    // The amount is the RAW figure, not the monthly-normalized one
    // `useTotalIncome` would have produced.
    expect(screen.getByDisplayValue('500.00')).toBeInTheDocument()
    // ...and the frequency survives as `weekly`. This is the discriminating
    // assertion the previous version lacked entirely.
    const frequency = screen.getAllByRole('combobox').find((el) => el.closest('div'))
    expect(frequency).toBeDefined()
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('weekly')
  })

  /**
   * ⚠️ A corrupt `frequency` must not kill the forecast (code review 62.1).
   * `??` only catches null/undefined; `'quarterly'` reached `validateFrequency`,
   * which throws, blanking the whole builder behind an "Invalid frequency"
   * banner that names no row — while the `<select>` rendered it as "Weekly".
   */
  it('falls back to monthly for a frequency the engine does not know', () => {
    useIncomeStore.setState({
      incomeSources: [incomeRow({ name: 'Odd', amount: 50_000, frequency: 'quarterly' as never })],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)

    expect(screen.getByDisplayValue('Odd')).toBeInTheDocument()
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('monthly')
  })

  /**
   * ⚠️ Both totals are raw `reduce(sum + currentBalance)` with no finiteness
   * guard, so one corrupt row makes the total NaN — which reached the money
   * field AND the saved forecast's `inputs` (code review 62.1). Every row
   * `amount` was already guarded; these two were not.
   */
  it('seeds 0 rather than NaN when a stored balance is not finite', () => {
    useSavingsStore.setState({
      savingsGoals: [savingsGoal({ currentBalance: Number.NaN as number })],
    })
    useBalanceStore.setState({
      entries: [investmentEntry({ currentBalance: undefined as unknown as number })],
    })
    render(<ScenarioBuilder onSave={vi.fn()} />)

    // Positive control: the builder rendered at all.
    expect(screen.getByDisplayValue('My Financial Forecast')).toBeInTheDocument()
    // The savings row is kept (story 100.1) with its balance coerced to 0.
    expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('0.00')
    // The investment row too (story 100.2), coerced per row.
    expect(screen.getByLabelText('Balance for Index fund')).toHaveValue('0.00')
    expect(screen.queryByDisplayValue('NaN')).toBeNull()
  })

  /**
   * ⚠️⚠️ MEASURED, and it corrects this story's own AC-1 wording.
   *
   * AC-1 asks that the growth-rate fields "show 0.00%". They cannot, and never
   * did: both are `<input type="number">` fed the string `formatPercentage`
   * produces, so the browser rejects the value outright. Probed directly at
   * implementation time:
   *
   *   incomeGrowth  .value=[]  getAttribute('value')=[0.00%]  type=number
   *   expenseGrowth .value=[]  getAttribute('value')=[0.00%]
   *
   * The field renders BLANK. That is pre-existing — it rendered blank holding
   * `3.00%` too — and this story makes it strictly better, because a blank field
   * that means "no growth" is honest where a blank field silently applying 3%
   * was not. Fixing the number/percent-string mismatch is a real defect but a
   * different one; it changes a shared field's typing semantics and is outside
   * FR94. Recorded in the story's Completion Notes, not silently absorbed.
   *
   * So the assertions below use the two observables that can actually tell 0
   * from 0.03: the rendered `value` ATTRIBUTE, and the rate the builder hands to
   * `onSave`. `getByDisplayValue('0.00%')` would never match, and asserting
   * `queryByDisplayValue('3.00%')` is null would pass vacuously.
   */
  it('defaults both growth rates to zero', () => {
    fillStores()
    render(<ScenarioBuilder onSave={vi.fn()} />)

    const income = screen.getByLabelText('Income Growth Rate')
    const expense = screen.getByLabelText('Expense Growth Rate')

    // ⚠️ AC-1's visible clause is now actually MET: since code review 62.1 these
    // are `type="text"`, so the DOM `.value` carries the string instead of the
    // browser rejecting it and leaving the field blank. Assert `.value`, which
    // is what the user sees — the attribute alone was the weaker observable the
    // blank-field defect forced.
    expect((income as HTMLInputElement).value).toBe('0.00%')
    expect((expense as HTMLInputElement).value).toBe('0.00%')
    // ⚠️ The two `.not.toBe('3.00%')` lines that stood here were labelled a
    // "positive control" and were nothing of the sort — they are implied by the
    // assertions above and cannot fail independently (code review 62.1). The
    // real control is the AC-7 test below, which drives a loaded 0.05 through
    // the same field and reads back `5.00%`.
  })

  it('hands a zero growth rate to onSave, not the retired 3%/2%', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true })
    fillStores()
    render(<ScenarioBuilder onSave={onSave} />)

    const saveButton = await screen.findByRole(
      'button',
      { name: /save forecast/i },
      { timeout: 2000 }
    )
    saveButton.click()

    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0][0]
    expect(saved.scenario.incomeGrowthRate).toBe(0)
    expect(saved.scenario.expenseGrowthRate).toBe(0)
  })
})

/**
 * Each seeded source is counted ONCE (62.1 AC-8).
 *
 * `ForecastingScenario.newIncome` / `newExpenses` share the builder's rows under
 * a second name, and the naming actively invites a double-count reading — story
 * 57.1 shipped three comments that got it wrong. Verified here rather than
 * argued: `calculateFinancialForecast` projects from its `currentData` argument
 * alone and never reads those two fields (`ForecastingScenario.newIncome`/`newExpenses`
 * in `forecasting.ts` declare them; the function reads only its `currentData` argument).
 */
describe('a seeded scenario counts each source exactly once (62.1 AC-8)', () => {
  it('reports the hand-computed year-1 figures', async () => {
    fillStores() // one income row $7,200/mo, one expense row $2,100/mo
    const onResultChange = vi.fn()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResultChange} />)

    await vi.waitFor(
      () =>
        expect(onResultChange).toHaveBeenCalledWith(
          expect.objectContaining({ baseline: expect.any(Array) })
        ),
      { timeout: 2000 }
    )
    const result = onResultChange.mock.calls.at(-1)?.[0]
    const yearOne = result.baseline[0]

    // BY HAND: a row's `income` is the monthly-normalized total lifted to a year.
    // ⚠️ `yearOne` here is `result.baseline[0]`, so the figure is built from
    // `baselineAnnualIncome` (in `forecasting.ts`), NOT from the projection row's
    // own `income:` expression. The two agree only because a fresh scenario pins
    // both growth rates to 0 — cite the baseline line, or a later growth default
    // would make this comment quietly wrong.
    // One `monthly` row at 720000 cents normalizes to 720000, so a year is
    // 720000 × 12 = 8640000. A double count — the scenario's `newIncome` added on
    // top of `currentData.income` — would report twice that, 17280000.
    //
    // ⚠️ These figures were 720000 / 210000 / 510000 until 2026-09-24, when the
    // engine stopped reporting a MONTHLY flow on a YEARLY row. The relational
    // point of these tests is unchanged and is what matters: N seeded sources must
    // scale linearly, never quadratically.
    expect(yearOne.income, 'one $7,200/mo source ⇒ 720000 × 12; a double count ⇒ 17280000').toBe(
      8_640_000
    )
    expect(yearOne.expenses, 'one $2,100/mo expense ⇒ 210000 × 12').toBe(2_520_000)
    // The flow is annual too: (720000 − 210000) × 12.
    expect(yearOne.netIncome, '(720000 − 210000) × 12').toBe(6_120_000)
  })

  it('doubles when a second identical source is seeded, rather than quadrupling', async () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow({ id: 'inc-1', name: 'Consulting A' }),
        incomeRow({ id: 'inc-2', name: 'Consulting B' }),
      ],
    })
    const onResultChange = vi.fn()
    render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResultChange} />)

    await vi.waitFor(() => expect(onResultChange).toHaveBeenCalled(), { timeout: 2000 })
    const result = onResultChange.mock.calls.at(-1)?.[0]

    // BY HAND: two `monthly` rows at 720000 normalize to 1440000, and a year of
    // that is 1440000 × 12 = 17280000 (one row was 8640000, so exactly double).
    // The relational half is mechanism-independent: whatever the unit, N sources
    // must scale linearly, not quadratically.
    expect(result.baseline[0].income, 'two $7,200/mo sources ⇒ 1440000 × 12').toBe(17_280_000)
  })
})

/**
 * The one-shot guard (62.1 AC-9).
 *
 * ⚠️⚠️ MEASURED VACUOUS BEFORE THIS (code review 62.1): no test changed a store
 * after `render()`, so the property the production docblock calls "cannot run
 * twice or overwrite the user's own edits" was pinned by nothing. Mutating the
 * guard to re-seed on every store change for fresh scenarios left the whole
 * 5-file suite 49/49 GREEN.
 */
describe('the seed happens once and never overwrites the user (62.1 AC-9)', () => {
  it('does not re-seed over an edit when the stores change afterwards', async () => {
    fillStores()
    render(<ScenarioBuilder onSave={vi.fn()} />)

    // The seed landed.
    const nameInput = screen.getByDisplayValue('Consulting')
    // The user renames the row.
    fireEvent.change(nameInput, { target: { value: 'My own edit' } })
    expect(screen.getByDisplayValue('My own edit')).toBeInTheDocument()

    // A later store change (a sync pull, a background write) must NOT clobber it.
    await act(async () => {
      useIncomeStore.setState({
        incomeSources: [incomeRow({ id: 'inc-late', name: 'Arrived Later' })],
      })
    })

    expect(screen.getByDisplayValue('My own edit')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Arrived Later')).toBeNull()
  })
})

describe('the seed respects the active profile (62.1 AC-4)', () => {
  it('seeds only the active profile rows and totals', () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow({ id: 'inc-a', name: 'A Salary', profileId: PROFILE_A }),
        incomeRow({ id: 'inc-b', name: 'B Salary', profileId: PROFILE_B }),
      ],
    })
    useSavingsStore.setState({
      savingsGoals: [
        savingsGoal({ id: 'g-a', currentBalance: 100_000, profileId: PROFILE_A }),
        savingsGoal({ id: 'g-b', currentBalance: 900_000, profileId: PROFILE_B }),
      ],
    })
    // Story 100.2: investment/debt rows are profile-scoped too.
    useBalanceStore.setState({
      entries: [
        investmentEntry({ id: 'e-a', name: 'A fund', currentBalance: 200_000 }),
        investmentEntry({
          id: 'e-b',
          name: 'B fund',
          currentBalance: 800_000,
          profileId: PROFILE_B,
        }),
        investmentEntry({
          id: 'e-b2',
          name: 'B loan',
          type: 'debt',
          currentBalance: 700_000,
          profileId: PROFILE_B,
        }),
      ] as never,
    })

    render(<ScenarioBuilder onSave={vi.fn()} />)

    expect(screen.getByDisplayValue('A Salary')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('B Salary')).toBeNull()
    // One savings ROW from profile A alone (story 100.1), holding $1,000 — not
    // two rows, and not profile B's $9,000.
    const savingsSection = screen.getByRole('region', { name: 'Savings Accounts' })
    const balances = within(savingsSection).getAllByLabelText(/^Balance for /)
    expect(balances).toHaveLength(1)
    expect(balances[0]).toHaveValue('1,000.00')
    // One investment ROW from profile A alone (story 100.2): not B's fund or loan.
    const balanceSection = screen.getByRole('region', { name: 'Investments & Debts' })
    const names = within(balanceSection)
      .getAllByLabelText(/^Balance Name, row \d+$/)
      .map((input) => (input as HTMLInputElement).value)
    expect(names).toEqual(['A fund'])
    expect(screen.getByLabelText('Balance for A fund')).toHaveValue('2,000.00')
  })

  /**
   * ⚠️ RENAMED in code review 62.1. This sets the active profile BEFORE `render`,
   * so it pins "the seed reads whichever profile is active at mount" — NOT a
   * switch. A post-mount switch does NOT reseed (`hasSeeded` latches); that gap
   * is recorded in `deferred-work.md` rather than claimed as covered here.
   */
  it('seeds from whichever profile is active at mount', () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow({ id: 'inc-a', name: 'A Salary', profileId: PROFILE_A }),
        incomeRow({ id: 'inc-b', name: 'B Salary', profileId: PROFILE_B }),
      ],
    })
    useProfileStore.setState({ activeProfileId: PROFILE_B })

    render(<ScenarioBuilder onSave={vi.fn()} />)

    expect(screen.getByDisplayValue('B Salary')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('A Salary')).toBeNull()
  })
})

describe('a user with nothing recorded gets an empty builder (62.1 AC-6)', () => {
  it('renders empty income and expense lists, never the demo rows', () => {
    // Stores are already cleared by beforeEach — this is the empty user.
    render(<ScenarioBuilder onSave={vi.fn()} />)

    // ⚠️ Positive control FIRST: a bare "no demo rows" assertion passes just as
    // happily on a builder that failed to render at all.
    expect(screen.getByDisplayValue('My Financial Forecast')).toBeInTheDocument()

    expect(screen.queryByDisplayValue('Salary')).toBeNull()
    expect(screen.queryByDisplayValue('Rent/Mortgage')).toBeNull()
    expect(screen.queryByDisplayValue('Utilities')).toBeNull()
    expect(screen.queryByDisplayValue('Groceries')).toBeNull()
    // No savings rows (story 100.1) and no investment/debt rows (story 100.2),
    // not the retired demo constants.
    expect(screen.getByText('No investments or debts in this scenario')).toBeInTheDocument()
    expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('5000')).toBeNull()
    expect(screen.queryByDisplayValue('10000')).toBeNull()
  })

  it('still offers the add-row affordances', () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)

    expect(screen.getByRole('button', { name: /add income/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add expense/i })).toBeInTheDocument()
  })
})

describe('a loaded forecast still seeds from the saved scenario (62.1 AC-7)', () => {
  // Saved rows carry `name` (the builder writes it and `itemsFromSaved` reads it)
  // although the scenario type declares only `{ amount, frequency }`; named rows,
  // not inline literals, so the excess-property check does not reject real data.
  const savedIncome = [{ name: 'Saved Income', amount: 111_100, frequency: 'monthly' as const }]
  const savedExpenses = [{ name: 'Saved Expense', amount: 222_200, frequency: 'monthly' as const }]
  const savedForecast: SavedForecast = {
    id: 'saved-1',
    name: 'March Plan',
    description: 'Saved months ago',
    scenario: {
      name: 'March Plan',
      description: 'Saved months ago',
      incomeGrowthRate: 0.05,
      expenseGrowthRate: 0.03,
      newIncome: savedIncome,
      newExpenses: savedExpenses,
      oneTimeEvents: [],
    },
    result: {
      scenario: { name: 'March Plan', incomeGrowthRate: 0.05, expenseGrowthRate: 0.03 },
      baseline: [],
      projection: [],
      summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
    },
    inputs: { savings: 333_300, investments: 444_400, years: 15 },
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  }

  it('does NOT re-baseline to the live stores', () => {
    // The live stores hold visibly different numbers. If any of them reaches the
    // builder, a forecast saved in March has silently re-based to September.
    fillStores()

    render(<ScenarioBuilder onSave={vi.fn()} initialForecast={savedForecast} />)

    expect(screen.getByDisplayValue('Saved Income')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Saved Expense')).toBeInTheDocument()
    // A v1 saved total reloads as one `Savings` row (story 100.1, AC-12).
    expect(screen.getByLabelText('Balance for Savings')).toHaveValue('3,333.00')
    // ... and a v1 investments total as one `Investments` row (story 100.2).
    expect(screen.getByLabelText('Balance for Investments')).toHaveValue('4,444.00')
    // Via the attribute, for the `type="number"` reason documented above.
    expect(screen.getByLabelText('Income Growth Rate').getAttribute('value')).toBe('5.00%')

    // Nothing from the live stores leaked in.
    expect(screen.queryByDisplayValue('Consulting')).toBeNull()
    expect(screen.queryByDisplayValue('Mortgage')).toBeNull()
    expect(screen.queryByDisplayValue('Emergency fund')).toBeNull()
    expect(screen.queryByDisplayValue('Index fund')).toBeNull()
  })

  it('falls back to zero, not to the live stores, for an older row with no saved inputs', () => {
    fillStores()
    const olderRow: SavedForecast = { ...savedForecast, inputs: undefined }

    render(<ScenarioBuilder onSave={vi.fn()} initialForecast={olderRow} />)

    expect(screen.getByDisplayValue('March Plan')).toBeInTheDocument()
    // No savings rows (story 100.1), no investment rows (story 100.2), and the
    // surviving DEFAULT_FORM.years of 10.
    expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
    expect(screen.getByText('No investments or debts in this scenario')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Emergency fund')).toBeNull()
    expect(screen.queryByDisplayValue('Index fund')).toBeNull()
  })
})

/**
 * ⚠️⚠️ THE CASE A PLAIN `render()` CANNOT SEE (62.1 AC-9).
 *
 * Server-render against the pristine snapshot, fill the stores, then hydrate —
 * the real ordering, borrowed from `store-selector-hydration.dom.test.tsx`.
 * Under a lazy `useState` initializer the builder captures the hydration-pass
 * snapshot (empty) and stays empty forever; under the effect gated on
 * `useStoresHydrated()` it fills on the commit after mount.
 */
async function hydrateAfterStoresFill(element: React.ReactElement) {
  const container = document.createElement('div')
  container.innerHTML = renderToString(element)
  document.body.appendChild(container)
  const serverHtml = container.innerHTML

  fillStores()

  const recoverable: string[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, element, {
      onRecoverableError: (error) => recoverable.push(String(error)),
    })
  })

  const clientHtml = container.innerHTML

  await act(async () => {
    root?.unmount()
  })
  container.remove()
  return { recoverable, serverHtml, clientHtml }
}

describe('the seed survives the rehydration race (62.1 AC-9)', () => {
  it('fills from the stores even though the hydration pass saw them empty', async () => {
    const { serverHtml, clientHtml } = await hydrateAfterStoresFill(
      <ScenarioBuilder onSave={vi.fn()} />
    )

    // ⚠️ NOT an assertion about the implementation: `renderToString` runs after
    // `beforeEach`'s `clearStores()` and before `fillStores()`, so no code path
    // could put 'Consulting' here. Kept only to document the harness's ordering;
    // it passes regardless of the code under test (code review 62.1).
    expect(serverHtml).not.toContain('Consulting')
    // ...but after hydration settles the builder shows it. A lazy initializer
    // fails HERE: it captured the empty hydration snapshot and never recovers.
    expect(
      clientHtml,
      'builder seeded empty and never recovered — the lazy-initializer failure mode'
    ).toContain('Consulting')
    // The savings row (story 100.1) and the investment row (story 100.2).
    expect(clientHtml).toContain('Emergency fund')
    expect(clientHtml).toContain('Index fund')
  })

  it('raises no recoverable hydration error (62.1 AC-10)', async () => {
    const { recoverable, serverHtml, clientHtml } = await hydrateAfterStoresFill(
      <ScenarioBuilder onSave={vi.fn()} />
    )

    expect(
      recoverable,
      `server html length ${serverHtml.length}, client html length ${clientHtml.length}`
    ).toEqual([])
  })

  /**
   * ⚠️ DESIGNED-RED CONTROL for the test above (84.5 code review; the 84.3 HIGH:
   * React 19 reports NO error for a mismatch directly under the hydration root,
   * so "no recoverable error" proves nothing unless this harness is shown to
   * HEAR one). The probe reads the store with `getState()`, bypassing the
   * hydration snapshot, so it renders 0 rows on the server and the filled count
   * on the client, NESTED inside the subject's tree as a real mismatch would be.
   */
  it('CONTROL: the same harness reports a nested mismatch when one exists', async () => {
    function MismatchProbe() {
      return (
        <section>
          <div>
            <span>{useIncomeStore.getState().incomeSources.length} rows</span>
          </div>
          <ScenarioBuilder onSave={vi.fn()} />
        </section>
      )
    }
    const { recoverable } = await hydrateAfterStoresFill(<MismatchProbe />)
    expect(recoverable.length, 'the harness could not hear a designed mismatch').toBeGreaterThan(0)
  })
})
