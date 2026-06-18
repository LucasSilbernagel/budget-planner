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
 * Formats a value in cents as currency or raw number
 * 
 * @param cents - Value in cents
 * @param options - Currency formatting options
 * @returns Formatted string
 */
export function formatCurrency(
  cents: number,
  options: Partial<CurrencyOptions> = {}
): string {
  const { mode = 'symbol', currency = 'USD', locale = 'en-US' } = options

  // Convert cents to dollars
  const dollars = cents / 100

  if (mode === 'none' || currency === 'NONE') {
    // Currency-less mode: return raw number
    return dollars.toFixed(2)
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
export function formatAmount(
  cents: number,
  decimals: number = 2
): string {
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
 * 
 * @param cents - Value in cents
 * @returns Formatted string for input fields
 */
export function formatForInput(cents: number): string {
  const dollars = cents / 100
  return dollars.toFixed(2)
}

/**
 * Parses a value from input string to cents
 * 
 * @param value - Input string (e.g., "123.45" or "123")
 * @returns Value in cents (rounded)
 */
export function parseFromInput(value: string): number {
  if (!value) return 0
  const dollars = parseFloat(value)
  if (isNaN(dollars)) return 0
  return Math.round(dollars * 100)
}

/**
 * Validates if a currency code is supported
 * 
 * @param currencyCode - Currency code to validate
 * @returns True if supported
 */
export function isCurrencySupported(currencyCode: string): boolean {
  // Check if the currency is supported by Intl.NumberFormat
  // or if it's in our known symbols list
  const supported = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL', 'ZAR', 'MXN', 'NONE']
  return supported.includes(currencyCode) || currencyCode.length === 3
}

/**
 * Gets the list of supported currencies
 */
export function getSupportedCurrencies(): CurrencyCode[] {
  return ['NONE', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL', 'ZAR', 'MXN']
}
