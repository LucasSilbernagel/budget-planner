import { describe, expect, it, vi } from 'vitest'
import { AMOUNT_NOT_A_NUMBER_MESSAGE, parseMoneyDraft, reformatAmountOnBlur } from '../money-input'

describe('reformatAmountOnBlur', () => {
	it.each([
		['42000', 'en-US', '42,000.00'],
		['42000.5', 'en-US', '42,000.50'],
		['1,234.5', 'en-US', '1,234.50'],
		['42000', 'de-DE', '42.000,00'],
		['42.000,5', 'de-DE', '42.000,50'],
		['1.2.3', 'en-US', '0.00'],
	])('%s (%s) → %s', (value, locale, expected) => {
		const setter = vi.fn()
		reformatAmountOnBlur(value, locale, setter)
		expect(setter).toHaveBeenCalledExactlyOnceWith(expected)
	})

	it.each([[''], ['   '], ['-'], ['.'], ['-.'], [',']])(
		'leaves %j alone (empty and no-digit guards)',
		(value) => {
			const setter = vi.fn()
			reformatAmountOnBlur(value, 'en-US', setter)
			expect(setter).not.toHaveBeenCalled()
		}
	)
})

describe('parseMoneyDraft', () => {
	it.each([
		['42000', 'en-US', 4_200_000],
		['42,000', 'en-US', 4_200_000],
		['42000.5', 'en-US', 4_200_050],
		['42,000.00', 'en-US', 4_200_000],
		['42.000,50', 'de-DE', 4_200_050],
		['1.239', 'en-US', 123],
		['-500', 'en-US', -50_000],
		['0', 'en-US', 0],
		['0.00', 'en-US', 0],
	])('%s (%s) → %i cents', (raw, locale, cents) => {
		expect(parseMoneyDraft(raw, locale)).toEqual({ cents })
	})

	it.each([[''], ['  '], ['-'], ['.'], ['-.']])('%j is 0 (empty / digit-free partial)', (raw) => {
		expect(parseMoneyDraft(raw, 'en-US')).toEqual({ cents: 0 })
	})

	it.each([['1.2.3'], ['1e5'], ['9'.repeat(309)]])('%s is refused, not read as 0', (raw) => {
		expect(parseMoneyDraft(raw, 'en-US')).toEqual({ problem: AMOUNT_NOT_A_NUMBER_MESSAGE })
	})

	it('uses the locale: de-DE 1.2.3 is still malformed, en-US 1,234 is grouped', () => {
		expect(parseMoneyDraft('1,2,3', 'de-DE')).toEqual({ problem: AMOUNT_NOT_A_NUMBER_MESSAGE })
		expect(parseMoneyDraft('1,234', 'en-US')).toEqual({ cents: 123_400 })
	})

	it('keeps a magnitude past the money limit for the caller to refuse', () => {
		expect(parseMoneyDraft('30000000', 'en-US')).toEqual({ cents: 3_000_000_000 })
	})
})
