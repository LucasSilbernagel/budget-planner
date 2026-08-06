import { act, fireEvent, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { projectAccumulatedNestEgg } from '@budget-planner/core/finance/retirement'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { RetirementAccumulationPlanner } from '../RetirementAccumulationPlanner'

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

// Fill every input for the reachable happy/toggle case:
//   age 40, saved $1,000,000, $1,500/mo, 5%, desired $12,000/yr, life 85.
// At month 0 the projected nest egg = the $1,000,000 principal, which already
// clears both models' required nest egg → reachable immediately (age 40).
//   deplete required = (85 − 40) × $12,000        = $540,000.00
//   perpetual required = round($12,000/12)/0.05   = $240,000.00
//   saved per year = $1,500 × 12                  = $18,000.00
async function fillReachableCase(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Current Age'), '40')
  await user.type(screen.getByLabelText('Life Expectancy'), '85')
  await user.type(screen.getByLabelText('Current Amount Saved'), '1000000')
  await user.type(screen.getByLabelText('Monthly Savings'), '1500')
  await user.type(screen.getByLabelText('Desired Retirement Income'), '12000')
  await user.clear(screen.getByLabelText('Expected Annual Return'))
  await user.type(screen.getByLabelText('Expected Annual Return'), '5')
}

describe('RetirementAccumulationPlanner (story 26.7)', () => {
  beforeEach(resetStores)
  afterEach(resetStores)

  it('prompts for input before all fields are provided', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(
      screen.getByText('Enter all six details above to see your retirement outlook.')
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
    //   age 60, saved $1,000, $50/mo, 4%, desired $5,000,000/yr, life 65.
    //   saved per year = $50 × 12 = $600.00 (still shown when not reachable).
    await user.type(screen.getByLabelText('Current Age'), '60')
    await user.type(screen.getByLabelText('Life Expectancy'), '65')
    await user.type(screen.getByLabelText('Current Amount Saved'), '1000')
    await user.type(screen.getByLabelText('Monthly Savings'), '50')
    await user.type(screen.getByLabelText('Desired Retirement Income'), '5000000')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '4')

    const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
    expect(
      notReachable.getByText(/Retirement isn.t reachable with these numbers/)
    ).toBeInTheDocument()
    expect(notReachable.getByText('Save more each month')).toBeInTheDocument()
    expect(notReachable.getByText('Retire on a lower annual income')).toBeInTheDocument()
    // Saved-per-year is always populated.
    expect(notReachable.getByText(/600\.00/)).toBeInTheDocument()
    // No successful-outlook block leaked through.
    expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
  })

  it('shows a targeted message (not the generic levers) when age is past life expectancy (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // currentAge >= lifeExpectancy → no retirement window; the blocker is the
    // ages, not the savings, so the generic "save more" levers must not show.
    await user.type(screen.getByLabelText('Current Age'), '70')
    await user.type(screen.getByLabelText('Life Expectancy'), '65')
    await user.type(screen.getByLabelText('Current Amount Saved'), '1000')
    await user.type(screen.getByLabelText('Monthly Savings'), '50')
    await user.type(screen.getByLabelText('Desired Retirement Income'), '12000')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '4')

    const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
    expect(
      notReachable.getByText(/current age is at or past your life expectancy/)
    ).toBeInTheDocument()
    // Saved-per-year still shown; generic savings-shortfall levers must NOT appear.
    expect(notReachable.getByText(/600\.00/)).toBeInTheDocument()
    expect(notReachable.queryByText('Save more each month')).not.toBeInTheDocument()
  })

  it('shows an explicit "too large" message instead of a blank void when the solver overflows (AC-6)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // Inputs parse cleanly, but a 10-digit life expectancy makes the deplete
    // required nest egg (years × income) overflow MAX_SAFE_INTEGER, so the solver
    // throws. The UI must render the failed-state message, never an empty results
    // area (regression: the memo previously returned null → all gates false → blank).
    await user.type(screen.getByLabelText('Current Age'), '40')
    await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
    await user.type(screen.getByLabelText('Current Amount Saved'), '1000000')
    await user.type(screen.getByLabelText('Monthly Savings'), '1500')
    await user.type(screen.getByLabelText('Desired Retirement Income'), '12000')
    await user.clear(screen.getByLabelText('Expected Annual Return'))
    await user.type(screen.getByLabelText('Expected Annual Return'), '5')

    expect(screen.getByTestId('accumulation-solve-failed')).toBeInTheDocument()
    expect(screen.getByText(/Those numbers are too large to compute/)).toBeInTheDocument()
    // Neither results region leaked, and it is NOT a blank void.
    expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('accumulation-not-reachable')).not.toBeInTheDocument()
  })

  it('pre-fills current amount saved from the investment-accounts total', () => {
    useBalanceStore.setState({
      entries: [
        {
          id: 'inv-1',
          userId: 'u1',
          name: 'RRSP',
          type: 'investment',
          currentBalance: 5_000_00,
          maxContributionLimit: null,
          monthlyContribution: null,
          contributionFrequency: null,
        } as unknown as never,
      ],
    })
    renderWithProviders(<RetirementAccumulationPlanner />)
    expect(screen.getByLabelText('Current Amount Saved')).toHaveValue('5,000.00')
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
      'Current Amount Saved',
      'Monthly Savings',
      'Desired Retirement Income',
      'Expected Annual Return',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
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

    // age 40 → life 50, $100,000 saved, $1,000/mo, 6%, desired $12,000/yr.
    await user.type(screen.getByLabelText('Current Age'), '40')
    await user.type(screen.getByLabelText('Life Expectancy'), '50')
    await user.type(screen.getByLabelText('Current Amount Saved'), '100000')
    await user.type(screen.getByLabelText('Monthly Savings'), '1000')
    await user.type(screen.getByLabelText('Desired Retirement Income'), '12000')
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
    expect(summary?.textContent).toContain('6.0% annual return')
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

  it('shows a placeholder instead of a chart on defaults, never a stale default curve', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)

    expect(
      screen.getByText('Fill in the details above to see how your savings grow.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Projection Summary:')).not.toBeInTheDocument()
  })

  it('does not tell the user to fill in details when the solve failed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // Every field IS filled; the solver overflows. Telling the user to "fill in
    // the details above" beneath a "too large to compute" panel is two
    // contradictory instructions on one screen.
    await user.type(screen.getByLabelText('Current Age'), '40')
    await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
    await user.type(screen.getByLabelText('Current Amount Saved'), '1000000')
    await user.type(screen.getByLabelText('Monthly Savings'), '1500')
    await user.type(screen.getByLabelText('Desired Retirement Income'), '12000')
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
    await user.type(screen.getByLabelText('Current Age'), '40')
    await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
    await user.type(screen.getByLabelText('Current Amount Saved'), '1000000')
    await user.type(screen.getByLabelText('Monthly Savings'), '1500')
    await user.type(screen.getByLabelText('Desired Retirement Income'), '12000')
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

  it.each([['Current Amount Saved'], ['Monthly Savings'], ['Desired Retirement Income']])(
    'strips garbage pasted into "%s"',
    (label) => {
      renderWithProviders(<RetirementAccumulationPlanner />)

      const input = screen.getByLabelText(label)
      fireEvent.change(input, { target: { value: 'approx $2,500.00 each' } })

      expect(input).toHaveValue('2,500.00')
    }
  )

  it('never lets a typed letter into a money field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    const input = screen.getByLabelText('Monthly Savings')
    await user.clear(input)
    await user.type(input, '15abc00')

    expect(input).toHaveValue('1500')
  })

  it('keeps money fields as text/decimal so caret correction stays enabled', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)

    for (const label of ['Current Amount Saved', 'Monthly Savings', 'Desired Retirement Income']) {
      const input = screen.getByLabelText(label) as HTMLInputElement
      // `setSelectionRange` throws on type="number", which would silently disable
      // the caret correction in sanitizeMoneyChange (story 28-1).
      expect(input.type).toBe('text')
      expect(input.inputMode).toBe('decimal')
    }
  })

  it('keeps a half-typed "-" visible instead of echoing it to 0.00 on blur', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    // The no-digit arm of the blur re-echo: sanitizeMoneyInput deliberately lets
    // digit-free partials through, and they must stay visible.
    const input = screen.getByLabelText('Monthly Savings')
    await user.clear(input)
    await user.type(input, '-')
    fireEvent.blur(input)

    expect(input).toHaveValue('-')
  })

  it('leaves an untouched money field empty on blur, never "0.00"', () => {
    renderWithProviders(<RetirementAccumulationPlanner />)

    // The empty arm: blurring a never-filled field must not turn "not provided"
    // into "entered zero", which would defeat the incomplete-input gate.
    const input = screen.getByLabelText('Monthly Savings')
    fireEvent.blur(input)

    expect(input).toHaveValue('')
    expect(
      screen.getByText('Enter all six details above to see your retirement outlook.')
    ).toBeInTheDocument()
  })

  it('keeps focus in the field while typing (the render-helper guarantee)', async () => {
    // `currencyField` must stay a called render helper, never a `<Component/>`
    // defined in the render body — that would remount the input on every
    // keystroke and drop focus (the story 26.7 regression).
    const user = userEvent.setup()
    renderWithProviders(<RetirementAccumulationPlanner />)

    const input = screen.getByLabelText('Current Amount Saved')
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
    expect(fields.length).toBeGreaterThanOrEqual(6)
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

  it('re-seeds with the new separators and keeps typing working afterwards', async () => {
    const user = userEvent.setup()
    useBalanceStore.setState({
      entries: [
        {
          id: 'inv-1',
          type: 'investment',
          name: 'Brokerage',
          currentBalance: 123456789,
          maxContributionLimit: null,
          monthlyContribution: 0,
          contributionFrequency: 'monthly',
        },
      ],
    })

    const { rerender } = renderWithProviders(<RetirementAccumulationPlanner />)
    const input = screen.getByLabelText('Current Amount Saved')
    // en-US (currency-less) grouping.
    expect(input).toHaveValue('1,234,567.89')

    // Switch to EUR, whose locale is de-DE: group '.', decimal ','.
    act(() => {
      useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
    })
    rerender(<RetirementAccumulationPlanner />)

    const switched = screen.getByLabelText('Current Amount Saved')
    expect(switched).toHaveValue('1.234.567,89')

    // The next keystroke must append, not mangle the de-DE separators the effect
    // just wrote — this is the blur-echo/idempotence guarantee reaching the UI.
    await user.type(switched, '1')
    expect(switched).toHaveValue('1.234.567,891')
  })

  it('renders the currency-symbol prefix on every money field in symbol mode', () => {
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
    renderWithProviders(<RetirementAccumulationPlanner />)

    // One adornment per money field (saved, monthly savings, desired income).
    expect(screen.getAllByText('$').length).toBeGreaterThanOrEqual(3)
  })
})
