/**
 * Currency → locale mapping tests (story 8-1, FR25).
 *
 * The selected currency alone drives the formatting locale. Each supported
 * currency maps to its canonical regional BCP-47 locale, and any unmapped code
 * falls back to DEFAULT_LOCALE. Also asserts the mapped locales actually produce
 * the expected region-default `formatCurrency` output (the whole point of 8-1).
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, localeForCurrency } from '../currency-locale.js'
import { formatCurrency, getSupportedCurrencies } from '../currency.js'

describe('localeForCurrency (story 8-1)', () => {
  it('DEFAULT_LOCALE is en-US', () => {
    expect(DEFAULT_LOCALE).toBe('en-US')
  })

  describe('maps every supported currency to its regional locale', () => {
    const cases: readonly [string, string][] = [
      ['USD', 'en-US'],
      ['EUR', 'de-DE'], // Decision D1: largest eurozone economy
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
    // Every currency the UI can select (all of getSupportedCurrencies except the
    // NONE sentinel) must have a dedicated regional locale — not the DEFAULT_LOCALE
    // fallback — so adding a currency to core without a map entry fails loudly here.
    // (USD legitimately maps to en-US === DEFAULT_LOCALE, so exclude it from the
    // "must differ from fallback" check and assert its presence separately.)
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
    // Codes valid elsewhere (server enum) but absent from the client map, plus
    // the currency-less sentinel and outright garbage.
    expect(localeForCurrency('SEK')).toBe(DEFAULT_LOCALE)
    expect(localeForCurrency('NZD')).toBe(DEFAULT_LOCALE)
    expect(localeForCurrency('NONE')).toBe(DEFAULT_LOCALE)
    expect(localeForCurrency('XYZ')).toBe(DEFAULT_LOCALE)
  })

  describe('drives region-default formatting via formatCurrency (AC-1)', () => {
    // de-DE uses U+00A0 before the symbol; ja-JP/others use various Unicode
    // spaces. \s matches them all — normalize to a plain space for assertions.
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
