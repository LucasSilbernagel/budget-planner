/**
 * Per-category breakdown section on `/categories` (story 30.5, FR54 part 2).
 *
 * Shows, separately for income and for expenses, what each category totals and
 * what share of that side it is — the exact figures the overview pies cannot
 * carry.
 *
 * ⚠️ THIS GROUPS DIFFERENTLY FROM THE OVERVIEW PIES, ON PURPOSE. The pies group
 * by a RESOLVED NAME and fall back to the row's own name (Decision 10), so an
 * uncategorized "Rent" and an uncategorized "Groceries" are two slices. This
 * section groups by `categoryId` and folds every unresolvable row into ONE
 * `Uncategorized` bucket (Decision 1, Lucas 2026-08-10) — which is what makes
 * "how much of my money is uncategorized?" answerable at all. Two surfaces, two
 * deliberate groupings. Do not "fix" either to match the other.
 *
 * ⚠️ LABELS RESOLVE THROUGH THE UNSCOPED `useCategoryNameMap()`, not through
 * `useCategoriesForActiveProfile()` (Decision 5). 30.4b's review ruled that
 * reads must be scoped the way writes are — that rule governs the PICKER and
 * the MANAGER (what you may create and choose). Income and expense rows carry
 * no `profileId` of their own, so resolving their labels through the scoped set
 * would render a real assignment as `Uncategorized` after a profile switch,
 * which is strictly worse than showing the name. The pies and the table badges
 * resolve the same way, so every read surface agrees.
 *
 * ⚠️ CADENCE COMES FROM THE GLOBAL OVERVIEW PREFERENCE and has no writer on
 * this page — its only `<select>` lives on the Home dashboard. So the cadence is
 * NAMED in each side's heading rather than left to be inferred from figures the
 * user cannot change from here.
 *
 * Premium gating is inherited from `CategoriesPage`, which mounts this only in
 * its resolved-entitled branch.
 */

import {
  type CategoryBreakdownItem,
  type CategoryBreakdownRow,
  type Frequency,
  buildCategoryBreakdown,
  generateColorMap,
} from '@budget-planner/core'
import { type ReactElement, useId, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useCategoryNameMap } from '../../hooks/useCategoryLabels'
import { useIsNarrowViewport } from '../../hooks/useIsNarrowViewport'
import { barDomainTicks, categoryChartHeight, formatCompactAxisTick } from '../../lib/chart-axis'
import { useChartColors } from '../../lib/chartTheme'
import { useExpenses, useIncomeSources } from '../../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../../stores/currencyStore'
import {
  DURATION_LABEL,
  IS_NON_INTEGRAL_CADENCE,
  type OverviewDuration,
  useOverviewDuration,
} from '../../stores/overviewDurationStore'
import { ErrorBoundary } from '../ErrorBoundary'

/**
 * The single residual bucket's label.
 *
 * ⚠️ MATCHES `CategoryPicker`'s `UNCATEGORIZED_LABEL` deliberately — one word
 * for one concept across the product. Not imported from there because that file
 * is a form control this section has no other reason to depend on, and story
 * 30.5's AC-10 fences it; the duplication is two literals, and this comment is
 * the link between them.
 *
 * ⚠️ A LABEL CANNOT DISAMBIGUATE THIS BUCKET ON ITS OWN. Nothing stops a user
 * creating a real category called "Uncategorized" — renaming the residual just
 * moves the collision to a different word. So the residual row is marked
 * STRUCTURALLY (`data-uncategorized`) and visually (italic + muted), and tests
 * key on the attribute, never on the text.
 */
const UNCATEGORIZED_LABEL = 'Uncategorized'

/** The four members of the core `Frequency` union — there is no quarterly. */
const FREQUENCIES: readonly Frequency[] = ['weekly', 'biweekly', 'monthly', 'annually']

type IncomeRow = ReturnType<typeof useIncomeSources>[number]
type ExpenseRow = ReturnType<typeof useExpenses>[number]

/**
 * Rows the core helper can safely consume.
 *
 * ⚠️ `buildCategoryBreakdown` THROWS on a non-finite amount or an unknown
 * frequency, deliberately — silently dropping a row would understate the user's
 * money. But a rehydrated or server-pulled row is not validated by any store,
 * so a corrupt persisted blob must degrade that ROW, never take the render
 * down. Same guard shape the dashboard already applies before aggregating.
 */
function toBreakdownItems(rows: readonly (IncomeRow | ExpenseRow)[]): CategoryBreakdownItem[] {
  const items: CategoryBreakdownItem[] = []
  for (const row of rows) {
    // ⚠️ Log the row ID ONLY. The row carries the user's category name and
    // amount, and this product's whole pitch is that its financial data does
    // not leave the device — a console any error-reporting tool or screen-share
    // can capture is not the place to print it.
    if (typeof row?.amount !== 'number' || !Number.isFinite(row.amount)) {
      console.warn('Skipping a row with a non-numeric amount in the category breakdown:', row?.id)
      continue
    }
    if (!FREQUENCIES.includes(row.frequency)) {
      console.warn('Skipping a row with an unknown frequency in the category breakdown:', row.id)
      continue
    }
    items.push({ categoryId: row.categoryId, amount: row.amount, frequency: row.frequency })
  }
  return items
}

/**
 * A row's stable identity for keys, colours and scoped test queries. The
 * residual bucket has no id, so it gets an explicit sentinel rather than an
 * empty string (`generateColorMap` skips `''` and the bar would lose its
 * colour).
 */
function rowKey(row: CategoryBreakdownRow): string {
  return row.categoryId ?? 'uncategorized'
}

export function CategoryBreakdown(): ReactElement {
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  const categoryNames = useCategoryNameMap()
  const duration = useOverviewDuration()
  const formatAmount = useFormattedAmount()
  const { mode, currency } = useCurrencyPreferences()
  const isNarrow = useIsNarrowViewport()
  const chartColors = useChartColors()
  const headingId = useId()

  // ⚠️ `categoryNames` is load-bearing in BOTH dependency lists. Without it a
  // RENAME leaves this section showing the old label until an unrelated income
  // or expense edit invalidates the memo — a silently stale table.
  const income = useMemo(
    () =>
      buildCategoryBreakdown(toBreakdownItems(incomeSources), categoryNames, {
        cadence: duration,
        uncategorizedLabel: UNCATEGORIZED_LABEL,
      }),
    [incomeSources, categoryNames, duration]
  )
  const expense = useMemo(
    () =>
      buildCategoryBreakdown(toBreakdownItems(expenses), categoryNames, {
        cadence: duration,
        uncategorizedLabel: UNCATEGORIZED_LABEL,
      }),
    [expenses, categoryNames, duration]
  )

  const hasAnyRows = income.rows.length > 0 || expense.rows.length > 0

  return (
    <section
      data-testid="category-breakdown"
      aria-labelledby={headingId}
      className="surface rounded-lg shadow-md p-4 sm:p-6"
    >
      {/* ⚠️ NOT the literal "Categories": `categories-premium.spec.ts` asserts
          a `^categories$` heading has count 0 on the free branch, and a
          colliding heading would turn that spec into a landmine the moment
          session seeding exists. */}
      <h2 id={headingId} className="text-xl font-semibold text-subheading">
        Category breakdown
      </h2>
      <p className="mt-1 text-sm text-muted">
        What each category totals and its share of that side. Income and expenses are separate
        wholes, so each share is measured against its own total.
      </p>
      {/* ⚠️ Only a NON-INTEGRAL cadence can diverge. This breakdown rounds ONCE
          PER BUCKET so its rows sum to the total shown beside them, while the
          dashboard rounds once over the whole set — at ×12/52 (weekly) and
          ×12/26 (biweekly) those disagree by a few cents. `monthly` (×1) and
          `annually` (×12) are integral and agree exactly, so an unconditional
          note would be false half the time.

          ⚠️ This used to read `duration === 'weekly'`, which was correct only
          while `biweekly` was unreachable from the UI. Story 32.1 made it
          selectable, turning that check into a silent omission — no type error,
          no failing test. Derive from the multiplier set, never from one
          hard-coded value.

          `IS_NON_INTEGRAL_CADENCE` is IMPORTED from `overviewDurationStore`, not
          declared here: story 32.3 gave the Overview's breakdown pies the same
          divergence (they scale per entry, the Total cards scale the whole set
          once), so two surfaces now need the same predicate and a copy would be
          the `DURATION_LABEL`/`CADENCE_LABEL` duplication all over again. */}
      {IS_NON_INTEGRAL_CADENCE[duration] ? (
        <p className="mt-1 text-xs text-muted" data-testid="breakdown-rounding-note">
          Each category total is rounded on its own, so at this view these figures can differ from
          the dashboard total by a few cents.
        </p>
      ) : null}

      {hasAnyRows ? (
        <div className="mt-6 space-y-8">
          <BreakdownSide
            side="income"
            title="Income by category"
            emptyLabel="No income to break down yet"
            rows={income.rows}
            totalCents={income.totalCents}
            duration={duration}
            formatAmount={formatAmount}
            isNarrow={isNarrow}
            chartColors={chartColors}
            mode={mode}
            currency={currency}
          />
          <BreakdownSide
            side="expense"
            title="Expenses by category"
            emptyLabel="No expenses to break down yet"
            rows={expense.rows}
            totalCents={expense.totalCents}
            duration={duration}
            formatAmount={formatAmount}
            isNarrow={isNarrow}
            chartColors={chartColors}
            mode={mode}
            currency={currency}
          />
        </div>
      ) : (
        <div
          className="surface-inset mt-6 rounded-lg p-6 text-center"
          data-testid="breakdown-empty"
        >
          {/* ⚠️ Do NOT imply categorizing is a precondition — it is not. A
              single uncategorized expense already produces a full breakdown
              (one Uncategorized row at 100%), and surfacing uncategorized money
              is a headline behaviour of this view, not a degraded state. */}
          <p className="text-muted">
            Add income or expenses to see the breakdown here. Anything you have not categorized is
            grouped together, so there is no need to categorize everything first.
          </p>
        </div>
      )}
    </section>
  )
}

interface BreakdownSideProps {
  /** Which side of the ledger — also the testid prefix for scoped queries. */
  side: 'income' | 'expense'
  title: string
  /** Shown when THIS side has no rows while the other one does. */
  emptyLabel: string
  rows: CategoryBreakdownRow[]
  /** This side's own 100% denominator — the sum of `rows[].totalCents`. */
  totalCents: number
  duration: OverviewDuration
  formatAmount: (cents: number) => string
  isNarrow: boolean
  chartColors: ReturnType<typeof useChartColors>
  mode: ReturnType<typeof useCurrencyPreferences>['mode']
  currency: ReturnType<typeof useCurrencyPreferences>['currency']
}

/**
 * One side's table plus its bar chart.
 *
 * Income and expenses are SEPARATE WHOLES: this component never sees the other
 * side's figures, so a share cannot accidentally be measured against a combined
 * denominator, and each chart derives its axis from its own amounts only.
 */
function BreakdownSide({
  side,
  title,
  emptyLabel,
  rows,
  totalCents,
  duration,
  formatAmount,
  isNarrow,
  chartColors,
  mode,
  currency,
}: BreakdownSideProps): ReactElement {
  const headingId = useId()
  const heading = `${title} ${DURATION_LABEL[duration]}`

  // ⚠️ A share of a NET total is only meaningful when the parts compose to the
  // whole. Once a side holds BOTH signs the denominator is a net that can be
  // arbitrarily close to zero, and `|row| / |net|` stops meaning anything:
  // +100.00 against −99.99 renders 1,000,000.0%, and an exact cancellation
  // trips the zero-guard so every row reads 0.0% while showing real money.
  // Both boundaries are pinned in the core suite.
  //
  // Sign homogeneity is an EXACT test, deliberately NOT a magnitude threshold
  // on the denominator — no threshold can separate a legitimate 200% (the
  // documented mixed-sign case) from a meaningless 1,000,000%, and story 28-2
  // established that this repo prefers an exact check over an invented bound.
  const sharesAreMeaningful =
    rows.every((row) => row.totalCents >= 0) || rows.every((row) => row.totalCents <= 0)

  if (rows.length === 0) {
    return (
      <div>
        <h3 id={headingId} className="text-sm font-semibold text-label">
          {heading}
        </h3>
        <div
          className="surface-inset mt-2 rounded-lg p-6 text-center"
          data-testid={`breakdown-${side}-empty`}
        >
          <p className="text-muted">{emptyLabel}</p>
        </div>
      </div>
    )
  }

  // ⚠️ `generateColorMap` ASSIGNS BY ARRAY INDEX (`CATEGORY_COLORS[i % 16]`),
  // so the colour follows the key's POSITION, not the key. Feeding it `rows`
  // directly — which arrive magnitude-sorted — rebinds every colour whenever
  // the ordering shifts: edit one expense so Housing overtakes Groceries and
  // all three bars change colour with no data change to two of them. Sorting
  // the keys first decouples colour from rank, so a row's colour follows its
  // identity for as long as the set is unchanged.
  //
  // Honest limit: adding or removing a category still shifts the colours of
  // every key that sorts after it. Fixing that needs a hash-based assignment in
  // the shared generator, which would also change the overview pies.
  //
  // Same PALETTE as the pies, not the same colour per category: they build
  // their map over both sides keyed by resolved NAME, this builds one per side
  // keyed by id, and an index-assigned palette gives different results for
  // different key sets.
  const colors = generateColorMap([...rows.map(rowKey)].sort())

  return (
    <div>
      <h3 id={headingId} className="text-sm font-semibold text-label">
        {heading}
      </h3>

      {/* `table-fixed` + `break-words` is what keeps a 255-character category
          name from pushing the page past 320px — an auto-layout table sizes to
          its widest unbroken cell. */}
      <table
        className="mt-2 w-full table-fixed text-sm"
        data-testid={`breakdown-${side}-table`}
        aria-labelledby={headingId}
      >
        <thead className="surface-inset">
          <tr>
            <th
              scope="col"
              className="w-1/2 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted"
            >
              Category
            </th>
            <th
              scope="col"
              className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted"
            >
              Total
            </th>
            <th
              scope="col"
              className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted"
            >
              Share
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              data-testid={`breakdown-${side}-row`}
              data-category-key={rowKey(row)}
              // ⚠️ The residual bucket is identified STRUCTURALLY, not by its
              // label — a user can create a real category with any name,
              // including whatever this bucket is called. Tests key on this.
              data-uncategorized={row.categoryId === null ? 'true' : undefined}
            >
              {/* `scope="row"` gives every cell in the row a DISTINGUISHING
                  accessible name — without it a screen-reader user hears a
                  column of bare amounts with nothing binding them to a
                  category. */}
              <th
                scope="row"
                className={
                  row.categoryId === null
                    ? 'min-w-0 break-words px-2 py-2 text-left font-medium italic text-muted'
                    : 'min-w-0 break-words px-2 py-2 text-left font-medium text-heading'
                }
              >
                {row.label}
              </th>
              <td className="px-2 py-2 text-right tabular-nums text-body">
                {formatAmount(row.totalCents)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-body">
                {sharesAreMeaningful ? `${row.sharePercent.toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="surface-inset">
          <tr data-testid={`breakdown-${side}-total`}>
            <th scope="row" className="px-2 py-2 text-left font-semibold text-heading">
              Total
            </th>
            <td className="px-2 py-2 text-right font-semibold tabular-nums text-heading">
              {formatAmount(totalCents)}
            </td>
            <td className="px-2 py-2" />
          </tr>
        </tfoot>
      </table>

      {sharesAreMeaningful ? null : (
        <p className="mt-2 text-xs text-muted" data-testid={`breakdown-${side}-share-suppressed`}>
          Shares are hidden here because this side mixes positive and negative amounts, which leaves
          no meaningful whole to measure each category against.
        </p>
      )}

      <BreakdownBarChart
        rows={rows}
        colors={colors}
        isNarrow={isNarrow}
        chartColors={chartColors}
        formatAmount={formatAmount}
        mode={mode}
        currency={currency}
        testId={`breakdown-${side}-chart`}
      />
    </div>
  )
}

interface BreakdownBarChartProps {
  rows: CategoryBreakdownRow[]
  colors: Record<string, string>
  isNarrow: boolean
  chartColors: ReturnType<typeof useChartColors>
  formatAmount: (cents: number) => string
  mode: ReturnType<typeof useCurrencyPreferences>['mode']
  currency: ReturnType<typeof useCurrencyPreferences>['currency']
  testId: string
}

/**
 * One horizontal bar chart for a single side.
 *
 * ⚠️ The axis domain is derived from THIS side's amounts only (`barDomainTicks`
 * on `rows`), never from both sides pooled — story UX-2's lesson: a large
 * annual income would otherwise crush every expense bar into a sliver. Rendered
 * only when the side has at least one row, so there is never an empty axis.
 *
 * Structurally the same chart as the dashboard's `CategoryBarChart`, which is
 * module-private to `HomePage.tsx`; the pattern is repeated here rather than
 * exported, so that file stays untouched by this story.
 */
function BreakdownBarChart({
  rows,
  colors,
  isNarrow,
  chartColors,
  formatAmount,
  mode,
  currency,
  testId,
}: BreakdownBarChartProps): ReactElement {
  const ticks = barDomainTicks(rows.map((row) => row.totalCents))
  // `barDomainTicks` always returns at least one tick (its `min === max` branch
  // degenerates to `[0]`), so these fallbacks are unreachable in practice — but
  // `noUncheckedIndexedAccess` widens an index read to `number | undefined`,
  // and Recharts' `domain` takes a strict `[number, number]`. Narrowed here
  // rather than cast, so a genuinely empty tick set degrades to a flat 0 axis
  // instead of `undefined` reaching the chart.
  const domainMin = ticks[0] ?? 0
  const domainMax = ticks[ticks.length - 1] ?? 0
  const data = rows.map((row) => ({
    key: rowKey(row),
    category: row.label,
    amount: row.totalCents,
    fill: colors[rowKey(row)] ?? chartColors.axis,
  }))

  return (
    <div className="mt-4" style={{ height: categoryChartHeight(rows.length) }} data-testid={testId}>
      <ErrorBoundary
        fallback={<div className="p-4 text-red-600 dark:text-red-400">Chart error occurred</div>}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            {/* ⚠️ The axis data is CENTS; `formatCompactAxisTick` takes whole
                currency UNITS. Forgetting the `/ 100` silently renders figures
                a hundred times too large. */}
            <XAxis
              type="number"
              domain={[domainMin, domainMax]}
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
                <Cell key={entry.key} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ErrorBoundary>
    </div>
  )
}
