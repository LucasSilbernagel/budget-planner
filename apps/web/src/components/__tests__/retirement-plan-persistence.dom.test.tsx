import { act, renderWithProviders, screen, userEvent } from '@/test/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import {
  RETIREMENT_PLANNER_STORAGE_KEY,
  RETIREMENT_PLANNER_VERSION,
  useRetirementPlannerStore,
} from '../../stores/retirementPlannerStore'
import { RetirementAccumulationPlanner } from '../RetirementAccumulationPlanner'

/**
 * The retirement plan survives (story 44.1, FR71).
 *
 * ⚠️ WHAT THIS FILE CANNOT PROVE. jsdom has no reload. Unmounting and remounting
 * shows that the plan outlives the COMPONENT — but a store that never wrote to
 * localStorage at all passes that perfectly, because the zustand store is a
 * module singleton holding the value in memory. The reload claim lives in
 * `e2e/retirement-plan-persistence.spec.ts` and nowhere else. The tests here
 * that go through `persist.rehydrate()` are the ones that touch storage.
 *
 * ⚠️ NO FIXTURE VALUE EQUALS ITS DEFAULT. A test that stores `'35'` and asserts
 * `'35'` cannot tell "restored" from "defaulted".
 */

const ISO = '2026-08-06T00:00:00.000Z'

const incomeRow = (amount: number) => ({
  id: 'inc-1',
  userId: 0,
  name: 'Salary',
  amount,
  frequency: 'monthly' as const,
  createdAt: ISO,
  updatedAt: ISO,
})

// ⚠️ Story 47.2: `monthlyContribution` now IS the derived "Monthly Savings"
// figure, so it is a real parameter rather than inert padding.
const investmentRow = (currentBalance: number, monthlyContribution = 0) => ({
  id: 'inv-1',
  type: 'investment' as const,
  name: 'RRSP',
  currentBalance,
  monthlyContribution,
  frequency: 'monthly' as const,
  createdAt: ISO,
  updatedAt: ISO,
})

/** A saved plan in which no field equals its default. */
const SAVED_PLAN = {
  currentAgeInput: '42',
  lifeExpectancyInput: '88',
  desiredIncomeInput: '55,000.00',
  desiredIncomeTouched: true,
  desiredIncomeLocale: 'en-US',
  // ⚠️ 'monthly', not 'annual'. 'annual' IS the default, so the file's own
  // "no fixture value equals its default" rule was violated here and a restored
  // basis was indistinguishable from a defaulted one (code review).
  incomeBasis: 'monthly',
  annualReturnInput: '7.5',
  postRetirementReturnInput: '3.25',
  postRetirementTouched: true,
  model: 'perpetual',
} as const

function seedStoredPlan(plan: unknown, version: number = RETIREMENT_PLANNER_VERSION): void {
  localStorage.setItem(RETIREMENT_PLANNER_STORAGE_KEY, JSON.stringify({ state: { plan }, version }))
}

/** Load a stored plan the way `StoreHydration` does on a real page load. */
async function rehydrate(): Promise<void> {
  await act(async () => {
    await useRetirementPlannerStore.persist.rehydrate()
  })
}

const MIRROR_HINT = /Follows the rate above until you change it/

beforeEach(() => {
  useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  useBalanceStore.setState({ entries: [] })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
})

describe('first visit (AC-2)', () => {
  it('pre-fills age 35 and life expectancy 90', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(screen.getByLabelText('Current Age')).toHaveValue(35)
    expect(screen.getByLabelText('Life Expectancy')).toHaveValue(90)
  })

  it('leaves the 6.0% return and the deplete model as they were', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(screen.getByLabelText('Expected Annual Return')).toHaveValue(6)
    expect(screen.getByRole('radio', { name: /deplete/i })).toBeChecked()
  })
})

describe('the plan outlives the component (AC-1)', () => {
  it('keeps every typed field across an unmount and remount', async () => {
    const user = userEvent.setup()
    const first = renderWithProviders(<RetirementAccumulationPlanner />)

    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), '42')
    await user.type(screen.getByLabelText('Desired Retirement Income'), '55000')
    await user.click(screen.getByRole('radio', { name: /perpetual/i }))

    first.unmount()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Current Age')).toHaveValue(42)
    // Grouped, not the raw '55000' that was typed: clicking the radio blurred
    // the money field, and `reEcho` re-echoes it in locale form. What persisted
    // is what the user was actually left looking at.
    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('55,000.00')
    expect(screen.getByRole('radio', { name: /perpetual/i })).toBeChecked()
  })

  it('renders a plan restored from storage', async () => {
    seedStoredPlan(SAVED_PLAN)
    await rehydrate()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Current Age')).toHaveValue(42)
    expect(screen.getByLabelText('Life Expectancy')).toHaveValue(88)
    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('55,000.00')
    expect(screen.getByLabelText('Income period')).toHaveValue('monthly')
    expect(screen.getByLabelText('Expected Annual Return')).toHaveValue(7.5)
    expect(screen.getByLabelText('Post-Retirement Annual Return')).toHaveValue(3.25)
    expect(screen.getByRole('radio', { name: /perpetual/i })).toBeChecked()
  })
})

describe('the income prefill must not clobber a restored plan (AC-1)', () => {
  it('leaves a restored desired income alone WITH income rows present', async () => {
    // ⚠️ THE INCOME ROWS ARE THE POINT OF THIS TEST. `prefillDesiredIncomeCents`
    // derives from the income store, which rehydrates in the same pass as the
    // plan, so the seeding effect re-fires on every visit. Without income rows
    // the prefill is null, the effect returns early, and this test passes against
    // a build that has no guard at all.
    useIncomeStore.setState({ incomeSources: [incomeRow(200_000)] })
    seedStoredPlan(SAVED_PLAN)
    await rehydrate()

    renderWithProviders(<RetirementAccumulationPlanner />)

    // The prefill for this fixture is $2,000 x 12 x 0.5 = 12,000.00. If the guard
    // is gone that is what appears here instead of the saved 55000.
    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('55,000.00')
  })

  it('still seeds the field for a user who has never authored it', () => {
    // The courtesy the guard must not break: untouched means "seed me".
    useIncomeStore.setState({ incomeSources: [incomeRow(200_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('12,000.00')
  })

  it('stops seeding as soon as the user types in the field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    await user.type(screen.getByLabelText('Desired Retirement Income'), '999')
    // Income arrives afterwards — a prefill recompute that must not overwrite.
    act(() => {
      useIncomeStore.setState({ incomeSources: [incomeRow(200_000)] })
    })

    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('999')
  })
})

describe('a deliberately cleared field stays cleared (AC-4)', () => {
  it('does not re-default an age the user emptied, across a remount', async () => {
    const user = userEvent.setup()
    const first = renderWithProviders(<RetirementAccumulationPlanner />)

    await user.clear(screen.getByLabelText('Current Age'))
    expect(screen.getByLabelText('Current Age')).toHaveValue(null)

    first.unmount()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Current Age')).toHaveValue(null)
  })

  it('does not re-default an emptied age restored from storage', async () => {
    seedStoredPlan({ ...SAVED_PLAN, currentAgeInput: '', lifeExpectancyInput: '' })
    await rehydrate()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Current Age')).toHaveValue(null)
    expect(screen.getByLabelText('Life Expectancy')).toHaveValue(null)
    // ...while a field the payload still carries keeps its SAVED value.
    expect(screen.getByLabelText('Expected Annual Return')).toHaveValue(7.5)
  })

  it('takes the default for a field genuinely ABSENT from the payload', async () => {
    // ⚠️ The previous test's comment used to claim this, while asserting a field
    // that was PRESENT in its fixture (7.5 is the saved value, not the default
    // 6.0) — an assertion that taught a false default. Absent is its own case.
    const { annualReturnInput: _omitted, ...withoutRate } = SAVED_PLAN
    seedStoredPlan({ ...withoutRate, currentAgeInput: '' })
    await rehydrate()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Expected Annual Return')).toHaveValue(6)
    expect(screen.getByLabelText('Current Age')).toHaveValue(null)
  })
})

describe('the mirror hint matches the restored plan (AC-3)', () => {
  it('drops the "follows the rate above" clause for a restored touched plan', async () => {
    seedStoredPlan(SAVED_PLAN)
    await rehydrate()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Post-Retirement Annual Return')).toHaveValue(3.25)
    expect(screen.queryByText(MIRROR_HINT)).not.toBeInTheDocument()
  })

  it('keeps the clause, and the mirror, for a restored untouched plan', async () => {
    seedStoredPlan({
      ...SAVED_PLAN,
      postRetirementReturnInput: '',
      postRetirementTouched: false,
    })
    await rehydrate()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByText(MIRROR_HINT)).toBeInTheDocument()
    // Mirroring means it shows the ACCUMULATION rate, not its own empty value.
    expect(screen.getByLabelText('Post-Retirement Annual Return')).toHaveValue(7.5)
  })

  it('sets the flag as the user edits, so the hint and the value never disagree', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(screen.getByText(MIRROR_HINT)).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Post-Retirement Annual Return'))
    await user.type(screen.getByLabelText('Post-Retirement Annual Return'), '3')

    expect(screen.queryByText(MIRROR_HINT)).not.toBeInTheDocument()
    expect(useRetirementPlannerStore.getState().plan.postRetirementTouched).toBe(true)
  })
})

describe('the derived figures still derive (AC-8)', () => {
  it('is absent from the persisted payload', async () => {
    useBalanceStore.setState({ entries: [investmentRow(1_000_000_00)] })
    renderWithProviders(<RetirementAccumulationPlanner />)
    act(() => {
      useRetirementPlannerStore.getState().setCurrentAgeInput('42')
    })

    const parsed = JSON.parse(localStorage.getItem(RETIREMENT_PLANNER_STORAGE_KEY) as string)
    expect(Object.keys(parsed.state.plan).sort()).toEqual(
      [
        'annualReturnInput',
        'currentAgeInput',
        'desiredIncomeInput',
        'desiredIncomeLocale',
        'desiredIncomeTouched',
        'incomeBasis',
        'lifeExpectancyInput',
        'model',
        'postRetirementReturnInput',
        'postRetirementTouched',
      ].sort()
    )
  })

  it('shows today’s investment total, not the one that was on screen when saved', async () => {
    seedStoredPlan(SAVED_PLAN)
    await rehydrate()
    useBalanceStore.setState({ entries: [investmentRow(7_777_00, 33_300)] })

    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('7,777.00')
    // ⚠️ The describe says "figureS". Before story 47.2 only ONE of them was
    // checked here, so the monthly figure's derive-don't-persist property was
    // unguarded in the suite that exists to prove it — and after 47.2 both
    // figures read the same rows, which is exactly when a persisted-stale bug
    // would hit both at once.
    expect(screen.getByTestId('derived-monthly-savings')).toHaveTextContent('333.00')
  })
})

describe('corrupt payloads (AC-5)', () => {
  it('renders the planner on defaults without throwing', async () => {
    seedStoredPlan({ currentAgeInput: 42, lifeExpectancyInput: null, model: 'preserve' })
    await rehydrate()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Current Age')).toHaveValue(35)
    expect(screen.getByLabelText('Life Expectancy')).toHaveValue(90)
    expect(screen.getByRole('radio', { name: /deplete/i })).toBeChecked()
  })

  it('never hands the parsers a non-string, which would throw before any guard', async () => {
    // `parseAge` calls `.trim()` on its argument. A surviving number is a
    // TypeError inside the parse memo, which the try/catch would report as an
    // "invalid input" note rather than the defaults the user should see.
    seedStoredPlan({ ...SAVED_PLAN, currentAgeInput: 42 }, RETIREMENT_PLANNER_VERSION)
    await rehydrate()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(
      screen.queryByText(/check the highlighted|could not be read as a number/i)
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current Age')).toHaveValue(35)
  })
})

describe('the income basis and the seeded figure stay in step (code review)', () => {
  it('re-seeds an UNTOUCHED figure when the basis changes, so it round-trips', async () => {
    // ⚠️ THE BUG THIS PINS. An income-seeded user saw 12,000.00 under Annual,
    // switched to Monthly, and the field kept reading 12,000.00 — now solved as a
    // MONTHLY income, i.e. 12x their plan. That trio persisted, and on the next
    // load the seed effect re-fired and rewrote it to 1,000.00: the projection
    // they left was not the projection they came back to. Before persistence the
    // state evaporated at unmount.
    const user = userEvent.setup()
    useIncomeStore.setState({ incomeSources: [incomeRow(200_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('12,000.00')
    await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')

    // What is on screen now is what a reload will produce, because the seed
    // follows the basis while the value is unauthored.
    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('1,000.00')
    expect(useRetirementPlannerStore.getState().plan.desiredIncomeInput).toBe('1,000.00')
  })

  it('leaves an AUTHORED figure alone when the basis changes', async () => {
    // The other half: switching the basis must still change only the MEANING of
    // a number the user typed, never the number itself.
    const user = userEvent.setup()
    useIncomeStore.setState({ incomeSources: [incomeRow(200_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)

    const field = screen.getByLabelText('Desired Retirement Income')
    await user.clear(field)
    await user.type(field, '9999')
    await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')

    // Grouped because moving to the select blurred the money field and `reEcho`
    // ran — the MAGNITUDE is what must be untouched, and 9999 -> 9,999.00 is the
    // same number. A re-seed would have produced 1,000.00 instead.
    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('9,999.00')
  })
})

describe('a persisted money string survives a currency change (code review, HIGH)', () => {
  it('re-expresses an authored figure instead of reinterpreting it', async () => {
    // ⚠️ MEASURED AGAINST THE REAL PARSER: '55.000,00' authored on EUR/de-DE and
    // reparsed under en-US yields 5500 cents — $55 where the user meant €55,000.
    // '1234,56' yields $123,456. No throw, no invalid state: the field keeps
    // showing the old string while the solver answers a different question.
    // Currency is two clicks away in Settings, and this store is the only one
    // that persists a display string rather than integer cents.
    seedStoredPlan({
      ...SAVED_PLAN,
      desiredIncomeInput: '55.000,00',
      desiredIncomeLocale: 'de-DE',
      desiredIncomeTouched: true,
    })
    await rehydrate()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })

    renderWithProviders(<RetirementAccumulationPlanner />)

    // The MAGNITUDE is carried across, not the characters.
    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('55,000.00')
    expect(useRetirementPlannerStore.getState().plan.desiredIncomeLocale).toBe('en-US')
  })

  it('leaves the figure untouched when the locale has not changed', async () => {
    seedStoredPlan(SAVED_PLAN)
    await rehydrate()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })

    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('55,000.00')
  })

  it('carries the magnitude of a grouped-vs-decimal ambiguity correctly', async () => {
    // '1,2' is not a partial entry under de-DE — the comma is its DECIMAL
    // separator, so this is 1.2 and must come across as 1.20, not as 12 or 1,200.
    seedStoredPlan({
      ...SAVED_PLAN,
      desiredIncomeInput: '1,2',
      desiredIncomeLocale: 'de-DE',
      desiredIncomeTouched: true,
    })
    await rehydrate()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })

    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('1.20')
  })

  it('keeps a genuinely unparseable entry exactly as typed rather than mangling it', async () => {
    // A digit-free partial has no magnitude to carry across; the characters are
    // the only thing worth preserving, and the field must not become '0.00'.
    seedStoredPlan({
      ...SAVED_PLAN,
      desiredIncomeInput: '-',
      desiredIncomeLocale: 'de-DE',
      desiredIncomeTouched: true,
    })
    await rehydrate()
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })

    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('-')
    expect(useRetirementPlannerStore.getState().plan.desiredIncomeLocale).toBe('en-US')
  })
})

describe('the authored latch is not tripped by a rejected keystroke (code review)', () => {
  it('keeps seeding after a character the sanitizer throws away', async () => {
    // One stray letter in a money field used to latch `desiredIncomeTouched`
    // permanently — and persistently — without changing a single character on
    // screen, silently ending income tracking for that user forever.
    const user = userEvent.setup()
    useIncomeStore.setState({ incomeSources: [incomeRow(200_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)

    await user.type(screen.getByLabelText('Desired Retirement Income'), 'x')

    expect(useRetirementPlannerStore.getState().plan.desiredIncomeTouched).toBe(false)
    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('12,000.00')
  })
})
