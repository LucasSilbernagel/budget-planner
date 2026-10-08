import {
	type CurrencyCode,
	type CurrencyMode,
	currencySymbol,
} from '@budget-planner/core/format/currency'

/** Abbreviates here because core's `abbreviate` is a no-op in currency-less mode. Takes units, not cents. */
export function formatCompactAxisTick(
	value: number,
	mode: CurrencyMode,
	currency: CurrencyCode
): string {
	const safe = Number.isFinite(value) ? value : 0
	const abs = Math.abs(safe)
	let compact: string
	if (abs >= 1_000_000) {
		compact = `${(safe / 1_000_000).toFixed(1)}M`
	} else if (abs >= 1_000) {
		// Round in the K band first so 999,600 rolls over to "1.0M", not "1000K".
		const thousands = safe / 1_000
		compact =
			Math.abs(Math.round(thousands)) >= 1_000
				? `${(safe / 1_000_000).toFixed(1)}M`
				: `${thousands.toFixed(0)}K`
	} else {
		compact = `${Math.round(safe)}`
	}
	// A persisted `{mode:'symbol', currency:'NONE'}` is reachable; don't prefix "NONE" onto ticks.
	return mode === 'symbol' && currency !== 'NONE'
		? `${currencySymbol(currency)}${compact}`
		: compact
}

export function niceAxisTicks(min: number, max: number, targetCount = 5): number[] {
	if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
		return [Math.round(min) || 0]
	}
	const rawStep = (max - min) / Math.max(1, targetCount)
	const magnitude = 10 ** Math.floor(Math.log10(rawStep))
	const normalized = rawStep / magnitude
	const niceUnit = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10
	const step = niceUnit * magnitude
	const start = Math.floor(min / step) * step
	const end = Math.ceil(max / step) * step
	const ticks: number[] = []
	// Round to the step's precision: cleans float error without collapsing sub-unit steps into duplicates.
	const decimals = step >= 1 ? 0 : Math.ceil(-Math.log10(step))
	for (let tick = start; tick <= end + step / 2 && ticks.length <= 100; tick += step) {
		ticks.push(Number(tick.toFixed(decimals)))
	}
	return ticks
}

export function barDomainTicks(amounts: number[]): number[] {
	return niceAxisTicks(Math.min(0, ...amounts), Math.max(0, ...amounts))
}

export function categoryChartHeight(barCount: number): number {
	const CHROME_PX = 72
	const PER_BAR_PX = 64
	return Math.max(barCount, 1) * PER_BAR_PX + CHROME_PX
}
