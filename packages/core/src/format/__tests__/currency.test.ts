/**
 * Currency Formatting Tests
 *
 * Validates the currency control system (FR9 / story 4-6):
 * - AC-1: currency-less mode is the default and renders raw numeric entries
 * - AC-2: explicit symbols mode formats via Intl.NumberFormat
 *
 * Note: AC-3 (persistence across navigation) is exercised by the Zustand
 * store in apps/web; this suite covers the pure formatting core.
 */

import { describe, expect, it } from 'vitest'
import { localeForCurrency } from '../currency-locale.js'
import {
  CONSOLIDATED_CURRENCIES,
  DEFAULT_CURRENCY_OPTIONS,
  canonicalizeCurrency,
  currencyDisplayLabel,
  currencySymbol,
  formatAmount,
  formatCurrency,
  formatForInput,
  getSupportedCurrencies,
  isCurrencySupported,
  parseFromInput,
} from '../currency.js'

describe('Currency Formatting', () => {
  describe('DEFAULT_CURRENCY_OPTIONS (AC-1: currency-less default)', () => {
    it('defaults to currency-less mode', () => {
      expect(DEFAULT_CURRENCY_OPTIONS.mode).toBe('none')
    })

    it('defaults to the NONE currency code', () => {
      expect(DEFAULT_CURRENCY_OPTIONS.currency).toBe('NONE')
    })
  })

  describe('formatCurrency - currency-less mode (AC-1)', () => {
    // Story 14-2: currency-less mode now groups via Intl.NumberFormat (decimal
    // style), so 4+ digit magnitudes carry the locale's thousands separator.
    // Sub-1000 values, zero, and negatives are unaffected by grouping.
    it('renders grouped numeric value with no symbol when mode is none', () => {
      expect(formatCurrency(123456, { mode: 'none' })).toBe('1,234.56')
    })

    it('renders raw value when currency is NONE even if mode is symbol', () => {
      expect(formatCurrency(50000, { mode: 'symbol', currency: 'NONE' })).toBe('500.00')
    })

    it('uses currency-less behaviour with no options (default)', () => {
      // No options => DEFAULT mode 'none' => grouped raw number (sub-1000, no separator)
      expect(formatCurrency(99900)).toBe('999.00')
    })

    it('formats zero as raw 0.00', () => {
      expect(formatCurrency(0, { mode: 'none' })).toBe('0.00')
    })

    it('formats negative values as raw (e.g. debts)', () => {
      expect(formatCurrency(-25050, { mode: 'none' })).toBe('-250.50')
    })

    it('guards non-finite input (NaN/Infinity) → 0.00 instead of "NaN"', () => {
      expect(formatCurrency(Number.NaN, { mode: 'none' })).toBe('0.00')
      expect(formatCurrency(Number.POSITIVE_INFINITY, { mode: 'none' })).toBe('0.00')
    })
  })

  describe('formatCurrency - currency-less grouping (story 14-2, AC-2/AC-3)', () => {
    // ICU may emit a narrow-NBSP (U+202F) or NBSP (U+00A0) group separator for
    // some locales (e.g. de-DE / fr-FR); normalize to a plain space so the
    // assertions express the human-visible result.
    const normalizeSpaces = (value: string) => value.replace(/[  ]/g, ' ')

    it('groups a large currency-less value in the default (en-US) locale', () => {
      expect(formatCurrency(123456789, { mode: 'none' })).toBe('1,234,567.89')
    })

    it('groups a currency-less value per an explicit non-en-US locale (de-DE)', () => {
      const result = formatCurrency(123456789, { mode: 'none', locale: 'de-DE' })
      expect(normalizeSpaces(result)).toBe('1.234.567,89')
    })

    it('never contains a currency symbol in currency-less mode', () => {
      const result = formatCurrency(123456789, { mode: 'none' })
      expect(result).not.toMatch(/[$€£¥]/)
    })

    it('groups a very large near-MAX_SAFE_INTEGER value with no NaN/Infinity', () => {
      // Number.MAX_SAFE_INTEGER / 100 is exactly 90071992547409.90625 as an
      // IEEE-754 double; Intl.NumberFormat renders it to 2 digits as ...409.90.
      // (`toFixed(2)` would give ...409.91 — an engine-dependent last-cent
      // divergence that only appears at ~$90T magnitudes, far beyond any real
      // budget figure.) The point of the test is that it groups cleanly with no
      // NaN/Infinity, not the trailing cent.
      const result = formatCurrency(Number.MAX_SAFE_INTEGER, { mode: 'none' })
      expect(result).not.toMatch(/NaN|Infinity|undefined/)
      expect(result).toBe('90,071,992,547,409.90')
    })

    it('renders non-finite input as the locale-grouped zero', () => {
      expect(formatCurrency(Number.NaN, { mode: 'none' })).toBe('0.00')
      expect(formatCurrency(Number.POSITIVE_INFINITY, { mode: 'none', locale: 'de-DE' })).toBe(
        '0,00'
      )
    })

    it('falls back to ungrouped toFixed(2) when the locale is invalid (never throws)', () => {
      // An exotic/invalid locale must not crash a render; the catch path returns
      // the plain fixed-decimal string. `not-a-locale!!` throws RangeError inside
      // Intl.NumberFormat, so this exercises the catch and asserts its output.
      expect(() => formatCurrency(123456, { mode: 'none', locale: 'not-a-locale!!' })).not.toThrow()
      expect(formatCurrency(123456, { mode: 'none', locale: 'not-a-locale!!' })).toBe('1234.56')
    })
  })

  describe('formatCurrency - explicit symbols mode (AC-2)', () => {
    it('formats USD with $ via Intl.NumberFormat', () => {
      expect(formatCurrency(123456, { mode: 'symbol', currency: 'USD', locale: 'en-US' })).toBe(
        '$1,234.56'
      )
    })

    it('includes the € symbol for EUR', () => {
      const result = formatCurrency(100000, { mode: 'symbol', currency: 'EUR', locale: 'en-US' })
      expect(result).toContain('€')
      expect(result).toContain('1,000.00')
    })

    it('includes the £ symbol for GBP', () => {
      const result = formatCurrency(100000, { mode: 'symbol', currency: 'GBP', locale: 'en-US' })
      expect(result).toContain('£')
    })

    it('always renders two fraction digits', () => {
      expect(formatCurrency(500, { mode: 'symbol', currency: 'USD', locale: 'en-US' })).toBe(
        '$5.00'
      )
    })

    it('uses the currency native fraction digits (JPY → 0 decimals)', () => {
      const result = formatCurrency(123456, { mode: 'symbol', currency: 'JPY', locale: 'en-US' })
      expect(result).toContain('¥')
      expect(result).toContain('1,235') // 1234.56 rounded, no minor unit
      expect(result).not.toContain('.')
    })

    it('guards non-finite input in symbol mode → "$0.00"', () => {
      expect(formatCurrency(Number.NaN, { mode: 'symbol', currency: 'USD', locale: 'en-US' })).toBe(
        '$0.00'
      )
    })

    it('abbreviates large values when requested', () => {
      expect(formatCurrency(150000000, { mode: 'symbol', currency: 'USD', abbreviate: true })).toBe(
        '$1.5M'
      )
      expect(
        formatCurrency(250000000000, { mode: 'symbol', currency: 'USD', abbreviate: true })
      ).toBe('$2.5B')
    })
  })

  describe('locale-aware formatting (story 4-7: AC-1, AC-2, AC-3)', () => {
    // de-DE uses U+00A0 (NBSP) before the symbol; fr-FR uses U+202F
    // (narrow NBSP) as the grouping separator. Normalize both to a regular
    // space so the assertions express the human-visible result.
    const normalizeSpaces = (value: string) => value.replace(/[  ]/g, ' ')

    it('AC-1: en-US formats 1000 USD as $1,000.00', () => {
      expect(formatCurrency(100000, { mode: 'symbol', currency: 'USD', locale: 'en-US' })).toBe(
        '$1,000.00'
      )
    })

    it('AC-2: de-DE formats 1000 EUR as 1.000,00 €', () => {
      const result = formatCurrency(100000, { mode: 'symbol', currency: 'EUR', locale: 'de-DE' })
      expect(normalizeSpaces(result)).toBe('1.000,00 €')
    })

    it('AC-3: fr-FR formats 1000 EUR as 1 000,00 €', () => {
      const result = formatCurrency(100000, { mode: 'symbol', currency: 'EUR', locale: 'fr-FR' })
      expect(normalizeSpaces(result)).toBe('1 000,00 €')
    })

    it('the same value renders differently per locale (locale actually drives output)', () => {
      const us = formatCurrency(100000, { mode: 'symbol', currency: 'EUR', locale: 'en-US' })
      const de = formatCurrency(100000, { mode: 'symbol', currency: 'EUR', locale: 'de-DE' })
      expect(us).not.toBe(de)
    })

    // Story 14-2: lock large-value grouping in symbols mode against regressions.
    it('groups a large USD value as $1,234,567.89', () => {
      expect(formatCurrency(123456789, { mode: 'symbol', currency: 'USD', locale: 'en-US' })).toBe(
        '$1,234,567.89'
      )
    })

    it('groups a large EUR value per de-DE as 1.234.567,89 €', () => {
      const result = formatCurrency(123456789, { mode: 'symbol', currency: 'EUR', locale: 'de-DE' })
      expect(normalizeSpaces(result)).toBe('1.234.567,89 €')
    })
  })

  describe('formatAmount', () => {
    it('renders cents as a raw decimal string', () => {
      expect(formatAmount(123456)).toBe('1234.56')
    })

    it('respects a custom decimal count', () => {
      expect(formatAmount(123456, 0)).toBe('1235')
    })
  })

  describe('formatForInput - edge cases', () => {
    it('returns 0.00 for NaN', () => {
      expect(formatForInput(Number.NaN)).toBe('0.00')
    })

    it('returns 0.00 for Infinity', () => {
      expect(formatForInput(Number.POSITIVE_INFINITY)).toBe('0.00')
    })

    it('formats a normal cents value', () => {
      expect(formatForInput(10050)).toBe('100.50')
    })
  })

  describe('parseFromInput', () => {
    it('parses whole dollars to cents', () => {
      expect(parseFromInput('100')).toBe(10000)
    })

    it('parses decimal values to cents', () => {
      expect(parseFromInput('100.50')).toBe(10050)
    })

    it('strips thousands separators', () => {
      expect(parseFromInput('1,000.50')).toBe(100050)
    })

    it('rejects scientific notation', () => {
      expect(parseFromInput('1e10')).toBe(0)
    })

    it('rejects multiple decimal points', () => {
      expect(parseFromInput('1.2.3')).toBe(0)
    })

    it('returns 0 for empty input', () => {
      expect(parseFromInput('')).toBe(0)
    })
  })

  describe('currencySymbol', () => {
    it('returns known symbols', () => {
      expect(currencySymbol('USD')).toBe('$')
      expect(currencySymbol('EUR')).toBe('€')
      expect(currencySymbol('GBP')).toBe('£')
    })

    it('falls back to the code itself when unknown', () => {
      expect(currencySymbol('XYZ')).toBe('XYZ')
    })
  })

  describe('isCurrencySupported', () => {
    it('accepts known currencies and NONE', () => {
      expect(isCurrencySupported('USD')).toBe(true)
      expect(isCurrencySupported('NONE')).toBe(true)
    })

    it('accepts any 3-letter code', () => {
      expect(isCurrencySupported('SEK')).toBe(true)
    })

    it('rejects malformed codes', () => {
      expect(isCurrencySupported('US')).toBe(false)
    })
  })

  describe('getSupportedCurrencies', () => {
    it('lists NONE first for the currency-less default', () => {
      expect(getSupportedCurrencies()[0]).toBe('NONE')
    })

    it('includes the core currencies', () => {
      const currencies = getSupportedCurrencies()
      expect(currencies).toContain('USD')
      expect(currencies).toContain('EUR')
      expect(currencies).toContain('GBP')
    })

    it('drops the consolidated dollar variants CAD/AUD/MXN (story 8-2)', () => {
      const currencies = getSupportedCurrencies()
      expect(currencies).not.toContain('CAD')
      expect(currencies).not.toContain('AUD')
      expect(currencies).not.toContain('MXN')
    })

    it('keeps exactly the 10 canonical selectable codes', () => {
      expect(getSupportedCurrencies()).toEqual([
        'NONE',
        'USD',
        'EUR',
        'GBP',
        'JPY',
        'CNY',
        'CHF',
        'INR',
        'BRL',
        'ZAR',
      ])
    })
  })

  describe('currencyDisplayLabel (story 14-1: symbol picker, UX-DR16)', () => {
    it('renders unambiguous currencies as their bare symbol', () => {
      expect(currencyDisplayLabel('USD')).toBe('$')
      expect(currencyDisplayLabel('EUR')).toBe('€')
      expect(currencyDisplayLabel('GBP')).toBe('£')
      expect(currencyDisplayLabel('INR')).toBe('₹')
    })

    it('never presents a selectable currency by its bare ISO code', () => {
      // The whole point of UX-DR16: the picker must not read as US-centric codes.
      // CHF is the one sanctioned exception (its ISO code IS its conventional
      // symbol), asserted explicitly by the dedicated test below, so it is
      // excluded here rather than dressed up with a meaningless sentinel.
      for (const code of getSupportedCurrencies().filter((c) => c !== 'NONE' && c !== 'CHF')) {
        expect(currencyDisplayLabel(code)).not.toBe(code)
      }
    })

    it('disambiguates the shared ¥ glyph (JPY vs CNY) with the ISO code', () => {
      // JPY and CNY were deliberately NOT consolidated (they format differently),
      // yet currencySymbol() maps both to ¥ — so the label must distinguish them.
      const jpy = currencyDisplayLabel('JPY')
      const cny = currencyDisplayLabel('CNY')
      expect(jpy).toContain('¥')
      expect(cny).toContain('¥')
      expect(jpy).toContain('JPY')
      expect(cny).toContain('CNY')
      expect(jpy).not.toBe(cny)
    })

    it('suffixes the ISO code for alphabetic single-letter symbols (ZAR → "R ZAR")', () => {
      expect(currencyDisplayLabel('ZAR')).toBe('R ZAR')
    })

    it('shows a letters-only symbol that equals its code once, without a redundant suffix (CHF)', () => {
      expect(currencyDisplayLabel('CHF')).toBe('CHF')
    })

    it('keeps a distinct glyph symbol bare even if it shares a leading letter (BRL → "R$")', () => {
      expect(currencyDisplayLabel('BRL')).toBe('R$')
    })

    it('produces a mutually distinct label for every selectable currency (no two options alike)', () => {
      const labels = getSupportedCurrencies()
        .filter((c) => c !== 'NONE')
        .map((c) => currencyDisplayLabel(c))
      expect(new Set(labels).size).toBe(labels.length)
      for (const label of labels) {
        expect(label.trim().length).toBeGreaterThan(0)
      }
    })
  })

  describe('canonicalizeCurrency (story 8-2: consolidation)', () => {
    it('maps the consolidated dollar family to USD', () => {
      expect(canonicalizeCurrency('CAD')).toBe('USD')
      expect(canonicalizeCurrency('AUD')).toBe('USD')
      expect(canonicalizeCurrency('MXN')).toBe('USD')
    })

    it('passes every kept selectable code through unchanged', () => {
      for (const code of ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CHF', 'INR', 'BRL', 'ZAR', 'NONE']) {
        expect(canonicalizeCurrency(code)).toBe(code)
      }
    })

    it('passes non-consolidated / unknown codes through unchanged', () => {
      // Distinct-render codes that are not part of the dollar cluster, plus garbage.
      expect(canonicalizeCurrency('SEK')).toBe('SEK')
      expect(canonicalizeCurrency('NZD')).toBe('NZD')
      expect(canonicalizeCurrency('XYZ')).toBe('XYZ')
    })

    it('is idempotent (canonicalizing a representative is a no-op)', () => {
      expect(canonicalizeCurrency(canonicalizeCurrency('CAD'))).toBe('USD')
    })

    it('CONSOLIDATED_CURRENCIES is the single source of truth for canonicalize', () => {
      for (const [from, to] of Object.entries(CONSOLIDATED_CURRENCIES)) {
        expect(canonicalizeCurrency(from)).toBe(to)
      }
    })

    it('no consolidated code remains selectable (map ∩ list = ∅)', () => {
      const selectable = getSupportedCurrencies()
      for (const code of Object.keys(CONSOLIDATED_CURRENCIES)) {
        expect(selectable).not.toContain(code)
      }
    })

    it('equivalence-drift guard: no two selectable codes render identically', () => {
      // The whole point of consolidation — after it, every remaining selectable
      // currency must produce a distinct rendered string via the app's real
      // formatting path. Adding a future currency that duplicates an existing
      // render fails loudly here.
      const seen = new Map<string, string>()
      for (const code of getSupportedCurrencies()) {
        const output = formatCurrency(100000, {
          mode: 'symbol',
          currency: code,
          locale: localeForCurrency(code),
        })
        const collided = seen.get(output)
        expect(collided, `${code} renders "${output}" identically to ${collided}`).toBeUndefined()
        seen.set(output, code)
      }
    })
  })
})
