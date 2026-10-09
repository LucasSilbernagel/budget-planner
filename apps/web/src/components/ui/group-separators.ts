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
