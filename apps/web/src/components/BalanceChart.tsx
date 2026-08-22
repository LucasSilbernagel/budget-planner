import type React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import {
  type BalanceChartModel,
  SAVINGS_SEGMENT_KEY,
  buildBalanceChartAriaLabel,
  buildReferenceLineLabel,
  getBalanceChartChrome,
  getBalanceSeriesFills,
  segmentFill,
} from '../lib/balance-chart-data'
import { barDomainTicks, formatCompactAxisTick } from '../lib/chart-axis'
import { useChartColors } from '../lib/chartTheme'
import type { useCurrencyPreferences } from '../stores/currencyStore'
import { useTheme } from '../stores/themeStore'
import { ErrorBoundary } from './ErrorBoundary'

interface BalanceChartProps {
  /** Folded by `buildBalanceChartModel`, in manual (not table-sort) order. */
  model: BalanceChartModel
  /** Cents → display string, honouring the user's currency preference. */
  formatAmount: (cents: number) => string
  mode: ReturnType<typeof useCurrencyPreferences>['mode']
  currency: ReturnType<typeof useCurrencyPreferences>['currency']
}

/**
 * Stacked assets-vs-liabilities columns with per-entry segments and a net-worth
 * reference line (story 37.2, FR64 / UX-DR42).
 *
 * WHY THIS CHART TYPE (ratified by Lucas 2026-08-21). Three adjacent surfaces
 * already overlap this territory: the Overview's ux-2 "Balances" sub-chart plots
 * the same three AGGREGATES (Savings / Investments / Debts), this page's four
 * stat cards carry those same totals, and the Investment Accounts table lists
 * investments per account as TEXT. None of them shows which individual accounts
 * and debts make up each side, side by side and to scale. That is the
 * differentiator, and it is what keeps this out of the redundancy trap story
 * 12-4 removed a chart for.
 *
 * ⚠️ Story 12-4's own Alternative 2 was "Assets (Savings + Investments) stacked
 * vs Liabilities (Debts), net worth as the derived difference" — and it was
 * REJECTED, on three costs: more code, redundancy with the sibling chart on the
 * same screen, and little planning gain. Two of the three were Overview-local
 * and do not apply here, and per-entry segmentation is what answers the third.
 * Recorded because the next reader will otherwise conclude this re-adds
 * something a prior story deliberately declined.
 *
 * ⚠️ THIS IS THE DEFAULT (COLUMN) LAYOUT. `SavingsChart.tsx` — the structural
 * template for everything else here — is `layout="vertical"`, i.e. HORIZONTAL
 * bars with a category Y-axis. Copying its axis setup rotates this chart and
 * inverts every axis prop with it. Here `XAxis` is the category axis and `YAxis`
 * is the value axis.
 *
 * ⚠️ NO PERIOD SEMANTICS. `currentBalance` is a point-in-time STOCK. There is no
 * duration selector, no period suffix, and no substitution of
 * `monthlyContribution` for the balance.
 *
 * ⚠️ `useChartColors()`, `useTheme()` and `useIsNarrowViewport()` are called
 * HERE, not threaded down as props the way `HomePage.tsx` does. This follows
 * `SavingsChart.tsx` / `RetirementTimelineChart.tsx`, and it is what lets the
 * wiring test flip the theme store and render this component in isolation. The
 * CURRENCY trio stays props, because the page already resolves it.
 */
export function BalanceChart({
  model,
  formatAmount,
  mode,
  currency,
}: BalanceChartProps): React.ReactElement {
  const chartColors = useChartColors()
  const fills = getBalanceSeriesFills(useTheme() === 'dark' ? 'dark' : 'light')
  // ⚠️ Permanently `false` in jsdom (no `matchMedia`), so unit tests only ever
  // exercise the desktop branch. The narrow branch is covered by testing
  // `getBalanceChartChrome(true)` directly plus a 320px Playwright case.
  const isNarrow = useIsNarrowViewport()
  const chrome = getBalanceChartChrome(isNarrow)

  // This chart's OWN domain from its OWN amounts (story UX-2: charts must not
  // share an axis). ⚠️ `barDomainTicks` returns TICKS, not a domain, and its
  // input is the model's PER-SIGN stack sums — see `domainInputs`.
  const ticks = barDomainTicks(model.domainInputs)
  // `noUncheckedIndexedAccess` is on, and Recharts' `domain` is a strict pair —
  // narrow with `??`, never cast.
  const domainMin = ticks[0] ?? 0
  const domainMax = ticks[ticks.length - 1] ?? 0

  // ⚠️ Suppressed when rows were excluded: `netWorth` is then not the figure the
  // Net Worth card shows, and drawing a line labelled with it would assert an
  // agreement that does not hold. The excluded-rows notice renders instead.
  const showReferenceLine = model.excludedCount === 0

  let assetIndex = 0
  let liabilityIndex = 0

  return (
    <div data-testid="balance-chart" style={{ height: chrome.height }}>
      <ErrorBoundary
        fallback={<div className="p-4 text-red-600 dark:text-red-400">Chart error occurred</div>}
      >
        <ResponsiveContainer width="100%" height="100%">
          {/* `role="img"` + `aria-label` give the plot an accessible name. ⚠️ It
              also makes the plot OPAQUE to assistive tech, which is why the
              label carries the three AGGREGATE figures: per-entry values have a
              text path in the two tables below, but the savings total lives only
              in a stat card and neither column total appears anywhere else on
              the page. Recharts' `accessibilityLayer` is deliberately not added
              — an explicit `role` does survive it, so the two are not mutually
              exclusive, but its announcements are driven from inside a subtree
              `role="img"` has already made opaque. */}
          <BarChart
            data={model.data}
            // ⚠️ Top/bottom room for the ReferenceLine LABEL, which Recharts
            // paints above its line and will otherwise clip against the plot
            // edge — the failure mode epic 24 recorded. Keeping `netWorth` inside
            // the domain stops the LINE leaving the plot; only margin stops the
            // TEXT leaving it.
            margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
            // ⚠️ NOT the default `'none'`. Under `'none'` a negative segment is
            // accumulated back DOWN OVER the stack rather than below the zero
            // baseline, so a negative balance — legal at every layer except the
            // entry form — would silently misdraw. `'sign'` is what puts
            // positives above zero and negatives below it.
            stackOffset="sign"
            role="img"
            aria-label={buildBalanceChartAriaLabel(model, formatAmount)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            <XAxis
              dataKey="category"
              type="category"
              tick={{ fontSize: chrome.categoryFontSize, fill: chartColors.axis }}
              stroke={chartColors.axis}
            />
            {/* Amounts are CENTS; `formatCompactAxisTick` takes whole units,
                hence the `/ 100`. Dropping it renders figures a hundred times
                too large, silently — axis ticks are painted, and painted things
                are invisible to the unit suite. Wrapped in an arrow, never
                passed by reference: Recharts calls a tickFormatter as
                `(value, index)`. */}
            <YAxis
              type="number"
              domain={[domainMin, domainMax]}
              ticks={ticks}
              width={chrome.valueAxisWidth}
              tickFormatter={(value: number) => formatCompactAxisTick(value / 100, mode, currency)}
              tick={{ fontSize: chrome.tickFontSize, fill: chartColors.axis }}
              stroke={chartColors.axis}
            />
            {/* ⚠️ No `trigger` and no `shared` prop. The axis-type default is
                what attaches Recharts' touch handlers, and it is what makes ONE
                tap list every segment in a column — the only way segment
                identity is reachable without a mouse. `trigger="click"` swaps
                the whole handler set. */}
            <Tooltip
              formatter={(value: number, name: string) => [formatAmount(value), name]}
              contentStyle={{
                backgroundColor: chartColors.tooltipBg,
                border: `1px solid ${chartColors.tooltipBorder}`,
                color: chartColors.tooltipText,
                // ⚠️ A FIXED width, not a max — see `tooltipWidth`. Recharts
                // computes the left/right flip from a box it measured on an
                // earlier frame, so a max-width tooltip paints narrow but is
                // positioned as if it were wide and runs off the viewport.
                width: chrome.tooltipWidth,
                boxSizing: 'border-box',
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
              }}
              labelStyle={{ color: chartColors.tooltipText }}
              itemStyle={{ color: chartColors.tooltipText }}
              // The wrapper is what Recharts measures and translates, so it
              // carries the same fixed width as the content.
              wrapperStyle={{ width: chrome.tooltipWidth }}
            />
            {model.segments.map((segment) => {
              // ⚠️ The savings segment does NOT consume a ramp slot. It has its
              // own fixed hue, so counting it would push the first investment to
              // the ramp's SECOND colour and break the deliberate match with the
              // Overview's aggregate Investments bar.
              const indexWithinSide =
                segment.key === SAVINGS_SEGMENT_KEY
                  ? 0
                  : segment.side === 'Assets'
                    ? assetIndex++
                    : liabilityIndex++
              return (
                <Bar
                  key={segment.key}
                  dataKey={segment.key}
                  name={segment.label}
                  // ⚠️ ONE shared stackId for every bar. Recharts allocates one
                  // slot per DISTINCT stackId across the whole category axis, so
                  // a second stack group would render both columns at half width,
                  // each offset beside an invisible empty slot.
                  stackId="balance"
                  fill={segmentFill(segment, indexWithinSide, fills)}
                  // The card-coloured hairline is what keeps adjacent segments
                  // separable when the ramp cycles. ⚠️ `tooltipBg` is a semantic
                  // PROXY for the surface colour — it equals `.surface` in both
                  // themes today but is not a surface token, and the scope fence
                  // forbids adding one to `ChartColors`. Nothing detects drift.
                  stroke={chartColors.tooltipBg}
                  strokeWidth={1}
                  maxBarSize={chrome.maxBarSize}
                />
              )
            })}
            {showReferenceLine && (
              <ReferenceLine
                y={model.netWorth}
                stroke={chartColors.axis}
                strokeDasharray="5 5"
                label={{
                  // ⚠️ Built, not string-concatenated-then-clipped. The builder
                  // drops the "Net worth" prefix before it will cut the figure,
                  // because a truncated currency string reads as a different
                  // number rather than as an abbreviation.
                  value: buildReferenceLineLabel(
                    model.netWorth,
                    formatAmount,
                    chrome.referenceLabelMaxChars
                  ),
                  position: 'insideTopLeft',
                  fill: chartColors.axis,
                  fontSize: chrome.tickFontSize,
                }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </ErrorBoundary>
    </div>
  )
}
