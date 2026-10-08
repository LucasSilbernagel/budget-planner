import {
	CONSOLIDATED_CURRENCIES,
	formatCurrency,
	getSupportedCurrencies,
	localeForCurrency,
} from '@budget-planner/core'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../../../stores/currencyStore'
import { GroupedAmount, groupSeparator, splitAtGroupSeparators } from '../GroupedAmount'

/** The element's children as a token list: text runs, and `|` for each `<wbr>`. */
function tokens(el: Element): string[] {
	return Array.from(el.childNodes).map((n) =>
		n.nodeType === Node.ELEMENT_NODE
			? `<${(n as Element).tagName.toLowerCase()}>`
			: (n.textContent ?? '')
	)
}

function renderAmount(text: string) {
	const { container } = render(
		<p data-testid="figure">
			<GroupedAmount text={text} />
		</p>
	)
	const el = container.querySelector('[data-testid="figure"]')
	if (!el) throw new Error('figure not rendered')
	return el
}

/** Formats exactly as `useFormattedAmount` does for the given store state. */
function formatLikeTheApp(cents: number, mode: 'none' | 'symbol', currency: string): string {
	const locale = mode === 'none' ? 'en-US' : localeForCurrency(currency)
	return formatCurrency(cents, { mode, currency, locale })
}

const REAL_STATE = useCurrencyStore.getState()
afterEach(() => {
	useCurrencyStore.setState(REAL_STATE, true)
})

describe('GroupedAmount', () => {
	it('en-US symbol mode: a <wbr> after every "," group separator and nowhere else', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
		const text = formatLikeTheApp(101322222180, 'symbol', 'USD')
		expect(text).toBe('$1,013,222,221.80')
		const el = renderAmount(text)
		expect(tokens(el)).toEqual(['$1,', '<wbr>', '013,', '<wbr>', '222,', '<wbr>', '221.80'])
		expect(el.textContent).toBe(text)
	})

	it('a negative figure: the sign and symbol stay with the first group', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
		const text = formatLikeTheApp(-98765432100, 'symbol', 'USD')
		expect(text).toBe('-$987,654,321.00')
		const el = renderAmount(text)
		expect(tokens(el)).toEqual(['-$987,', '<wbr>', '654,', '<wbr>', '321.00'])
		expect(el.textContent).toBe(text)
	})

	it('currency-less mode (grouping fixed to en-US even with a retained EUR)', () => {
		useCurrencyStore.setState({ mode: 'none', currency: 'EUR' })
		const text = formatLikeTheApp(1234567890, 'none', 'EUR')
		expect(text).toBe('12,345,678.90')
		const el = renderAmount(text)
		expect(tokens(el)).toEqual(['12,', '<wbr>', '345,', '<wbr>', '678.90'])
		expect(el.textContent).toBe(text)
	})

	it('de-DE (EUR): breaks after "." group separators, never after the "," decimal', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
		const text = formatLikeTheApp(1234567890, 'symbol', 'EUR')
		// `12.345.678,90 €` with a no-break space before the symbol.
		expect(text).toBe('12.345.678,90 €')
		const el = renderAmount(text)
		expect(tokens(el)).toEqual(['12.', '<wbr>', '345.', '<wbr>', '678,90 €'])
		expect(el.textContent).toBe(text)
	})

	it('en-ZA (ZAR): the group separator is also the symbol separator; only the digit-flanked ones break', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'ZAR' })
		const text = formatLikeTheApp(-123456789, 'symbol', 'ZAR')
		const sep = groupSeparator('en-ZA')
		expect(sep).not.toBeNull()
		expect(sep).not.toBe(',')
		// The same character sits between "R" and the first digit: no break there.
		expect(text).toBe(`-R${sep}1${sep}234${sep}567,89`)
		const el = renderAmount(text)
		expect(tokens(el)).toEqual([`-R${sep}1${sep}`, '<wbr>', `234${sep}`, '<wbr>', '567,89'])
		expect(el.textContent).toBe(text)
	})

	it('a figure under 1,000 has no group, so no <wbr>', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
		const el = renderAmount('$999.99')
		expect(tokens(el)).toEqual(['$999.99'])
	})

	it('the <wbr> count equals the group-separator count for every supported currency', () => {
		// The selectable codes plus the consolidated dollar family (CAD/AUD/MXN),
		// which stay formattable for legacy/synced values: 9 + 3 = 12.
		const currencies = [
			...getSupportedCurrencies().filter((c) => c !== 'NONE'),
			...Object.keys(CONSOLIDATED_CURRENCIES),
		]
		expect(currencies).toHaveLength(12)
		for (const currency of currencies) {
			useCurrencyStore.setState({ mode: 'symbol', currency })
			const locale = localeForCurrency(currency)
			const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(
				-1234567890.12
			)
			const groups = parts.filter((p) => p.type === 'group').length
			const text = formatLikeTheApp(-123456789012, 'symbol', currency)
			const el = renderAmount(text)
			expect(el.querySelectorAll('wbr'), currency).toHaveLength(groups)
			expect(el.textContent, currency).toBe(text)
		}
	})
})

describe('groupSeparator', () => {
	it('reads the CURRENCY-style separator when given a currency (de-AT differs by style)', () => {
		// de-AT groups decimals with a no-break space but currency amounts with `.` (ICU 78).
		expect(groupSeparator('de-AT')).toBe('\u00a0')
		expect(groupSeparator('de-AT', 'EUR')).toBe('.')
	})

	it('returns null for an invalid currency instead of throwing', () => {
		expect(groupSeparator('en-US', 'NOT-A-CODE')).toBeNull()
	})
})

describe('splitAtGroupSeparators', () => {
	it('splits only after a separator with a digit on both sides', () => {
		expect(splitAtGroupSeparators('1,234,567.89', ',')).toEqual(['1,', '234,', '567.89'])
		expect(splitAtGroupSeparators('a, b,1', ',')).toEqual(['a, b,1'])
		expect(splitAtGroupSeparators('١٬٢٣٤', '٬')).toEqual(['١٬', '٢٣٤'])
	})

	it('returns the text whole when the locale has no group separator', () => {
		expect(splitAtGroupSeparators('1234567.89', null)).toEqual(['1234567.89'])
	})
})
