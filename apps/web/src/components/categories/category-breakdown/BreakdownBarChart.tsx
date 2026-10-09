import type { CategoryBreakdownRow } from '@budget-planner/core/finance/categoryBreakdown'
import type { ReactElement } from 'react'
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
import { useIsNarrowViewport } from '../../../hooks/useIsNarrowViewport'
import { barDomainTicks, categoryChartHeight, formatCompactAxisTick } from '../../../lib/chart-axis'
import { useChartColors } from '../../../lib/chartTheme'
import { useCurrencyPreferences, useFormattedAmount } from '../../../stores/currencyStore'
import { ErrorBoundary } from '../../ErrorBoundary'
import { rowKey } from './breakdown-rows'

type BreakdownBarChartProps = {
	rows: CategoryBreakdownRow[]
	colors: Record<string, string>
	testId: string
}

// The axis domain comes from this side only, or large income would crush every expense bar.
export function BreakdownBarChart({ rows, colors, testId }: BreakdownBarChartProps): ReactElement {
	const isNarrow = useIsNarrowViewport()
	const chartColors = useChartColors()
	const formatAmount = useFormattedAmount()
	const { mode, currency } = useCurrencyPreferences()
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
