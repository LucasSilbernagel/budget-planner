import {
	type CurrencyCode,
	type CurrencyMode,
	formatCurrency,
} from '@budget-planner/core/format/currency'

// Recharts numeric props cannot be driven by CSS, so they switch at the breakpoint.
// Pure and exported because layout is not observable in jsdom.
export type RetirementChartChrome = {
	height: number
	yAxisWidth: number
	tickFontSize: number
	marginLeft: number
	marginRight: number
	showAxisLabels: boolean
}

export function getRetirementChartChrome(isNarrow: boolean): RetirementChartChrome {
	return isNarrow
		? {
				height: 300,
				yAxisWidth: 48,
				tickFontSize: 10,
				marginLeft: 4,
				// Wide enough to clear the 'Retirement' reference-line label, which clips at 320px otherwise.
				marginRight: 44,
				showAxisLabels: false,
			}
		: {
				height: 400,
				yAxisWidth: 72,
				tickFontSize: 12,
				marginLeft: 20,
				marginRight: 64,
				showAxisLabels: true,
			}
}

// Tested directly: jsdom renders no Recharts SVG. Rounded because the X axis is one category per year;
// 0 is valid (an already-met plan retires today).
export function getRetirementMarkerOffset(
	earliestRetirementAge: number | null,
	currentAge: number,
	horizonYears: number
): number | null {
	if (earliestRetirementAge === null) {
		return null
	}

	const offset = Math.round(earliestRetirementAge - currentAge)

	return offset >= 0 && offset <= horizonYears ? offset : null
}

// The X axis plots age, so ReferenceLine x must be an age, not a years-from-now offset.
export function getRetirementMarkerAge(
	markerOffset: number | null,
	currentAge: number
): number | null {
	return markerOffset === null ? null : currentAge + markerOffset
}

export type RetirementTimelineChartProps = {
	/** Current amount saved at year 0, in integer cents. */
	currentSavedCents: number
	/** Monthly contribution, in integer cents. */
	monthlySavingsCents: number
	/** Annual return as a decimal (0.06 = 6%). */
	annualReturnRate: number
	currentAge: number
	yearsToProject: number
	// null when unreachable: no marker, so the chart never claims an impossible retirement.
	earliestRetirementAge: number | null
}

/** One sampled year of the accumulation curve. All money in integer CENTS. */
export type RetirementChartPoint = {
	year: number
	age: number
	startingBalance: number
	annualContribution: number
	endingBalance: number
	retirementYear: boolean
}

// Takes cents, like every other formatCurrency caller.
export function formatChartCurrency(
	cents: number,
	mode: CurrencyMode,
	currency: CurrencyCode,
	locale: string
): string {
	return formatCurrency(cents, { mode, currency, locale, abbreviate: true })
}
