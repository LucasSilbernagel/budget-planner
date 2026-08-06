/**
 * Strict input parsers for the Retirement planner (story 29.1).
 *
 * ## Why these exist alongside core's parsers
 *
 * `packages/core`'s `parseFromInput` is deliberately NON-throwing: it is the
 * *display* path, used inside state updaters (a throw there would take out the
 * render). These are the *calculation* path — they reject malformed money rather
 * than coercing it, so a typo can never be silently fed to the retirement solver
 * as a real number. For any digit-bearing value the two agree.
 *
 * ## Why they are here rather than inside a component
 *
 * Before this story `parseCurrencyToCents` existed three times (two byte-similar
 * copies in `RetirementAccumulationPlanner` and `RetirementForm`, plus core's
 * non-throwing alias they deliberately shadowed) and `parsePercentageToDecimal`
 * twice. AC-8 merges each to one. Living in `lib/` makes them directly
 * unit-testable, which is what the corruption cases below need.
 *
 * ## ⚠️ The dead-guard bug, fixed here
 *
 * Both former currency copies stripped every character outside `[\d.]` BEFORE
 * running their scientific-notation and non-numeric guards, so those guards were
 * unreachable — the offending characters were already gone. `"1e5"` returned
 * `$15` and `"12x34"` returned `$12.34`, silently. The guards now run against the
 * locale-canonicalized input with only *non-magnitude-carrying* characters
 * (whitespace, currency symbols) removed, so anything that could change the
 * number is still there to be rejected.
 */

/** Separators assumed when no locale is supplied (the app's neutral default). */
const FALLBACK_GROUP_SEPARATOR = ','
const FALLBACK_DECIMAL_SEPARATOR = '.'

/**
 * An actual scientific-notation literal ("1e5", "1.5E-3") — as opposed to any
 * string that merely contains an "e". Used only to pick the more specific of two
 * rejection messages; both paths reject.
 */
const SCIENTIFIC_NOTATION = /^\d+(\.\d+)?[eE][+-]?\d+$/

/**
 * Rewrites a locale-formatted number string into en-US canonical form: grouping
 * removed, decimal separator normalized to '.'.
 *
 * Must run BEFORE any '.'-as-decimal assumption, or a de-DE "1.234,56" is read
 * as one-thousand-two-hundred-something instead of 1234.56 (story 14-3).
 */
function canonicalizeSeparators(value: string, locale?: string): string {
  let groupSeparator = FALLBACK_GROUP_SEPARATOR
  let decimalSeparator = FALLBACK_DECIMAL_SEPARATOR

  if (locale) {
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(11111.1)
      groupSeparator = parts.find((p) => p.type === 'group')?.value ?? FALLBACK_GROUP_SEPARATOR
      decimalSeparator =
        parts.find((p) => p.type === 'decimal')?.value ?? FALLBACK_DECIMAL_SEPARATOR
    } catch {
      // Invalid/exotic locale: fall through with the en-US fallbacks.
    }
  }

  const withoutGrouping = value.split(groupSeparator).join('')
  return decimalSeparator === '.'
    ? withoutGrouping
    : withoutGrouping.split(decimalSeparator).join('.')
}

/**
 * Removes only characters that cannot change the magnitude of the number:
 * whitespace and currency symbols (Unicode `Sc`). Everything else — letters,
 * `e`/`E`, stray punctuation — is left in place so the guards below can reject it
 * instead of silently deleting it.
 */
function stripNonMagnitudeCharacters(value: string): string {
  return value.replace(/[\s\p{Sc}]/gu, '')
}

/**
 * Parses a currency string to integer cents (strict).
 *
 * Locale-canonicalizes grouping/decimal separators, then rejects negative,
 * multi-decimal, scientific-notation, non-numeric, or overflowing values. An
 * empty string parses to 0 — the caller decides whether an empty field means
 * "not provided yet".
 *
 * @param value - Currency string from a money input (e.g. "1,234.56", "$1,000.00")
 * @param locale - BCP-47 locale whose grouping/decimal separators apply
 * @returns Amount in integer cents
 * @throws Error on malformed input.
 */
export function parseCurrencyToCents(value: string, locale?: string): number {
  if (value == null) {
    throw new Error('Invalid currency: value cannot be null or undefined')
  }

  if (value.trim() === '') {
    return 0
  }

  const canonical = canonicalizeSeparators(value.trim(), locale)

  if (canonical.startsWith('-')) {
    throw new Error('Currency amount cannot be negative')
  }

  const candidate = stripNonMagnitudeCharacters(canonical)

  if ((candidate.match(/\./g) || []).length > 1) {
    throw new Error('Invalid currency: multiple decimal points not allowed')
  }

  // Ordering matters: report scientific notation specifically before falling
  // back to the generic non-numeric message, so the error stays actionable.
  // Matched precisely rather than on a bare `includes('e')` — otherwise any word
  // containing an "e" ("12 apples 34") is reported as scientific notation.
  if (SCIENTIFIC_NOTATION.test(candidate)) {
    throw new Error('Invalid currency: scientific notation not allowed')
  }

  if (!/^\d+(\.\d+)?$/.test(candidate)) {
    throw new Error('Invalid currency: contains non-numeric characters')
  }

  const amount = parseFloat(candidate)

  if (Number.isNaN(amount) || !Number.isFinite(amount)) {
    throw new Error('Invalid currency: must be a valid finite number')
  }

  const cents = Math.round(amount * 100)

  if (!Number.isSafeInteger(cents)) {
    throw new Error('Invalid currency: value exceeds safe integer limit')
  }

  return cents
}

/**
 * Parses a percentage string to a decimal (strict). "6" / "6%" / "6.5" → 0.06 /
 * 0.065. Empty string → 0.
 *
 * @throws Error on malformed or negative input.
 */
export function parsePercentageToDecimal(value: string): number {
  if (value == null) {
    throw new Error('Invalid percentage: value cannot be null or undefined')
  }

  if (value.trim() === '') {
    return 0
  }

  const trimmed = value.trim()

  if ((trimmed.match(/\./g) || []).length > 1) {
    throw new Error('Invalid percentage: multiple decimal points not allowed')
  }

  if (trimmed.startsWith('-')) {
    throw new Error('Percentage cannot be negative')
  }

  const cleaned = trimmed.replace(/%/g, '').trim()

  if (SCIENTIFIC_NOTATION.test(cleaned)) {
    throw new Error('Invalid percentage: scientific notation not allowed')
  }

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('Invalid percentage: contains non-numeric characters')
  }

  const num = parseFloat(cleaned)

  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error('Invalid percentage: must be a valid finite number')
  }

  return num / 100
}

/**
 * Parses a whole-number age in years. Empty string → `null` ("not provided").
 *
 * @throws Error on non-numeric, negative, or fractional input.
 */
export function parseAge(value: string): number | null {
  if (value == null || value.trim() === '') {
    return null
  }

  const trimmed = value.trim()

  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Age must be a whole number')
  }

  const num = parseInt(trimmed, 10)

  if (!Number.isFinite(num)) {
    throw new Error('Age must be a finite number')
  }

  return num
}
