import type React from 'react'
import { useChartColors } from '../../../lib/chartTheme'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { formatYear } from './chart-helpers'

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
