import { fireEvent, renderWithProviders, screen, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
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
