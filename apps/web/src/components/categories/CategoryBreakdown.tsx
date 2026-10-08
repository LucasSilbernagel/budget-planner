// Groups by categoryId with one Uncategorized bucket, unlike the overview pies (by name); both on purpose.
// Labels resolve through the unscoped name map: rows carry no profileId, so scoping would hide real names.

import {
	buildCategoryBreakdown,
	type CategoryBreakdownItem,
	type CategoryBreakdownRow,
	type Frequency,
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

// A user can name a real category "Uncategorized", so the residual row is marked by data-uncategorized.
const UNCATEGORIZED_LABEL = 'Uncategorized'

const FREQUENCIES: readonly Frequency[] = ['weekly', 'biweekly', 'monthly', 'annually']

type IncomeRow = ReturnType<typeof useIncomeSources>[number]
type ExpenseRow = ReturnType<typeof useExpenses>[number]

// The core helper throws on corrupt rows; a bad persisted row must degrade that row, not the render.
function toBreakdownItems(rows: readonly (IncomeRow | ExpenseRow)[]): CategoryBreakdownItem[] {
	const items: CategoryBreakdownItem[] = []
	for (const row of rows) {
		// Log the id only: the row holds the user's financial data.
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

// generateColorMap skips an empty key, so the residual bucket needs a sentinel.
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

	// categoryNames must stay in both dependency lists, or a rename leaves stale labels.
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
			{/* Not the literal "Categories", which would collide with the page heading. */}
			<h2 id={headingId} className="text-xl font-semibold text-subheading">
				Category breakdown
			</h2>
			<p className="mt-1 text-sm text-muted">
				What each category totals and its share of that side. Income and expenses are separate
				wholes, so each share is measured against its own total.
			</p>
			{/* Only non-integral cadences (weekly, biweekly) diverge from the dashboard: rows round per bucket so they sum to the total. */}
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
					{/* Don't imply categorizing is required: uncategorized money still gets a full breakdown. */}
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
	side: 'income' | 'expense'
	title: string
	emptyLabel: string
	rows: CategoryBreakdownRow[]
	totalCents: number
	duration: OverviewDuration
	formatAmount: (cents: number) => string
	isNarrow: boolean
	chartColors: ReturnType<typeof useChartColors>
	mode: ReturnType<typeof useCurrencyPreferences>['mode']
	currency: ReturnType<typeof useCurrencyPreferences>['currency']
}

// Each side is its own whole, so shares never use a combined denominator.
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

	// Shares of a net total only mean something when every row has the same sign; a mixed-sign
	// net can be near zero (+100 vs -99.99 = 1,000,000%). An exact test, since no threshold separates 200% from that.
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

	// generateColorMap assigns by array index, so sort keys to keep colours stable when rows reorder by magnitude.
	const colors = generateColorMap([...rows.map(rowKey)].sort())

	return (
		<div>
			<h3 id={headingId} className="text-sm font-semibold text-label">
				{heading}
			</h3>

			{/* table-fixed + break-words keep a 255-character name from overflowing 320px. */}
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
							data-uncategorized={row.categoryId === null ? 'true' : undefined}
						>
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

// The axis domain comes from this side only, or large income would crush every expense bar.
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
	// Narrowed rather than cast: noUncheckedIndexedAccess widens the index read, and domain needs [number, number].
	const domainMin = ticks[0] ?? 0
	const domainMax = ticks.at(-1) ?? 0
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
						{/* Axis data is cents; formatCompactAxisTick takes whole units. */}
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
