/**
 * SavingsChart → Recharts wiring (story 37.1).
 *
 * ⚠️ WHY THIS FILE EXISTS. jsdom gives `ResponsiveContainer` a 0×0 box, so
 * `validateWidthHeight` rejects it and `BarChart.render()` returns `null` — NO
 * SVG ever reaches the DOM. A DOM assertion about this chart's bars, axis,
 * legend or accessible name passes identically on correct and broken code and
 * can never fail. So Recharts is replaced with prop-capturing stubs and every
 * assertion is made on what the chart was HANDED.
 *
 * ⚠️ Kept in its own file because `vi.mock('recharts')` is module-scoped: doing
 * it in the page suite would silently convert all 53 of its tests into
 * mocked-chart tests.
 *
 * ⚠️ The `BarChart` stub is PROP-CAPTURING, not the house `Passthrough`
 * (`HomePage.pie-labels.chart-wiring.test.tsx:57`), which drops every prop but
 * `children` — with that stub `role`, `aria-label` and `data` are never
 * captured and half of this file would be unwritable.
 *
 * ⚠️ A MISSING STUB DOES NOT THROW. `SavingsChart` wraps its chart in an
 * `ErrorBoundary` that swallows React's "Element type is invalid" and renders
 * its fallback, so the symptom of a broken mock is an EMPTY CAPTURE, not an
 * exception. Hence a non-vacuity guard before every assertion.
 */

import { cleanup, render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavingsChartRow } from '../../lib/savings-chart-data'
import { useThemeStore } from '../../stores/themeStore'

interface CapturedAxis {
  domain?: [number, number]
  ticks?: number[]
  width?: number
  stroke?: string
  tickFormatter?: (value: never) => string
  tick?: { fontSize: number; fill: string }
}
interface CapturedBar {
  dataKey: string
  name: string
  fill: string
  stroke?: string
  strokeWidth?: number
  strokeDasharray?: string
  barSize?: number
}
interface CapturedLegendEntry {
  id: string
  value: string
  type: string
  color: string
  payload?: { strokeDasharray?: string }
}

const captured = vi.hoisted(() => ({
  chart: null as { data: unknown[]; role?: string; ariaLabel?: string; layout?: string } | null,
  bars: [] as CapturedBar[],
  xAxis: null as CapturedAxis | null,
  yAxis: null as CapturedAxis | null,
  grid: null as { stroke?: string } | null,
  tooltip: null as {
    contentStyle?: Record<string, string>
    labelStyle?: { color: string }
    formatter?: (value: number, name: string) => [string, string]
  } | null,
  legend: null as {
    payload?: CapturedLegendEntry[]
    formatter?: (value: string) => ReactNode
    wrapperStyle?: { fontSize: number }
  } | null,
}))

vi.mock('recharts', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: Wrapper,
    BarChart: ({
      children,
      data,
      role,
      layout,
      'aria-label': ariaLabel,
    }: {
      children?: ReactNode
      data: unknown[]
      role?: string
      layout?: string
      'aria-label'?: string
    }) => {
      captured.chart = { data, role, ariaLabel, layout }
      return <div>{children}</div>
    },
    XAxis: (props: CapturedAxis) => {
      captured.xAxis = props
      return null
    },
    YAxis: (props: CapturedAxis) => {
      captured.yAxis = props
      return null
    },
    CartesianGrid: (props: { stroke?: string }) => {
      captured.grid = props
      return null
    },
    Tooltip: (props: {
      contentStyle?: Record<string, string>
      labelStyle?: { color: string }
      formatter?: (value: number, name: string) => [string, string]
    }) => {
      captured.tooltip = props
      return null
    },
    Legend: (props: {
      payload?: CapturedLegendEntry[]
      formatter?: (value: string) => ReactNode
      wrapperStyle?: { fontSize: number }
    }) => {
      captured.legend = props
      return null
    },
    Bar: (props: CapturedBar) => {
      captured.bars.push(props)
      return null
    },
    Cell: () => null,
  }
})

const { SavingsChart, SAVINGS_CHART_ARIA_LABEL } = await import('../SavingsChart')

const ROWS: SavingsChartRow[] = [
  { id: 'a', label: 'Emergency Fund', saved: 600_00, target: 1_000_00 },
  { id: 'b', label: 'TFSA', saved: 450_00, target: null },
]

// ⚠️ `mode`/`currency` are passed as PROPS, deliberately. `vitest.setup.ts`
// forces `{mode:'none', currency:'NONE'}` on the currency STORE, which this
// component never reads — so a test that relied on the store default would be
// asserting against a value the component cannot see.
function renderChart(rows: SavingsChartRow[] = ROWS) {
  return render(
    <SavingsChart
      rows={rows}
      formatAmount={(cents) => `$${(cents / 100).toFixed(2)}`}
      mode="symbol"
      currency="USD"
    />
  )
}

beforeEach(() => {
  captured.chart = null
  captured.bars = []
  captured.xAxis = null
  captured.yAxis = null
  captured.grid = null
  captured.tooltip = null
  captured.legend = null
  useThemeStore.setState({ theme: 'light' })
})

afterEach(() => {
  // ⚠️ Unmount BEFORE resetting the theme. `setState` on a live store re-renders
  // any still-mounted chart, and that update lands outside `act()` — a warning
  // that is noise here but masks real ones elsewhere in the file.
  cleanup()
  useThemeStore.setState({ theme: 'light' })
})

describe('SavingsChart wiring — what the chart is handed', () => {
  it('plots one row per entry, in the order given, keyed by id', () => {
    renderChart()
    expect(captured.chart).not.toBeNull()
    expect(captured.chart?.data).toHaveLength(2)
    expect((captured.chart?.data as SavingsChartRow[]).map((r) => r.id)).toEqual(['a', 'b'])
    expect((captured.chart?.data as SavingsChartRow[]).map((r) => r.label)).toEqual([
      'Emergency Fund',
      'TFSA',
    ])
  })

  // ⚠️ Without this the chart could silently flip to vertical COLUMNS — the
  // category and value axes swap roles and every label lands wrong — and no
  // unit assertion in this repo would notice, because jsdom paints no SVG.
  it('lays the bars out horizontally', () => {
    renderChart()
    expect(captured.chart).not.toBeNull()
    expect(captured.chart?.layout).toBe('vertical')
  })

  // The tooltip is the ONLY place the precise, currency-formatted amount is
  // shown — the axis is abbreviated and the bars are geometry. Deleting the
  // formatter shows raw cents ("600000"), and nothing else in any suite looks.
  it('formats tooltip values as currency, from cents', () => {
    renderChart()
    expect(captured.tooltip?.formatter).toBeTypeOf('function')
    // `formatAmount` here is this file's stub, `(cents) => $<cents/100>`. What
    // the assertion pins is the routing: the value arrives in CENTS and is
    // handed to `formatAmount` unchanged (600_000 → $6000.00, not $60.00 from a
    // double divide), and the series name is passed through as the second item.
    expect(captured.tooltip?.formatter?.(600_000, 'Saved')).toEqual(['$6000.00', 'Saved'])
    expect(captured.tooltip?.formatter?.(0, 'Target')).toEqual(['$0.00', 'Target'])
  })

  it('carries an accessible name on the plot', () => {
    renderChart()
    expect(captured.chart).not.toBeNull()
    expect(captured.chart?.role).toBe('img')
    // ⚠️ Contains a U+2014 EM DASH. The e2e queries by this exact string.
    expect(captured.chart?.ariaLabel).toBe('Savings by account — current balance against target')
    expect(SAVINGS_CHART_ARIA_LABEL).toBe(captured.chart?.ariaLabel)
  })

  it('renders exactly two series: a solid Saved fill and a dashed Target outline', () => {
    renderChart()
    expect(captured.bars).toHaveLength(2)
    const [saved, target] = captured.bars
    expect(saved?.dataKey).toBe('saved')
    expect(saved?.name).toBe('Saved')
    expect(saved?.fill).toBe('#8B5CF6')
    expect(target?.dataKey).toBe('target')
    expect(target?.name).toBe('Target')
    // The non-colour cue: the two series differ in TEXTURE, so they stay
    // distinguishable in greyscale (WCAG 1.4.1).
    expect(target?.fill).toBe('none')
    expect(target?.strokeDasharray).toBe('4 3')
    expect(target?.strokeWidth).toBe(2)
  })

  it('hands a null target straight through so Recharts paints no bar for it', () => {
    renderChart()
    expect(captured.chart?.data).toHaveLength(2)
    expect((captured.chart?.data as SavingsChartRow[])[1]?.target).toBeNull()
  })

  it('converts cents to units on the value axis', () => {
    renderChart()
    expect(captured.xAxis?.tickFormatter).toBeTypeOf('function')
    // 600000 cents = $6,000 → "$6K". Without the `/ 100` this reads "$600K":
    // a silent hundredfold error, invisible to any DOM assertion.
    expect(captured.xAxis?.tickFormatter?.(600_000 as never)).toBe('$6K')
  })

  it('truncates the category labels so a long name cannot paint out of the gutter', () => {
    renderChart()
    expect(captured.yAxis?.tickFormatter).toBeTypeOf('function')
    const long = 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3)
    expect(long).toHaveLength(138)
    // ⚠️ CALLED THE WAY RECHARTS CALLS IT — `(value, index)`, for several
    // indices. `truncateAxisLabel`'s own second parameter is its `max`, so a
    // formatter passed by reference receives the tick INDEX as its length limit
    // and index 0 yields a limit of 0. A one-argument call cannot see that, and
    // did not: this shipped untruncated until the 320px e2e caught it.
    const formatter = captured.yAxis?.tickFormatter as unknown as (
      value: string,
      index: number
    ) => string
    expect(formatter(long, 0)).toHaveLength(16)
    expect(formatter(long, 1)).toHaveLength(16)
    expect(formatter(long, 7)).toHaveLength(16)
    expect(formatter('New Car', 0)).toBe('New Car')
  })

  it('computes its own diverging domain from its own amounts', () => {
    renderChart()
    expect(captured.xAxis?.ticks?.length).toBeGreaterThan(1)
    expect(captured.xAxis?.domain?.[0]).toBe(captured.xAxis?.ticks?.[0])
    expect(captured.xAxis?.domain?.[1]).toBe(
      captured.xAxis?.ticks?.[(captured.xAxis?.ticks?.length ?? 1) - 1]
    )
    // The domain spans the largest TARGET (1,000_00), not just the balances —
    // an axis sized to the balances alone would clip every target bar.
    expect(captured.xAxis?.domain?.[1]).toBeGreaterThanOrEqual(1_000_00)
  })

  // The data layer deliberately passes NEGATIVE balances through (`sync.ts` has
  // no lower bound), so the axis has to diverge. Every other fixture in this
  // file is positive, which would let a domain clamped at 0 ship green while a
  // negative balance rendered as an invisible zero-width bar.
  it('spans a negative balance rather than clamping the domain at zero', () => {
    renderChart([
      { id: 'a', label: 'Overdrawn', saved: -250_00, target: null },
      { id: 'b', label: 'Emergency Fund', saved: 600_00, target: 1_000_00 },
    ])
    expect(captured.xAxis?.domain?.[0]).toBeLessThanOrEqual(-250_00)
    expect(captured.xAxis?.domain?.[1]).toBeGreaterThanOrEqual(1_000_00)
    expect(captured.xAxis?.ticks?.some((t) => t < 0)).toBe(true)
  })

  it('gives the legend an explicit payload the outlined series can actually show', () => {
    renderChart()
    expect(captured.legend?.payload).toHaveLength(2)
    const [saved, target] = captured.legend?.payload ?? []
    expect(saved?.value).toBe('Saved')
    expect(saved?.type).toBe('square')
    expect(target?.value).toBe('Target')
    // ⚠️ `plainline`, NOT `line`: only `plainline` reads `payload.strokeDasharray`.
    // `line` draws a solid S-curve and the dash cue never reaches the legend.
    expect(target?.type).toBe('plainline')
    expect(target?.payload?.strokeDasharray).toBe('4 3')
  })

  it('routes the legend text through the theme rather than the wrapper style', () => {
    renderChart()
    // Recharts colours each label from its payload entry, overriding
    // `wrapperStyle.color` — so the formatter is the only thing that can theme
    // the text. Without it "Saved" paints #8B5CF6 (3.47:1 on the dark card).
    expect(captured.legend?.formatter).toBeTypeOf('function')
    const { container } = render(captured.legend?.formatter?.('Saved') as ReactElement)
    expect(container.querySelector('span')?.style.color).toBe('rgb(107, 114, 128)')
  })

  it('uses the desktop chrome when the viewport is not narrow', () => {
    // jsdom has no `matchMedia`, so `useIsNarrowViewport()` is permanently
    // false here and ONLY this branch is reachable. The narrow branch is
    // covered by `getSavingsChartChrome(true)` directly plus a 320px e2e case.
    renderChart()
    expect(captured.yAxis?.width).toBe(132)
    expect(captured.yAxis?.tick?.fontSize).toBe(12)
    expect(captured.bars[0]?.barSize).toBe(14)
    expect(captured.legend?.wrapperStyle?.fontSize).toBe(12)
    // The label limit is desktop's 16, not narrow's 10 — the same branch.
    expect(
      (captured.yAxis?.tickFormatter as unknown as (v: string, i: number) => string)(
        'abcdefghijklmnopqrstuvwxyz',
        0
      )
    ).toHaveLength(16)
  })
})

describe('SavingsChart wiring — theme', () => {
  it('takes the light palette when the theme is light', () => {
    useThemeStore.setState({ theme: 'light' })
    renderChart()
    expect(captured.chart).not.toBeNull()
    expect(captured.xAxis?.stroke).toBe('#6b7280')
    expect(captured.grid?.stroke).toBe('#e5e7eb')
    expect(captured.tooltip?.contentStyle?.backgroundColor).toBe('#ffffff')
  })

  // ⚠️ Every assertion here is on something a THEME CAN CHANGE. Re-measuring
  // geometry under a flipped theme asserts nothing (36-3's R8 lesson).
  it('takes the dark palette when the theme is dark', () => {
    useThemeStore.setState({ theme: 'dark' })
    renderChart()
    expect(captured.chart).not.toBeNull()
    expect(captured.xAxis?.stroke).toBe('#9ca3af')
    expect(captured.xAxis?.tick?.fill).toBe('#9ca3af')
    expect(captured.yAxis?.stroke).toBe('#9ca3af')
    expect(captured.grid?.stroke).toBe('#374151')
    expect(captured.tooltip?.contentStyle?.backgroundColor).toBe('#1f2937')
    expect(captured.tooltip?.labelStyle?.color).toBe('#f3f4f6')
  })

  it('themes the Target outline and the legend text too', () => {
    useThemeStore.setState({ theme: 'dark' })
    renderChart()
    expect(captured.bars).toHaveLength(2)
    // The outline is drawn in the axis token precisely so it themes; a
    // hard-coded stroke would read as a sub-AA hairline on the dark card.
    expect(captured.bars[1]?.stroke).toBe('#9ca3af')
    expect(captured.legend?.payload?.[1]?.color).toBe('#9ca3af')
    const { container } = render(captured.legend?.formatter?.('Target') as ReactElement)
    expect(container.querySelector('span')?.style.color).toBe('rgb(156, 163, 175)')
  })
})
