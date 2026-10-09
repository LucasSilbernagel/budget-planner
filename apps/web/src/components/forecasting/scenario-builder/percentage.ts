import { decimalCommaToPoint } from '../../../lib/percent-text'

export function formatPercentage(value: string | number): string {
	return `${(Number(value) * 100).toFixed(2)}%`
}

// A plain decimal, optionally signed, optionally ending in %.
const PERCENT_TEXT = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*%?\s*$/

// parseFloat alone reads a prefix (5abc -> 5, 2,5 -> 2, 1e2 -> 100), so the whole text must match.
// A single decimal comma converts to a point first.
export function parsePercentText(raw: string): number {
	const text = decimalCommaToPoint(raw)
	return PERCENT_TEXT.test(text) ? Number.parseFloat(text) / 100 : Number.NaN
}
