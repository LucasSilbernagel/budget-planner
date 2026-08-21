import type React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { barDomainTicks, formatCompactAxisTick } from '../lib/chart-axis'
import { useChartColors } from '../lib/chartTheme'
import {
  SAVINGS_SAVED_FILL,
  type SavingsChartRow,
  getSavingsChartChrome,
  savingsChartHeight,
  truncateAxisLabel,
} from '../lib/savings-chart-data'
import type { useCurrencyPreferences } from '../stores/currencyStore'
import { ErrorBoundary } from './ErrorBoundary'

/** Accessible name for the plot. Exported so the e2e can query BY NAME. */
export const SAVINGS_CHART_ARIA_LABEL = 'Savings by account — current balance against target'

interface SavingsChartProps {
  /** Rows to plot, already folded by `buildSavingsChartRows`, in table order. */
  rows: SavingsChartRow[]
  /** Cents → display string, honouring the user's currency preference. */
  formatAmount: (cents: number) => string
  mode: ReturnType<typeof useCurrencyPreferences>['mode']
  currency: ReturnType<typeof useCurrencyPreferences>['currency']
}

/**
 * Grouped horizontal bar chart of each savings entry's current balance against
 * its target (story 37.1, FR64 / UX-DR42).
 *
 * WHY THIS CHART TYPE (ratified by Lucas 2026-08-20; `epics.md:4561` asks for
 * the rationale to be recorded). Two adjacent surfaces already overlap this
 * territory: the Overview plots ONE AGGREGATE savings bar, and this page's
 * table carries a NORMALIZED-PERCENTAGE progress column. Neither shows
 * per-entry ABSOLUTE balances side by side against their targets. That is the
 * differentiator, and it is what keeps this out of the redundancy trap story
 * 12-4 removed a chart for. A donut was rejected: every pie decision since
 * 2026-07-07 has narrowed or removed pies, a pie tells slices apart by hue
 * alone (the WCAG 1.4.1 shape 12-4 flagged), and it carries no progress
 * dimension at all.
 *
 * ⚠️ NO PERIOD SEMANTICS. `currentBalance` is a point-in-time STOCK, not a
 * per-period flow — `ClientSavingsGoal` has no `frequency` field. So there is no
 * duration selector, no period suffix on the title or the accessible name, and
 * no substitution of a contribution figure (`monthlyAllocation`,
 * `distributablePool`, the solver's `effectiveAllocation`) for the balance.
 * Story 32.1's scope fence, restated: those three are named as forbidden there,
 * and they are the nearest-to-hand things a reader of the epic might reach for.
 *
 * ⚠️ `useChartColors()` and `useIsNarrowViewport()` are called HERE, not
 * threaded down as props the way `HomePage.tsx` and `CategoryBreakdown.tsx` do.
 * This follows `RetirementTimelineChart.tsx`, and it is what lets the wiring
 * test flip the theme store and render this component in isolation.
 */
export function SavingsChart({
  rows,
  formatAmount,
  mode,
  currency,
}: SavingsChartProps): React.ReactElement {
  const chartColors = useChartColors()
  // ⚠️ Permanently `false` in jsdom (no `matchMedia`), so unit tests only ever
  // exercise the desktop branch. The narrow branch is covered by testing
  // `getSavingsChartChrome(true)` directly plus a 320px Playwright case.
  const isNarrow = useIsNarrowViewport()
  const chrome = getSavingsChartChrome(isNarrow)

  // This chart's OWN domain from its OWN amounts (story UX-2: charts must not
  // share an axis). Absent targets are filtered out rather than passed as
  // `null` — `barDomainTicks` spreads into `Math.min`/`Math.max`, where a
  // stray non-number would silently widen or poison the domain.
  const ticks = barDomainTicks([
    ...rows.map((row) => row.saved),
    ...rows.flatMap((row) => (row.target === null ? [] : [row.target])),
  ])
  // `noUncheckedIndexedAccess` is on, and Recharts' `domain` is a strict pair —
  // narrow with `??`, never cast (the idiom is documented at
  // `CategoryBreakdown.tsx:476-484`).
  const domainMin = ticks[0] ?? 0
  const domainMax = ticks[ticks.length - 1] ?? 0

  return (
    <div data-testid="savings-chart" style={{ height: savingsChartHeight(rows.length) }}>
      <ErrorBoundary
        fallback={<div className="p-4 text-red-600 dark:text-red-400">Chart error occurred</div>}
      >
        <ResponsiveContainer width="100%" height="100%">
          {/* `role="img"` + `aria-label` give the plot an accessible name — only
              one other chart in the app has one. ⚠️ It also makes the plot
              OPAQUE to assistive tech, which is deliberate: the table on this
              page is the accessible path to the numbers, and this chart is
              additive. Do not add Recharts' `accessibilityLayer` — it is false
              by default in 2.x, it contradicts `role="img"`, and it is a
              user-visible keyboard-behaviour change with no coverage here. */}
          <BarChart data={rows} layout="vertical" role="img" aria-label={SAVINGS_CHART_ARIA_LABEL}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            {/* Amounts are CENTS; `formatCompactAxisTick` takes whole units,
                hence the `/ 100`. Dropping it renders figures a hundred times
                too large, silently — axis ticks are painted, and painted things
                are invisible to the unit suite. */}
            <XAxis
              type="number"
              domain={[domainMin, domainMax]}
              ticks={ticks}
              tickFormatter={(value: number) => formatCompactAxisTick(value / 100, mode, currency)}
              tick={{ fontSize: chrome.tickFontSize, fill: chartColors.axis }}
              stroke={chartColors.axis}
            />
            <YAxis
              dataKey="label"
              type="category"
              width={chrome.yAxisWidth}
              // ⚠️ Wrapped, NOT passed by reference. Recharts calls a
              // tickFormatter as `(value, index)`, and `truncateAxisLabel`'s
              // second parameter is its `max` — passing it bare feeds the tick
              // INDEX in as the length limit, so index 0 yields a limit of 0 and
              // the label comes back essentially untruncated. Caught by e2e; the
              // unit test that called the formatter with one argument could not
              // see it.
              tickFormatter={(label: string) => truncateAxisLabel(label, chrome.labelMaxChars)}
              tick={{ fontSize: chrome.tickFontSize, fill: chartColors.axis }}
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
            {/* ⚠️ The legend needs an EXPLICIT payload and an EXPLICIT
                formatter, and neither is boilerplate:
                  - Recharts derives swatches from each series' `fill`, and the
                    Target series is `fill="none"`, so a bare `<Legend />`
                    paints an INVISIBLE swatch for it.
                  - `type: 'plainline'` (not `'line'`) is what reads
                    `payload.strokeDasharray`; `'line'` draws a solid S-curve
                    and the dash — the whole non-colour cue — never reaches the
                    legend. `'plainline'` throws without the `payload` object.
                  - `wrapperStyle.color` does NOT colour the labels: Recharts
                    sets each label's inline colour from its payload entry,
                    which would paint "Saved" in #8B5CF6 at 3.47:1 on the dark
                    card. The formatter is what routes the text through the
                    theme. */}
            <Legend
              payload={[
                { id: 'saved', value: 'Saved', type: 'square', color: SAVINGS_SAVED_FILL },
                {
                  id: 'target',
                  value: 'Target',
                  type: 'plainline',
                  color: chartColors.axis,
                  payload: { strokeDasharray: '4 3' },
                },
              ]}
              formatter={(value: string) => (
                <span style={{ color: chartColors.axis }}>{value}</span>
              )}
              wrapperStyle={{ fontSize: chrome.legendFontSize }}
            />
            <Bar dataKey="saved" name="Saved" fill={SAVINGS_SAVED_FILL} barSize={chrome.barSize} />
            {/* The Target series is an OUTLINE, not a second fill. That is a
                WCAG 1.4.1 decision, not a stylistic one: the two series differ
                in TEXTURE, so they stay distinguishable without relying on hue.
                It also inherits the AA-verified axis token, so it themes
                correctly on both surfaces. A row with no usable target carries
                a literal `null` here, and Recharts paints no <path> for it. */}
            <Bar
              dataKey="target"
              name="Target"
              fill="none"
              stroke={chartColors.axis}
              strokeWidth={2}
              strokeDasharray="4 3"
              barSize={chrome.barSize}
            />
          </BarChart>
        </ResponsiveContainer>
      </ErrorBoundary>
    </div>
  )
}
