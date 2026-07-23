import { renderWithProviders, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'
import { RetirementTimelineChart, getRetirementChartChrome } from '../RetirementTimelineChart'

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

/**
 * Narrow-viewport chart chrome (story 24.1).
 *
 * Recharts sizing props (height, YAxis width, tick size, margins, axis titles)
 * cannot be driven by CSS, so they switch at the narrow breakpoint via
 * `useIsNarrowViewport`. jsdom has no real layout, so we test the pure chrome
 * selector directly for both branches; the visual result is verified manually at
 * 320px + desktop. The invariant that matters: the narrow branch shrinks every
 * space-consuming dimension and drops the axis titles so the plot stays usable.
 */
describe('getRetirementChartChrome — narrow vs wide (story 24.1)', () => {
  it('drops the axis titles and shrinks the chrome on narrow viewports', () => {
    const narrow = getRetirementChartChrome(true)
    const wide = getRetirementChartChrome(false)

    // Axis titles ("Years from Now" / "Assets") are desktop-only.
    expect(narrow.showAxisLabels).toBe(false)
    expect(wide.showAxisLabels).toBe(true)

    // Every space-consuming dimension is no larger on narrow than on wide, and
    // the plot-crowding ones are strictly smaller.
    expect(narrow.height).toBeLessThan(wide.height)
    expect(narrow.yAxisWidth).toBeLessThan(wide.yAxisWidth)
    expect(narrow.tickFontSize).toBeLessThan(wide.tickFontSize)
    expect(narrow.marginRight).toBeLessThan(wide.marginRight)
    expect(narrow.marginLeft).toBeLessThanOrEqual(wide.marginLeft)
  })

  it('keeps all dimensions positive so the chart never collapses', () => {
    for (const chrome of [getRetirementChartChrome(true), getRetirementChartChrome(false)]) {
      expect(chrome.height).toBeGreaterThan(0)
      expect(chrome.yAxisWidth).toBeGreaterThan(0)
      expect(chrome.tickFontSize).toBeGreaterThan(0)
      expect(chrome.marginRight).toBeGreaterThanOrEqual(0)
      expect(chrome.marginLeft).toBeGreaterThanOrEqual(0)
    }
  })

  // Concrete usability floors, not just relative ordering (review follow-up):
  // the narrow branch must stay large enough to actually be usable, and — the
  // regression this pins — the right margin must clear the ~42px-wide
  // "Retirement" reference-line label that is centered on a far-right retirement
  // year, or the label clips at 320px.
  it('narrow branch keeps a usable chart height and a right margin that clears the reference-line label', () => {
    const narrow = getRetirementChartChrome(true)
    // A phone chart still needs real vertical room to read the curve.
    expect(narrow.height).toBeGreaterThanOrEqual(240)
    // ~42px of the centered "Retirement" label sits right of the far-right line;
    // a smaller right margin re-clips it (the 24→44 review fix).
    expect(narrow.marginRight).toBeGreaterThanOrEqual(42)
    // Axis ticks must stay legible.
    expect(narrow.tickFontSize).toBeGreaterThanOrEqual(9)
  })
})
