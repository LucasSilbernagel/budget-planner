import { act, fireEvent, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { projectAccumulatedNestEgg } from '@budget-planner/core/finance/retirement'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import {
  RetirementAccumulationPlanner,
  describeSolverError,
} from '../RetirementAccumulationPlanner'

/**
 * RetirementAccumulationPlanner tests (stories 26.7 / 28.1 / 29.1).
 *
 * Since 29.1 this component IS the retirement page: one shared input set feeding
 * the solver, the outputs and the growth chart. The suite therefore covers both
 * the original solver-driven behaviour and the assertions re-homed from the
 * deleted `RetirementForm` (money sanitization, the 100×-prefill guard, the WCAG
 * focus-ring pin) — those pinned real regressions and must not die with the file.
 *
 * Currency preferences are forced to the currency-less default (mode 'none') so
 * amounts render as plain grouped decimals (e.g. "1,000,000.00").
 */

/** Reset every store this component reads. Zustand stores are not auto-reset. */
function resetStores() {
  useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  useBalanceStore.setState({ entries: [] })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
}

const ISO = '2026-08-06T00:00:00.000Z'

// Fully-typed store fixtures.
// ⚠️ `investmentRow` follows the REAL `ClientBalanceTracking` shape
// (`packages/core/src/services/balanceTracking.ts:32-50`). The two fixtures this
// file used before 29.2 were both wrong — one hid behind `as unknown as never`,
// the other invented a `contributionFrequency` field that does not exist on the
// type while omitting the required `frequency`/`createdAt`/`updatedAt`. They
// compiled only because `tsconfig.app.json` excludes test files, so the
// type-check gate could never catch them.
const incomeRow = (amount: number, frequency = 'monthly' as const, id = 'inc-1') => ({
  id,
  userId: 0,
  name: 'Salary',
  amount,
  frequency,
  createdAt: ISO,
  updatedAt: ISO,
})

const expenseRow = (amount: number, frequency = 'monthly' as const, id = 'exp-1') => ({
  id,
  userId: 0,
  name: 'Rent',
  amount,
  frequency,
  createdAt: ISO,
  updatedAt: ISO,
})

/**
 * ⚠️ Story 47.2: `monthlyContribution` and `frequency` are no longer inert
 * padding on this fixture — they ARE the "Monthly Savings" figure now. Every
 * row built here defaulted to `monthlyContribution: 0`, so leaving the default
 * in place takes the derived figure to $0.00 and collapses every downstream
 * reachability expectation. Pass a contribution whenever the test cares about
 * that figure.
 */
const investmentRow = (
  currentBalance: number,
  id = 'inv-1',
  contribution: { amount?: number; frequency?: 'weekly' | 'biweekly' | 'monthly' | 'annually' } = {}
) => ({
  id,
  type: 'investment' as const,
  name: 'RRSP',
  currentBalance,
  monthlyContribution: contribution.amount ?? 0,
  frequency: contribution.frequency ?? ('monthly' as const),
  createdAt: ISO,
  updatedAt: ISO,
})

const debtRow = (currentBalance: number, id = 'debt-1') => ({
  ...investmentRow(currentBalance, id),
  type: 'debt' as const,
  name: 'Card',
})

/**
 * Seed the stores that now DRIVE the two derived figures, for the reachable
 * happy/toggle case: saved $1,000,000, $1,500/mo net.
 *
 * ⚠️ Since 29.2 these are no longer typed — they are derived, so the fixture has
 * to seed the sources instead. The income figure is doing double duty: it feeds
 * BOTH the derived monthly-savings figure AND the desired-income prefill
 * (`grossIncome × 12 × 0.5`). $2,000/mo gross → a $12,000/yr prefill, which is
 * exactly the desired income this fixture used to type by hand, so every
 * downstream expectation below is preserved and no `user.clear()` is needed.
 *
 *   saved                                          = $1,000,000.00
 *   monthly savings (the RRSP contribution)        = $1,500.00
 *   saved per year = $1,500 × 12                   = $18,000.00
 *   desired income prefill = $2,000 × 12 × 0.5     = $12,000.00 / yr
 *   deplete required = (85 − 40) × $12,000         = $540,000.00
 *   perpetual required = round($12,000/12)/0.05    = $240,000.00
 *
 * At month 0 the projected nest egg = the $1,000,000 principal, which already
 * clears both models' required nest egg → reachable immediately (age 40).
 */
function seedReachableStores() {
  // ⚠️ Story 47.2: the $1,500/mo now comes from the account's own contribution,
  // not from income − expenses. The income and expense rows STAY: $2,000/mo gross
  // still drives the desired-income prefill ($12,000/yr), which every expectation
  // in the docblock above depends on. Dropping them because "income no longer
  // feeds monthly savings" would break this fixture a second way.
  useBalanceStore.setState({
    entries: [investmentRow(1_000_000_00, 'inv-1', { amount: 150_000 })],
  })
  useIncomeStore.setState({ incomeSources: [incomeRow(200_000)] })
  useExpenseStore.setState({ expenses: [expenseRow(50_000)] })
}

/**
 * The rendered VALUE of a derived card, exactly — not its whole text content.
 *
 * ⚠️ Use this instead of `toHaveTextContent('0.00')` for any money assertion.
 * `toHaveTextContent` with a string is a SUBSTRING match, so `'-2,000.00'`
 * contains `'0.00'` and the obvious assertion passes on precisely the value it
 * was written to forbid.
 */
function derivedValueOf(testId: string): string {
  return screen.getByTestId(testId).querySelector('dd > span')?.textContent ?? ''
}

/**
 * Parse a rendered money string to a number, PRESERVING the sign.
 *
 * ⚠️ The obvious `replace(/[^\d.]/g, '')` strips the minus, turning `-48,000.00`
 * into `48000` and erasing exactly the error a sign check exists to catch.
 */
function toMoney(text: string | null | undefined): number {
  return Number((text ?? '').replace(/[^\d.-]/g, ''))
}

/** Seed the sources, then type the four fields that are still editable. */
async function fillReachableCase(user: ReturnType<typeof userEvent.setup>) {
  act(seedReachableStores)
  await user.clear(screen.getByLabelText('Current Age'))
  await user.type(screen.getByLabelText('Current Age'), '40')
  await user.clear(screen.getByLabelText('Life Expectancy'))
  await user.type(screen.getByLabelText('Life Expectancy'), '85')
  await user.clear(screen.getByLabelText('Expected Annual Return'))
  await user.type(screen.getByLabelText('Expected Annual Return'), '5')
}

describe('RetirementAccumulationPlanner (story 26.7)', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('prompts for input before all fields are provided', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(
      screen.getByText('Enter all the details above to see your retirement outlook.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
  })

  it('renders the full output set for a reachable solve (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    await fillReachableCase(user)

    const outputs = within(screen.getByTestId('accumulation-outputs'))
    // Each output row: label followed by its value.
    expect(outputs.getByText('Saved per year').nextElementSibling).toHaveTextContent('18,000.00')
    expect(outputs.getByText('Total saved').nextElementSibling).toHaveTextContent('1,000,000.00')
    expect(outputs.getByText('Months to retirement').nextElementSibling).toHaveTextContent('0')
    expect(outputs.getByText('Years to retirement').nextElementSibling).toHaveTextContent('0.0')
    expect(outputs.getByText('Earliest retirement age').nextElementSibling).toHaveTextContent('40')
    expect(outputs.getByText('Nest egg at retirement').nextElementSibling).toHaveTextContent(
      '1,000,000.00'
    )
    // Deplete is the default model.
    expect(outputs.getByText('Required nest egg').nextElementSibling).toHaveTextContent(
      '540,000.00'
    )
  })

  it('recomputes the required nest egg when the model toggles (AC-3)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    await fillReachableCase(user)

    const requiredRow = () =>
      within(screen.getByTestId('accumulation-outputs')).getByText('Required nest egg')
        .nextElementSibling

    // Deplete (default) → $540,000.00.
    expect(requiredRow()).toHaveTextContent('540,000.00')

    // Switch to perpetual → $240,000.00 (age-independent, income / rate).
    await user.click(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ }))
    expect(requiredRow()).toHaveTextContent('240,000.00')
  })

  it('shows the calm not-reachable state with levers, no error (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // Tiny savings, short window, huge desired income → never reachable.
    //   age 60, saved $1,000, $50/mo saved, 4%, desired $5,000,000/yr, life 65.
    //   saved per year = $50 × 12 = $600.00 (still shown when not reachable).
    // The amounts are unchanged from before 29.2 — only their SOURCE moved: to a
    // seeded store in 29.2, and to the account's own CONTRIBUTION in 47.2. The
    // income row stays because it prefills the desired-income field below.
    act(() => {
      useBalanceStore.setState({
        entries: [investmentRow(1_000_00, 'inv-1', { amount: 5_000 })],
      })
      useIncomeStore.setState({ incomeSources: [incomeRow(5_000)] })
    })
    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), '60')
    await user.clear(screen.getByLabelText('Life Expectancy'))
    await user.type(screen.getByLabelText('Life Expectancy'), '65')
    const desired = screen.getByLabelText('Desired Retirement Income')
    // Seeding income also prefills this field, so it must be cleared first.
    await user.clear(desired)
    await user.type(desired, '5000000')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '4')

    const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
    expect(
      notReachable.getByText(/Retirement isn.t reachable with these numbers/)
    ).toBeInTheDocument()
    // ⚠️ Since 29.2 the first lever names ANOTHER page: the savings figures are
    // derived, so there is no "save more" control on this screen to act on.
    // ⚠️ Story 47.2 re-pointed it. The old wording ("Raise your income or cut
    // expenses on the Income and Expenses pages") named a lever that no longer
    // moves this outcome at all — income and expenses stopped feeding the
    // monthly figure — so it was advice that could not work.
    expect(
      notReachable.getByText('Put more into your investment accounts on the Balance Tracking page')
    ).toBeInTheDocument()
    // The retired wording must be gone, not merely unreachable.
    expect(notReachable.queryByText(/Raise your income or cut expenses/)).not.toBeInTheDocument()
    // ⚠️ Do NOT assert the retired 'Save more each month' string here: it exists
    // nowhere in the repo, so that assertion could never fail. Pin a CURRENT
    // string that must be absent instead — the no-data heading, which this
    // branch must not borrow.
    expect(notReachable.queryByText(/We don.t have your savings data yet/)).not.toBeInTheDocument()
    expect(notReachable.getByText('Retire on a lower annual income')).toBeInTheDocument()

    // ⚠️ The return-rate lever must name ONLY the post-retirement rate. Since
    // story 35.3 the saving-phase rate also drives the deplete requirement's
    // income-growth term, so raising it can push retirement FURTHER away —
    // measured on the real solver at 27 → 48 → 63 months for 6% → 8% → 10%.
    // Advising it in the panel that exists for users in shortfall would tell
    // them to deepen the shortfall. Both halves are asserted: the safe lever is
    // present, and the ambiguous phrasing is absent.
    expect(notReachable.getByText('Assume a higher return after you retire')).toBeInTheDocument()
    expect(notReachable.queryByText(/higher return while saving/)).not.toBeInTheDocument()
    expect(notReachable.queryByText(/higher annual return/)).not.toBeInTheDocument()
    // Saved-per-year is always populated.
    expect(notReachable.getByText(/600\.00/)).toBeInTheDocument()
    // No successful-outlook block leaked through.
    expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
  })

  it('shows a targeted message (not the generic levers) when age is past life expectancy (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // currentAge >= lifeExpectancy → no retirement window; the blocker is the
    // ages, not the savings, so the generic levers must not show.
    act(() => {
      useBalanceStore.setState({
        entries: [investmentRow(1_000_00, 'inv-1', { amount: 5_000 })],
      })
      useIncomeStore.setState({ incomeSources: [incomeRow(5_000)] })
    })
    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), '70')
    await user.clear(screen.getByLabelText('Life Expectancy'))
    await user.type(screen.getByLabelText('Life Expectancy'), '65')
    const desired = screen.getByLabelText('Desired Retirement Income')
    await user.clear(desired)
    await user.type(desired, '12000')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '4')

    const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
    expect(
      notReachable.getByText(/current age is at or past your life expectancy/)
    ).toBeInTheDocument()
    // Saved-per-year still shown; generic savings-shortfall levers must NOT
    // appear. Asserted against the CURRENT lever copy — pinning the retired
    // "Save more each month" string would pass vacuously now that it is gone.
    expect(notReachable.getByText(/600\.00/)).toBeInTheDocument()
    expect(
      notReachable.queryByText(
        'Put more into your investment accounts on the Balance Tracking page'
      )
    ).not.toBeInTheDocument()
  })

  it('shows an explicit "too large" message instead of a blank void when the solver overflows (AC-6)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // Inputs parse cleanly, but a 10-digit life expectancy makes the deplete
    // required nest egg (years × income) overflow MAX_SAFE_INTEGER, so the solver
    // throws. The UI must render the failed-state message, never an empty results
    // area (regression: the memo previously returned null → all gates false → blank).
    act(seedReachableStores)
    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), '40')
    await user.clear(screen.getByLabelText('Life Expectancy'))
    await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '5')

    expect(screen.getByTestId('accumulation-solve-failed')).toBeInTheDocument()
    expect(screen.getByText(/Those numbers are too large to compute/)).toBeInTheDocument()
    // Neither results region leaked, and it is NOT a blank void.
    expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('accumulation-not-reachable')).not.toBeInTheDocument()
  })

  it('derives current amount saved from investments only, never netting debts against them', () => {
    // Same selector as the 26.5 "Total Investments" card: investments summed,
    // debts excluded entirely (not subtracted). $5,000 + $2,500 = $7,500, and the
    // $9,000 card balance must not pull it down to a net figure.
    useBalanceStore.setState({
      entries: [investmentRow(5_000_00), investmentRow(2_500_00, 'inv-2'), debtRow(9_000_00)],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    // ⚠️ Pinned as the exact value node. A `not.toHaveTextContent('1,500.00')`
    // guard would pass under the very mutation it targets: netting the debt
    // gives -1,500.00, which floors to 0.00 and contains neither string.
    expect(derivedValueOf('derived-current-saved')).toBe('7,500.00')
  })
})

/**
 * The consolidation itself (story 29.1).
 *
 * AC-1: each shared input is collected exactly once. AC-2: the outputs and the
 * chart derive from that one set, with no contradictory duplicate figures.
 */
describe('RetirementAccumulationPlanner — one shared input set (story 29.1)', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('collects each shared input exactly once (AC-1)', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<RetirementAccumulationPlanner />)

    await fillReachableCase(user)

    // One field per concept — `getByLabelText` throws on a duplicate match, so
    // these calls ARE the assertion that nothing collects them twice.
    for (const label of [
      'Current Age',
      'Life Expectancy',
      'Desired Retirement Income',
      'Expected Annual Return',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }

    // The two derived figures are shown exactly once each, as displays rather
    // than controls. `getAllByText` would catch a second copy re-appearing (for
    // instance if a future change re-added an input beside the display).
    for (const label of ['Current Amount Saved', 'Monthly Savings']) {
      expect(screen.getAllByText(label)).toHaveLength(1)
      expect(screen.queryByRole('textbox', { name: label })).not.toBeInTheDocument()
    }

    // The retired duplicates must not come back under their old names.
    for (const gone of [
      'Current Savings',
      'Annual Contribution',
      'Return Rate',
      'Retirement Age',
    ]) {
      expect(screen.queryByLabelText(gone)).not.toBeInTheDocument()
    }

    // Exactly one element may carry id="currentAge" — the planner and the chart
    // both shipped one, which is invalid HTML and mis-binds the second <label>.
    expect(container.ownerDocument.querySelectorAll('#currentAge')).toHaveLength(1)
    // The two rate fields must not share an id either — copying the first field's
    // markup wholesale is the obvious way to add the second, and it would put
    // both controls behind one <label>.
    expect(container.ownerDocument.querySelectorAll('#annualReturn')).toHaveLength(1)
    expect(container.ownerDocument.querySelectorAll('#postRetirementReturn')).toHaveLength(1)
  })

  it('renders one required-nest-egg figure, not a second standalone one (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    await fillReachableCase(user)
    await user.click(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ }))

    // The Safe Withdrawal figure the deleted form computed separately IS this
    // row: $12,000/yr at 5% → $240,000. It appears once.
    expect(screen.getAllByText(/^240,000\.00$/)).toHaveLength(1)
    expect(screen.queryByText('Required Retirement Assets')).not.toBeInTheDocument()
    // ...and it is labelled as the Safe Withdrawal Model, so the explanation the
    // standalone form carried is not lost. The FORMULA itself is deliberately not
    // repeated here — it is stated once on the page, in the route's explainer.
    expect(screen.getByText(/uses the Safe Withdrawal Model/)).toBeInTheDocument()
    expect(screen.queryByText(/FV = Ir × \(12 \/ r\)/)).not.toBeInTheDocument()
  })

  it('states the selected model’s explanation once, not twice (AC-3)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    await fillReachableCase(user)

    // The explanation lives beside its radio, where it helps you choose. It was
    // also being echoed under the outputs, so the selected model's text appeared
    // twice on one screen — in the story whose whole premise is saying each thing
    // once. Both models' radio copy is present; neither is duplicated.
    for (const explanation of [
      /Draw your savings down to zero by your life expectancy/,
      /Live off the investment returns forever/,
    ]) {
      expect(screen.getAllByText(explanation)).toHaveLength(1)
    }
  })

  it('the growth chart agrees with the solver to the cent (AC-2, AC-9)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // age 40 → life 50, $100,000 saved, $1,000/mo saved, 6%, desired $12,000/yr.
    // Amounts unchanged from before 29.2 — only the source moved (to the stores
    // in 29.2, to the account's own contribution in 47.2), which is what keeps
    // the cent-exact expectation below valid.
    act(() => {
      useBalanceStore.setState({
        entries: [investmentRow(100_000_00, 'inv-1', { amount: 100_000 })],
      })
      useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
    })
    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), '40')
    await user.clear(screen.getByLabelText('Life Expectancy'))
    await user.type(screen.getByLabelText('Life Expectancy'), '50')
    const desiredIncome = screen.getByLabelText('Desired Retirement Income')
    await user.clear(desiredIncome)
    await user.type(desiredIncome, '12000')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '6')

    const summary = screen.getByText('Projection Summary:').closest('p')
    expect(summary).not.toBeNull()

    // ⚠️ The previous version of this test asserted only prop echoes (age, year
    // count, rate) and never touched a balance — it would have passed with the
    // chart wired back onto annual compounding, the exact regression it claimed
    // to prevent. The figure is now derived from core's own monthly-compounded
    // function and matched exactly.
    const outputs = within(screen.getByTestId('accumulation-outputs'))
    const yearsToRetirement = Number(
      outputs.getByText('Years to retirement').nextElementSibling?.textContent
    )
    const horizonYears = Math.max(1, Math.ceil(yearsToRetirement))
    const expectedCents = projectAccumulatedNestEgg(100_000_00, 1_000_00, 0.06, horizonYears * 12)
    const expectedDisplay = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(expectedCents / 100)

    expect(summary?.textContent).toContain(expectedDisplay)
    expect(summary?.textContent).toContain('at age 40')
    expect(summary?.textContent).toContain('6.0% return while saving')
  })

  it('stops the curve at retirement rather than running to life expectancy (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // Deplete model: the plan is that the nest egg reaches ZERO by life
    // expectancy. Charting accumulation all the way to 85 showed it peaking
    // there instead — an order-of-magnitude figure contradicting the outputs
    // directly above it.
    await fillReachableCase(user)

    const outputs = within(screen.getByTestId('accumulation-outputs'))
    const earliestAge = Number(
      outputs.getByText('Earliest retirement age').nextElementSibling?.textContent
    )
    const summary = screen.getByText('Projection Summary:').closest('p')

    expect(summary?.textContent).toContain(`at age ${earliestAge}`)
    // Life expectancy is 85 in this fixture; the curve must not run there.
    expect(summary?.textContent).not.toContain('at age 85')
  })

  it('reports the gap between today’s savings and the required nest egg', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    await fillReachableCase(user)

    // $1,000,000 saved already clears the $540,000 deplete target.
    const outputs = within(screen.getByTestId('accumulation-outputs'))
    expect(outputs.getByText('Still to accumulate').nextElementSibling).toHaveTextContent(
      'Already covered'
    )
  })

  it('shows a placeholder instead of a chart when a field is missing, never a stale default curve', () => {
    // ⚠️ RETARGETED BY STORY 44.1, and the reason matters. This used to seed the
    // full `seedReachableStores` fixture and rely on age/life-expectancy being
    // EMPTY by default to reach the "not filled in yet" state. FR71 gave those
    // two fields real defaults (35 / 90), so that fixture now solves — see the
    // test below. The guard this test actually carries is "an incomplete plan
    // draws no curve", so it now uses a genuinely incomplete plan: no income
    // rows means no desired-income prefill, and desired income has no default.
    act(() => {
      useBalanceStore.setState({ entries: [investmentRow(1_000_000_00)] })
      useExpenseStore.setState({ expenses: [expenseRow(50_000)] })
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('')
    expect(
      screen.getByText('Fill in the details above to see how your savings grow.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Projection Summary:')).not.toBeInTheDocument()
  })

  it('opens on a solved plan for a user who already has income (story 44.1, FR71)', () => {
    // The behaviour change FR71's defaults produce, recorded deliberately rather
    // than discovered later: age and life expectancy now arrive filled, the
    // return rate and model already had defaults, and desired income is seeded
    // from the income store — so a user with data lands on an answer instead of
    // an empty form. This is "opens on numbers a user can start from"; if it is
    // ever unwanted, this is the test that says so out loud.
    act(seedReachableStores)
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByLabelText('Current Age')).toHaveValue(35)
    expect(screen.getByLabelText('Life Expectancy')).toHaveValue(90)
    expect(screen.getByText('Projection Summary:')).toBeInTheDocument()
    expect(
      screen.queryByText('Fill in the details above to see how your savings grow.')
    ).not.toBeInTheDocument()
  })

  it('does not tell the user to fill in details when the solve failed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // Every field IS filled; the solver overflows. Telling the user to "fill in
    // the details above" beneath a "too large to compute" panel is two
    // contradictory instructions on one screen.
    act(seedReachableStores)
    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), '40')
    await user.clear(screen.getByLabelText('Life Expectancy'))
    await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '5')

    expect(screen.getByTestId('accumulation-solve-failed')).toBeInTheDocument()
    expect(
      screen.queryByText('Fill in the details above to see how your savings grow.')
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/No projection — the numbers above are out of range/)
    ).toBeInTheDocument()
  })

  it('explains the deplete-model overflow instead of falling back to the generic message', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // The 10-digit life expectancy makes `calculateRequiredNestEgg` throw
    // `Required nest egg exceeds safe integer limit.` — the one overflow §7
    // documents as reachable, and the one the copy map originally omitted, so the
    // detail line never rendered for the exact case it was added to explain.
    act(seedReachableStores)
    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), '40')
    await user.clear(screen.getByLabelText('Life Expectancy'))
    await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '5')

    const failed = within(screen.getByTestId('accumulation-solve-failed'))
    expect(failed.getByText(/too large to plan for/)).toBeInTheDocument()
  })
})

/**
 * Desired-income prefill (re-homed from RetirementForm, UX review #6).
 *
 * The prefill divides cents back to display units: a regression guard against
 * re-introducing the 100×-too-large default. 29.1 additionally re-sources it from
 * the frequency-NORMALIZED gross income — the retired form summed raw cents, so a
 * weekly $500 counted as $500/month.
 *
 * ⚠️ Since 29.2 the income-store seeds in this block have a SECOND effect: they
 * also drive the derived Monthly Savings figure. These tests stay green because
 * they assert only the desired-income field, but a failure here can now have two
 * causes — check which figure actually moved before assuming the prefill broke.
 */
describe('RetirementAccumulationPlanner — desired-income prefill', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('prefills half of annual income in whole units, not raw cents', () => {
    // $10,000/mo income (1,000,000 cents) → annual $120,000 → half = $60,000.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          userId: 0,
          name: 'Salary',
          amount: 1_000_000,
          frequency: 'monthly',
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z',
        },
      ],
    })

    renderWithProviders(<RetirementAccumulationPlanner />)

    const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
    expect(income).toHaveValue('60,000.00')
    // The pre-fix bug rendered the raw cents figure (100× too large).
    expect(income.value).not.toBe('6000000')
    expect(income).not.toHaveValue('6,000,000.00')
  })

  it('normalizes a weekly income instead of counting it as monthly', () => {
    // $500/week = $2,166.50/mo normalized (×52/12) → annual $25,998 → half
    // = $12,999. The retired form's raw-cents sum would have seeded from $500.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          userId: 0,
          name: 'Shifts',
          amount: 50_000,
          frequency: 'weekly',
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z',
        },
      ],
    })

    renderWithProviders(<RetirementAccumulationPlanner />)

    const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
    // ⚠️ Asserted EXACTLY, not as a `> 12,000` lower bound: a re-introduced
    // raw-cents prefill renders 1,299,996.00, which clears any open lower bound
    // and would have let the 100× bug back in through the weaker of the pair.
    // $500/wk × (52/12) = $2,166.67/mo → × 12 × 0.5 = $13,000.02 annual.
    expect(income).toHaveValue('13,000.02')
    // Not the un-normalized $500 × 12 × 0.5 = $3,000 the raw sum would give.
    expect(income).not.toHaveValue('3,000.00')
  })

  it('seeds the desired income in the SELECTED basis, not always annual', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // ⚠️ The seed is derived as an ANNUAL figure. Writing it into a field the
    // user has switched to Monthly makes the solver read 12× the intended
    // income — a silent overstatement of the required nest egg with no cue.
    await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')

    act(() => {
      useIncomeStore.setState({
        incomeSources: [
          {
            id: 'inc-1',
            userId: 0,
            name: 'Salary',
            amount: 1_000_000,
            frequency: 'monthly',
            createdAt: '2026-07-11T00:00:00.000Z',
            updatedAt: '2026-07-11T00:00:00.000Z',
          },
        ],
      })
    })

    // $10,000/mo → annual $120,000 → half = $60,000/yr → $5,000/mo under the
    // selected basis. The pre-fix bug wrote 60,000.00 into a monthly field.
    const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
    expect(income).toHaveValue('5,000.00')
    expect(income).not.toHaveValue('60,000.00')
  })

  it('leaves a typed number untouched when the basis is switched', async () => {
    const user = userEvent.setup()
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          userId: 0,
          name: 'Salary',
          amount: 1_000_000,
          frequency: 'monthly',
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z',
        },
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
    expect(income).toHaveValue('60,000.00')

    // ⚠️ FIXTURE CORRECTED IN STORY 44.1's CODE REVIEW — the assertion is
    // unchanged and the test is now STRONGER, not weaker. This test is titled
    // "a TYPED number" and asserted the ratified rule that switching the basis
    // changes only what a number means. But it never typed: `60,000.00` above is
    // the income-derived SEED, so the test could not tell a typed value from a
    // seeded one, and what it actually pinned was "a seeded value is left alone"
    // — the behaviour review found does not round-trip a reload (a seeded annual
    // figure left under a monthly basis is silently rewritten on the next load).
    // Story 44.1 re-seeds UNAUTHORED values on a basis switch and leaves AUTHORED
    // ones exactly as entered, so the rule this test names is intact; the value
    // just has to be genuinely typed for the test to be about it.
    await user.clear(income)
    await user.type(income, '60000')

    // Switching the basis changes only what the number MEANS — the basis-aware
    // seed must not turn into a basis-driven rewrite of the field.
    await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
    expect(income).toHaveValue('60,000.00')
  })
})

/**
 * Income-period basis (re-homed from RetirementForm, story 15.2 / decision D2).
 *
 * Canonical storage is ANNUAL cents (the solver's unit); a monthly entry is
 * converted at the boundary. Switching the basis must not rewrite the number.
 */
describe('RetirementAccumulationPlanner — income period basis', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('interprets the same number as annual or monthly without rewriting it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    await fillReachableCase(user)
    // ⚠️ TYPE the desired income rather than inheriting the seed (fixture
    // corrected in story 44.1's code review — every assertion below is
    // unchanged). `fillReachableCase` seeds income whose prefill happens to be
    // 12,000.00, so this test read as "a typed number" while testing a seeded
    // one. Since 44.1 an unauthored seed follows the basis (so that what is on
    // screen survives a reload) and only an authored value is held fixed — which
    // is the rule this test is actually about.
    const incomeField = screen.getByLabelText('Desired Retirement Income')
    await user.clear(incomeField)
    await user.type(incomeField, '12000')
    await user.click(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ }))

    const requiredRow = () =>
      within(screen.getByTestId('accumulation-outputs')).getByText('Required nest egg')
        .nextElementSibling

    // Annual (default): $12,000/yr → $1,000/mo at 5% → $240,000.
    expect(requiredRow()).toHaveTextContent('240,000.00')

    // Monthly: the same "12,000" now means $12,000/mo → 12× the nest egg.
    await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
    expect(requiredRow()).toHaveTextContent('2,880,000.00')

    // The typed number is left exactly as entered — only its meaning changed.
    expect(
      (screen.getByLabelText('Desired Retirement Income') as HTMLInputElement).value
    ).toContain('12,000')
    expect(screen.getByText('The monthly income you want in retirement')).toBeInTheDocument()
  })
})

/**
 * Money-input sanitization (story 28-1, FR46).
 *
 * All money fields here share a single `currencyField` render helper, so one
 * onChange covers them; these prove the wiring reaches each field and that the
 * non-money numeric fields beside them were not swept up. ⚠️ There is no e2e net
 * on this route — `e2e/money-input-sanitization.spec.ts` covers /income,
 * /expenses, /savings and /balance, not /retirement. These are the only guard.
 */
describe('RetirementAccumulationPlanner money inputs reject non-numeric characters', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  // ⚠️ Story 29.2 left exactly ONE money input on this page — the other two
  // became derived displays. These guards were RETARGETED onto it rather than
  // deleted: each pins a real shipped regression (the 28.1 caret bug, the 26.7
  // remount-loses-focus bug) and, with no e2e net on this route, they remain the
  // only protection the sanitizer wiring has.
  it('strips garbage pasted into "Desired Retirement Income"', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)

    const input = screen.getByLabelText('Desired Retirement Income')
    fireEvent.change(input, { target: { value: 'approx $2,500.00 each' } })

    expect(input).toHaveValue('2,500.00')
  })

  it('never lets a typed letter into a money field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    const input = screen.getByLabelText('Desired Retirement Income')
    await user.clear(input)
    await user.type(input, '15abc00')

    expect(input).toHaveValue('1500')
  })

  it('keeps the money field as text/decimal so caret correction stays enabled', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)

    const input = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
    // `setSelectionRange` throws on type="number", which would silently disable
    // the caret correction in sanitizeMoneyChange (story 28-1).
    expect(input.type).toBe('text')
    expect(input.inputMode).toBe('decimal')
  })

  it('keeps a half-typed "-" visible instead of echoing it to 0.00 on blur', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // The no-digit arm of the blur re-echo: sanitizeMoneyInput deliberately lets
    // digit-free partials through, and they must stay visible.
    const input = screen.getByLabelText('Desired Retirement Income')
    await user.clear(input)
    await user.type(input, '-')
    fireEvent.blur(input)

    expect(input).toHaveValue('-')
  })

  it('leaves an untouched money field empty on blur, never "0.00"', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)

    // The empty arm: blurring a never-filled field must not turn "not provided"
    // into "entered zero", which would defeat the incomplete-input gate. With no
    // income seeded there is no prefill, so the field really is untouched.
    const input = screen.getByLabelText('Desired Retirement Income')
    fireEvent.blur(input)

    expect(input).toHaveValue('')
    expect(
      screen.getByText('Enter all the details above to see your retirement outlook.')
    ).toBeInTheDocument()
  })

  it('keeps focus in the field while typing (the render-helper guarantee)', async () => {
    // `currencyField` must stay a called render helper, never a `<Component/>`
    // defined in the render body — that would remount the input on every
    // keystroke and drop focus (the story 26.7 regression).
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    const input = screen.getByLabelText('Desired Retirement Income')
    await user.clear(input)
    await user.type(input, '12345')

    expect(input).toHaveFocus()
    expect(input).toHaveValue('12345')
  })
})

/**
 * Mobile a11y (re-homed from RetirementForm, story 24.1).
 *
 * The "Income period" <select> once shipped `focus:ring-blue-500` with no
 * `focus:ring-2` — a ring colour with zero width, i.e. an invisible focus
 * indicator (the Epic 15 WCAG lesson). ⚠️ Class-TOKEN membership, not substring:
 * `focus:ring-blue-500` contains "focus:ring-" but is not `focus:ring-2`.
 */
describe('RetirementAccumulationPlanner — mobile a11y', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('the Income period select keeps a visible focus ring and a ≥44px target', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)

    const basis = screen.getByLabelText('Income period') as HTMLSelectElement
    expect(basis.classList.contains('focus:ring-2')).toBe(true)
    expect(basis.classList.contains('focus:outline-none')).toBe(true)
    expect(basis.classList.contains('min-h-[44px]')).toBe(true)
  })

  it('every text and number input keeps a visible focus ring and a ≥44px target (AC-4)', () => {
    const { container } = renderWithProviders(<RetirementAccumulationPlanner />)

    const fields = container.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="number"]'
    )
    // Exactly four since 29.2 (age, life expectancy, desired income, return) —
    // the other two became derived displays. Pinned EXACTLY rather than as a
    // lower bound: an open bound would let a newly-added input slip in unringed
    // as long as the total stayed high enough, which is the failure this test
    // exists to catch.
    expect(fields).toHaveLength(5)
    for (const field of fields) {
      expect(field.classList.contains('focus:ring-2')).toBe(true)
      expect(field.classList.contains('focus:outline-none')).toBe(true)
      expect(field.classList.contains('min-h-[44px]')).toBe(true)
    }
  })

  it('every model radio keeps a visible focus ring (AC-4)', () => {
    const { container } = renderWithProviders(<RetirementAccumulationPlanner />)

    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    expect(radios).toHaveLength(2)
    for (const radio of radios) {
      expect(radio.classList.contains('focus:ring-2')).toBe(true)
      expect(radio.classList.contains('focus:outline-none')).toBe(true)
    }
  })
})

/**
 * Locale switch mid-edit (story 28-1).
 *
 * The derived prefill rewrites the money field with the new locale's separators
 * whenever the currency changes. The sanitizer must accept whatever that effect
 * writes — otherwise the first keystroke after a currency switch would start
 * eating the field's own separators.
 */
describe('RetirementAccumulationPlanner survives a currency switch mid-edit', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('re-formats the derived figure with the new locale separators', () => {
    useBalanceStore.setState({ entries: [investmentRow(123456789)] })

    const { rerender } = renderWithProviders(<RetirementAccumulationPlanner />)
    // en-US (currency-less) grouping.
    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('1,234,567.89')

    // Switch to EUR, whose locale is de-DE: group '.', decimal ','.
    act(() => {
      useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
    })
    rerender(<RetirementAccumulationPlanner />)

    // ⚠️ Substring, not an exact match: in symbol mode `formatCurrency` returns
    // an Intl currency string ("1.234.567,89 €") whose space before the symbol is
    // a narrow no-break space (U+202F), which an exact assertion would miss.
    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('1.234.567,89')
  })

  it('re-seeds the money field with the new locale separators and keeps typing working', async () => {
    const user = userEvent.setup()
    // ⚠️ Income MUST be seeded. Without it `prefillDesiredIncomeCents` is null,
    // the re-seed effect early-returns, and the test degenerates into a plain
    // string append that would pass with the effect deleted outright — which is
    // what happened when this guard was first retargeted. The effect depends on
    // `locale`, so a currency switch is what makes it rewrite the field.
    useIncomeStore.setState({ incomeSources: [incomeRow(1_000_000)] })
    const { rerender } = renderWithProviders(<RetirementAccumulationPlanner />)

    // $10,000/mo → annual $120,000 → half = $60,000, en-US grouping.
    const input = screen.getByLabelText('Desired Retirement Income')
    expect(input).toHaveValue('60,000.00')

    // Switch to EUR, whose locale is de-DE: group '.', decimal ','.
    act(() => {
      useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
    })
    rerender(<RetirementAccumulationPlanner />)

    const switched = screen.getByLabelText('Desired Retirement Income')
    expect(switched).toHaveValue('60.000,00')

    // The next keystroke must append, not mangle the de-DE separators the effect
    // just wrote — the blur-echo/idempotence guarantee reaching the UI (28-1).
    await user.type(switched, '1')
    expect(switched).toHaveValue('60.000,001')
  })

  it('renders the currency-symbol prefix on the money field in symbol mode', () => {
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
    useBalanceStore.setState({ entries: [investmentRow(5_000_00)] })
    renderWithProviders(<RetirementAccumulationPlanner />)

    // One standalone adornment node, for the one remaining money INPUT. Before
    // 29.2 there were three; the drop to one is the expected consequence of two
    // fields becoming displays, not a regression.
    expect(screen.getAllByText('$')).toHaveLength(1)

    // The derived displays are not left symbol-less by that change — they format
    // through `formatCurrency`, so the symbol is part of the value text itself.
    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('$5,000.00')
  })
})

/**
 * Derived, non-editable figures (story 29.2, FR48 + FR49).
 *
 * "Current amount saved" and "monthly savings" are no longer inputs: they are
 * derived displays computed from data the user already entered elsewhere. The
 * user cannot correct them, which is exactly why the flooring behaviour has to be
 * both clamped at the binding boundary AND disclosed.
 */
describe('RetirementAccumulationPlanner — derived figures (story 29.2)', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  /** Fill only the four fields that are still editable after 29.2. */
  async function fillEditableFields(
    user: ReturnType<typeof userEvent.setup>,
    { age = '40', life = '85', income = '12000', rate = '5' } = {}
  ) {
    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), age)
    await user.clear(screen.getByLabelText('Life Expectancy'))
    await user.type(screen.getByLabelText('Life Expectancy'), life)
    const incomeField = screen.getByLabelText('Desired Retirement Income')
    await user.clear(incomeField)
    await user.type(incomeField, income)
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), rate)
  }

  it('derives current amount saved from the investment-accounts total (AC-1)', () => {
    useBalanceStore.setState({ entries: [investmentRow(5_000_00)] })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('5,000.00')
  })

  it('derives monthly savings from investment CONTRIBUTIONS at mixed cadences (47.2 AC-1, AC-5)', () => {
    // Four accounts, four cadences, normalized PER ROW and then summed:
    //
    //   $500.00 weekly    50000 × 52/12 = 216666.666… → round → 216667
    //   $1,200.00 annually 120000 × 1/12 =  10000.0    → round →  10000
    //   $250.00 biweekly   25000 × 26/12 =  54166.666… → round →  54167
    //   $100.00 monthly    10000 × 1     =  10000      → round →  10000
    //                                                    total = 290834c
    //
    // ⚠️ The fixture is chosen so per-item-then-sum and sum-then-round DISAGREE:
    // summing the unrounded values first gives 290833.333… → 290833, one cent
    // short. $2,908.34 is the pool's discipline (`savingsAllocation.ts:116-124`);
    // $2,908.33 is the mutant. A fixture where every row normalized exactly would
    // have passed against both.
    useBalanceStore.setState({
      entries: [
        investmentRow(0, 'inv-1', { amount: 50_000, frequency: 'weekly' }),
        investmentRow(0, 'inv-2', { amount: 120_000, frequency: 'annually' }),
        investmentRow(0, 'inv-3', { amount: 25_000, frequency: 'biweekly' }),
        investmentRow(0, 'inv-4', { amount: 10_000, frequency: 'monthly' }),
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(derivedValueOf('derived-monthly-savings')).toBe('2,908.34')
    // ⚠️ Un-normalized (raw cents summed) would read $2,050.00 — the distortion
    // the removed Net Worth projection page shipped and this page rejects.
    expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent('2,050.00')
  })

  it('clamps each ROW at zero, never the total (47.2 AC-1)', () => {
    // ⚠️⚠️ THE FIXTURE THIS SUITE WAS MISSING, and its absence was found in
    // review. Every other negative fixture here is a SINGLE negative row, for
    // which per-row `Math.max(0, …)` and one clamp on the total are
    // indistinguishable — both yield 0.00. Measured: rewriting the loop as
    // `total += monthly` with a single `Math.max(0, total)` at the end left the
    // ENTIRE suite green while a negative row silently ate a real contribution
    // from another account.
    //
    //   +$1,500.00/mo  →  150000
    //   −$400.00/mo    →  clamped to 0, NOT −40000
    //                     per-row total = 150000 → $1,500.00
    //                     total-clamped = 110000 → $1,100.00
    //
    // Per-row is the pool's discipline (`savingsAllocation.ts:116-124`), and the
    // two surfaces reading the same rows must agree on it.
    useBalanceStore.setState({
      entries: [
        investmentRow(0, 'inv-1', { amount: 150_000 }),
        investmentRow(0, 'inv-2', { amount: -40_000 }),
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(derivedValueOf('derived-monthly-savings')).toBe('1,500.00')
    // The total-clamping mutant's answer, which this figure must never return.
    expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent('1,100.00')
  })

  it('discloses a clamped row WITHOUT claiming the figure was zeroed (47.2 AC-8)', async () => {
    const user = userEvent.setup()
    // ⚠️ A state the old derivation could not reach: a positive figure that still
    // hid a clamped row. Keying `flooredFromNegative` off the ROW rather than the
    // FIGURE fired the results caveat here — copy that says the projection
    // "treats it as zero" beside a card reading $1,500.00. Both clauses false.
    //
    // ⚠️⚠️ THE EDITABLE FIELDS MUST BE FILLED, and the first version of this test
    // did not fill them. `resultsCaveat` renders only INSIDE a results branch, so
    // asserting its absence without solving passes vacuously — measured: the
    // row-keyed mutant came back GREEN. The warning was already written on the
    // neighbouring test in this same file and it still did not propagate.
    useBalanceStore.setState({
      entries: [
        investmentRow(100_000_00, 'inv-1', { amount: 150_000 }),
        investmentRow(0, 'inv-2', { amount: -40_000 }),
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillEditableFields(user)

    const card = screen.getByTestId('derived-monthly-savings')
    expect(derivedValueOf('derived-monthly-savings')).toBe('1,500.00')
    expect(card).toHaveTextContent(
      'One or more accounts have a negative monthly contribution, which this plan counts as nothing.'
    )
    // A results branch really is on screen, so the absence below is not vacuous.
    expect(screen.getByTestId('accumulation-outputs')).toBeInTheDocument()
    // The figure was NOT floored, so the results-level caveat must stay off.
    expect(screen.queryByTestId('derived-floor-disclosure')).not.toBeInTheDocument()
  })

  it('tells a negative-only contributor the truth, not "add one" (47.2 AC-7, AC-8)', () => {
    // ⚠️⚠️ THE TWO ZEROS, collapsed in the first implementation and caught in
    // review. This user HAS set a contribution; it was clamped up from below
    // zero. The no-contribution note tells them to do what they already did,
    // while the results caveat beside it says a figure came out below zero —
    // two contradictory sentences on one screen.
    useBalanceStore.setState({
      entries: [investmentRow(50_000_00, 'inv-1', { amount: -200_000 })],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    const card = screen.getByTestId('derived-monthly-savings')
    expect(derivedValueOf('derived-monthly-savings')).toBe('0.00')
    expect(card).toHaveTextContent(
      'Your investment account contributions currently come to less than nothing'
    )
    expect(card).not.toHaveTextContent('have no monthly contribution set yet')
  })

  it('counts a contribution the user marked as already accounted for (47.2 AC-2)', () => {
    // ⚠️⚠️ THE ARM THAT MATTERS. `contributionRecordedAsExpense` is a statement
    // about the SAVINGS POOL — it stops `calculateDistributablePool` subtracting
    // the same money twice (FR72, stories 45.1/47.1). It says nothing about
    // whether the money is invested. It is. Filtering on it here — i.e. reusing
    // `savingsAllocation`'s `sumMonthlyInvestmentContributions` — would silently
    // import the pool's rule into the retirement plan and under-report every
    // payroll-deducted saver's actual saving.
    //
    //   flagged   $400.00/mo → 40000
    //   unflagged $600.00/mo → 60000
    //                  total = 100000c = $1,000.00 (NOT $600.00)
    useBalanceStore.setState({
      entries: [
        { ...investmentRow(0, 'inv-1', { amount: 40_000 }), contributionRecordedAsExpense: true },
        investmentRow(0, 'inv-2', { amount: 60_000 }),
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(derivedValueOf('derived-monthly-savings')).toBe('1,000.00')
    // The pool's answer for the same rows, which this figure must NOT return.
    expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent('600.00')
  })

  it('no longer moves when income or expenses change (47.2 AC-4)', () => {
    // The decoupling, asserted directly rather than inferred from the new
    // derivation. Before 47.2 either mutation below moved this figure.
    useBalanceStore.setState({
      entries: [investmentRow(0, 'inv-1', { amount: 75_000 })],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(derivedValueOf('derived-monthly-savings')).toBe('750.00')

    act(() => {
      useIncomeStore.setState({ incomeSources: [incomeRow(900_000)] })
      useExpenseStore.setState({ expenses: [expenseRow(400_000)] })
    })

    expect(derivedValueOf('derived-monthly-savings')).toBe('750.00')
    // The old derivation would now read $5,000.00.
    expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent('5,000.00')
  })

  it('renders neither derived figure as an editable control (AC-1, AC-2)', () => {
    useBalanceStore.setState({
      entries: [investmentRow(5_000_00, 'inv-1', { amount: 300_000 })],
    })
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)

    // Positive anchors FIRST: without them this test passes if the component
    // renders nothing at all, which is the opposite of what its name claims.
    expect(derivedValueOf('derived-current-saved')).toBe('5,000.00')
    expect(derivedValueOf('derived-monthly-savings')).toBe('3,000.00')

    expect(screen.queryByRole('textbox', { name: /Current Amount Saved/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Monthly Savings/ })).not.toBeInTheDocument()
  })

  it('updates both figures live when the underlying store changes (AC-3)', () => {
    // ⚠️ Since 47.2 that is ONE store, not three — both figures track the same
    // balance rows, which is the coherence this change buys.
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('0.00')

    act(() => {
      useBalanceStore.setState({
        entries: [investmentRow(7_500_00, 'inv-1', { amount: 250_000 })],
      })
    })

    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('7,500.00')
    expect(screen.getByTestId('derived-monthly-savings')).toHaveTextContent('2,500.00')
  })

  it('distinguishes no accounts from accounts with nothing going in (47.2 AC-6, AC-7)', () => {
    // No investment rows at all → "add an account".
    const { unmount } = renderWithProviders(<RetirementAccumulationPlanner />)
    expect(screen.getByTestId('derived-monthly-savings')).toHaveTextContent(
      'Add an investment account on the Balance Tracking page, and say what you put in each month.'
    )
    unmount()

    // ⚠️⚠️ The state the OLD source could NOT produce, and the main user-visible
    // risk in story 47.2: the account exists, it just has no contribution set.
    // Borrowing the note above would tell this user to do the thing they have
    // already done, while the plan quietly reports they can never retire.
    useBalanceStore.setState({ entries: [investmentRow(50_000_00, 'inv-1')] })
    renderWithProviders(<RetirementAccumulationPlanner />)
    const derived = screen.getByTestId('derived-monthly-savings')
    expect(derived).toHaveTextContent(
      'Your investment accounts have no monthly contribution set yet — add one on the Balance Tracking page.'
    )
    expect(derived).not.toHaveTextContent('Add an investment account')
  })

  it('reports unreadable CONTRIBUTIONS, and names the page that holds them (47.2 AC-9)', () => {
    // A non-finite `monthlyContribution` is reachable: the sync applier writes
    // pulled rows into the store without validating them. Before 47.2 this same
    // failure was reported as "We couldn't read your income data." and sent the
    // user to a page that has nothing to do with it.
    useBalanceStore.setState({
      entries: [
        {
          ...investmentRow(50_000_00, 'inv-1'),
          monthlyContribution: Number.NaN,
        } as unknown as never,
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    const derived = screen.getByTestId('derived-monthly-savings')
    expect(derived).toHaveTextContent("We couldn't read your investment account contributions.")
    // Distinct from the BALANCE failure on the other card — the two cards read
    // different fields of the same rows and must not blame each other's.
    expect(derived).not.toHaveTextContent('investment account balances')
    // The planner still rendered — no ErrorBoundary fallback.
    expect(screen.getByLabelText('Current Age')).toBeInTheDocument()
  })

  it('COERCES a corrupt contribution cadence to monthly rather than failing (47.2 AC-9)', () => {
    // ⚠️ Deliberately NOT the unreadable path. `monthlyContributionCents` coerces
    // an unrecognised cadence to 'monthly' — the same degradation
    // `SavingsPage`'s KNOWN_FREQUENCIES applies — so the savings pool and this
    // figure can never disagree about a corrupt row. $300.00 is read as $300/mo.
    useBalanceStore.setState({
      entries: [
        {
          ...investmentRow(50_000_00, 'inv-1', { amount: 30_000 }),
          frequency: 'daily',
        } as unknown as never,
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(derivedValueOf('derived-monthly-savings')).toBe('300.00')
    expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent(
      "We couldn't read your investment account contributions."
    )
  })

  it('distinguishes investment accounts that hold nothing from having none at all', () => {
    // `< 0` left exactly-zero in the `ok` state with no note, so a user with empty
    // accounts saw a bare $0.00 indistinguishable from having no accounts.
    useBalanceStore.setState({ entries: [investmentRow(0)] })
    renderWithProviders(<RetirementAccumulationPlanner />)

    const derived = screen.getByTestId('derived-current-saved')
    expect(derived).toHaveTextContent('Your investment accounts currently hold nothing.')
    expect(derived).not.toHaveTextContent('Only investment accounts count toward your nest egg')
  })

  it('survives a corrupt persisted income row without reaching the ErrorBoundary (AC-6)', () => {
    // ⚠️ Re-pointed by 47.2, not deleted. Income no longer feeds either derived
    // figure, but it still feeds `prefillDesiredIncomeCents`, which calls
    // `calculateNetIncomeResult` on the render path — the same throw that
    // white-screens the HomePage dashboard (deferred-work.md:483). The guard now
    // proves the PLANNER survives it and the derived figures are untouched by it.
    useBalanceStore.setState({
      entries: [investmentRow(0, 'inv-1', { amount: 120_000 })],
    })
    useIncomeStore.setState({
      incomeSources: [{ ...incomeRow(100_000), frequency: 'daily' } as unknown as never],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    // The planner still rendered — no ErrorBoundary fallback.
    expect(screen.getByLabelText('Current Age')).toBeInTheDocument()
    // And the corrupt income row did not poison the contributions figure.
    expect(derivedValueOf('derived-monthly-savings')).toBe('1,200.00')
  })

  it('shows the FLOORED monthly savings, never a negative figure (AC-5)', async () => {
    const user = userEvent.setup()
    // The contribution is −$2,000/mo. ⚠️ Since story 47.2 the negative comes from
    // the CONTRIBUTION row; the income and expense rows below feed only the
    // desired-income prefill and cannot move this figure at all.
    //
    // ⚠️ What this actually guards. Core is NOT the exposure here: the solver
    // clamps `savedPerYearCents` (`retirement.ts:636`) AND
    // `projectAccumulatedNestEgg` clamps both of its own inputs on arrival
    // (`:449-450`), so an unclamped value cannot erode the projection. The
    // exposure is the DISPLAY — without the flooring at the binding boundary the
    // card would read "−$2,000.00" while every figure the solver produced was
    // computed from 0. One input, two contradictory numbers, and since 29.2 no
    // field for the user to correct. Mutation-proven: reverting the
    // `Math.max(0, …)` makes the negative-value assertion below fail.
    // ⚠️ Since 47.2 the negative must come from a CONTRIBUTION row. Seeding
    // income < expenses no longer touches this figure at all, so the old fixture
    // left the card at a trivially-zero value and the assertion below passed
    // without ever exercising the clamp.
    useBalanceStore.setState({
      entries: [investmentRow(100_000_00, 'inv-1', { amount: -200_000 })],
    })
    useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(300_000)] })

    renderWithProviders(<RetirementAccumulationPlanner />)

    // ⚠️ Pinned EXACTLY, via the value node. `toHaveTextContent('0.00')` is a
    // SUBSTRING match — '-2,000.00' contains '0.00' — so the obvious assertion
    // passes on precisely the value it is meant to forbid.
    expect(derivedValueOf('derived-monthly-savings')).toBe('0.00')

    await fillEditableFields(user)

    // The display and the solver agree: both are working from zero.
    const outputs = within(screen.getByTestId('accumulation-outputs'))
    expect(outputs.getByText('Saved per year').nextElementSibling?.textContent).toBe('0.00')

    // And the projection grew from the assets rather than being drawn down.
    // ⚠️ `toMoney` preserves the sign — stripping it (via /[^\d.]/g) turns
    // '-48,000.00' into 48000 and erases the very error under test. The floor is
    // CONCRETE, not a comparison between two unpinned quantities: $100,000 of
    // assets compounding must end at or above the principal it started from.
    expect(toMoney(outputs.getByText('Total saved').nextElementSibling?.textContent)).toBe(100_000)
    expect(
      toMoney(outputs.getByText('Nest egg at retirement').nextElementSibling?.textContent)
    ).toBeGreaterThanOrEqual(100_000)
  })

  it('floors a NEGATIVE investment total the same way, and says so (AC-1, AC-5)', () => {
    // ⚠️ The saved side had ZERO coverage: the clamp could be deleted outright
    // and the whole suite stayed green. A negative total is reachable because the
    // sync applier writes server rows without validation, and `currentBalance` is
    // legal below zero everywhere except the entry form.
    useBalanceStore.setState({ entries: [investmentRow(-5_000_00)] })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(derivedValueOf('derived-current-saved')).toBe('0.00')
    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent(
      'Your investment accounts currently net below zero'
    )
  })

  it('reports an unreadable balance instead of rendering a confident zero (AC-4, AC-6)', () => {
    // A NaN balance formats as a plausible '0.00' and used to be classed `ok`,
    // so the card claimed a healthy zero while the solver threw and the failure
    // copy blamed the user's age — a field that is no longer even editable.
    useBalanceStore.setState({
      entries: [{ ...investmentRow(0), currentBalance: Number.NaN } as unknown as never],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    const derived = screen.getByTestId('derived-current-saved')
    expect(derived).toHaveTextContent("We couldn't read your investment account balances.")
    expect(derived).not.toHaveTextContent('From your investment accounts')
  })

  it('treats a fractional-cent balance as unreadable rather than solving from it', () => {
    // Sub-cent data makes the card and the solver disagree silently. The removed
    // Net Worth projection page refused the identical row; this guard outlived it.
    useBalanceStore.setState({
      entries: [{ ...investmentRow(0), currentBalance: 500_050.5 } as unknown as never],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent(
      "We couldn't read your investment account balances."
    )
    expect(derivedValueOf('derived-current-saved')).toBe('0.00')
  })

  it('warns in the results when a figure could not be read at all (AC-4)', async () => {
    const user = userEvent.setup()
    // `unreadable` feeds a FABRICATED zero to the solver. Excluding it from the
    // caveat produced a complete, confident outlook built on invented data.
    // ⚠️ Since 47.2 the unreadable source is a corrupt CONTRIBUTION, not a
    // corrupt income row — income no longer reaches either derived figure.
    useBalanceStore.setState({
      entries: [
        {
          ...investmentRow(100_000_00, 'inv-1'),
          monthlyContribution: Number.NaN,
        } as unknown as never,
      ],
    })
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillEditableFields(user)

    expect(screen.getByTestId('derived-floor-disclosure')).toHaveTextContent(
      'Some of your saved data could not be read'
    )
  })

  it('leaves the results caveat OFF when both figures are honestly zero', async () => {
    const user = userEvent.setup()
    // Exactly-balanced income/expenses floors nothing, so claiming "your real
    // position is worse than these numbers suggest" would simply be false.
    //
    // ⚠️ The editable fields MUST be filled. The caveat only renders inside a
    // results branch, so asserting its absence without solving passes vacuously —
    // mutation-checked: keying `flooredFromNegative` back off the state name is
    // caught only once a results branch is on screen.
    // ⚠️ Since 47.2 the honest zero is an account with NO contribution set:
    // nothing was clamped, so claiming the position is worse than shown would be
    // a plain lie.
    useBalanceStore.setState({ entries: [investmentRow(100_000_00, 'inv-1')] })
    useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(300_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillEditableFields(user)

    expect(screen.getByTestId('derived-monthly-savings')).toHaveTextContent(
      'no monthly contribution set yet'
    )
    expect(screen.getByTestId('accumulation-outputs')).toBeInTheDocument()
    expect(screen.queryByTestId('derived-floor-disclosure')).not.toBeInTheDocument()
  })

  it('does not claim "no savings data" when the data exists but nets to zero (AC-7)', async () => {
    const user = userEvent.setup()
    // ⚠️ The discriminating case for the no-data branch. Both floored figures are
    // 0, but NEITHER source is empty — the user entered everything, it just nets
    // negative. Gating on `cents === 0` (as this branch first did) tells them to
    // add data they already added, while the caveat below contradicts it.
    useBalanceStore.setState({
      entries: [investmentRow(-5_000_00, 'inv-1', { amount: -200_000 })],
    })
    useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(300_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillEditableFields(user)

    const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
    expect(notReachable.queryByText(/We don.t have your savings data yet/)).not.toBeInTheDocument()
    expect(
      notReachable.getByText(/Retirement isn.t reachable with these numbers/)
    ).toBeInTheDocument()
    // Both figures really were floored from negatives, so the caveat belongs here.
    expect(screen.getByTestId('derived-floor-disclosure')).toBeInTheDocument()
  })

  it('draws no chart, and claims no figures, for a user with no source data at all', async () => {
    const user = userEvent.setup()
    // The chart gate was newly satisfied for zero-data users, producing
    // "your assets reach 0.00 in 55 years, at age 85" beneath a panel that had
    // just said we have no data.
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillEditableFields(user, { age: '30', life: '85', income: '40000', rate: '6' })

    expect(screen.queryByText('Projection Summary:')).not.toBeInTheDocument()
    expect(
      screen.getByText(/add your investment accounts to see how your savings grow/i)
    ).toBeInTheDocument()
    // The retired wording named two pages that no longer feed anything here.
    expect(screen.queryByText(/income and expenses to see how your savings grow/i)).toBeNull()
  })

  it('gives a user with no data the add-your-data branch, not "unreachable" (AC-7)', async () => {
    const user = userEvent.setup()
    // ⚠️ Regression guard for a state 29.2 CREATED. Before it, these two fields
    // were empty inputs that held the incomplete gate shut, so this user saw the
    // calm "enter your details" prompt. The gate no longer waits on them, so the
    // solve now runs with 0 saved and 0 monthly — reaching the not-reachable
    // branch and telling a brand-new user their retirement is unreachable and to
    // "save more each month", a control this page no longer has.
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillEditableFields(user, { age: '30', life: '85', income: '40000', rate: '6' })

    const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
    expect(notReachable.getByText(/We don.t have your savings data yet/)).toBeInTheDocument()
    expect(
      notReachable.getByText(/Add your investment accounts on the Balance/)
    ).toBeInTheDocument()
    expect(notReachable.getByText(/what you put into them each month/)).toBeInTheDocument()
    expect(
      notReachable.queryByText(/Retirement isn.t reachable with these numbers/)
    ).not.toBeInTheDocument()
    expect(
      notReachable.queryByText(
        'Put more into your investment accounts on the Balance Tracking page'
      )
    ).not.toBeInTheDocument()
  })

  it('does not show a confident all-zero outlook to a user with no data (47.2)', async () => {
    const user = userEvent.setup()
    // ⚠️ Story 47.2 WIDENED the population that reaches this. `noSourceData` used
    // to require BOTH sources empty; now that both figures read the investment
    // rows it means "no investment accounts", which is the ordinary state of
    // someone who has filled in income and expenses and nothing else.
    //
    // With a desired income of 0 the solve succeeds and reports `reachable`, so
    // the outputs panel renders a green all-zero outlook — directly above the
    // chart's "add your investment accounts" placeholder, which is gated on
    // `noSourceData` and the outputs panel was not.
    useIncomeStore.setState({ incomeSources: [incomeRow(500_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(200_000)] })
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillEditableFields(user, { age: '30', life: '85', income: '0', rate: '6' })

    expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('accumulation-not-reachable')).getByText(
        /We don.t have your savings data yet/
      )
    ).toBeInTheDocument()
  })

  it('discloses in the results that a floored figure was assumed to be zero (AC-4)', async () => {
    const user = userEvent.setup()
    // ⚠️ Since 47.2 the floored figure is a NEGATIVE contribution. The old
    // fixture (income < expenses) floors nothing here any more, so it would have
    // asserted the caveat's presence while nothing was actually clamped.
    useBalanceStore.setState({
      entries: [investmentRow(100_000_00, 'inv-1', { amount: -200_000 })],
    })
    useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
    useExpenseStore.setState({ expenses: [expenseRow(300_000)] })

    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillEditableFields(user)

    expect(screen.getByTestId('derived-floor-disclosure')).toBeInTheDocument()
  })
})

/**
 * Story 35.3 — the post-retirement return rate.
 *
 * The rate a plan earns AFTER retirement is now separate from the one it earns
 * while saving. The field mirrors the accumulation rate until the user edits it,
 * which is what keeps an untouched planner numerically identical to its
 * pre-35.3 behaviour at every rate rather than only at the 6.0 default.
 */
/**
 * Story 47.2 (FR74) — the copy fence.
 *
 * Five surfaces named income or expenses as the source of the monthly figure.
 * Each was true before this story and false after it, and NOT ONE of them was
 * covered: the whole set could have shipped unchanged while every test stayed
 * green, which is precisely what the epic warned would happen.
 *
 * ⚠️ The negatives here are scoped to the elements that must not mention income
 * or expenses, never to the page. The planner legitimately says "Desired
 * Retirement Income" and "Income period" — a page-wide ban would be red on
 * arrival, which is a guard that gets deleted rather than fixed.
 */
describe('RetirementAccumulationPlanner — the monthly figure stops blaming income (story 47.2)', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('never ties the Monthly Savings card to income or expenses, in any state (AC-10)', () => {
    const states: [string, () => void][] = [
      ['no investment accounts', () => undefined],
      [
        'accounts with no contribution set',
        () => useBalanceStore.setState({ entries: [investmentRow(50_000_00, 'inv-1')] }),
      ],
      [
        'a real contribution',
        () =>
          useBalanceStore.setState({
            entries: [investmentRow(50_000_00, 'inv-1', { amount: 120_000 })],
          }),
      ],
      [
        'an unreadable contribution',
        () =>
          useBalanceStore.setState({
            entries: [
              {
                ...investmentRow(50_000_00, 'inv-1'),
                monthlyContribution: Number.NaN,
              } as unknown as never,
            ],
          }),
      ],
    ]

    for (const [label, seed] of states) {
      resetStores()
      // ⚠️ Income and expenses are seeded in EVERY case on purpose. A card that
      // still read them would have something to say about them; without this the
      // absence below could just be the absence of data.
      useIncomeStore.setState({ incomeSources: [incomeRow(500_000)] })
      useExpenseStore.setState({ expenses: [expenseRow(200_000)] })
      seed()

      const { unmount } = renderWithProviders(<RetirementAccumulationPlanner />)
      const card = screen.getByTestId('derived-monthly-savings')
      // Positive anchor first: the card really did render its own content.
      expect(card.textContent, label).toContain('Monthly Savings')
      expect(card.textContent, label).not.toMatch(/income|expense/i)
      unmount()
    }
  })

  it('sends an unreadable monthly figure to the page that holds it (AC-10)', () => {
    // Defence in depth: the derived figures guard non-finite values before the
    // solver sees them, so this copy is reachable only if that guard is bypassed.
    // It was still telling the user to check two pages that no longer feed it.
    const copy = describeSolverError(new Error('Monthly savings must be a finite number'))
    expect(copy).toMatch(/monthly\s+contributions\s+on\s+your\s+Balance\s+Tracking\s+page/i)
    expect(copy).not.toMatch(/income|expenses/i)
  })

  it('offers a lever that can actually move the outcome (AC-10)', async () => {
    const user = userEvent.setup()
    // ⚠️ The most damaging of the five. "Raise your income or cut expenses" was
    // shown to a user in shortfall and, after this story, could not change their
    // outlook by a cent.
    useBalanceStore.setState({
      entries: [investmentRow(1_000_00, 'inv-1', { amount: 5_000 })],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)
    await user.clear(screen.getByLabelText('Current Age'))
    await user.type(screen.getByLabelText('Current Age'), '60')
    await user.clear(screen.getByLabelText('Life Expectancy'))
    await user.type(screen.getByLabelText('Life Expectancy'), '65')
    const desired = screen.getByLabelText('Desired Retirement Income')
    await user.clear(desired)
    await user.type(desired, '5000000')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '4')

    const levers = within(screen.getByTestId('accumulation-not-reachable')).getByRole('list')
    expect(levers.textContent).toContain(
      'Put more into your investment accounts on the Balance Tracking page'
    )
    expect(levers.textContent).not.toMatch(/income\s+or\s+cut\s+expenses/i)
    expect(levers.textContent).not.toMatch(/Income\s+and\s+Expenses\s+pages/i)
  })
})

describe('RetirementAccumulationPlanner — post-retirement return rate (story 35.3)', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  const accumulationField = () => screen.getByLabelText('Expected Annual Return')
  const postRetirementField = () => screen.getByLabelText('Post-Retirement Annual Return')

  /** Replace an input's whole value. `user.type` APPENDS, and both fields ship pre-filled. */
  async function setField(
    user: ReturnType<typeof userEvent.setup>,
    field: HTMLElement,
    value: string
  ) {
    await user.clear(field)
    await user.type(field, value)
  }

  it('mirrors the accumulation rate until the user edits it (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // BEFORE: it starts showing the accumulation default, not an independent one.
    expect(postRetirementField()).toHaveValue(6)

    await setField(user, accumulationField(), '8')

    expect(accumulationField()).toHaveValue(8)
    expect(postRetirementField()).toHaveValue(8)
  })

  it('stops mirroring once edited, and the two then move independently (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(postRetirementField()).toHaveValue(6)

    await setField(user, postRetirementField(), '3')
    expect(postRetirementField()).toHaveValue(3)

    // Changing the accumulation rate must no longer drag the edited field with it.
    await setField(user, accumulationField(), '8')
    expect(accumulationField()).toHaveValue(8)
    expect(postRetirementField()).toHaveValue(3)
  })

  it('a lower post-retirement rate raises the requirement and delays retirement (AC-7)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // ⚠️ The default seeded fixture is already over-funded ($1,000,000 saved
    // against a $540,000 requirement), so it retires at month 0 and NOTHING
    // moves for a small rate change. The rate has to drop far enough for the
    // requirement to clear the balance before this assertion means anything.
    await fillReachableCase(user)

    const outputValue = (label: string): string =>
      within(screen.getByTestId('accumulation-outputs')).getByText(label).nextElementSibling
        ?.textContent ?? ''

    const requiredBefore = toMoney(outputValue('Required nest egg'))
    const ageBefore = outputValue('Earliest retirement age')
    expect(requiredBefore).toBeGreaterThan(0)

    await setField(user, postRetirementField(), '2')

    const requiredAfter = toMoney(outputValue('Required nest egg'))
    expect(requiredAfter).toBeGreaterThan(requiredBefore)

    // ⚠️ Assert the DIRECTION, not merely that the value moved. `not.toBe(before)`
    // passes just as happily on an implementation that retires the user EARLIER,
    // which is the opposite of what this test's name claims to protect — and this
    // is the only UI-level check of the age effect.
    expect(Number(outputValue('Earliest retirement age'))).toBeGreaterThan(Number(ageBefore))
  })

  it('a blank post-retirement rate is incomplete, not a silent 0% (Trap B)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillReachableCase(user)

    // BEFORE: a real result is on screen.
    expect(screen.getByTestId('accumulation-outputs')).toBeInTheDocument()

    await user.clear(postRetirementField())

    // `parsePercentageToDecimal` returns 0 for an empty string rather than
    // throwing, so without the emptiness gate this would render a confident
    // 0%-return answer instead of asking for the missing value.
    expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
    expect(
      screen.getByText('Enter all the details above to see your retirement outlook.')
    ).toBeInTheDocument()
  })

  it('both rate fields explain which phase they govern (AC-1, AC-10)', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(
      screen.getByText(
        /Expected yearly return while you are still saving — under this model it also sets how fast your retirement income is assumed to rise/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /What your savings earn once you retire — lower it to model a safer allocation\. Follows the rate above until you change it/
      )
    ).toBeInTheDocument()
  })

  it('drops the income-growth clause on the perpetual model, where it is false', async () => {
    // The clause describes the deplete annuity's growth term. Perpetual sizes on
    // income ÷ post-retirement rate and never reads this rate for anything but
    // the growth curve — the core suite pins that a 0.12 accumulation rate does
    // not move a perpetual target, so rendering the clause there states a
    // mechanism the user's own calculation does not have.
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByText(/under this model it also sets how fast/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ }))

    expect(screen.queryByText(/under this model it also sets how fast/)).not.toBeInTheDocument()
    expect(
      screen.getByText('Expected yearly return while you are still saving')
    ).toBeInTheDocument()
  })

  it('stops promising to follow the rate above once that has stopped being true', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByText(/Follows the rate above until you change it/)).toBeInTheDocument()

    await setField(user, postRetirementField(), '3')

    // Nothing ever resets the touched flag, so the sentence would otherwise keep
    // asserting a behaviour that has permanently ended.
    expect(screen.queryByText(/Follows the rate above until you change it/)).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'What your savings earn once you retire — lower it to model a safer allocation'
      )
    ).toBeInTheDocument()
  })

  it('names the real cause when the two rates overflow the requirement (AC-10)', async () => {
    // The overflow throw used to need an absurd income; with two rates a long
    // horizon plus a wide rate gap reaches it, so copy blaming the income alone
    // points at the one field that is fine.
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillReachableCase(user)

    await setField(user, screen.getByLabelText('Life Expectancy'), '900')
    await setField(user, postRetirementField(), '0')

    const panel = screen.getByTestId('accumulation-solve-failed')
    expect(panel).toHaveTextContent(/gap between your two return rates/)
  })

  it('keeps the growth chart on the accumulation rate only (AC-5)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)
    await fillReachableCase(user)

    const summaryText = () => screen.getByText('Projection Summary:').closest('p')?.textContent
    expect(summaryText()).toContain('5.0% return while saving')

    await setField(user, postRetirementField(), '2')

    // The curve describes the saving phase, so the post-retirement assumption
    // must not appear in it.
    expect(summaryText()).toContain('5.0% return while saving')
  })
})

describe('RetirementAccumulationPlanner — assets stay OUT of the nest egg (Story 43.4, D6)', () => {
  const balanceRow = (id: string, type: string, currentBalance: number) => ({
    id,
    type,
    name: id,
    currentBalance,
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  it('does not count an asset row toward the RENDERED nest-egg base', () => {
    // ⚠️ This is the ONLY surviving projection in the app fed by balance entries:
    // `RetirementTimelineChart` compounds this figure at the investment return
    // rate. If an asset ever reached it, a condo would compound like a portfolio.
    //
    // ⚠️ The first version of this test re-implemented the investment filter IN
    // THE TEST BODY and asserted on its own arithmetic. It never rendered the
    // component, so widening `useTotalInvestmentBalance` to include assets — the
    // exact defect D6 exists to prevent — would have left it GREEN. It was a
    // guard that could not fail. It now reads the DISPLAYED figure.
    useBalanceStore.setState({
      entries: [
        balanceRow('inv-1', 'investment', 5_000_000),
        balanceRow('asset-1', 'asset', 40_000_000),
      ],
    })

    renderWithProviders(<RetirementAccumulationPlanner />)

    // Hand-computed: the base is the INVESTMENT total alone, $50,000.00.
    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('50,000.00')
    // And explicitly NOT the folded-in figure, $450,000.00, which is what
    // including the condo would produce.
    expect(screen.getByTestId('derived-current-saved')).not.toHaveTextContent('450,000.00')
  })

  it('shows the nest-egg empty state for a user holding ONLY assets', () => {
    // A user with balance entries but no investments must not be told to "add
    // accounts on the Balance Tracking page" as if the page were empty — that is
    // the copy D6 rewrote.
    useBalanceStore.setState({ entries: [balanceRow('asset-1', 'asset', 40_000_000)] })

    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(screen.getByTestId('derived-current-saved')).toHaveTextContent(
      'Only investment accounts count toward your nest egg'
    )
    expect(screen.getByTestId('derived-current-saved')).not.toHaveTextContent('400,000.00')
  })
})
