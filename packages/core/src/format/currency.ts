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
 *
 * Per FR9 / AC-1 (story 4-6) and project-context.md, currency-less mode is the
 * product default: new users see raw numeric entries with no currency symbol
 * until they opt into explicit symbols.
 */
export const DEFAULT_CURRENCY_OPTIONS: CurrencyOptions = {
  mode: 'none',
  currency: 'NONE',
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
  const {
    mode = DEFAULT_CURRENCY_OPTIONS.mode,
    currency = DEFAULT_CURRENCY_OPTIONS.currency,
    locale = DEFAULT_CURRENCY_OPTIONS.locale,
    abbreviate = false,
  } = options

  // Guard non-finite input (NaN/Infinity) so no display path ever renders
  // "NaN"/"$NaN". Mirrors formatForInput/parseFromInput, which already coerce
  // non-finite values — formatCurrency is the universal display formatter.
  const dollars = Number.isFinite(cents) ? cents / 100 : 0

  if (mode === 'none' || currency === 'NONE') {
    // Currency-less mode: grouped raw number with no currency symbol, per the
    // resolved locale (story 14-2). `toFixed(2)` never groups, so large figures
    // read as USD-style unformatted digits; Intl.NumberFormat with decimal style
    // applies the locale's thousands separator while keeping two fixed decimals.
    try {
      return new Intl.NumberFormat(locale, {
        style: 'decimal',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(dollars)
    } catch {
      // An exotic/invalid locale must never crash a render; fall back to the
      // ungrouped fixed-decimal string (mirrors the symbols-mode fallback below).
      return dollars.toFixed(2)
    }
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
    // Explicit symbols mode: use Intl.NumberFormat.
    // Let Intl apply each currency's native fraction digits (USD/EUR → 2,
    // JPY → 0, BHD → 3) rather than forcing 2, per the native-localization rule.
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
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
 * Formats a value in cents for an editable currency input's *display* echo:
 * grouped, locale-aware, and always symbol-less (the currency symbol is a
 * separate UI affordance, not part of the editable string) — story 14-3.
 *
 * Mirrors the currency-less branch of {@link formatCurrency} (Intl decimal style,
 * two fixed decimals, defensive `try/catch → toFixed(2)` fallback, non-finite
 * guard) so an input's blur/pre-fill echo groups identically to how the amount
 * displays read-only. The paired reader {@link parseFromInput} accepts the same
 * locale so the grouped string round-trips back to exact integer cents.
 *
 * @param cents - Value in cents.
 * @param locale - BCP-47 locale (defaults to en-US, the neutral currency-less locale).
 * @returns Grouped, symbol-less string for input display (e.g. `1,234,567.89`
 *   en-US, `1.234.567,89` de-DE).
 */
export function formatForInputDisplay(cents: number, locale = 'en-US'): string {
  const dollars = Number.isFinite(cents) ? cents / 100 : 0
  try {
    return new Intl.NumberFormat(locale, {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(dollars)
  } catch {
    // An exotic/invalid locale must never crash a render; fall back to the
    // ungrouped fixed-decimal string (mirrors formatCurrency's fallbacks).
    return dollars.toFixed(2)
  }
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
 * When a `locale` is supplied, the string is first canonicalized from that
 * locale's grouping/decimal convention to en-US form so grouped input round-trips
 * without the '.'-as-decimal assumption below corrupting it (story 14-3):
 * - de-DE "1.234,56" -> 123456 cents (group '.', decimal ',')
 * - de-CH "1'234.56" -> 123456 cents (group '’'/apostrophe, decimal '.')
 * - en-IN "1,23,456.78" -> 12345678 cents (Indian grouping)
 *
 * Rejected formats:
 * - "1.2.3" (multiple decimal points) -> 0
 * - "1e10" (scientific notation) -> 0
 * - NaN or Infinity -> 0
 *
 * @param value - Input string (e.g., "123.45" or "123")
 * @param locale - Optional BCP-47 locale whose grouping/decimal separators the
 *   input uses. Omit for en-US-style input (backward compatible).
 * @returns Value in cents (integer), or 0 if invalid
 */
export function parseFromInput(value: string, locale?: string): number {
  if (!value || value.trim() === '') return 0

  // Reject scientific notation BEFORE stripping — the regex below would remove
  // the 'e'/'E', leaving a misleading numeric remainder (e.g. "1e10" -> "110").
  // Match only a real exponent (digit, e/E, optional sign, digit) so incidental
  // letters in garbage input (e.g. "100 each") don't reject otherwise-parseable digits.
  if (/\d[eE][+-]?\d/.test(value)) return 0

  // Canonicalize locale grouping/decimal to en-US form BEFORE stripping, so a
  // comma-decimal ("1.234,56") or apostrophe/Indian-grouped string parses to the
  // right cents. Without this, the `[^\d.-]` strip + '.'-decimal logic below would
  // read de-DE "1.234,56" as "1.234" -> 123 cents (a 100000x corruption).
  let normalized = value
  if (locale) {
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(11111.1)
      const groupSep = parts.find((p) => p.type === 'group')?.value
      const decimalSep = parts.find((p) => p.type === 'decimal')?.value
      if (groupSep) normalized = normalized.split(groupSep).join('')
      if (decimalSep && decimalSep !== '.') normalized = normalized.split(decimalSep).join('.')
    } catch {
      // Invalid/exotic locale: fall through with the raw value (en-US assumptions).
    }
  }

  // Remove all non-numeric characters except decimal point and minus sign
  const cleaned = normalized.replace(/[^\d.-]/g, '')

  // Reject if multiple decimal points
  if ((cleaned.match(/\./g) || []).length > 1) return 0

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
 * Currencies that render byte-for-byte identically to a canonical representative
 * through the app's real formatting path (`formatCurrency` + `localeForCurrency`),
 * mapped to that representative (story 8-2, FR26).
 *
 * The dollar family USD/CAD/AUD/MXN all render `$1,000.00` under their regional
 * locales (en-US / en-CA / en-AU / es-MX), so CAD/AUD/MXN collapse to USD.
 * Currencies that merely share a glyph but format differently (JPY `￥1,000`
 * vs CNY `¥1,000.00`) are deliberately NOT consolidated. This is the single
 * source of truth for consolidation, shared by callers and tests.
 */
export const CONSOLIDATED_CURRENCIES: Readonly<Record<string, string>> = {
  CAD: 'USD',
  AUD: 'USD',
  MXN: 'USD',
}

/**
 * Maps a consolidated currency code to its canonical representative, passing
 * every other code (including `NONE` and unknown/server-only codes such as
 * `SEK`/`NZD`) through unchanged.
 *
 * Pure and isomorphic (no DOM/navigator/env), so it is SSR-safe by construction
 * and belongs in core. Consolidation is a selection/persistence concern, not a
 * formatting one — `formatCurrency` still formats any code correctly.
 *
 * @param code - A currency code.
 * @returns The canonical representative for consolidated codes, else `code`.
 */
export function canonicalizeCurrency(code: CurrencyCode): CurrencyCode {
  return CONSOLIDATED_CURRENCIES[code] ?? code
}

/**
 * Gets the list of selectable currencies.
 *
 * Consolidated (identical-render) codes are omitted so the selector shows one
 * entry per distinct rendered output (story 8-2): the dollar family collapses to
 * `USD`, dropping `CAD`/`AUD`/`MXN`. Those codes remain formattable via
 * `CURRENCY_LOCALE`/`currencySymbol` for any legacy/synced value.
 */
export function getSupportedCurrencies(): CurrencyCode[] {
  return ['NONE', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CHF', 'INR', 'BRL', 'ZAR']
}

/**
 * Human-visible label for a currency in the symbols picker (story 14-1, UX-DR16).
 *
 * The picker presents currencies by SYMBOL, not by nationality-tagged ISO code.
 * But a bare symbol is not always unambiguous, so this returns the symbol plus a
 * disambiguating ISO-code suffix ONLY where the symbol alone would be unclear:
 *
 * - Distinct glyph, unique among selectable currencies → bare symbol
 *   (`USD → "$"`, `EUR → "€"`, `GBP → "£"`, `INR → "₹"`, `BRL → "R$"`).
 * - Symbol shared by more than one selectable currency → `"<symbol> <CODE>"`
 *   (`JPY → "¥ JPY"`, `CNY → "¥ CNY"` — deliberately not consolidated in 8-2
 *   because they format differently, yet both map to `¥`).
 * - Alphabetic (letters-only) symbol → `"<symbol> <CODE>"` so it does not read as
 *   an accidental code collision (`ZAR → "R ZAR"`), except when the symbol already
 *   equals the code (`CHF → "CHF"`), where a suffix would be redundant.
 *
 * The returned string is itself screen-reader-legible, so the picker does not have
 * to rely on `aria-label` on `<option>` (inconsistently supported). The picker
 * keeps the ISO code as each option's `value`; only the display changes.
 *
 * Pure and isomorphic (no DOM/navigator/env) — SSR-safe, belongs in core.
 *
 * @param code - A currency code.
 * @returns The symbol-first display label.
 */
export function currencyDisplayLabel(code: CurrencyCode): string {
  const symbol = currencySymbol(code)

  // A letters-only symbol that already equals its code (e.g. CHF) is its own
  // unambiguous label; a "CHF CHF" suffix would be redundant.
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
