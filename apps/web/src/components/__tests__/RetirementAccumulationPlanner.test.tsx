import { act, fireEvent, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { RetirementAccumulationPlanner } from '../RetirementAccumulationPlanner'

/**
 * RetirementAccumulationPlanner tests (story 26.7).
 *
 * Drives the shipped 26.6 solver through the UI:
 * - AC-2: the outputs table renders the solver's output set for a reachable solve.
 * - AC-3: switching the target model recomputes the required nest egg.
 * - AC-4: an infeasible plan shows the calm not-reachable state (+ levers), no throw.
 *
 * Currency preferences are forced to the currency-less default (mode 'none') so
 * amounts render as plain grouped decimals (e.g. "1,000,000.00").
 */

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
  await user.type(screen.getByLabelText('Desired Annual Retirement Income'), '12000')
  await user.clear(screen.getByLabelText('Expected Annual Return'))
  await user.type(screen.getByLabelText('Expected Annual Return'), '5')
}

describe('RetirementAccumulationPlanner (story 26.7)', () => {
  beforeEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
    useBalanceStore.setState({ entries: [] })
  })

  afterEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
    useBalanceStore.setState({ entries: [] })
  })

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
    await user.type(screen.getByLabelText('Desired Annual Retirement Income'), '5000000')
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
    await user.type(screen.getByLabelText('Desired Annual Retirement Income'), '12000')
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
    await user.type(screen.getByLabelText('Desired Annual Retirement Income'), '12000')
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
 * Money-input sanitization (story 28-1, FR46).
 *
 * All three money fields here share a single `currencyField` render helper, so
 * one onChange covers them; these prove the wiring reaches each field (AC-3) and
 * that the non-money numeric fields beside them were not swept up.
 */
describe('RetirementAccumulationPlanner money inputs reject non-numeric characters', () => {
  beforeEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
    useBalanceStore.setState({ entries: [] })
  })

  afterEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
    useBalanceStore.setState({ entries: [] })
  })

  it.each([['Current Amount Saved'], ['Monthly Savings'], ['Desired Annual Retirement Income']])(
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
 * Locale switch mid-edit (story 28-1).
 *
 * The derived prefill rewrites the money field with the new locale's separators
 * whenever the currency changes. The sanitizer must accept whatever that effect
 * writes — otherwise the first keystroke after a currency switch would start
 * eating the field's own separators.
 */
describe('RetirementAccumulationPlanner survives a currency switch mid-edit', () => {
  beforeEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
    useBalanceStore.setState({ entries: [] })
  })

  afterEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
    useBalanceStore.setState({ entries: [] })
  })

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
})
