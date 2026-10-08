import type { CurrencyCode } from './currency.js'

export const DEFAULT_LOCALE = 'en-US'

// EUR has no single regional format; de-DE is the chosen default.
const CURRENCY_LOCALE: Readonly<Record<string, string>> = {
	USD: 'en-US',
	EUR: 'de-DE',
	GBP: 'en-GB',
	JPY: 'ja-JP',
	CAD: 'en-CA',
	AUD: 'en-AU',
	CHF: 'de-CH',
	CNY: 'zh-CN',
	INR: 'en-IN',
	BRL: 'pt-BR',
	ZAR: 'en-ZA',
	MXN: 'es-MX',
}

export function localeForCurrency(currency: CurrencyCode): string {
	return CURRENCY_LOCALE[currency] ?? DEFAULT_LOCALE
}
