import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type BalanceChartModel,
  SAVINGS_SEGMENT_KEY,
  buildBalanceChartModel,
  getBalanceSeriesFills,
} from '../../lib/balance-chart-data'
import { barDomainTicks } from '../../lib/chart-axis'
import { useThemeStore } from '../../stores/themeStore'

/**
 * What the Balance chart HANDS Recharts (story 37.2).
 *
 * ⚠️ FOUR PRECONDITIONS, all learned the hard way:
 *
 * 1. jsdom gives `ResponsiveContainer` a 0×0 box, so the real chart renders NO
 *    SVG. Every claim here is therefore about PROPS, captured from stubs — never
 *    about the DOM. A `.recharts-*` assertion in this file could not fail.
 * 2. This must be its OWN file. `vi.mock('recharts')` is module-scoped and would
 *    turn every other test in a shared file into a mocked-chart test.
 * 3. The stubs must CAPTURE props. The house `Passthrough` stub used elsewhere
 *    drops every prop but `children`, which would make all of this vacuous.
 * 4. A missing stub does NOT throw — `ErrorBoundary` swallows React's "Element
 *    type is invalid" and renders its fallback, so the symptom of a broken mock
 *    is an EMPTY CAPTURE, not an exception. Hence the non-vacuity guards.
 */

interface CapturedBar {
  dataKey: string
  name: string
  fill: string
  stroke: string
  strokeWidth: number
  stackId: string
  maxBarSize: number
}

const captured = vi.hoisted(() => ({
  chart: null as null | {
    data: unknown[]
    role: string
    ariaLabel: string
    stackOffset: string
    margin: Record<string, number>
  },
  bars: [] as CapturedBar[],
  xAxis: null as null | Record<string, unknown>,
  yAxis: null as null | Record<string, unknown>,
  grid: null as null | Record<string, unknown>,
  tooltip: null as null | Record<string, unknown>,
  refLine: null as null | Record<string, unknown>,
}))

vi.mock('recharts', () => ({
  // ⚠️ These two MUST render their children, or no <Bar> ever mounts and every
  // capture below stays empty.
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({
    children,
    data,
    role,
    'aria-label': ariaLabel,
    stackOffset,
    margin,
  }: {
    children: React.ReactNode
    data: unknown[]
    role: string
    'aria-label': string
    stackOffset: string
    margin: Record<string, number>
  }) => {
    captured.chart = { data, role, ariaLabel, stackOffset, margin }
    return <div>{children}</div>
  },
  Bar: (props: CapturedBar) => {
    captured.bars.push(props)
    return null
  },
  XAxis: (props: Record<string, unknown>) => {
    captured.xAxis = props
    return null
  },
  YAxis: (props: Record<string, unknown>) => {
    captured.yAxis = props
    return null
  },
  CartesianGrid: (props: Record<string, unknown>) => {
    captured.grid = props
    return null
  },
  Tooltip: (props: Record<string, unknown>) => {
    captured.tooltip = props
    return null
  },
  ReferenceLine: (props: Record<string, unknown>) => {
    captured.refLine = props
    return null
  },
}))

const { BalanceChart } = await import('../BalanceChart')

const fmt = (cents: number): string => `${(cents / 100).toFixed(2)}`

function modelOf(
  entries: Array<{ id: string; type: 'investment' | 'debt'; name: string; currentBalance: number }>,
  savingsCents = 0
): BalanceChartModel {
  return buildBalanceChartModel({
    entries: entries.map((partial) => ({
      ...partial,
      monthlyContribution: 0,
      frequency: 'monthly',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as never,
    savingsCents,
  })
}

const MIXED = () =>
  modelOf(
    [
      { id: 'inv', type: 'investment', name: 'Brokerage', currentBalance: 500_000 },
      { id: 'debt', type: 'debt', name: 'Mortgage', currentBalance: 200_000 },
    ],
    100_000
  )

// ⚠️ `mode`/`currency` are passed as PROPS, not read from the store: the shared
// test setup forces the currency store to `none`/`NONE`, which this component
// never reads. Asserting a symbol without passing one would prove nothing.
function renderChart(model: BalanceChartModel = MIXED()) {
  return render(<BalanceChart model={model} formatAmount={fmt} mode="symbol" currency="USD" />)
}

beforeEach(() => {
  captured.chart = null
  // ⚠️ Module-scoped and ACCUMULATING — without this reset a later test reads an
  // earlier test's bars and passes on a chart that rendered none of its own.
  captured.bars = []
  captured.xAxis = null
  captured.yAxis = null
  captured.grid = null
  captured.tooltip = null
  captured.refLine = null
  useThemeStore.setState({ theme: 'light' })
})

afterEach(() => {
  // ⚠️ cleanup BEFORE resetting the theme: `setState` on a live store re-renders
  // a still-mounted chart outside `act()`.
  cleanup()
  useThemeStore.setState({ theme: 'light' })
})

describe('BalanceChart wiring — what the chart is handed', () => {
  it('plots ONE stacked column per non-empty side, Assets first', () => {
    renderChart()
    expect(captured.chart).not.toBeNull()
    expect(captured.chart?.data).toHaveLength(2)
    expect((captured.chart?.data as Array<{ category: string }>).map((d) => d.category)).toEqual([
      'Assets',
      'Liabilities',
    ])
  })

  it('uses the DEFAULT column layout, not SavingsChart’s vertical one', () => {
    renderChart()
    // `layout` is never passed, so Recharts' default (columns) applies. The
    // category axis is X and the value axis is Y — the inverse of SavingsChart.
    expect(captured.xAxis?.dataKey).toBe('category')
    expect(captured.xAxis?.type).toBe('category')
    expect(captured.yAxis?.type).toBe('number')
  })

  it('sets stackOffset="sign" so negative balances go BELOW the baseline', () => {
    renderChart()
    // Recharts' default is `'none'`, which accumulates a negative segment back
    // down over the stack instead of below zero.
    expect(captured.chart?.stackOffset).toBe('sign')
  })

  it('gives every bar ONE shared stackId', () => {
    renderChart()
    expect(captured.bars.length).toBeGreaterThan(0)
    expect(new Set(captured.bars.map((bar) => bar.stackId)).size).toBe(1)
  })

  it('renders one bar per segment, keyed by id and named by label', () => {
    renderChart()
    expect(captured.bars.map((bar) => bar.dataKey)).toEqual([
      SAVINGS_SEGMENT_KEY,
      'seg-inv',
      'seg-debt',
    ])
    expect(captured.bars.map((bar) => bar.name)).toEqual(['Savings', 'Brokerage', 'Mortgage'])
  })

  it('strokes each segment in the card colour so adjacent segments stay separable', () => {
    renderChart()
    for (const bar of captured.bars) {
      // `tooltipBg` is the semantic proxy for the surface colour.
      expect(bar.stroke).toBe('#ffffff')
      expect(bar.strokeWidth).toBe(1)
    }
  })

  it('caps bar width, so a single-column chart does not span the whole band', () => {
    renderChart()
    expect(captured.bars.length).toBeGreaterThan(0)
    for (const bar of captured.bars) expect(bar.maxBarSize).toBe(120)
  })

  it('carries an accessible name listing all three aggregates', () => {
    renderChart()
    expect(captured.chart?.role).toBe('img')
    expect(captured.chart?.ariaLabel).toContain('assets 6000.00')
    expect(captured.chart?.ariaLabel).toContain('liabilities 2000.00')
    expect(captured.chart?.ariaLabel).toContain('net worth 4000.00')
  })

  it('converts CENTS to units in the value-axis tick formatter', () => {
    renderChart()
    const format = captured.yAxis?.tickFormatter as (value: number, index: number) => string
    // ⚠️ Called as `(value, index)` — the way Recharts calls it. A one-argument
    // call is exactly what let story 37.1's index-as-limit defect stay green.
    expect(format(600_000, 0)).toBe('$6K')
    expect(format(600_000, 3)).toBe('$6K')
  })

  it('hands the axis its TICKS, not only a domain', () => {
    // ⚠️ `barDomainTicks` returns ticks; the domain is just their endpoints.
    // Dropping `ticks={ticks}` lets Recharts invent its own against the explicit
    // domain — a different painted axis that every domain-only assertion misses.
    renderChart()
    const model = MIXED()
    expect(captured.yAxis?.ticks).toEqual(barDomainTicks(model.domainInputs))
  })

  it('reserves top margin so the reference-line label cannot clip', () => {
    // Keeping netWorth in the domain stops the LINE leaving the plot; only margin
    // stops the LABEL, which Recharts paints above it (epic 24's failure mode).
    renderChart()
    expect(captured.chart?.margin?.top).toBeGreaterThan(0)
  })

  it('spans a domain built from the model’s per-sign stack sums', () => {
    const model = modelOf(
      [{ id: 'inv', type: 'investment', name: 'Margin', currentBalance: -300_000 }],
      500_000
    )
    renderChart(model)
    const domain = captured.yAxis?.domain as [number, number]
    // The column NET is +200,000 but the stack paints from −300,000 to +500,000.
    expect(domain[0]).toBeLessThanOrEqual(-300_000)
    expect(domain[1]).toBeGreaterThanOrEqual(500_000)
  })

  it('routes tooltip values through formatAmount, and sets no trigger or shared prop', () => {
    renderChart()
    const format = captured.tooltip?.formatter as (v: number, n: string) => [string, string]
    expect(format(123_456, 'Brokerage')).toEqual(['1234.56', 'Brokerage'])
    // The axis-type default is what attaches the touch handlers — the only route
    // to segment identity without a mouse.
    expect(captured.tooltip?.trigger).toBeUndefined()
    expect(captured.tooltip?.shared).toBeUndefined()
  })

  it('draws the net-worth reference line, labelled with the same figure the card shows', () => {
    renderChart()
    expect(captured.refLine).not.toBeNull()
    expect(captured.refLine?.y).toBe(400_000)
    expect((captured.refLine?.label as { value: string }).value).toBe('Net worth 4000.00')
  })

  it('SUPPRESSES the reference line when any row was excluded', () => {
    const model = modelOf([
      { id: 'ok', type: 'investment', name: 'OK', currentBalance: 100_000 },
      { id: 'bad', type: 'investment', name: 'Bad', currentBalance: Number.NaN },
    ])
    expect(model.excludedCount).toBe(1)
    renderChart(model)
    // Net worth is no longer the figure the card shows, so a line labelled with
    // it would assert an agreement that does not hold.
    expect(captured.refLine).toBeNull()
  })

  it('renders a single column when only one side has data', () => {
    renderChart(modelOf([{ id: 'd', type: 'debt', name: 'Loan', currentBalance: 90_000 }]))
    expect(captured.chart?.data).toHaveLength(1)
    expect(captured.bars).toHaveLength(1)
  })
})

describe('BalanceChart wiring — theme', () => {
  // ⚠️ Every assertion here is on something a THEME CAN CHANGE. Re-measuring
  // geometry under a flipped theme would assert nothing.
  it('paints light chrome and the light ramp by default', () => {
    renderChart()
    expect(captured.xAxis?.stroke).toBe('#6b7280')
    expect(captured.grid?.stroke).toBe('#e5e7eb')
    expect(captured.tooltip?.contentStyle).toMatchObject({ backgroundColor: '#ffffff' })
    const fills = getBalanceSeriesFills('light')
    expect(captured.bars.map((bar) => bar.fill)).toEqual([
      fills.savings,
      fills.asset[0],
      fills.liability[0],
    ])
  })

  it('paints dark chrome and the DARK ramp when the theme store flips', () => {
    useThemeStore.setState({ theme: 'dark' })
    renderChart()
    expect(captured.xAxis?.stroke).toBe('#9ca3af')
    expect(captured.grid?.stroke).toBe('#374151')
    expect(captured.tooltip?.contentStyle).toMatchObject({ backgroundColor: '#1f2937' })
    const dark = getBalanceSeriesFills('dark')
    expect(captured.bars.map((bar) => bar.fill)).toEqual([
      dark.savings,
      dark.asset[0],
      dark.liability[0],
    ])
    // The hairline follows the card, or segments would be outlined in white on a
    // dark card.
    for (const bar of captured.bars) expect(bar.stroke).toBe('#1f2937')
  })

  it('themes the reference line too', () => {
    useThemeStore.setState({ theme: 'dark' })
    renderChart()
    expect(captured.refLine?.stroke).toBe('#9ca3af')
    expect((captured.refLine?.label as { fill: string }).fill).toBe('#9ca3af')
  })
})
