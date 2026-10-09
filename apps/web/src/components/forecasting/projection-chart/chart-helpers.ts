import type { ForecastingResult } from '@budget-planner/core/finance/forecasting'
import {
	type CurrencyCode,
	type CurrencyMode,
	currencySymbol,
} from '@budget-planner/core/format/currency'
import { niceAxisTicks } from '../../../lib/chart-axis'

type ChartDataPoint = {
	year: number
	baselineNetWorth: number
	scenarioNetWorth: number
	baselineIncome: number
	scenarioIncome: number
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

export function formatYear(year: number): string {
	return `Year ${year}`
}

export function convertToChartData(result: ForecastingResult | null): ChartDataPoint[] {
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
