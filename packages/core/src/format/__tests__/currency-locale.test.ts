import { describe, expect, it } from 'vitest'
import { formatCurrency, getSupportedCurrencies } from '../currency.js'
import { DEFAULT_LOCALE, localeForCurrency } from '../currency-locale.js'

describe('localeForCurrency', () => {
	it('DEFAULT_LOCALE is en-US', () => {
		expect(DEFAULT_LOCALE).toBe('en-US')
	})

	describe('maps every supported currency to its regional locale', () => {
		const cases: readonly [string, string][] = [
			['USD', 'en-US'],
			['EUR', 'de-DE'], // largest eurozone economy
			['GBP', 'en-GB'],
			['JPY', 'ja-JP'],
			['CAD', 'en-CA'],
			['AUD', 'en-AU'],
			['CHF', 'de-CH'],
			['CNY', 'zh-CN'],
			['INR', 'en-IN'],
			['BRL', 'pt-BR'],
			['ZAR', 'en-ZA'],
			['MXN', 'es-MX'],
		]

		for (const [currency, locale] of cases) {
			it(`${currency} → ${locale}`, () => {
				expect(localeForCurrency(currency)).toBe(locale)
			})
		}
	})

	it('maps every selectable currency explicitly (guards against future drift)', () => {
		// USD maps to en-US === DEFAULT_LOCALE, so it's checked separately.
		const selectable = getSupportedCurrencies().filter((code) => code !== 'NONE')
		for (const code of selectable) {
			const locale = localeForCurrency(code)
			expect(locale, `no locale mapping for selectable currency ${code}`).toBeTruthy()
			if (code !== 'USD') {
				expect(locale, `${code} silently falls back to DEFAULT_LOCALE`).not.toBe(DEFAULT_LOCALE)
			}
		}
		expect(localeForCurrency('USD')).toBe(DEFAULT_LOCALE)
	})

	it('falls back to DEFAULT_LOCALE for unmapped codes', () => {
		expect(localeForCurrency('SEK')).toBe(DEFAULT_LOCALE)
		expect(localeForCurrency('NZD')).toBe(DEFAULT_LOCALE)
		expect(localeForCurrency('NONE')).toBe(DEFAULT_LOCALE)
		expect(localeForCurrency('XYZ')).toBe(DEFAULT_LOCALE)
	})

	describe('drives region-default formatting via formatCurrency', () => {
		// Intl uses various Unicode spaces (e.g. U+00A0); normalize to a plain space.
		const normalizeSpaces = (value: string) => value.replace(/\s/g, ' ')

		const format = (currency: string, cents: number) =>
			formatCurrency(cents, { mode: 'symbol', currency, locale: localeForCurrency(currency) })

		it('EUR → 1.000,00 €', () => {
			expect(normalizeSpaces(format('EUR', 100000))).toBe('1.000,00 €')
		})

		it('GBP → £1,000.00', () => {
			expect(format('GBP', 100000)).toBe('£1,000.00')
		})

		it('USD → $1,000.00', () => {
			expect(format('USD', 100000)).toBe('$1,000.00')
		})

		it('JPY → ￥1,000 (no minor unit)', () => {
			const result = normalizeSpaces(format('JPY', 100000))
			expect(result).toContain('1,000')
			expect(result).not.toContain('.')
		})
	})
})
