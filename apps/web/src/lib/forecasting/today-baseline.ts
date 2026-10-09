/** A saved forecast's stored baseline is never shown; it is recomputed from today's data. */

import {
	calculateFinancialForecast,
	type ForecastInputData,
	type ForecastingResult,
	type ForecastingScenario,
	isValidForecastYears,
	type YearlyForecast,
} from '@budget-planner/core/finance/forecasting'

const FLAT: ForecastingScenario = {
	name: 'Today',
	incomeGrowthRate: 0,
	expenseGrowthRate: 0,
	oneTimeEvents: [],
}

export function todayBaseline(
	data: ForecastInputData | null,
	years: number
): YearlyForecast[] | null {
	if (!data || !isValidForecastYears(years)) return null
	try {
		return calculateFinancialForecast(data, FLAT, years).baseline
	} catch {
		return null
	}
}

export function withTodayBaseline(
	result: ForecastingResult,
	data: ForecastInputData | null
): ForecastingResult | null {
	const baseline = todayBaseline(data, result.projection.length)
	return baseline ? { ...result, baseline } : null
}

export function vsTodayCents(result: ForecastingResult): number | null {
	const baselineEnd = result.baseline.at(-1)
	return baselineEnd ? result.summary.endingNetWorth - baselineEnd.netWorth : null
}

/** No `+` below 0: `formatCurrency` emits its own `-`. */
export function signedAmount(cents: number, formatCurrency: (cents: number) => string): string {
	return `${cents >= 0 ? '+' : ''}${formatCurrency(cents)}`
}
