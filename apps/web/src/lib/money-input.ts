/**
 * Story 109.1 (FR177, D1): the shared rules of a typed money field.
 *
 * Every money field in the app is a `type="text"` input that keeps the user's
 * typing as they enter it and re-echoes it grouped on blur. The re-echo was
 * copied into four pages (Income, Expenses, Savings, Balance); the forecasting
 * builder now uses the same fields, so the rule lives here once.
 */
// Imported from the barrel: the `format/currency` subpath is unresolvable to
// `tsc` (see `sanitized-input.ts`).
import { formatForInputDisplay, parseFromInput } from '@budget-planner/core'

/** The message for text that holds a number we cannot read (`1.2.3`), story 81.1. */
export const AMOUNT_NOT_A_NUMBER_MESSAGE = 'Enter a number.'

/**
 * Re-echoes an amount field in grouped, locale-aware form on blur (`42000` →
 * `42,000.00`). Both guard arms are load-bearing and must stay: the empty arm
 * keeps "not filled in" from becoming "entered zero", and the no-digit arm keeps
 * the digit-free partials `sanitizeMoneyInput` deliberately allows through
 * (story 28-1) VISIBLE — without it a half-typed "-" would silently become
 * "0.00" under the user's cursor.
 *
 * @param value - The field's current text.
 * @param locale - BCP-47 locale whose grouping/decimal separators apply.
 * @param setter - Writes the re-echoed text; not called when a guard holds.
 */
export function reformatAmountOnBlur(
  value: string,
  locale: string | undefined,
  setter: (v: string) => void
): void {
  if (value.trim() === '' || !/\d/.test(value)) return
  setter(formatForInputDisplay(parseFromInput(value, locale), locale))
}

/** A typed amount read as cents, or why it cannot be read. */
export type MoneyDraft = { cents: number } | { problem: string }

/**
 * Reads the text of a forecasting builder money field (story 109.1, AC 4).
 *
 * - Empty (or blank) text is 0: a cleared amount means nothing, not a mistake.
 * - A digit-free partial (`-`, `.`) is also 0, so the field can keep showing it.
 * - Text holding a 1-9 digit that `parseFromInput` still reads as 0 (`1.2.3`, an
 *   exponent, 309+ digits) is a `problem`: it is refused, never written as 0
 *   (the 81.1 contract).
 *
 * The sign is kept: whether a negative is allowed, and the upper bound, are the
 * caller's rules.
 *
 * ⚠️ Known edge: a well-formed amount under one cent (`0.001`) also truncates to
 * 0 with a 1-9 digit, so it is refused as "Enter a number.".
 */
export function parseMoneyDraft(raw: string, locale: string | undefined): MoneyDraft {
  if (raw.trim() === '') return { cents: 0 }
  const cents = parseFromInput(raw, locale)
  if (cents === 0 && /[1-9]/.test(raw)) return { problem: AMOUNT_NOT_A_NUMBER_MESSAGE }
  return { cents }
}
