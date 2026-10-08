import { describe, expect, it } from 'vitest'
import { isMarked, summarizeEndingExpenses } from '../retirement-ending-expenses'

const row = (extra: Record<string, unknown> = {}) => ({
	amount: 100_000,
	frequency: 'monthly',
	...extra,
})

describe('isMarked — `=== true`, never truthy', () => {
	it('is true only for a real boolean true', () => {
		expect(isMarked(row({ endsBeforeRetirement: true }) as never)).toBe(true)
	})

	it.each([
		['absent', {}],
		['false', { endsBeforeRetirement: false }],
		['undefined', { endsBeforeRetirement: undefined }],
	])('is false when the key is %s', (_label, extra) => {
		expect(isMarked(row(extra) as never)).toBe(false)
	})

	it('⚠️ is false for a persisted TRUTHY STRING — localStorage is user-editable', () => {
		// A `"false"` string is truthy. A truthy read here would mark a row the user
		// never ticked and silently cut their retirement target.
		expect(isMarked(row({ endsBeforeRetirement: 'false' }) as never)).toBe(false)
		expect(isMarked(row({ endsBeforeRetirement: 'true' }) as never)).toBe(false)
		expect(isMarked(row({ endsBeforeRetirement: 1 }) as never)).toBe(false)
	})
})

describe('summarizeEndingExpenses — nothing marked', () => {
	it('returns `none` for an empty list', () => {
		expect(summarizeEndingExpenses([])).toEqual({ state: 'none' })
	})

	it('returns `none` when rows exist but none is marked', () => {
		expect(summarizeEndingExpenses([row(), row({ amount: 50_000 })])).toEqual({ state: 'none' })
	})

	it('⚠️ returns `none` rather than `unreadable` when the only corrupt row is unmarked', () => {
		expect(summarizeEndingExpenses([{ amount: 'oops', frequency: 'monthly' }])).toEqual({
			state: 'none',
		})
	})
})

describe('summarizeEndingExpenses — the figures', () => {
	it('sums a single marked monthly row', () => {
		const result = summarizeEndingExpenses([
			row({ amount: 180_000, endsBeforeRetirement: true }),
			row({ amount: 240_000 }),
		])
		expect(result).toEqual({
			state: 'ok',
			totalMonthlyCents: 420_000,
			markedMonthlyCents: 180_000,
			remainingMonthlyCents: 240_000,
		})
	})

	it('⚠️ NORMALIZES a non-monthly cadence rather than summing raw amounts', () => {
		// Core multiplies by the exact fractions 52/12, 26/12 and 1/12, not 4.333 etc., and rounds
		// each item: 10_000c x 52/12 = 43_333.33… -> 43_333c.
		const result = summarizeEndingExpenses([
			row({ amount: 10_000, frequency: 'weekly', endsBeforeRetirement: true }),
			row({ amount: 120_000, frequency: 'annually' }),
		])
		expect(result).toMatchObject({ state: 'ok', markedMonthlyCents: 43_333 })
		const ok = result as Extract<typeof result, { state: 'ok' }>
		expect(ok.totalMonthlyCents).toBe(53_333)
		expect(ok.remainingMonthlyCents).toBe(10_000)
		expect(ok.totalMonthlyCents).not.toBe(130_000)
	})

	it('handles every marked row ending — the remainder is exactly zero', () => {
		const result = summarizeEndingExpenses([row({ amount: 180_000, endsBeforeRetirement: true })])
		expect(result).toMatchObject({
			state: 'ok',
			totalMonthlyCents: 180_000,
			markedMonthlyCents: 180_000,
			remainingMonthlyCents: 0,
		})
	})

	it('sums several marked rows across mixed cadences', () => {
		// biweekly 20_000c x 26/12 = 43_333.33… -> round = 43_333c
		const result = summarizeEndingExpenses([
			row({ amount: 180_000, endsBeforeRetirement: true }),
			row({ amount: 20_000, frequency: 'biweekly', endsBeforeRetirement: true }),
			row({ amount: 60_000 }),
		])
		const ok = result as Extract<typeof result, { state: 'ok' }>
		expect(ok.state).toBe('ok')
		expect(ok.markedMonthlyCents).toBe(223_333)
		expect(ok.totalMonthlyCents).toBe(283_333)
		expect(ok.remainingMonthlyCents).toBe(60_000)
	})
})

describe('summarizeEndingExpenses — REFUSES rather than guessing', () => {
	it('⚠️⚠️ refuses a persisted STRING amount — the concatenation trap', () => {
		// A string amount makes `+` concatenate, giving a plausible finite total with no NaN.
		expect(
			summarizeEndingExpenses([
				row({ amount: 180_000, endsBeforeRetirement: true }),
				row({ amount: '240000' }),
			])
		).toEqual({ state: 'unreadable' })
	})

	it('⚠️ and the string-amount row is the MARKED one', () => {
		expect(
			summarizeEndingExpenses([
				row({ amount: '180000', endsBeforeRetirement: true }),
				row({ amount: 240_000, endsBeforeRetirement: true }),
			])
		).toEqual({ state: 'unreadable' })
	})

	it.each([
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['-Infinity', Number.NEGATIVE_INFINITY],
	])('refuses a non-finite amount (%s)', (_label, amount) => {
		expect(
			summarizeEndingExpenses([
				row({ amount: 180_000, endsBeforeRetirement: true }),
				row({ amount }),
			])
		).toEqual({ state: 'unreadable' })
	})

	it('refuses an unrecognised frequency', () => {
		expect(
			summarizeEndingExpenses([
				row({ amount: 180_000, endsBeforeRetirement: true }),
				row({ frequency: 'fortnightly' }),
			])
		).toEqual({ state: 'unreadable' })
	})

	it('refuses a null or primitive array element without throwing', () => {
		// zustand runs `migrate` only on a version mismatch, so a current-version blob carries
		// this straight into state.
		expect(
			summarizeEndingExpenses([row({ amount: 180_000, endsBeforeRetirement: true }), null])
		).toEqual({ state: 'unreadable' })
		expect(
			summarizeEndingExpenses([row({ amount: 180_000, endsBeforeRetirement: true }), 42])
		).toEqual({ state: 'unreadable' })
	})

	it('⚠️ refuses a FRACTIONAL cent, which is finite and would show one number and adopt another', () => {
		expect(
			summarizeEndingExpenses([
				row({ amount: 180_000.5, endsBeforeRetirement: true }),
				row({ amount: 240_000 }),
			])
		).toEqual({ state: 'unreadable' })
	})

	it.each([
		['an unmarked row', { amount: -100_000 }, { amount: 50_000, endsBeforeRetirement: true }],
		['the marked row', { amount: -50_000, endsBeforeRetirement: true }, { amount: 100_000 }],
	])('⚠️ refuses a NEGATIVE amount on %s (code review 65.2)', (_label, a, b) => {
		// Reachable from hand-edited localStorage, which bypasses the database CHECK.
		expect(summarizeEndingExpenses([row(a), row(b)])).toEqual({ state: 'unreadable' })
	})

	it('⚠️⚠️ refuses an amount that is safe MONTHLY but overflows when expressed ANNUALLY', () => {
		// `toAnnualIncomeCents` throws when ×12 leaves the safe range and nothing catches it on
		// the render path; the form can save this value.
		const amount = 800_000_000_000_000
		expect(Number.isSafeInteger(amount)).toBe(true)
		expect(Number.isSafeInteger(amount * 12)).toBe(false)
		expect(summarizeEndingExpenses([row({ amount, endsBeforeRetirement: true })])).toEqual({
			state: 'unreadable',
		})
	})

	it('⚠️ PARITY: the refusal threshold is EXACTLY the renderer\u2019s throw threshold', () => {
		// Must match the bound `toAnnualIncomeCents` throws on:
		// 9_007_199_254_740_991 / 12 = 750_599_937_895_082.58...
		const LARGEST_OK = 750_599_937_895_082
		expect(Number.isSafeInteger(LARGEST_OK * 12)).toBe(true)
		expect(Number.isSafeInteger((LARGEST_OK + 1) * 12)).toBe(false)

		expect(
			summarizeEndingExpenses([row({ amount: LARGEST_OK, endsBeforeRetirement: true })])
		).toMatchObject({ state: 'ok' })
		expect(
			summarizeEndingExpenses([row({ amount: LARGEST_OK + 1, endsBeforeRetirement: true })])
		).toEqual({ state: 'unreadable' })
	})
})
