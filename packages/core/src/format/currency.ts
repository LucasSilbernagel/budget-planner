export type CurrencyMode = 'none' | 'symbol'

export type CurrencyCode = 'NONE' | 'USD' | 'EUR' | 'GBP' | string

export type CurrencyOptions = {
	mode: CurrencyMode
	currency: CurrencyCode
	locale?: string
	abbreviate?: boolean
}

export const DEFAULT_CURRENCY_OPTIONS: CurrencyOptions = {
	mode: 'none',
	currency: 'NONE',
	locale: 'en-US',
}

const CURRENCY_ABBREVIATION_THRESHOLDS = {
	BILLION: 1000000000,
	MILLION: 1000000,
	THOUSAND: 1000,
} as const

export function formatCurrency(cents: number, options: Partial<CurrencyOptions> = {}): string {
	const {
		mode = DEFAULT_CURRENCY_OPTIONS.mode,
		currency = DEFAULT_CURRENCY_OPTIONS.currency,
		locale = DEFAULT_CURRENCY_OPTIONS.locale,
		abbreviate = false,
	} = options

	const dollars = Number.isFinite(cents) ? cents / 100 : 0

	if (mode === 'none' || currency === 'NONE') {
		try {
			return new Intl.NumberFormat(locale, {
				style: 'decimal',
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(dollars)
		} catch {
			// An invalid locale must never crash a render.
			return dollars.toFixed(2)
		}
	}

	if (abbreviate) {
		const absDollars = Math.abs(dollars)
		const currencySymbolValue = currencySymbol(currency)

		if (absDollars >= CURRENCY_ABBREVIATION_THRESHOLDS.BILLION) {
			const value = dollars / CURRENCY_ABBREVIATION_THRESHOLDS.BILLION
			return `${currencySymbolValue}${value.toFixed(1)}B`
		}

		if (absDollars >= CURRENCY_ABBREVIATION_THRESHOLDS.MILLION) {
			const value = dollars / CURRENCY_ABBREVIATION_THRESHOLDS.MILLION
			return `${currencySymbolValue}${value.toFixed(1)}M`
		}

		if (absDollars >= CURRENCY_ABBREVIATION_THRESHOLDS.THOUSAND) {
			const value = dollars / CURRENCY_ABBREVIATION_THRESHOLDS.THOUSAND
			return `${currencySymbolValue}${value.toFixed(0)}K`
		}
	}

	try {
		// Let Intl apply each currency's native fraction digits (JPY → 0).
		const formatter = new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
		})
		return formatter.format(dollars)
	} catch {
		return `${currencySymbol(currency)}${dollars.toFixed(2)}`
	}
}

export function formatAmount(cents: number, decimals = 2): string {
	const dollars = cents / 100
	return dollars.toFixed(decimals)
}

export function currencySymbol(currencyCode: CurrencyCode): string {
	const symbols: Record<string, string> = {
		USD: '$',
		EUR: '€',
		GBP: '£',
		JPY: '¥',
		CAD: 'CA$',
		AUD: 'AU$',
		CHF: 'CHF',
		CNY: '¥',
		INR: '₹',
		BRL: 'R$',
		ZAR: 'R',
		MXN: 'MX$',
	}

	return symbols[currencyCode] || currencyCode
}

export function formatForInput(cents: number): string {
	if (!Number.isFinite(cents)) {
		return '0.00'
	}

	const dollars = cents / 100
	return dollars.toFixed(2)
}

export function formatForInputDisplay(cents: number, locale = 'en-US'): string {
	const dollars = Number.isFinite(cents) ? cents / 100 : 0
	try {
		return new Intl.NumberFormat(locale, {
			style: 'decimal',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(dollars)
	} catch {
		// An invalid locale must never crash a render.
		return dollars.toFixed(2)
	}
}

export function parseFromInput(value: string, locale?: string): number {
	if (!value || value.trim() === '') return 0

	// Reject exponents before stripping, or "1e10" would become "110".
	if (/\d[eE][+-]?\d/.test(value)) return 0

	// Canonicalize before stripping, or de-DE "1.234,56" would read as 123 cents.
	let normalized = value
	if (locale) {
		try {
			const parts = new Intl.NumberFormat(locale).formatToParts(11111.1)
			const groupSep = parts.find((p) => p.type === 'group')?.value
			const decimalSep = parts.find((p) => p.type === 'decimal')?.value
			if (groupSep) normalized = normalized.split(groupSep).join('')
			if (decimalSep && decimalSep !== '.') normalized = normalized.split(decimalSep).join('.')
		} catch {}
	}

	const cleaned = normalized.replace(/[^\d.-]/g, '')

	if ((cleaned.match(/\./g) || []).length > 1) return 0

	const amount = Number.parseFloat(cleaned)

	if (Number.isNaN(amount) || !Number.isFinite(amount)) return 0

	// Convert from the string to avoid IEEE 754 rounding.
	if (cleaned.includes('.')) {
		const [whole = '', decimal = ''] = cleaned.split('.')
		const paddedDecimal = decimal.padEnd(2, '0').slice(0, 2)
		return Number.parseInt(whole + paddedDecimal, 10) || 0
	}

	return Number.parseInt(`${cleaned}00`, 10) || 0
}

// Character filter that must never change magnitude: malformed input passes through so
// parseFromInput rejects it, instead of becoming a plausible wrong number.
export function sanitizeMoneyInput(value: string, locale?: string): string {
	if (!value) return value

	let groupSep = ','
	let decimalSep = '.'
	if (locale) {
		try {
			const parts = new Intl.NumberFormat(locale).formatToParts(11111.1)
			groupSep = parts.find((p) => p.type === 'group')?.value ?? groupSep
			decimalSep = parts.find((p) => p.type === 'decimal')?.value ?? decimalSep
		} catch {}
	}

	// Drop the exponent whole; stripping only 'e' would splice its digits into the mantissa.
	const exponent = value.search(/[eE][+-]?\d/)
	const trimmed = exponent === -1 ? value : value.slice(0, exponent)

	let sanitized = ''
	for (const char of trimmed) {
		if (char >= '0' && char <= '9') {
			sanitized += char
		} else if (char === decimalSep || char === groupSep) {
			sanitized += char
		} else if (char === '.') {
			// parseFromInput always treats '.' as decimal, so removing it would rescale by 100.
			sanitized += char
		} else if (char === '-' && sanitized === '') {
			sanitized += char
		}
	}

	return sanitized
}

export function isCurrencySupported(currencyCode: string): boolean {
	const supported = [
		'USD',
		'EUR',
		'GBP',
		'JPY',
		'CAD',
		'AUD',
		'CHF',
		'CNY',
		'INR',
		'BRL',
		'ZAR',
		'MXN',
		'NONE',
	]
	return supported.includes(currencyCode) || currencyCode.length === 3
}

// Codes that render identically to their representative. JPY and CNY share ¥ but
// format differently, so they stay separate.
export const CONSOLIDATED_CURRENCIES: Readonly<Record<string, string>> = {
	CAD: 'USD',
	AUD: 'USD',
	MXN: 'USD',
}

export function canonicalizeCurrency(code: CurrencyCode): CurrencyCode {
	return CONSOLIDATED_CURRENCIES[code] ?? code
}

export function getSupportedCurrencies(): CurrencyCode[] {
	return ['NONE', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CHF', 'INR', 'BRL', 'ZAR']
}

export function currencyDisplayLabel(code: CurrencyCode): string {
	const symbol = currencySymbol(code)

	if (symbol === code) return symbol

	const isAlphabeticSymbol = /^[A-Za-z]+$/.test(symbol)
	const sharesGlyph =
		getSupportedCurrencies().filter((other) => other !== 'NONE' && currencySymbol(other) === symbol)
			.length > 1

	if (sharesGlyph || isAlphabeticSymbol) {
		return `${symbol} ${code}`
	}

	return symbol
}
