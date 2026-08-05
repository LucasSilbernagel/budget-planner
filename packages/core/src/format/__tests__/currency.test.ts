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
  formatForInputDisplay,
  getSupportedCurrencies,
  isCurrencySupported,
  parseFromInput,
  sanitizeMoneyInput,
} from '../currency.js'

/**
 * The only four group/decimal separator shapes reachable from the supported
 * currency set (see currency-locale.ts). Testing these beats testing four
 * arbitrary locales — every supported currency lands in one of them.
 */
const SEPARATOR_SHAPES = [
  { shape: 'A (group "," decimal ".")', locale: 'en-US', decimalSep: '.' },
  { shape: 'B (group "." decimal ",")', locale: 'de-DE', decimalSep: ',' },
  { shape: 'C (group "\'" decimal ".")', locale: 'de-CH', decimalSep: '.' },
  { shape: 'D (group U+00A0 decimal ",")', locale: 'en-ZA', decimalSep: ',' },
] as const

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

    /**
     * Regression lock for the Epic-6 "Infinity into store" HIGH (story 6-8),
     * incidentally fixed by story 14-3 when the money inputs were routed through
     * parseFromInput on both the validation guard and the store-write path. An
     * overflowing/non-finite amount must coerce to 0 *before* any page guard sees it,
     * so a positive-amount field shows its "valid positive amount" error and a balance
     * field stores a finite 0 — never Infinity. This test pins that contract so a
     * future refactor away from parseFromInput on the four entry pages (Income,
     * Expenses, Savings, Balance) cannot silently reintroduce the 6-8 leak.
     */
    it('coerces overflowing / non-finite amounts to 0 (regression: story 6-8 leak, fixed by 14-3)', () => {
      expect(parseFromInput('1e309')).toBe(0) // parses to Infinity via exponent
      expect(parseFromInput('1e999')).toBe(0)
      expect(parseFromInput('Infinity')).toBe(0) // letters stripped → NaN → 0
    })
  })

  describe('formatForInputDisplay (story 14-3: grouped symbol-less input echo)', () => {
    // ICU may use a narrow no-break space (U+202F) as the group separator.
    const normalizeSpaces = (value: string) => value.replace(/[  ]/g, ' ')

    it('groups a large value in en-US by default (no symbol)', () => {
      expect(formatForInputDisplay(123456789)).toBe('1,234,567.89')
    })

    it('groups per de-DE locale with comma decimal (no symbol)', () => {
      expect(normalizeSpaces(formatForInputDisplay(123456789, 'de-DE'))).toBe('1.234.567,89')
    })

    it('uses Indian grouping for en-IN (no symbol)', () => {
      expect(formatForInputDisplay(12345678, 'en-IN')).toBe('1,23,456.78')
    })

    it('keeps two fixed decimals for whole and sub-dollar amounts', () => {
      expect(formatForInputDisplay(500000)).toBe('5,000.00')
      expect(formatForInputDisplay(5)).toBe('0.05')
    })

    it('renders non-finite input as grouped zero (no NaN)', () => {
      expect(formatForInputDisplay(Number.NaN)).toBe('0.00')
      expect(formatForInputDisplay(Number.POSITIVE_INFINITY)).toBe('0.00')
    })

    it('falls back to ungrouped toFixed for an invalid locale (never throws)', () => {
      expect(formatForInputDisplay(123456, 'not-a-locale!!')).toBe('1234.56')
    })
  })

  describe('parseFromInput - locale-aware grouping (story 14-3)', () => {
    it('parses en-US grouped input to cents', () => {
      expect(parseFromInput('1,234,567.89', 'en-US')).toBe(123456789)
    })

    it('parses de-DE grouped comma-decimal input to cents', () => {
      expect(parseFromInput('1.234.567,89', 'de-DE')).toBe(123456789)
    })

    it('parses de-DE plain comma-decimal input (no grouping) to cents', () => {
      expect(parseFromInput('1234,56', 'de-DE')).toBe(123456)
    })

    it('parses en-IN Indian-grouped input to cents', () => {
      expect(parseFromInput('1,23,456.78', 'en-IN')).toBe(12345678)
    })

    it('round-trips format -> parse for de-DE without precision loss', () => {
      const cents = 987654321
      expect(parseFromInput(formatForInputDisplay(cents, 'de-DE'), 'de-DE')).toBe(cents)
    })

    it('round-trips format -> parse for en-IN without precision loss', () => {
      const cents = 12345678
      expect(parseFromInput(formatForInputDisplay(cents, 'en-IN'), 'en-IN')).toBe(cents)
    })

    it('preserves negatives (debts) under a comma-decimal locale', () => {
      expect(parseFromInput('-1.234,56', 'de-DE')).toBe(-123456)
    })

    it('falls back to en-US assumptions for an invalid locale (never throws)', () => {
      expect(parseFromInput('1,000.50', 'not-a-locale!!')).toBe(100050)
    })

    it('is backward compatible when no locale is passed', () => {
      expect(parseFromInput('1,000.50')).toBe(100050)
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

  describe('sanitizeMoneyInput (story 28-1, FR46: on-input character filtering)', () => {
    describe('rejects characters a money field can never contain (AC-1)', () => {
      it('strips letters entirely', () => {
        expect(sanitizeMoneyInput('abc')).toBe('')
        expect(sanitizeMoneyInput('12abc34')).toBe('1234')
      })

      it('strips currency symbols and punctuation', () => {
        expect(sanitizeMoneyInput('$50')).toBe('50')
        expect(sanitizeMoneyInput('50%')).toBe('50')
        expect(sanitizeMoneyInput('€1,234.56')).toBe('1,234.56')
        expect(sanitizeMoneyInput('1;2/3')).toBe('123')
      })

      it('strips whitespace that is not the locale group separator', () => {
        expect(sanitizeMoneyInput('1 000')).toBe('1000')
        expect(sanitizeMoneyInput('1\t000', 'en-US')).toBe('1000')
        // de-DE's group separator is '.', so a plain space is still noise there.
        expect(sanitizeMoneyInput('1 000', 'de-DE')).toBe('1000')
      })

      it('never returns a string longer than its input (caret-stability guarantee)', () => {
        for (const raw of ['abc', '1,234.56', '$-1.2.3', '1 234,56', "1'2'3", '1e10']) {
          for (const { locale } of SEPARATOR_SHAPES) {
            expect(sanitizeMoneyInput(raw, locale).length).toBeLessThanOrEqual(raw.length)
          }
        }
      })
    })

    describe('keeps legal locale-formatted amounts intact (AC-2)', () => {
      it('leaves each separator shape unchanged', () => {
        expect(sanitizeMoneyInput('1,234.56', 'en-US')).toBe('1,234.56')
        expect(sanitizeMoneyInput('1.234,56', 'de-DE')).toBe('1.234,56')
        expect(sanitizeMoneyInput("1'234.56", 'de-CH')).toBe("1'234.56")
        expect(sanitizeMoneyInput('1 234,56', 'en-ZA')).toBe('1 234,56')
      })

      it('preserves the Indian grouping pattern', () => {
        expect(sanitizeMoneyInput('1,23,456.78', 'en-IN')).toBe('1,23,456.78')
      })

      it('defaults to en-US assumptions when no locale is supplied', () => {
        expect(sanitizeMoneyInput('1,234.56')).toBe('1,234.56')
      })

      it('falls back to en-US assumptions on an exotic/invalid locale', () => {
        // Mirrors parseFromInput's try/catch fallthrough — a bad locale must never throw.
        expect(sanitizeMoneyInput('1,234.56', 'not-a-locale!!')).toBe('1,234.56')
      })
    })

    describe("never alters a value's magnitude (code-review regressions)", () => {
      // Each case below is a real silent-corruption path the first implementation
      // shipped. The rule that kills all three: this function removes noise
      // characters and NOTHING else — malformed structure is parseFromInput's to
      // reject (it returns 0, which the callers' `<= 0` validators block).

      it('keeps every separator, so a stray leading decimal cannot rescale the value', () => {
        // Field holds "1,000.00", caret at 0, user fumbles a '.'. De-duplicating
        // to the FIRST separator produced ".1,00000" -> 10 cents: $1,000 -> $0.10.
        expect(sanitizeMoneyInput('.1,000.00', 'en-US')).toBe('.1,000.00')
        expect(parseFromInput(sanitizeMoneyInput('.1,000.00', 'en-US'), 'en-US')).toBe(0)
        expect(sanitizeMoneyInput(',1.234,56', 'de-DE')).toBe(',1.234,56')
      })

      it('keeps a "." even where it is neither separator (en-ZA 100x regression)', () => {
        // en-ZA groups with U+00A0 and decimalises with ',', so '.' is neither —
        // but parseFromInput's `[^\d.-]` strip still reads it as the decimal point.
        // Stripping it turned R1 234,56 into R123 456,00.
        expect(sanitizeMoneyInput('1234.56', 'en-ZA')).toBe('1234.56')
        expect(parseFromInput(sanitizeMoneyInput('1234.56', 'en-ZA'), 'en-ZA')).toBe(123456)
        expect(parseFromInput(sanitizeMoneyInput('0.99', 'en-ZA'), 'en-ZA')).toBe(99)
      })

      it('leaves a multi-separator value for the parser to reject, not to repair', () => {
        // Previously '1.2.3' -> '1.23' -> 123 cents, i.e. a value the parser had
        // rejected became saveable. It must stay rejected (0 → validators block).
        expect(sanitizeMoneyInput('1.2.3', 'en-US')).toBe('1.2.3')
        expect(parseFromInput(sanitizeMoneyInput('1.2.3', 'en-US'), 'en-US')).toBe(0)
        expect(parseFromInput(sanitizeMoneyInput('1.234.56', 'en-US'), 'en-US')).toBe(0)
      })

      it('leaves repeated GROUP separators alone (de-DE "." is not a decimal point)', () => {
        // In dot-group locales these are three group separators and DO parse.
        expect(sanitizeMoneyInput('1.2.3', 'de-DE')).toBe('1.2.3')
        expect(parseFromInput(sanitizeMoneyInput('1.2.3', 'de-DE'), 'de-DE')).toBe(12300)
        expect(sanitizeMoneyInput('1,2,3', 'en-US')).toBe('1,2,3')
      })

      it('drops a scientific-notation exponent whole, never splicing its digits', () => {
        // "1.2E+09" -> "1.209" -> $1.20 was a value the validator used to block.
        expect(sanitizeMoneyInput('1.2E+09', 'en-US')).toBe('1.2')
        expect(sanitizeMoneyInput('2.5e6', 'en-US')).toBe('2.5')
        expect(sanitizeMoneyInput('1e10', 'en-US')).toBe('1')
        // What the field shows is exactly what the parser reads.
        expect(parseFromInput(sanitizeMoneyInput('1.2E+09', 'en-US'), 'en-US')).toBe(120)
      })

      it('round-trips every parseable value through sanitize unchanged, all 12 locales', () => {
        // The blanket magnitude guarantee: for anything parseFromInput accepts,
        // sanitizing must not move the cents. Covers the full supported-currency
        // locale set, not just the four separator shapes.
        const LOCALES = [
          'en-US',
          'de-DE',
          'en-GB',
          'ja-JP',
          'en-CA',
          'en-AU',
          'de-CH',
          'zh-CN',
          'en-IN',
          'pt-BR',
          'en-ZA',
          'es-MX',
        ]
        for (const locale of LOCALES) {
          for (const cents of [0, 1, 99, 100, 123456, 123456789, -1, -123456]) {
            const shown = formatForInputDisplay(cents, locale)
            expect(sanitizeMoneyInput(shown, locale), `${cents} in ${locale}`).toBe(shown)
            expect(parseFromInput(sanitizeMoneyInput(shown, locale), locale)).toBe(
              parseFromInput(shown, locale)
            )
          }
        }
      })
    })

    describe('negative sign (AC-1: sign characters are legal)', () => {
      it('keeps a leading minus — negatives are valid for debts', () => {
        expect(sanitizeMoneyInput('-100')).toBe('-100')
        expect(sanitizeMoneyInput('-1,234.56', 'en-US')).toBe('-1,234.56')
      })

      it('strips an interior minus', () => {
        expect(sanitizeMoneyInput('1-00')).toBe('100')
        expect(sanitizeMoneyInput('100-')).toBe('100')
      })

      it('keeps the minus when only stripped characters precede it', () => {
        expect(sanitizeMoneyInput('$-100')).toBe('-100')
      })
    })

    describe('preserves in-progress typing (never rewrites a partial value)', () => {
      it.each([
        ['empty', ''],
        ['lone minus', '-'],
        ['trailing decimal separator', '1.'],
        ['trailing group separator', '1,'],
        ['leading decimal separator', '.'],
      ])('returns %s unchanged', (_label, raw) => {
        expect(sanitizeMoneyInput(raw, 'en-US')).toBe(raw)
      })
    })

    describe('idempotence (required — blur output re-enters the field)', () => {
      const CASES = [
        '',
        '-',
        '.',
        '1.',
        '1,',
        'abc',
        '12abc34',
        '$50',
        '1.2.3',
        '1,2,3',
        '-1,234.56',
        "1'234.56",
        '1 234,56',
        '1e10',
        '1 000',
        '.1,000.00',
        '1.234.56',
        '1.2E+09',
      ]

      for (const { shape, locale } of SEPARATOR_SHAPES) {
        it(`is idempotent across the whole table in shape ${shape}`, () => {
          for (const raw of CASES) {
            const once = sanitizeMoneyInput(raw, locale)
            expect(sanitizeMoneyInput(once, locale), `input "${raw}"`).toBe(once)
          }
        })
      }
    })

    describe('blur-echo tolerance (the field must survive its own re-format)', () => {
      for (const { shape, locale } of SEPARATOR_SHAPES) {
        it(`leaves formatForInputDisplay output untouched in shape ${shape}`, () => {
          // Derive the expected string by CALLING formatForInputDisplay rather than
          // hard-coding a literal: de-CH's apostrophe is ICU-version-dependent, so a
          // literal would break on a Node/ICU bump rather than on a real regression.
          for (const cents of [0, 100, 123456, 123456789, -123456]) {
            const echoed = formatForInputDisplay(cents, locale)
            expect(sanitizeMoneyInput(echoed, locale), `${cents} in ${locale}`).toBe(echoed)
          }
        })
      }
    })

    describe('round-trip with parseFromInput (the AC-2 guarantee)', () => {
      for (const { shape, locale, decimalSep } of SEPARATOR_SHAPES) {
        it(`sanitizing never changes the parsed value in shape ${shape}`, () => {
          // Scoped to inputs parseFromInput accepts, expressed in each shape's OWN
          // separators; the documented divergences are pinned separately below.
          const accepted = [
            '0',
            '100',
            '-100',
            `${decimalSep}50`,
            `1${decimalSep}`,
            formatForInputDisplay(123456, locale),
            formatForInputDisplay(-98765, locale),
            formatForInputDisplay(123456789, locale),
          ]
          for (const raw of accepted) {
            expect(
              parseFromInput(sanitizeMoneyInput(raw, locale), locale),
              `input "${raw}" in ${locale}`
            ).toBe(parseFromInput(raw, locale))
          }
        })
      }

      it('strips garbage down to the digits parseFromInput would have kept anyway', () => {
        expect(parseFromInput(sanitizeMoneyInput('12abc34', 'en-US'), 'en-US')).toBe(
          parseFromInput('12abc34', 'en-US')
        )
      })
    })

    describe('deliberate divergences from parseFromInput (decisions, not accidents)', () => {
      it('truncates at a scientific-notation exponent (the one divergence)', () => {
        // parseFromInput rejects "1e10" outright (returns 0). AC-1 forbids leaving
        // the letter in the field, so the exponent tail goes whole — never just the
        // 'e', which would splice the exponent digits into the mantissa.
        expect(parseFromInput('1e10')).toBe(0)
        expect(sanitizeMoneyInput('1e10')).toBe('1')
        expect(parseFromInput(sanitizeMoneyInput('1e10'))).toBe(100)
      })

      it('passes a bare "e" through the ordinary letter strip', () => {
        // Only a real exponent (digit-bearing) truncates; a stray letter is noise.
        expect(sanitizeMoneyInput('1e')).toBe('1')
        expect(sanitizeMoneyInput('12e34x')).toBe('12')
      })
    })

    describe('paste handling (AC-5 — a paste arrives as one change event)', () => {
      it('cleans a whole pasted string in a single call', () => {
        expect(sanitizeMoneyInput('USD 1,234.56 per month', 'en-US')).toBe('1,234.56')
        expect(sanitizeMoneyInput('total: abc', 'en-US')).toBe('')
      })
    })
  })
})
