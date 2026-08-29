import { renderWithProviders, screen } from '@/test/utils'
import { projectAccumulatedNestEgg } from '@budget-planner/core/finance/retirement'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'
import {
  CustomTooltip,
  RetirementTimelineChart,
  getRetirementChartChrome,
  getRetirementMarkerAge,
  getRetirementMarkerOffset,
} from '../RetirementTimelineChart'

/**
 * RetirementTimelineChart tests (stories 15.3 / 24.1 / 29.1).
 *
 * Since 29.1 this component owns NO inputs: it is a controlled child of the
 * consolidated planner, fed the one shared input set. The old "six controls with
 * their ids" guardrail is therefore gone by design — those controls were the
 * duplication the story removes, and their absence is now asserted instead.
 *
 * ResizeObserver is stubbed globally in vitest.setup.ts, so <ResponsiveContainer>
 * mounts without throwing; the summary renders regardless of chart sizing.
 */

/** A solvable, reachable scenario: $100,000 saved, $1,000/mo, 6%, age 40 → 50. */
const BASE_PROPS = {
  currentSavedCents: 100_000_00,
  monthlySavingsCents: 1_000_00,
  annualReturnRate: 0.06,
  currentAge: 40,
  yearsToProject: 10,
  earliestRetirementAge: 45,
}

describe('RetirementTimelineChart — controlled child (story 29.1)', () => {
  beforeEach(() => {
    // Currency-less default → no symbol adornment unless a test opts in.
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  })

  afterEach(() => {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  })

  it('renders the projection summary from its props', () => {
    renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)
    expect(screen.getByText('Projection Summary:')).toBeInTheDocument()
  })

  it('owns no inputs of its own — every shared field now lives in the planner (AC-1)', () => {
    renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)

    // The six controls this component used to collect are gone; keeping any of
    // them would re-create the duplicate/contradictory input set 29.1 removes.
    for (const label of [
      'Current Savings',
      'Annual Contribution',
      'Return Rate',
      'Years',
      'Current Age',
      'Retirement Age',
    ]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  /**
   * ⚠️ The live bug 29.1 fixes: the component used to early-return a bare "no
   * data" div ABOVE its own six inputs and Reset button, so typing 0 into Years
   * or Return Rate made every control vanish with no way back short of a reload.
   * The controls now live in the planner, so an empty projection can only ever
   * replace the chart itself — this pins that it cannot swallow anything else.
   */
  it('an empty projection replaces only the chart, trapping nobody (AC-9c)', () => {
    const { container } = renderWithProviders(
      <RetirementTimelineChart {...BASE_PROPS} yearsToProject={0} />
    )

    expect(screen.getByTestId('retirement-chart-empty')).toBeInTheDocument()
    // Nothing interactive was inside this component to lose.
    expect(container.querySelectorAll('input, select, button')).toHaveLength(0)
  })

  /**
   * ⚠️ AC-2 / AC-9a, the numeric claim rather than a textual one.
   *
   * The chart must plot the SOLVER's accumulation curve. Before 29.1 it used
   * `calculateCompoundingProjection`, which compounds ANNUALLY — story 26.6 keeps
   * the two deliberately distinct — so the same inputs produced a different nest
   * egg here than in the planner's outputs. The expected figure below is derived
   * by calling core's monthly-compounded function directly, so this fails the
   * moment the chart drifts back onto the other math.
   */
  it('plots the solver’s own monthly-compounded curve, to the cent (AC-2)', () => {
    renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)

    const expectedCents = projectAccumulatedNestEgg(
      BASE_PROPS.currentSavedCents,
      BASE_PROPS.monthlySavingsCents,
      BASE_PROPS.annualReturnRate,
      BASE_PROPS.yearsToProject * 12
    )
    // Currency-less mode renders plain grouped decimals (abbreviation is a no-op
    // there), so the summary carries the exact figure.
    const expectedDisplay = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(expectedCents / 100)

    const summary = screen.getByText('Projection Summary:').closest('p')
    expect(summary?.textContent).toContain(expectedDisplay)
    // Sanity: this is a real six-figure amount, not a 100×-off reading of it.
    expect(expectedDisplay).toBe('345,819.02')
  })

  it('opens the curve at today’s balance, not a year later', () => {
    renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)

    // The summary says "starting with X at age 40"; without a year-0 point the
    // first plotted balance was age 41, so the caption described a point the
    // chart did not contain.
    const summary = screen.getByText('Projection Summary:').closest('p')
    expect(summary?.textContent).toContain('at age 40')
    // Horizon 10 → years 0..10 inclusive.
    expect(summary?.textContent).toContain('in 10 years')
  })

  it('claims the curve ends at retirement only when it actually does', () => {
    // Marker at year 5, curve runs to year 10 — the end of the curve is NOT
    // retirement, so the summary must not say it is.
    const { unmount } = renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)
    expect(screen.getByText('Projection Summary:').closest('p')?.textContent).not.toContain(
      'when you can retire'
    )
    unmount()

    // Curve truncated at retirement (offset 10 == horizon 10) — now it is.
    renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} earliestRetirementAge={50} />)
    expect(screen.getByText('Projection Summary:').closest('p')?.textContent).toContain(
      'when you can retire'
    )
  })

  it('says "1 year", not "1 years"', () => {
    renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} yearsToProject={1} />)
    expect(screen.getByText('Projection Summary:').closest('p')?.textContent).toContain(
      'in 1 year,'
    )
  })

  it('reports an overflow instead of throwing out of the render', () => {
    renderWithProviders(
      <RetirementTimelineChart
        {...BASE_PROPS}
        currentSavedCents={Number.MAX_SAFE_INTEGER}
        annualReturnRate={5}
        yearsToProject={100}
      />
    )

    expect(screen.getByTestId('retirement-chart-empty')).toBeInTheDocument()
    expect(screen.getByText(/too large to chart/)).toBeInTheDocument()
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
/**
 * Retirement marker placement (story 29.1, AC-9b).
 *
 * ⚠️ AC-9b had NO automated coverage before review — the only proof was a
 * throwaway browser probe. It cannot be covered through the DOM either: Recharts
 * renders no SVG children under jsdom's zero-size `ResponsiveContainer`, so
 * `querySelectorAll('.recharts-reference-line')` returns 0 whether the marker was
 * suppressed deliberately or the whole chart failed to render — a negative
 * assertion that passes vacuously. So the decision is a pure function, tested
 * directly, exactly as `getRetirementChartChrome` is.
 */
describe('getRetirementMarkerOffset (story 29.1)', () => {
  it('places the marker at the solver’s derived age, in years from now', () => {
    expect(getRetirementMarkerOffset(62, 40, 30)).toBe(22)
  })

  it('places it at 0 when the plan is already met — the regression this pins', () => {
    // An earlier `>= 1` floor returned no marker here, so the chart looked
    // identical to the not-reachable case at the exact moment the plan succeeded.
    expect(getRetirementMarkerOffset(40, 40, 10)).toBe(0)
    // Anything under six months rounds to 0 and hit the same hole.
    expect(getRetirementMarkerOffset(40.3, 40, 10)).toBe(0)
  })

  it('draws no marker when retirement is not reachable', () => {
    expect(getRetirementMarkerOffset(null, 40, 30)).toBeNull()
  })

  it('draws no marker when retirement falls outside the plotted horizon', () => {
    expect(getRetirementMarkerOffset(80, 40, 30)).toBeNull()
  })

  it('rounds month precision onto a whole-year category', () => {
    expect(getRetirementMarkerOffset(62.4, 40, 30)).toBe(22)
    expect(getRetirementMarkerOffset(62.6, 40, 30)).toBe(23)
  })
})

describe('getRetirementChartChrome — narrow vs wide (story 24.1)', () => {
  it('drops the axis titles and shrinks the chrome on narrow viewports', () => {
    const narrow = getRetirementChartChrome(true)
    const wide = getRetirementChartChrome(false)

    // Axis titles ("Age" / "Assets") are desktop-only.
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

/**
 * The tooltip header agrees with the axis (story 44.3, AC-3).
 *
 * ⚠️ WHY THE WORD IS PINNED ALONGSIDE THE VALUE. Since 44.3 the X axis plots
 * `age`, so Recharts hands this component an AGE as `label`. Measured in a real
 * Chromium against the half-done change (axis switched, header left alone), the
 * tooltip rendered "Year 41" for projection year 6 of a 35-year-old — an age
 * wearing the word "year". An assertion of the form `toContain('41')` passes
 * against BOTH that broken header and the fixed one, so it would certify
 * nothing. The word and the value have to be pinned together.
 *
 * ⚠️ WHERE THE NON-VACUITY ACTUALLY COMES FROM — an earlier version of this
 * comment got the mechanism wrong. The header interpolates `label`, which the
 * test supplies directly; it never reads `payload.age` or `payload.year`. So it
 * is the LABEL VALUE that has to be the age (41) rather than the year index (6),
 * and mutation M8 pins exactly that by pointing `label` at 6. The payload's
 * `age`/`year` fields are set apart only so the fixture reads honestly. The
 * age-vs-index separation matters for real in the e2e hover test, where the
 * label is produced by the chart rather than by the test.
 */
describe('CustomTooltip — the header agrees with the axis (story 44.3)', () => {
  const CURRENCY = { mode: 'none', currency: 'NONE', locale: 'en-US' } as const

  /** A payload as Recharts hands it over: `label` is the axis category value. */
  function renderTooltip(label: number, overrides: Record<string, unknown> = {}) {
    return renderWithProviders(
      <CustomTooltip
        active
        label={String(label)}
        payload={[
          {
            payload: {
              year: 6,
              age: 41,
              startingBalance: 175_100_00,
              annualContribution: 27_300_00,
              endingBalance: 214_000_00,
              retirementYear: false,
              ...overrides,
            },
          },
        ]}
        {...CURRENCY}
      />
    )
  }

  it('heads the tooltip with the AGE, not the word "Year" (AC-3)', () => {
    const { container } = renderTooltip(41)

    expect(container.textContent).toContain('Age 41')
    // The exact defect measured before the fix: an age under the word "Year".
    expect(container.textContent).not.toContain('Year 41')
  })

  /**
   * ⚠️ The guard branch taken when a payload arrives without the balance fields
   * — `RetirementTimelineChart.tsx:214`, one of TWO header sites (the main one
   * is `:222`). It carries a second copy of the header, and no test rendered it
   * before this one, so a fix applied only to the main branch left a lying
   * header on the degraded path with nothing to catch it. (The story cites the
   * pre-change line `:186`; this same change moved it down ~28 lines. Epic 44
   * has now produced stale anchors three stories running — re-verify, do not
   * inherit.)
   */
  it('also heads the DEGRADED branch with the age (AC-3, the easily-missed one)', () => {
    const { container } = renderWithProviders(
      <CustomTooltip active label="41" payload={[{ payload: { age: 41 } }]} {...CURRENCY} />
    )

    expect(container.textContent).toContain('Data unavailable')
    expect(container.textContent).toContain('Age 41')
    expect(container.textContent).not.toContain('Year 41')
  })

  it('renders nothing when inactive or empty — unchanged by 44.3', () => {
    const { container } = renderWithProviders(
      <CustomTooltip active={false} label="41" payload={[]} {...CURRENCY} />
    )
    expect(container.textContent).toBe('')
  })
})

/**
 * The reference line is placed by an AGE since 44.3 (AC-4).
 *
 * ⚠️ `getRetirementMarkerOffset` is deliberately UNCHANGED — its five tests
 * above, including the "already met" regression pin story 29.1 added to close a
 * real hole, keep testing exactly what they tested. This thin converter exists
 * so the offset→age step is a named, tested thing rather than arithmetic sitting
 * in the JSX where nothing would notice it drifting out of step with `dataKey`.
 */
describe('getRetirementMarkerAge (story 44.3)', () => {
  it('converts the years-from-now offset into the age the axis plots', () => {
    expect(getRetirementMarkerAge(22, 40)).toBe(62)
  })

  it('maps an already-met plan’s offset 0 onto the current age', () => {
    // The 29.1 hole this keeps open: offset 0 is a real answer, not "no marker".
    // ⚠️ SCOPE — this proves the CONVERSION, not that a marker renders. Whether
    // the chart draws one at offset 0 depends on the series carrying a year-0
    // point, which nothing here or in 29.1's own tests asserts, and which the
    // e2e AC-4 test explicitly excludes via its `> currentAge` precondition.
    // That end-to-end gap is pre-existing and logged in deferred-work.
    expect(getRetirementMarkerAge(0, 40)).toBe(40)
  })

  it('draws no marker when there is no offset to convert', () => {
    expect(getRetirementMarkerAge(null, 40)).toBeNull()
  })
})
