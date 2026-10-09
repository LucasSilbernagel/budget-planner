import { useCurrencyPreferences } from '../../stores/currencyStore'
import { formatChartCurrency, type RetirementChartPoint } from './chart-helpers'

// Exported because jsdom renders no Recharts SVG. `label` is the X axis dataKey (age).
export function CustomTooltip({
	active,
	payload,
	label,
}: {
	active?: boolean
	payload?: Array<{ payload: unknown }>
	label?: string
}) {
	const { mode, currency, locale } = useCurrencyPreferences()
	const firstEntry = payload?.[0]
	if (!active || !firstEntry) {
		return null
	}

	const data = firstEntry.payload as RetirementChartPoint

	if (
		!('startingBalance' in data) ||
		!('annualContribution' in data) ||
		!('endingBalance' in data)
	) {
		return (
			<div className="bg-white dark:bg-gray-800 dark:text-gray-100 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
				<p className="font-semibold text-subheading">Age {label}</p>
				<p className="text-sm text-muted">Data unavailable</p>
			</div>
		)
	}

	return (
		<div className="bg-white dark:bg-gray-800 dark:text-gray-100 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
			<p className="font-semibold text-subheading">Age {label}</p>
			<p className="text-sm text-body">
				Starting Balance: {formatChartCurrency(data.startingBalance, mode, currency, locale)}
			</p>
			<p className="text-sm text-body">
				Annual Contribution: {formatChartCurrency(data.annualContribution, mode, currency, locale)}
			</p>
			<p className="text-sm text-body">
				Ending Balance: {formatChartCurrency(data.endingBalance, mode, currency, locale)}
			</p>
			{data.retirementYear && (
				<p className="text-sm text-green-600 dark:text-green-400 mt-2 font-medium">
					✓ Retirement Year
				</p>
			)}
		</div>
	)
}
