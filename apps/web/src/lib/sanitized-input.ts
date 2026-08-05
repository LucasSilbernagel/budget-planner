/**
 * Caret-preserving glue for on-input sanitization (story 28-1, FR46).
 *
 * The pure character filters live in `packages/core` and must stay DOM-free and
 * SSR-safe. This is the browser-side half: applying a filter to a controlled
 * `<input>` without teleporting the user's cursor.
 *
 * ## Why this is needed
 *
 * A controlled input whose `onChange` returns a string React has already got in
 * state does NOT re-render — but React still restores the DOM node's value from
 * props, and that restore drops the caret to the END of the field. So typing a
 * rejected character in the middle of `1,234.56` leaves the value correct while
 * silently throwing the cursor to the end, making mid-string editing unusable.
 *
 * Returning a value "equal to or shorter than the input" is not sufficient to
 * avoid this — the jump happens precisely in the no-change case. The fix is to
 * write the sanitized value and the corrected caret to the node ourselves; React
 * then finds the node already matching props and leaves the selection alone.
 */

// Imported from the barrel rather than the `format/currency` subpath: the
// subpath is unresolvable to `tsc` (no `exports` map; Vite/Vitest resolve it via
// alias), and every such import adds a TS2307 to the type-check baseline.
import { sanitizeMoneyInput } from '@budget-planner/core'

/**
 * Applies a pure character filter to a controlled input, preserving the caret.
 *
 * The new caret position is derived by running the same filter over the text
 * *before* the caret — so it lands after exactly the characters that survived,
 * regardless of how many were dropped earlier in the string.
 *
 * When the filter is a no-op for this value the node is left untouched, so the
 * ordinary typing path keeps React's native behaviour.
 *
 * ⚠️ `sanitize` must be **prefix-stable**: every decision it makes about a
 * character may depend only on characters *before* it, so that
 * `sanitize(raw.slice(0, caret)).length` is a valid index into `sanitize(raw)`.
 * A filter that instead de-duplicates from the right, or trims a trailing
 * separator, satisfies the "only removes characters" contract while producing a
 * wrong caret. `sanitizeMoneyInput` is prefix-stable by construction.
 *
 * ⚠️ Known trade-off: assigning `input.value` imperatively discards the browser's
 * native per-field undo history, so `Ctrl+Z` stops working in a field after a
 * character has been rejected in it. Preserving it would require
 * `execCommand('insertText')`/`setRangeText`; accepted for now (story 28-1 review).
 *
 * @param input - The controlled input element from the change event.
 * @param sanitize - Pure, prefix-stable `string → string` filter that only removes
 *   characters.
 * @returns The sanitized value, to be written to state by the caller.
 */
export function sanitizeWithCaret(
  input: HTMLInputElement,
  sanitize: (raw: string) => string
): string {
  const raw = input.value
  const sanitized = sanitize(raw)

  if (sanitized !== raw) {
    // `selectionStart` is null on input types that do not support selection
    // (number, email, date...), and `setSelectionRange` THROWS on them. Every
    // current money field is type="text", but this helper is exported and its
    // `sanitize` counterpart is a generic opt-in prop, so guard the write rather
    // than rely on call sites never combining the two.
    const caret = input.selectionStart
    const supportsSelection = caret !== null
    const nextCaret = sanitize(raw.slice(0, caret ?? raw.length)).length
    input.value = sanitized
    if (supportsSelection) {
      input.setSelectionRange(nextCaret, nextCaret)
    }
  }

  return sanitized
}

/**
 * {@link sanitizeWithCaret} bound to the money filter — the form used by every
 * money field in the app.
 *
 * @param input - The controlled input element from the change event.
 * @param locale - BCP-47 locale whose grouping/decimal separators apply.
 * @returns The sanitized value, to be written to state by the caller.
 */
export function sanitizeMoneyChange(input: HTMLInputElement, locale?: string): string {
  return sanitizeWithCaret(input, (raw) => sanitizeMoneyInput(raw, locale))
}
