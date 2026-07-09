import { renderWithProviders, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'
import { RetirementTimelineChart } from '../RetirementTimelineChart'

/**
 * RetirementTimelineChart structural guardrail tests (story 15.3).
 *
 * This is a visual/layout restyle story — the meaningful verification is the
 * hydrated-DOM check at 320px + desktop in both themes. These shallow tests only
 * guard against structural regressions: the six controls and their app-standard
 * labels must keep rendering (with their htmlFor/id associations intact), and the
 * currency-symbol adornment must survive the restyle.
 *
 * ResizeObserver is stubbed globally in vitest.setup.ts, so <ResponsiveContainer>
 * mounts without throwing; the controls render regardless of chart sizing.
 */
describe('RetirementTimelineChart — controls restyle (story 15.3)', () => {
  beforeEach(() => {
    // Currency-less default → no symbol adornment unless a test opts in.
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  })

  afterEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  })

  it('renders without crashing', () => {
    renderWithProviders(<RetirementTimelineChart />)
    expect(screen.getByText('Projection Summary:')).toBeInTheDocument()
  })

  it('renders all six controls with their labels and ids intact (AC-1)', () => {
    renderWithProviders(<RetirementTimelineChart />)

    const controls: [string, string][] = [
      ['Current Savings', 'principal'],
      ['Annual Contribution', 'contribution'],
      ['Return Rate', 'returnRate'],
      ['Years', 'years'],
      ['Current Age', 'currentAge'],
      ['Retirement Age', 'retirementAge'],
    ]

    for (const [label, id] of controls) {
      const input = screen.getByLabelText(label)
      expect(input).toBeInTheDocument()
      expect(input.id).toBe(id)
    }

    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  it('preserves the currency-symbol prefix in symbol mode (AC-2)', () => {
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
    renderWithProviders(<RetirementTimelineChart />)

    // Current Savings + Annual Contribution each render a leading currency symbol.
    expect(screen.getAllByText('$').length).toBeGreaterThanOrEqual(2)
  })
})
