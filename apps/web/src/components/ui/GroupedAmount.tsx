/**
 * A `<wbr>` after each digit-flanked group separator, so a figure wraps only between groups.
 * Server and first client render must agree: render inside `hydrated` or where all stores are `skipHydration`.
 */

import type React from 'react'
import { Fragment } from 'react'
import { useCurrencyPreferences } from '../../stores/currencyStore'

/**
 * Pass `currency` in symbol mode: some locales group differently in currency style
 * (de-AT: no-break space in decimal style, `.` in currency style).
 */
export function groupSeparator(locale: string, currency?: string | null): string | null {
	try {
		const options: Intl.NumberFormatOptions = currency ? { style: 'currency', currency } : {}
		return (
			new Intl.NumberFormat(locale, options)
				.formatToParts(1_234_567)
				.find((p) => p.type === 'group')?.value ?? null
		)
	} catch {
		return null
	}
}

const DIGIT = /\p{Nd}/u

/** Splits after each separator with a digit on both sides (en-ZA uses the same space after `R`). */
export function splitAtGroupSeparators(text: string, separator: string | null): string[] {
	if (!separator) return [text]
	const segments: string[] = []
	let start = 0
	for (let i = text.indexOf(separator); i !== -1; i = text.indexOf(separator, i + 1)) {
		const end = i + separator.length
		if (DIGIT.test(text.charAt(i - 1)) && DIGIT.test(text.charAt(end))) {
			segments.push(text.slice(start, end))
			start = end
		}
	}
	segments.push(text.slice(start))
	return segments
}

export function GroupedAmount({ text }: { text: string }): React.ReactElement {
	const { mode, currency, locale } = useCurrencyPreferences()
	// Mirrors `formatCurrency`'s branch: currency-less (or `NONE`) is decimal style.
	const symbolCurrency = mode === 'none' || currency === 'NONE' ? null : currency
	const segments = splitAtGroupSeparators(text, groupSeparator(locale, symbolCurrency))
	return (
		<>
			{segments.map((segment, i) => (
				// Index keys are correct here: the segments are a pure function of
				// `text` and have no identity of their own.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above
				<Fragment key={i}>
					{i > 0 && <wbr />}
					{segment}
				</Fragment>
			))}
		</>
	)
}
