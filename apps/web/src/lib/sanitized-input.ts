/**
 * Writes the sanitized value and caret to the node directly: React restoring a controlled value drops the caret
 * to the end, even when the value is unchanged.
 */

import { sanitizeMoneyInput } from '@budget-planner/core/format/currency'

/**
 * `sanitize` must be prefix-stable, so sanitize(raw.slice(0, caret)).length indexes sanitize(raw).
 * Trade-off: assigning input.value discards the field's native undo history.
 */
export function sanitizeWithCaret(
	input: HTMLInputElement,
	sanitize: (raw: string) => string
): string {
	const raw = input.value
	const sanitized = sanitize(raw)

	if (sanitized !== raw) {
		// selectionStart is null and setSelectionRange throws on non-text input types.
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

export function sanitizeMoneyChange(input: HTMLInputElement, locale?: string): string {
	return sanitizeWithCaret(input, (raw) => sanitizeMoneyInput(raw, locale))
}
