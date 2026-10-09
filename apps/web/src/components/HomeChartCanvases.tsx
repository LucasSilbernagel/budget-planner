import type { RechartsDataItem } from '@budget-planner/core/finance/visualization'
import { CATEGORY_COLORS } from '@budget-planner/core/finance/visualization'
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
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { formatCompactAxisTick } from '../lib/chart-axis'
import { useChartColors } from '../lib/chartTheme'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'

// Lazy-loaded by HomePage to keep Recharts off the critical path: export chart components only. Safe only because
// HomePage renders these inside its `hydrated` gate; the caller owns the height so the Suspense fallback can be null.

type CategoryBarDatum = { category: string; amount: number; fill: string }

type CategoryBarCanvasProps = {
	data: CategoryBarDatum[]
	ticks: number[]
}

export function CategoryBarCanvas({ data, ticks }: CategoryBarCanvasProps): React.ReactElement {
	const isNarrow = useIsNarrowViewport()
	const chartColors = useChartColors()
	const formatAmount = useFormattedAmount()
	const { mode, currency } = useCurrencyPreferences()
	// niceAxisTicks never returns [], but the type allows undefined; undefined falls back to Recharts' auto domain.
	const first = ticks[0]
	const last = ticks.at(-1)
	const domain: [number, number] | undefined =
		first !== undefined && last !== undefined ? [first, last] : undefined

	return (
		<ResponsiveContainer width="100%" height="100%">
			<BarChart data={data} layout="vertical">
				<CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
				<XAxis
					type="number"
					domain={domain}
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

type BreakdownPieCanvasProps = {
	data: RechartsDataItem[]
	total: number
}

// No accessible name on purpose: HomePage hides the plot, and the list below it reads every slice.
export function BreakdownPieCanvas({ data, total }: BreakdownPieCanvasProps): React.ReactElement {
	const isNarrow = useIsNarrowViewport()
	const formatAmount = useFormattedAmount()
	return (
		<ResponsiveContainer width="100%" height="100%">
			<PieChart>
				<Pie
					// Recharts' pie defaults to tabIndex 0; inside an aria-hidden wrapper that is an invisible tab stop.
					rootTabIndex={-1}
					data={data}
					cx="50%"
					cy="50%"
					labelLine={false}
					innerRadius={isNarrow ? 42 : 55}
					outerRadius={isNarrow ? 70 : 85}
					fill="#8884d8"
					dataKey="value"
					nameKey="name"
					// No in-plot labels: the list names every slice. `labelLine` is inert without `label`; kept false so
					// restoring `label` does not also restore leader lines.
					label={false}
				>
					{data.map((entry, index) => (
						<Cell
							key={`${entry.type}-${entry.name}`}
							fill={entry.fill || CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
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
