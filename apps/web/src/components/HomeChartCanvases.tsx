import { CATEGORY_COLORS } from '@budget-planner/core/finance/visualization'
import type { RechartsDataItem } from '@budget-planner/core/finance/visualization'
import type React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCompactAxisTick } from '../lib/chart-axis'
import type { useChartColors } from '../lib/chartTheme'
import type { useCurrencyPreferences } from '../stores/currencyStore'

/**
 * The Overview's two Recharts CANVASES, and nothing else (story 38.3, AC-6).
 *
 * ## Why this file exists — it is a performance boundary, not a refactor
 *
 * `@tanstack/react-start`'s `hydrateStart.js:28` AWAITS `router.loadRouteChunk`
 * for every match before hydration begins, so the Overview's route chunk and its
 * whole STATIC import graph sit on the critical path to the figures appearing.
 * `HomePage.tsx` used to `import { Bar, BarChart, … } from 'recharts'` at module
 * scope, which put the Recharts vendor chunk — **104.0 KB gzipped, 36.1% of the
 * measured critical path** — in front of a user who is waiting to see a number.
 *
 * `HomePage` now pulls this module through `React.lazy`, so Recharts is fetched
 * only once the charts are actually about to render, and never at all for a
 * visitor who has no data.
 *
 * ## ⚠️ What makes this deferral hydration-safe, and the fence around it
 *
 * The charts render inside `HomePage`'s `hasData` branch, which is itself inside
 * the `!hydrated` mount gate story 38.2 added. On the server `hydrated` is
 * `false` by construction, so **no chart markup reaches the SSR HTML or the first
 * client render** — there is no server output for a lazy boundary to diverge
 * from. That is the whole reason this is safe. Verified by `curl` at the time of
 * the change: the `/` response contains zero `recharts` occurrences.
 *
 * ⚠️ **Move a `<Suspense>` boundary for this module OUTSIDE the `!hydrated` gate
 * and the chart library is back in the SSR response** — and, measured, NOTHING in
 * the hydration suite will tell you. Story 38.3's mutation M9 did exactly that
 * hoist and `e2e/hydration.spec.ts` stayed GREEN 9/9: React treats a `Suspense`
 * boundary that resolves differently on the server and on the client as ordinary
 * Suspense behaviour, not as a hydration mismatch, so no `pageerror` fires. The
 * detector that DOES catch it is the SSR-response fence in
 * `e2e/refresh-to-figures.spec.ts` ("the SSR response carries NO chart library"),
 * which was added because M9 refuted the story's own prediction.
 *
 * ## ⚠️ Footprint: the box belongs to the CALLER, deliberately
 *
 * Neither canvas draws its own height. `HomePage` keeps the sized wrapper —
 * `style={{ height: categoryChartHeight(data.length) }}` for the bars and
 * `className="h-[240px]"` for the pies — so the `Suspense` fallback can be
 * `null` and the box is provably identical before and after the chunk lands.
 * Story 38.2 measured a real 8px footprint bug caused by guessing at a
 * placeholder's height; this design removes the guess instead of repeating it.
 * **Do not move the height in here.**
 *
 * ## ⚠️ Do not add a non-chart export to this file
 *
 * Anything exported here is downloaded only when the charts are. A hook, a
 * helper or a type-carrying value that `HomePage` needs synchronously would
 * either pull the whole Recharts chunk back onto the critical path or force a
 * second copy of itself into it. Types are fine — they are erased.
 */

type CategoryBarDatum = { category: string; amount: number; fill: string }

interface CategoryBarCanvasProps {
  /** Bars to plot (amounts in cents), rendered in Recharts' vertical layout. */
  data: CategoryBarDatum[]
  /** Round tick values (cents) spanning this chart's OWN diverging domain. */
  ticks: number[]
  /** Narrow viewport: shrink the Y-axis label gutter and tick size for 320px. */
  isNarrow: boolean
  chartColors: ReturnType<typeof useChartColors>
  formatAmount: (cents: number) => string
  mode: ReturnType<typeof useCurrencyPreferences>['mode']
  currency: ReturnType<typeof useCurrencyPreferences>['currency']
}

/**
 * The plot for one Financial Category Summary sub-chart — flows OR balances
 * (story UX-2). Each instance owns its axis domain (`ticks`); the CALLER owns the
 * height, scaled to the bar count via `categoryChartHeight`, so the two
 * sub-charts stay legible independently instead of sharing one axis a large
 * annual flow can dominate. Axis/grid/tooltip strokes are routed through the
 * shared chartTheme so the chart reads on the dark `.surface` card too (story
 * 11-2 / 12-4 AC-2 dark-mode constraint).
 */
export function CategoryBarCanvas({
  data,
  ticks,
  isNarrow,
  chartColors,
  formatAmount,
  mode,
  currency,
}: CategoryBarCanvasProps): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
        {/* Round ticks (amounts are cents) with a compact, cents-dropping
            label — the full formatAmount value carries ".00" the narrow axis
            has no room for. */}
        <XAxis
          type="number"
          domain={[ticks[0], ticks[ticks.length - 1]]}
          ticks={ticks}
          tickFormatter={(value) => formatCompactAxisTick(value / 100, mode, currency)}
          tick={{ fontSize: 12, fill: chartColors.axis }}
          stroke={chartColors.axis}
        />
        <YAxis
          dataKey="category"
          type="category"
          width={isNarrow ? 76 : 132}
          tick={{ fontSize: isNarrow ? 11 : 12, fill: chartColors.axis }}
          stroke={chartColors.axis}
        />
        <Tooltip
          formatter={(value: number, name: string) => [formatAmount(value), name]}
          contentStyle={{
            backgroundColor: chartColors.tooltipBg,
            border: `1px solid ${chartColors.tooltipBorder}`,
            color: chartColors.tooltipText,
          }}
          labelStyle={{ color: chartColors.tooltipText }}
          itemStyle={{ color: chartColors.tooltipText }}
        />
        <Bar dataKey="amount" name="Amount">
          {data.map((entry) => (
            <Cell key={entry.category} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

interface BreakdownPieCanvasProps {
  /** Sub-heading text, used only to build the chart's accessible name. */
  title: string
  /** Pie slices for a SINGLE type, already period-scaled. Never empty here. */
  data: RechartsDataItem[]
  /** Sum of `data` values — the pie's own 100% denominator. */
  total: number
  /**
   * Narrow viewport: shrink the donut's radii so the plot stays inside its box
   * at 320px. Since story 36.2 the in-plot slice labels are gone at every
   * width, so the radii are all this flag drives here.
   */
  isNarrow: boolean
  formatAmount: (cents: number) => string
}

/**
 * The plot for one category-breakdown pie (income OR expense), with its own
 * correct 100% denominator (UX review #4).
 *
 * ⚠️ The colour-keyed list BELOW the plot is not here — it stays in `HomePage`
 * on purpose. It doubles as the legend and carries the per-category amounts as
 * plain text, which the period-control test asserts precisely because Recharts'
 * SVG is not laid out under jsdom. Moving it behind the lazy boundary would put
 * a `await`-shaped hole in a test that has nothing to do with charts.
 */
export function BreakdownPieCanvas({
  title,
  data,
  total,
  isNarrow,
  formatAmount,
}: BreakdownPieCanvasProps): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart aria-label={`${title} breakdown chart`} role="img">
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          innerRadius={isNarrow ? 42 : 55}
          outerRadius={isNarrow ? 70 : 85}
          fill="#8884d8"
          dataKey="value"
          nameKey="name"
          // No in-plot slice labels, at ANY width (story 36.2 / UX-DR41). With
          // many categories the coloured labels collide into an unreadable
          // tangle on desktop; below 640px they overflowed the container
          // outright (story 6-1). The list below names every slice, and the
          // hover tooltip carries the per-slice figure and share — so nothing is
          // lost. The chart is `role="img"`, so the labels never reached the
          // accessibility tree in the first place.
          //
          // ⚠️ `labelLine` above is now INERT: Recharts guards with
          // `label && this.renderLabels(sectors)`, and `labelLine` is read only
          // inside `renderLabels`. It is kept so that restoring `label` cannot
          // silently also restore the leader lines. Both props are pinned in
          // `__tests__/HomePage.pie-labels.chart-wiring.test.tsx`.
          label={false}
        >
          {data.map((entry, index) => (
            <Cell
              key={`${entry.type}-${entry.name}`}
              fill={entry.fill || entry.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
              stroke="#fff"
              strokeWidth={2}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => [
            `${formatAmount(value)}${total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : ''}`,
            name,
          ]}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
