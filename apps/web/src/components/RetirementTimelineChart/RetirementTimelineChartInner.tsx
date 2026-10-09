import { projectAccumulatedNestEgg } from '@budget-planner/core/finance/retirement'
import { useMemo } from 'react'
import {
	CartesianGrid,
	Line,
	LineChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import { useIsNarrowViewport } from '../../hooks/useIsNarrowViewport'
import { formatCompactAxisTick } from '../../lib/chart-axis'
import { useChartColors } from '../../lib/chartTheme'
import { useCurrencyPreferences } from '../../stores/currencyStore'
import { CustomTooltip } from './CustomTooltip'
import {
	formatChartCurrency,
	getRetirementChartChrome,
	getRetirementMarkerAge,
	getRetirementMarkerOffset,
	type RetirementChartPoint,
	type RetirementTimelineChartProps,
} from './chart-helpers'

export function RetirementTimelineChartInner({
	currentSavedCents,
	monthlySavingsCents,
	annualReturnRate,
	currentAge,
	yearsToProject,
	earliestRetirementAge,
}: RetirementTimelineChartProps) {
	const { mode, currency, locale } = useCurrencyPreferences()
	const chartColors = useChartColors()
	const isNarrow = useIsNarrowViewport()
	const chartChrome = getRetirementChartChrome(isNarrow)

	// Returns a result instead of calling setState inside the memo (a render-phase setState).
	const projection = useMemo<
		{ ok: true; points: RetirementChartPoint[] } | { ok: false; message: string }
	>(() => {
		if (yearsToProject <= 0) {
			return { ok: true, points: [] }
		}

		try {
			const annualContribution = Math.max(0, monthlySavingsCents) * 12
			const points: RetirementChartPoint[] = []

			// Starts at year 0 so an immediately-reachable retirement (offset 0) has a category for its marker.
			for (let year = 0; year <= yearsToProject; year++) {
				const age = currentAge + year
				points.push({
					year,
					age,
					startingBalance: projectAccumulatedNestEgg(
						currentSavedCents,
						monthlySavingsCents,
						annualReturnRate,
						Math.max(0, year - 1) * 12
					),
					annualContribution: year === 0 ? 0 : annualContribution,
					endingBalance: projectAccumulatedNestEgg(
						currentSavedCents,
						monthlySavingsCents,
						annualReturnRate,
						year * 12
					),
					retirementYear:
						earliestRetirementAge !== null && Math.round(earliestRetirementAge) === age,
				})
			}

			return { ok: true, points }
		} catch (e) {
			return {
				ok: false,
				message:
					e instanceof Error
						? 'These numbers grow too large to chart. Try a smaller amount or a shorter horizon.'
						: 'Failed to calculate projection',
			}
		}
	}, [
		currentSavedCents,
		monthlySavingsCents,
		annualReturnRate,
		currentAge,
		yearsToProject,
		earliestRetirementAge,
	])

	if (!projection.ok || projection.points.length === 0) {
		return (
			<div className="p-8 text-center text-muted" data-testid="retirement-chart-empty">
				<p>
					{projection.ok
						? 'No projection to display yet — check your age and life expectancy.'
						: projection.message}
				</p>
			</div>
		)
	}

	const chartData = projection.points
	const finalPoint = chartData.at(-1)
	const retirementYearOffset = getRetirementMarkerOffset(
		earliestRetirementAge,
		currentAge,
		finalPoint?.year ?? 0
	)
	// The axis plots ages, so the marker is placed by age; the summary below reasons in offsets.
	const retirementMarkerAge = getRetirementMarkerAge(retirementYearOffset, currentAge)

	return (
		<div className="space-y-6">
			<div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
				<ResponsiveContainer width="100%" height={chartChrome.height}>
					{/* Extra right margin so the 'Retirement' label at the final year is not clipped. */}
					<LineChart
						data={chartData}
						margin={{
							top: 20,
							right: chartChrome.marginRight,
							left: chartChrome.marginLeft,
							bottom: 20,
						}}
					>
						<CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
						{/* The tooltip header and reference line read their meaning from this dataKey; change all three together. */}
						<XAxis
							dataKey="age"
							label={
								chartChrome.showAxisLabels
									? {
											value: 'Age',
											position: 'insideBottom',
											offset: -5,
											fill: chartColors.axis,
										}
									: undefined
							}
							tick={{ fontSize: chartChrome.tickFontSize, fill: chartColors.axis }}
							stroke={chartColors.axis}
						/>
						<YAxis
							dataKey="endingBalance"
							label={
								chartChrome.showAxisLabels
									? {
											value: 'Assets',
											angle: -90,
											position: 'insideLeft',
											offset: 10,
											fill: chartColors.axis,
										}
									: undefined
							}
							// `formatCompactAxisTick` takes whole currency UNITS, so a
							// cents-space series divides at the boundary (per its contract).
							tickFormatter={(value) => formatCompactAxisTick(value / 100, mode, currency)}
							tick={{ fontSize: chartChrome.tickFontSize, fill: chartColors.axis }}
							stroke={chartColors.axis}
							domain={[0, 'auto']}
							width={chartChrome.yAxisWidth}
						/>
						<Tooltip content={<CustomTooltip />} />
						<Line
							type="monotone"
							dataKey="endingBalance"
							name="Retirement Assets"
							stroke="#3B82F6"
							strokeWidth={3}
							dot={{ r: 4, fill: '#3B82F6' }}
							activeDot={{ r: 8, fill: '#1D4ED8' }}
						/>
						{/* At the solver's earliest reachable retirement, never a separately-entered age. */}
						{retirementMarkerAge !== null && (
							<ReferenceLine
								x={retirementMarkerAge}
								stroke="#10B981"
								strokeDasharray="5 5"
								label={{ value: 'Retirement', position: 'top', fill: '#10B981' }}
							/>
						)}
					</LineChart>
				</ResponsiveContainer>
			</div>

			<div className="p-4 surface-inset rounded-lg">
				<p className="text-sm text-body">
					<strong>Projection Summary:</strong> Starting with{' '}
					{formatChartCurrency(Math.max(0, currentSavedCents), mode, currency, locale)} at age{' '}
					{currentAge}, with a {(annualReturnRate * 100).toFixed(1)}% return while saving and{' '}
					{formatChartCurrency(Math.max(0, monthlySavingsCents) * 12, mode, currency, locale)} saved
					each year, your assets reach{' '}
					<strong>
						{formatChartCurrency(finalPoint?.endingBalance ?? 0, mode, currency, locale)}
					</strong>{' '}
					in {finalPoint?.year ?? 0} {finalPoint?.year === 1 ? 'year' : 'years'}, at age{' '}
					{finalPoint?.age ?? currentAge}
					{/* An already-met plan retires at offset 0 but the curve is floored at one year, so its end
             is a year past retirement. */}
					{retirementYearOffset !== null && retirementYearOffset === finalPoint?.year
						? ' — when you can retire'
						: ''}
					.
				</p>
			</div>
		</div>
	)
}
