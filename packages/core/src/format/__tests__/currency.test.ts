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
import {
  DEFAULT_CURRENCY_OPTIONS,
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
    it('renders raw numeric value with no symbol when mode is none', () => {
      expect(formatCurrency(123456, { mode: 'none' })).toBe('1234.56')
    })

    it('renders raw value when currency is NONE even if mode is symbol', () => {
      expect(formatCurrency(50000, { mode: 'symbol', currency: 'NONE' })).toBe('500.00')
    })

    it('uses currency-less behaviour with no options (default)', () => {
      // No options => DEFAULT mode 'none' => raw number
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
  })
})
