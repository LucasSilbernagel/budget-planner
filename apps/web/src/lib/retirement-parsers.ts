/**
 * Strict calculation-path parsers: they reject malformed money, unlike core's non-throwing display parser.
 * Guards run before stripping anything that could change magnitude, so "1e5" or "12x34" is rejected.
 */

import { decimalCommaToPoint } from './percent-text'

const FALLBACK_GROUP_SEPARATOR = ','
const FALLBACK_DECIMAL_SEPARATOR = '.'

const SCIENTIFIC_NOTATION = /^\d+(\.\d+)?[eE][+-]?\d+$/

/** Must run before any '.'-as-decimal assumption, or de-DE "1.234,56" misparses. */
function canonicalizeSeparators(value: string, locale?: string): string {
	let groupSeparator = FALLBACK_GROUP_SEPARATOR
	let decimalSeparator = FALLBACK_DECIMAL_SEPARATOR

	if (locale) {
		try {
			const parts = new Intl.NumberFormat(locale).formatToParts(11111.1)
			groupSeparator = parts.find((p) => p.type === 'group')?.value ?? FALLBACK_GROUP_SEPARATOR
			decimalSeparator =
				parts.find((p) => p.type === 'decimal')?.value ?? FALLBACK_DECIMAL_SEPARATOR
		} catch {}
	}

	const withoutGrouping = value.split(groupSeparator).join('')
	return decimalSeparator === '.'
		? withoutGrouping
		: withoutGrouping.split(decimalSeparator).join('.')
}

function stripNonMagnitudeCharacters(value: string): string {
	return value.replace(/[\s\p{Sc}]/gu, '')
}

/** An empty string parses to 0; the caller decides whether that means "not provided". */
export function parseCurrencyToCents(value: string, locale?: string): number {
	if (value == null) {
		throw new Error('Invalid currency: value cannot be null or undefined')
	}

	if (value.trim() === '') {
		return 0
	}

	const canonical = canonicalizeSeparators(value.trim(), locale)

	if (canonical.startsWith('-')) {
		throw new Error('Currency amount cannot be negative')
	}

	const candidate = stripNonMagnitudeCharacters(canonical)

	if ((candidate.match(/\./g) || []).length > 1) {
		throw new Error('Invalid currency: multiple decimal points not allowed')
	}

	if (SCIENTIFIC_NOTATION.test(candidate)) {
		throw new Error('Invalid currency: scientific notation not allowed')
	}

	if (!/^\d+(\.\d+)?$/.test(candidate)) {
		throw new Error('Invalid currency: contains non-numeric characters')
	}

	const amount = Number.parseFloat(candidate)

	if (Number.isNaN(amount) || !Number.isFinite(amount)) {
		throw new Error('Invalid currency: must be a valid finite number')
	}

	const cents = Math.round(amount * 100)

	if (!Number.isSafeInteger(cents)) {
		throw new Error('Invalid currency: value exceeds safe integer limit')
	}

	return cents
}

/** A single decimal comma reads as a point, converted before the checks so ambiguous forms keep a comma and fail. */
export function parsePercentageToDecimal(value: string): number {
	if (value == null) {
		throw new Error('Invalid percentage: value cannot be null or undefined')
	}

	if (value.trim() === '') {
		return 0
	}

	const trimmed = decimalCommaToPoint(value.trim())

	if ((trimmed.match(/\./g) || []).length > 1) {
		throw new Error('Invalid percentage: multiple decimal points not allowed')
	}

	if (trimmed.startsWith('-')) {
		throw new Error('Percentage cannot be negative')
	}

	const cleaned = trimmed.replace(/%/g, '').trim()

	if (SCIENTIFIC_NOTATION.test(cleaned)) {
		throw new Error('Invalid percentage: scientific notation not allowed')
	}

	if (!/^\d+(\.\d+)?$/.test(cleaned)) {
		throw new Error('Invalid percentage: contains non-numeric characters')
	}

	const num = Number.parseFloat(cleaned)

	if (Number.isNaN(num) || !Number.isFinite(num)) {
		throw new Error('Invalid percentage: must be a valid finite number')
	}

	return num / 100
}

export function parseAge(value: string): number | null {
	if (value == null || value.trim() === '') {
		return null
	}

	const trimmed = value.trim()

	if (!/^\d+$/.test(trimmed)) {
		throw new Error('Age must be a whole number')
	}

	const num = Number.parseInt(trimmed, 10)

	if (!Number.isFinite(num)) {
		throw new Error('Age must be a finite number')
	}

	return num
}
