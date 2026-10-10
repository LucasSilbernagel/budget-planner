import { describe, expect, it } from 'vitest'
import { decimalCommaToPoint, formatSharePercent } from '../percent-text'

describe('decimalCommaToPoint', () => {
	it.each([
		['2,5', '2.5'],
		['2,5%', '2.5%'],
		[' 2,5 % ', ' 2.5 % '],
		['-2,5', '-2.5'],
		[',5', '.5'],
		['2,', '2.'],
	])('reads the single comma in %j as the decimal point', (raw, expected) => {
		expect(decimalCommaToPoint(raw)).toBe(expected)
	})

	it.each([['2.5'], ['1.000,5'], ['2,5,1'], ['1,000.5'], ['abc'], ['']])(
		'leaves %j unchanged',
		(raw) => {
			expect(decimalCommaToPoint(raw)).toBe(raw)
		}
	)
})

describe('formatSharePercent', () => {
	it.each([
		[8, 1000, '0.8%'],
		[1, 1000, '0.1%'],
		[4, 10000, '0%'],
		[5, 10000, '0.1%'],
		[460, 1000, '46%'],
		[2, 3, '66.7%'],
		[1000, 1000, '100%'],
		[1320, 1000, '132%'],
		[0, 1000, '0%'],
	])('%d of %d reads %s', (part, whole, expected) => {
		expect(formatSharePercent(part, whole)).toBe(expected)
	})
})
