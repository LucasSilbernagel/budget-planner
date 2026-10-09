import type { ForecastingResult } from '@budget-planner/core/finance/forecasting'
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
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { useIsNarrowViewport } from '../../hooks/useIsNarrowViewport'
import { useChartColors } from '../../lib/chartTheme'
import { signedAmount, vsTodayCents } from '../../lib/forecasting/today-baseline'
import { useCurrencyPreferences, useFormattedAmount } from '../../stores/currencyStore'
import { ErrorBoundary } from '../ErrorBoundary'
import {
	convertToChartData,
	formatProjectionAxisTick,
	formatYear,
	getProjectionChartChrome,
	projectionSeriesName,
	projectionYAxis,
} from './projection-chart/chart-helpers'
import { CustomTooltip } from './projection-chart/custom-tooltip'
import { SummaryCard } from './projection-chart/summary-card'

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
						className={cn(
							'px-3 py-1 text-sm rounded-md',
							CHART_TOGGLE_FOCUS_CLASS,
							config.showGrid
								? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
								: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
						)}
					>
						Grid
					</button>
					<button
						type="button"
						aria-pressed={config.showLegend}
						onClick={() => toggleOption('showLegend')}
						className={cn(
							'px-3 py-1 text-sm rounded-md',
							CHART_TOGGLE_FOCUS_CLASS,
							config.showLegend
								? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
								: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
						)}
					>
						Legend
					</button>
					<button
						type="button"
						aria-pressed={config.showTooltip}
						onClick={() => toggleOption('showTooltip')}
						className={cn(
							'px-3 py-1 text-sm rounded-md',
							CHART_TOGGLE_FOCUS_CLASS,
							config.showTooltip
								? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
								: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
						)}
					>
						Tooltips
					</button>
				</div>

				<Card className="rounded-xl shadow-lg border border-default p-4">
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
				</Card>

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
