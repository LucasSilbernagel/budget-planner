/**
 * A single `,` is a decimal point in percent fields (they have no grouping). Convert before
 * parseFloat, which reads '2,5' as 2.
 */
export function decimalCommaToPoint(raw: string): string {
	const commas = raw.split(',').length - 1
	return commas === 1 && !raw.includes('.') ? raw.replace(',', '.') : raw
}
