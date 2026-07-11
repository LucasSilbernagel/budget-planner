import { fireEvent, renderWithProviders, screen, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { ErrorBoundary } from '../ErrorBoundary'
import { NetWorthProjectionPage } from '../NetWorthProjectionPage'

/**
 * NetWorthProjectionPage "Annual Return Rate" input tests (story 6-7, BUG-B).
 *
 * The rate was stored as a decimal (0.07) while the input bound `value={rate * 100}`
 * and `onChange` did `parseFloat / 100`. That divide-then-remultiply round-trip
 * surfaced IEEE-754 noise (type 7.2 -> 0.072 -> *100 = 7.199999999999999). It also
 * fed 0 to `calculateCompoundingProjection` when the field was cleared, and that core
 * fn throws for a rate <= 0 / < 0.1% while being called unconditionally in render ->
 * the page crashed. These tests pin: quantized 2-decimal display, no crash on an
 * empty/zero rate, and that the math still uses the true decimal rate (NFR3).
 */
describe('NetWorthProjectionPage annual return rate input', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  function seedInvestment(currentBalance: number) {
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Brokerage',
      currentBalance,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
  }

  it('renders the rate input with a 2-decimal step and the default 7% (AC-1)', () => {
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/annual return rate/i)
    expect(input).toHaveAttribute('step', '0.01')
    expect(input).toHaveAttribute('max', '100')
    expect(input).toHaveValue(7)
  })

  it('quantizes a floating-point-noisy value to at most 2 decimals (AC-2)', () => {
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/annual return rate/i) as HTMLInputElement

    // The exact string the old round-trip would surface — must be cleaned up.
    fireEvent.change(input, { target: { value: '7.199999999999999' } })
    expect(input.value).toBe('7.2')

    // Ordinary excess precision is rounded to 2 decimals.
    fireEvent.change(input, { target: { value: '7.256' } })
    expect(input.value).toBe('7.26')
  })

  it('clamps out-of-range values to the [0, 100] percent window (AC-1)', () => {
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/annual return rate/i) as HTMLInputElement

    fireEvent.change(input, { target: { value: '150' } })
    expect(input.value).toBe('100')
  })

  it('does not crash and shows a hint when the rate is cleared or zero (AC-4)', () => {
    seedInvestment(1_000_000) // ensure hasData === true so the projection path is exercised
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/annual return rate/i) as HTMLInputElement

    // Clearing the field must not throw (the core calc rejects a rate <= 0).
    fireEvent.change(input, { target: { value: '' } })

    expect(input.value).toBe('0')
    expect(screen.getByText(/enter an annual return rate of at least 0\.1%/i)).toBeInTheDocument()
    // With no valid rate there is no projection to summarize.
    expect(screen.queryByText('Projection Summary')).not.toBeInTheDocument()
  })

  it('projects using the decimal rate, not the raw percent (AC-3, NFR3)', () => {
    // $10,000 principal, no income → pure compounding on principal.
    seedInvestment(1_000_000)
    renderWithProviders(<NetWorthProjectionPage />)

    // Default rate 7% over 10 years ≈ $19,671 (1.07^10 ≈ 1.967).
    // If the code wrongly passed 7 (i.e. 700%) as the decimal, the final value
    // would be astronomically larger — this range check disproves that.
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()
    const summary = screen.getByText('Projection Summary').closest('section') as HTMLElement
    // Read only the value paragraphs (pure numbers), not the "Year N" labels.
    const valueEls = within(summary).getAllByText((content, el) => {
      return el?.tagName === 'P' && /^[\d,]+(?:\.\d+)?$/.test(content.trim())
    })
    const values = valueEls.map((el) => Number.parseFloat((el.textContent ?? '').replace(/,/g, '')))
    const maxValue = Math.max(...values)
    expect(maxValue).toBeGreaterThan(10_000) // grew above the $10,000 principal
    expect(maxValue).toBeLessThan(30_000) // consistent with 7%, impossible at 700%
  })
})

/**
 * NetWorthProjectionPage input hardening (story BUG-1 — Epic-6 retro action item #1,
 * the twice-surfaced Infinity/overflow HIGH from 6-7).
 *
 * The rate input was already guarded (6-7), but the sibling `years` and
 * `additionalContribution` inputs fed the unconditionally-called, throwing core calc
 * (`calculateCompoundingProjection`), and the route had no ErrorBoundary — so an
 * out-of-range or overflowing entry white-screened the whole page. These tests pin:
 * years clamped to the field max (50), contribution rejected/clamped so the core
 * never receives a non-finite or overflowing value, and a residual core throw
 * (e.g. from an overflowing derived principal) contained by the ErrorBoundary.
 */
describe('NetWorthProjectionPage input hardening (story bug-1)', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
    useIncomeStore.setState({ incomeSources: [] })
  })

  function seedInvestment(currentBalance: number) {
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Brokerage',
      currentBalance,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
  }

  it('clamps a Projection Period above the field max down to 50 without crashing (AC-1)', () => {
    seedInvestment(1_000_000)
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/projection period/i) as HTMLInputElement

    // A type="number" field still accepts a *typed* value beyond `max`; pre-fix this
    // reached the core calc (years > MAX_PROJECTION_YEARS = 100) → throw → white-screen.
    fireEvent.change(input, { target: { value: '500' } })

    expect(input.value).toBe('50')
    // Projection still renders for the clamped value.
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()
  })

  it('rejects a non-finite Additional Annual Contribution as 0 without crashing (AC-2)', () => {
    seedInvestment(1_000_000)
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/additional annual contribution/i) as HTMLInputElement

    // `1e999` parses to Infinity → pre-fix the core calc threw "must be finite".
    fireEvent.change(input, { target: { value: '1e999' } })

    expect(input.value).toBe('0')
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()
  })

  it('clamps an astronomically large finite contribution to a safe maximum (AC-2)', () => {
    seedInvestment(1_000_000)
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/additional annual contribution/i) as HTMLInputElement

    // 1e16 in plain digits (the number input keeps it) would trip the per-year
    // Number.isSafeInteger overflow guard in the core calc → throw → white-screen, pre-fix.
    fireEvent.change(input, { target: { value: '10000000000000000' } })

    expect(input.value).toBe('1000000000') // clamped to MAX_CONTRIBUTION (1e9 units)
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()
  })

  it('contains a residual core throw (overflowing derived principal) in the ErrorBoundary fallback, not a white-screen (AC-3)', () => {
    // The *derived* initialNetWorth (summed from stored balances) is a vector this
    // story does not sanitize at the input. A single balance is capped by store
    // validation at MAX_SAFE_INTEGER/100 (~9e13 cents), but many valid entries sum
    // past the core calc's per-year Number.isSafeInteger guard (~8.4e15 principal) and
    // it throws. The route-level ErrorBoundary (mirroring /retirement) must contain
    // that throw so the user sees the themed fallback, not a blank/white screen.
    const NEAR_MAX_CENTS = 90_000_000_000_000 // 9e13, within the store's safe-integer bound
    for (let i = 0; i < 100; i++) {
      seedInvestment(NEAR_MAX_CENTS) // sum ≈ 9e15 → overflows the projection at year 1
    }
    renderWithProviders(
      <ErrorBoundary>
        <NetWorthProjectionPage />
      </ErrorBoundary>
    )

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('contains a residual core throw from an overflowing income-derived contribution in the ErrorBoundary fallback (AC-3, review follow-up)', () => {
    // `annualContribution = annualNetIncome + additionalContribution * 100`, and
    // annualNetIncome is summed from the income/expense stores — which, unlike balances,
    // have NO magnitude cap, so a single absurd income can overflow the core calc. This
    // story does not sanitize that derived value at the source; the route-level
    // ErrorBoundary is its containment. Pin that so a future boundary refactor can't
    // silently reintroduce a white screen for the (more easily reached) income vector.
    useIncomeStore.getState().addIncomeSource({
      name: 'Windfall',
      amount: 1e18, // cents; annualNetIncome ≈ 1.2e19 → overflows the projection at year 1
      frequency: 'monthly',
    })
    renderWithProviders(
      <ErrorBoundary>
        <NetWorthProjectionPage />
      </ErrorBoundary>
    )

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })
})
