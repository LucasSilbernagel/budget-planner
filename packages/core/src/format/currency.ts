/**
 * Currency Formatting Utilities
 *
 * Provides utilities for formatting currency values with or without symbols.
 * Supports both currency-less mode and explicit symbols mode.
 * Uses Intl.NumberFormat for locale-aware formatting.
 *
 * Architecture Requirement: FR9 - Currency control
 */

/**
 * Currency display mode
 */
export type CurrencyMode = 'none' | 'symbol'

/**
 * Supported currencies
 */
export type CurrencyCode = 'NONE' | 'USD' | 'EUR' | 'GBP' | string

/**
 * Currency formatting options
 */
export interface CurrencyOptions {
  mode: CurrencyMode
  currency: CurrencyCode
  locale?: string
  /**
   * Enable abbreviated format for large values (e.g., $1K, $1M, $1B)
   * Default: false
   */
  abbreviate?: boolean
}

/**
 * Default currency options
 */
export const DEFAULT_CURRENCY_OPTIONS: CurrencyOptions = {
  mode: 'symbol',
  currency: 'USD',
  locale: 'en-US',
}

/**
 * Currency formatting thresholds for abbreviation
 */
export const CURRENCY_ABBREVIATION_THRESHOLDS = {
  BILLION: 1000000000,
  MILLION: 1000000,
  THOUSAND: 1000,
} as const

/**
 * Formats a value in cents as currency or raw number
 *
 * @param cents - Value in cents
 * @param options - Currency formatting options
 * @returns Formatted string
 */
export function formatCurrency(cents: number, options: Partial<CurrencyOptions> = {}): string {
  const { mode = 'symbol', currency = 'USD', locale = 'en-US', abbreviate = false } = options

  // Convert cents to dollars
  const dollars = cents / 100

  if (mode === 'none' || currency === 'NONE') {
    // Currency-less mode: return raw number
    return dollars.toFixed(2)
  }

  // Abbreviated format for large values
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
    // Explicit symbols mode: use Intl.NumberFormat
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return formatter.format(dollars)
  } catch {
    // Fallback if Intl fails or currency not supported
    return `${currencySymbol(currency)}${dollars.toFixed(2)}`
  }
}

/**
 * Formats a value in cents as a raw number (no currency symbol)
 *
 * @param cents - Value in cents
 * @param decimals - Number of decimal places
 * @returns Formatted number string
 */
export function formatAmount(cents: number, decimals = 2): string {
  const dollars = cents / 100
  return dollars.toFixed(decimals)
}

/**
 * Gets the currency symbol for a given currency code
 *
 * @param currencyCode - Currency code
 * @returns Currency symbol or the code itself if not found
 */
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
    // Add more as needed
  }

  return symbols[currencyCode] || currencyCode
}

/**
 * Formats a value for input display (without currency symbol)
 * Handles NaN, Infinity, null, undefined gracefully
 *
 * @param cents - Value in cents
 * @returns Formatted string for input fields (always 2 decimal places)
 */
export function formatForInput(cents: number): string {
  // Handle NaN, Infinity, null, undefined
  if (!Number.isFinite(cents)) {
    return '0.00'
  }

  const dollars = cents / 100
  return dollars.toFixed(2)
}

/**
 * Parses a value from input string to cents
 * Handles various input formats including negative values for debts.
 *
 * Supported formats:
 * - "100" -> 10000 cents
 * - "100.50" -> 10050 cents
 * - "1,000.50" -> 100050 cents (commas removed)
 * - "-100" -> -10000 cents (negatives allowed for debts)
 * - ".50" -> 50 cents
 * - "1." -> 100 cents
 * - "" -> 0 cents
 *
 * Rejected formats:
 * - "1.2.3" (multiple decimal points) -> 0
 * - "1e10" (scientific notation) -> 0
 * - NaN or Infinity -> 0
 *
 * @param value - Input string (e.g., "123.45" or "123")
 * @returns Value in cents (integer), or 0 if invalid
 */
export function parseFromInput(value: string): number {
  if (!value || value.trim() === '') return 0

  // Remove all non-numeric characters except decimal point and minus sign
  const cleaned = value.replace(/[^\d.-]/g, '')

  // Reject if multiple decimal points
  if ((cleaned.match(/\./g) || []).length > 1) return 0

  // Reject scientific notation
  if (cleaned.includes('e') || cleaned.includes('E')) return 0

  const amount = parseFloat(cleaned)

  // Reject NaN, Infinity
  if (Number.isNaN(amount) || !Number.isFinite(amount)) return 0

  // Handle floating point precision by working with the string
  // Convert to cents directly from string to avoid IEEE 754 issues
  if (cleaned.includes('.')) {
    const [whole, decimal] = cleaned.split('.')
    const paddedDecimal = decimal.padEnd(2, '0').slice(0, 2)
    return parseInt(whole + paddedDecimal, 10) || 0
  }

  return parseInt(`${cleaned}00`, 10) || 0
}

// Alias for backward compatibility
export const parseCurrencyToCents = parseFromInput

/**
 * Validates if a currency code is supported
 *
 * @param currencyCode - Currency code to validate
 * @returns True if supported
 */
export function isCurrencySupported(currencyCode: string): boolean {
  // Check if the currency is supported by Intl.NumberFormat
  // or if it's in our known symbols list
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

/**
 * Gets the list of supported currencies
 */
export function getSupportedCurrencies(): CurrencyCode[] {
  return [
    'NONE',
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
  ]
}
