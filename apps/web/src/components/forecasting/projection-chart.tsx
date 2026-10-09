import type { ForecastingResult } from '@budget-planner/core/finance/forecasting'
import {
	type CurrencyCode,
	type CurrencyMode,
	currencySymbol,
} from '@budget-planner/core/format/currency'
import type React from 'react'
import { useState } from 'react'
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import { useIsNarrowViewport } from '../../hooks/useIsNarrowViewport'
import { niceAxisTicks } from '../../lib/chart-axis'
import { useChartColors } from '../../lib/chartTheme'
import { signedAmount, vsTodayCents } from '../../lib/forecasting/today-baseline'
import { useCurrencyPreferences, useFormattedAmount } from '../../stores/currencyStore'
import { ErrorBoundary } from '../ErrorBoundary'
import { GroupedAmount } from '../ui/GroupedAmount'

type ChartDataPoint = {
	year: number
	baselineNetWorth: number
	scenarioNetWorth: number
	baselineIncome: number
	scenarioIncome: number
}

type ChartConfig = {
	showGrid: boolean
	showLegend: boolean
	showTooltip: boolean
	animate: boolean
}

// Tailwind's ring is a box-shadow, which forced-colors mode discards, hence the outline.
// No ring offset: its white default would band the dark card.
const CHART_TOGGLE_FOCUS_CLASS =
	'focus:outline-none focus:ring-2 focus:ring-blue-500 forced-colors:focus:outline forced-colors:focus:outline-2'

const DEFAULT_CONFIG = {
	showGrid: true,
	showLegend: true,
	showTooltip: true,
	animate: true,
} satisfies ChartConfig

const CHART_COLORS = {
	baseline: '#3b82f6',
	scenario: '#8b5cf6',
	income: '#10b981',
	expense: '#ef4444',
}

export const SCENARIO_FALLBACK_NAME = 'Scenario'

// Defensive: a saved result is parsed JSON whose scenario.name nothing validates.
export function projectionSeriesName(result: ForecastingResult | null): string {
	const name: unknown = result?.scenario?.name
	const trimmed = typeof name === 'string' ? name.trim() : ''
	return trimmed ? trimmed : SCENARIO_FALLBACK_NAME
}

export type ProjectionChartChrome = {
	yAxisWidth: number
	tickFontSize: number
	marginLeft: number
	marginRight: number
}

// Upper bounds on one tick character's width, measured under the CI font (DejaVu).
const TICK_CHAR_PX = { narrow: 6.5, wide: 7.8 }
// Recharts draws a tick label after a 6 px tick line and a 2 px gap.
const TICK_LINE_AND_GAP = 8

// A label of width w fits iff yAxisWidth + marginLeft - 8 >= w; longer currency symbols widen the gutter.
export function getProjectionChartChrome(
	isNarrow: boolean,
	widestLabelChars = 0
): ProjectionChartChrome {
	const base = isNarrow
		? { yAxisWidth: 58, tickFontSize: 10, marginLeft: 0, marginRight: 12 }
		: { yAxisWidth: 72, tickFontSize: 12, marginLeft: 8, marginRight: 30 }
	const needed =
		Math.ceil(widestLabelChars * (isNarrow ? TICK_CHAR_PX.narrow : TICK_CHAR_PX.wide)) +
		TICK_LINE_AND_GAP -
		base.marginLeft
	return { ...base, yAxisWidth: Math.max(base.yAxisWidth, needed) }
}

const Y_DOMAIN_PADDING = 100_000
// The tick range spans at least this share of the largest value, so a flat series needs few decimals.
const Y_MIN_SPAN_RATIO = 0.05

// The domain is exactly the tick range, so every tick is drawn and every value is inside it.
export function projectionYAxis(values: number[]): {
	ticks: number[]
	domain: [number, number]
	step: number
} {
	const finite = values.filter((v) => Number.isFinite(v))
	let min = (finite.length > 0 ? Math.min(...finite) : 0) - Y_DOMAIN_PADDING
	let max = (finite.length > 0 ? Math.max(...finite) : 0) + Y_DOMAIN_PADDING
	const minSpan = Math.max(Math.abs(min), Math.abs(max)) * Y_MIN_SPAN_RATIO
	if (max - min < minSpan) {
		const mid = (min + max) / 2
		min = mid - minSpan / 2
		max = mid + minSpan / 2
	}
	const ticks = niceAxisTicks(min, max, 5)
	const first = ticks[0] ?? 0
	const last = ticks.at(-1) ?? first
	const step = ticks.length > 1 ? (ticks[1] as number) - first : Y_DOMAIN_PADDING
	return { ticks, domain: [first, last], step }
}

/** Decimals a label needs in `unit` so ticks `stepUnits` apart print distinct. */
function decimalsFor(stepUnits: number, unit: number, min: number): number {
	if (!(stepUnits > 0)) return min
	const needed = Math.ceil(-Math.log10(stepUnits / unit) - 1e-9)
	return Math.min(3, Math.max(min, needed))
}

// Prints as many decimals as the step needs: one fixed decimal shows $10K steps near $1.2M as "$1.2M" thrice.
export function formatProjectionAxisTick(
	cents: number,
	stepCents: number,
	mode: CurrencyMode,
	currency: CurrencyCode
): string {
	const value = Number.isFinite(cents) ? cents / 100 : 0
	const step = Number.isFinite(stepCents) ? Math.abs(stepCents) / 100 : 0
	const kDecimals = decimalsFor(step, 1_000, 0)
	let compact: string
	// A K value that ROUNDS to 1,000K rolls over to the M band.
	if (
		Math.abs(value) >= 1_000_000 ||
		Math.abs(Number((value / 1_000).toFixed(kDecimals))) >= 1_000
	) {
		compact = `${(value / 1_000_000).toFixed(decimalsFor(step, 1_000_000, 1))}M`
	} else if (Math.abs(value) >= 1_000) {
		compact = `${(value / 1_000).toFixed(kDecimals)}K`
	} else {
		compact = value === 0 ? '0' : value.toFixed(decimalsFor(step, 1, 0))
	}
	return mode === 'symbol' && currency !== 'NONE'
		? `${currencySymbol(currency)}${compact}`
		: compact
}

function formatYear(year: number): string {
	return `Year ${year}`
}

function convertToChartData(result: ForecastingResult | null): ChartDataPoint[] {
	if (!result) return []

	const data: ChartDataPoint[] = []
	const maxLength = Math.max(result.baseline.length, result.projection.length)

	for (let i = 0; i < maxLength; i++) {
		const year = i + 1
		const baseline = result.baseline[i]
		const projection = result.projection[i]

		data.push({
			year,
			baselineNetWorth: baseline?.netWorth || 0,
			scenarioNetWorth: projection?.netWorth || 0,
			baselineIncome: baseline?.income || 0,
			scenarioIncome: projection?.income || 0,
		})
	}

	return data
}

type CustomTooltipProps = {
	active?: boolean
	payload?: Array<{
		name: string
		value: number
		dataKey: string
		color?: string
	}>
	label?: string
}

// The box has a max width and rows wrap, so a long scenario name never widens the tooltip.
export function CustomTooltip({
	active,
	payload,
	label,
}: CustomTooltipProps): React.ReactElement | null {
	const formatCurrency = useFormattedAmount()
	// The default gray-700 would be near-invisible on the dark tooltip surface.
	const chartColors = useChartColors()
	if (!active || !payload?.length) return null

	return (
		<div className="max-w-[16rem] whitespace-normal bg-white dark:bg-gray-800 dark:text-gray-100 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3">
			<p className="text-muted text-sm">{formatYear(Number(label))}</p>
			<div className="mt-2 space-y-1">
				{payload.map((entry) => (
					<p
						key={entry.dataKey}
						className="text-sm break-words"
						style={{ color: entry.color || chartColors.tooltipText }}
					>
						<span
							className="inline-block w-2 h-2 rounded-full mr-2"
							style={{ backgroundColor: entry.color || chartColors.tooltipText }}
						/>
						{entry.name}: {formatCurrency(entry.value)}
					</p>
				))}
			</div>
		</div>
	)
}

export type ProjectionChartProps = {
	result: ForecastingResult | null
}

export function ProjectionChart({ result }: ProjectionChartProps): React.ReactElement {
	const formatCurrency = useFormattedAmount()
	const { mode, currency } = useCurrencyPreferences()
	const chartColors = useChartColors()
	const isNarrow = useIsNarrowViewport()
	const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG)

	const chartData = convertToChartData(result)
	const vsToday = result ? vsTodayCents(result) : null
	const scenarioName = projectionSeriesName(result)
	const yAxis = projectionYAxis(
		chartData.flatMap((point) => [point.baselineNetWorth, point.scenarioNetWorth])
	)
	const formatYTick = (value: number) => formatProjectionAxisTick(value, yAxis.step, mode, currency)
	const chrome = getProjectionChartChrome(
		isNarrow,
		Math.max(0, ...yAxis.ticks.map((tick) => formatYTick(tick).length))
	)

	const chartHeight = 400

	const toggleOption = (option: keyof ChartConfig) => {
		setConfig((prev) => ({ ...prev, [option]: !prev[option] }))
	}

	return (
		<ErrorBoundary fallback={<div className="p-4 text-red-600">Chart error occurred</div>}>
			<div className="space-y-6">
				<div className="mb-4">
					<h2 className="text-2xl font-bold text-subheading">Forecast Projections</h2>
					{/* No Y-axis title (a rotated one overlapped the ticks); this subtitle names the measure. */}
					<p className="text-muted mt-1 break-words">
						Net worth by year: Baseline vs. {scenarioName}
					</p>
				</div>

				<div className="flex flex-wrap gap-2 mb-4">
					<button
						type="button"
						aria-pressed={config.showGrid}
						onClick={() => toggleOption('showGrid')}
						className={`px-3 py-1 text-sm rounded-md ${CHART_TOGGLE_FOCUS_CLASS} ${
							config.showGrid
								? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
								: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
						}`}
					>
						Grid
					</button>
					<button
						type="button"
						aria-pressed={config.showLegend}
						onClick={() => toggleOption('showLegend')}
						className={`px-3 py-1 text-sm rounded-md ${CHART_TOGGLE_FOCUS_CLASS} ${
							config.showLegend
								? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
								: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
						}`}
					>
						Legend
					</button>
					<button
						type="button"
						aria-pressed={config.showTooltip}
						onClick={() => toggleOption('showTooltip')}
						className={`px-3 py-1 text-sm rounded-md ${CHART_TOGGLE_FOCUS_CLASS} ${
							config.showTooltip
								? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
								: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
						}`}
					>
						Tooltips
					</button>
				</div>

				<div className="surface rounded-xl shadow-lg border border-default p-4">
					{chartData.length === 0 ? (
						<div className="flex items-center justify-center h-[400px] text-muted text-center px-4">
							Build a scenario in the Scenario Builder to see its projection here.
						</div>
					) : (
						<ResponsiveContainer width="100%" height={chartHeight}>
							<LineChart
								data={chartData}
								margin={{
									top: 20,
									right: chrome.marginRight,
									left: chrome.marginLeft,
									bottom: 20,
								}}
							>
								{config.showGrid && (
									<CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
								)}

								<XAxis
									dataKey="year"
									tickFormatter={formatYear}
									label={{
										value: 'Time (Years)',
										position: 'insideBottom',
										offset: -5,
										fill: chartColors.axis,
									}}
									tick={{ fontSize: 12, fill: chartColors.axis }}
									stroke={chartColors.axis}
								/>

								<YAxis
									tickFormatter={formatYTick}
									ticks={yAxis.ticks}
									tick={{ fontSize: chrome.tickFontSize, fill: chartColors.axis }}
									stroke={chartColors.axis}
									domain={yAxis.domain}
									width={chrome.yAxisWidth}
								/>

								{config.showTooltip && <Tooltip content={<CustomTooltip />} />}

								{config.showLegend && (
									// No fixed height: Recharts offsets the plot by the measured legend height, so a fixed one let
									// a two-row legend cover the top tick.
									<Legend
										verticalAlign="top"
										wrapperStyle={{ paddingBottom: 20 }}
										formatter={(value: string) => (
											<span
												className="inline-block max-w-[5rem] sm:max-w-[16rem] truncate align-bottom"
												title={value}
											>
												{value}
											</span>
										)}
									/>
								)}

								<Line
									type="monotone"
									dataKey="baselineNetWorth"
									name="Baseline"
									stroke={CHART_COLORS.baseline}
									strokeWidth={2}
									dot={{ r: 4 }}
									activeDot={{ r: 6 }}
									isAnimationActive={config.animate}
								/>

								<Line
									type="monotone"
									dataKey="scenarioNetWorth"
									name={scenarioName}
									stroke={CHART_COLORS.scenario}
									strokeWidth={2}
									dot={{ r: 4 }}
									activeDot={{ r: 6 }}
									isAnimationActive={config.animate}
								/>

								{/* From summary.startingNetWorth, never the first row: rows are closing balances. */}
								<ReferenceLine
									y={result?.summary.startingNetWorth}
									// insideBottomRight sits above the line: a horizontal line's label box has zero height, so
									// insideTopRight would land below it, in the X tick labels.
									label={{
										value: 'Starting',
										position: 'insideBottomRight',
										fill: chartColors.axis,
										fontSize: 10,
									}}
									stroke="#9ca3af"
									strokeDasharray="3 3"
								/>
							</LineChart>
						</ResponsiveContainer>
					)}
				</div>

				{/* Gated on chartData so an empty-arrays result can't show cards beside the empty state. */}
				{result && chartData.length > 0 && (
					<dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
						<SummaryCard
							label="Starting Net Worth"
							value={formatCurrency(result.summary.startingNetWorth)}
							change={0}
						/>
						<SummaryCard
							label="Ending Net Worth"
							value={formatCurrency(result.summary.endingNetWorth)}
							change={result.summary.totalGrowth}
							positive={result.summary.totalGrowth >= 0}
						/>
						<SummaryCard
							label="Total Growth"
							value={formatCurrency(result.summary.totalGrowth)}
							change={0}
							positive={result.summary.totalGrowth >= 0}
						/>
						<SummaryCard
							label="Avg Annual Growth"
							value={formatCurrency(Math.round(result.summary.averageAnnualGrowth))}
							change={0}
							positive={result.summary.averageAnnualGrowth >= 0}
						/>
						{vsToday !== null && (
							<SummaryCard
								label="vs. today"
								value={signedAmount(vsToday, formatCurrency)}
								change={0}
								positive={vsToday >= 0}
							/>
						)}
					</dl>
				)}
			</div>
		</ErrorBoundary>
	)
}

// GroupedAmount: large amounts overflow these narrow cards, so they may break only after a group separator.
type SummaryCardProps = {
	label: string
	value: string
	change: number
	positive?: boolean
}

function SummaryCard({ label, value, change }: SummaryCardProps): React.ReactElement {
	const formatCurrency = useFormattedAmount()
	const changeFormatted = formatCurrency(change)
	const isPositive = change >= 0

	return (
		// A <dl> group may hold only <dt> and <dd>, so the change line is a block span inside the <dd>.
		<div className="surface-inset rounded-lg p-4">
			<dt className="text-sm font-medium text-muted">{label}</dt>
			<dd className="mt-1 text-lg font-semibold text-subheading">
				<GroupedAmount text={value} />
				{change !== 0 && (
					<span
						className={`mt-1 block text-xs font-medium ${
							isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
						}`}
					>
						{isPositive ? '+' : ''}
						{changeFormatted}
					</span>
				)}
			</dd>
		</div>
	)
}
