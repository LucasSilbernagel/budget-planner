import { describe, expect, it } from 'vitest'
import { buildCategoryBreakdown, type CategoryBreakdownItem } from '../categoryBreakdown.js'

const NAMES = new Map<string, string>([
	['cat-a', 'Groceries'],
	['cat-b', 'Housing'],
	['cat-c', 'Transport'],
])

const OPTIONS = { cadence: 'monthly' as const, uncategorizedLabel: 'Uncategorized' }

describe('buildCategoryBreakdown', () => {
	describe('grouping and frequency normalization', () => {
		it('merges two items sharing a categoryId into one frequency-normalized row', () => {
			// weekly 10000 → round(43333.33…) = 43333; + monthly 50000 = 93333.
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'weekly' },
				{ categoryId: 'cat-a', amount: 50000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.rows).toHaveLength(1)
			expect(result.rows[0]?.categoryId).toBe('cat-a')
			expect(result.rows[0]?.label).toBe('Groceries')
			expect(result.rows[0]?.totalCents).toBe(93333)
			expect(result.rows[0]?.count).toBe(2)
			expect(result.totalCents).toBe(93333)
		})

		it('does NOT sum raw entered amounts (the bug the overview pies once shipped)', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'weekly' },
				{ categoryId: 'cat-b', amount: 10000, frequency: 'annually' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			// weekly: round(10000 × 52/12) = 43333; annually: round(10000 / 12) = 833.
			expect(result.rows[0]?.totalCents).toBe(43333)
			expect(result.rows[1]?.totalCents).toBe(833)
		})

		it('keeps two items in DIFFERENT categories as two rows', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 50000, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: 30000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.rows).toHaveLength(2)
			expect(result.rows.map((row) => row.label)).toEqual(['Groceries', 'Housing'])
		})
	})

	describe('cadence', () => {
		it('expresses every total at the requested cadence', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'weekly' },
				{ categoryId: 'cat-a', amount: 50000, frequency: 'monthly' },
			]

			const monthly = buildCategoryBreakdown(items, NAMES, { ...OPTIONS, cadence: 'monthly' })
			const annually = buildCategoryBreakdown(items, NAMES, { ...OPTIONS, cadence: 'annually' })

			// Same 93333 bucket: monthly 93333; annually 93333 × 12 = 1119996.
			expect(monthly.rows[0]?.totalCents).toBe(93333)
			expect(annually.rows[0]?.totalCents).toBe(1119996)
			expect(annually.rows[0]?.totalCents).not.toBe(monthly.rows[0]?.totalCents)
			expect(annually.totalCents).toBe(1119996)
		})
	})

	describe('reconciliation', () => {
		it('reconciles at weekly, where per-bucket rounding is NOT trivially exact', () => {
			// A non-integral cadence (weekly, biweekly) is what exposes a wrong rounding order.
			// Per row: round(10000 × 12/52) = 2308; 7 × 2308 = 16156.
			const items: CategoryBreakdownItem[] = Array.from({ length: 7 }, (_, index) => ({
				categoryId: `cat-${index}`,
				amount: 10000,
				frequency: 'monthly' as const,
			}))
			const names = new Map(
				Array.from({ length: 7 }, (_, index) => [`cat-${index}`, `Category ${index}`] as const)
			)

			const result = buildCategoryBreakdown(items, names, { ...OPTIONS, cadence: 'weekly' })

			expect(result.rows).toHaveLength(7)
			for (const row of result.rows) {
				expect(row.totalCents).toBe(2308)
			}
			expect(result.totalCents).toBe(16156)
			expect(result.rows.reduce((sum, row) => sum + row.totalCents, 0)).toBe(result.totalCents)

			// Accepted divergence from the Overview card, which rounds once over the whole set:
			// round(70000 × 12/52) = 16154.
			expect(result.totalCents).not.toBe(16154)
		})

		it('rounds ONCE PER BUCKET, not per item, when many items share one category', () => {
			// Only a multi-item bucket separates per-bucket from per-item rounding:
			// round(70000 × 12/52) = 16154 vs 7 × round(10000 × 12/52) = 16156.
			const items: CategoryBreakdownItem[] = Array.from({ length: 7 }, () => ({
				categoryId: 'cat-a',
				amount: 10000,
				frequency: 'monthly' as const,
			}))

			const result = buildCategoryBreakdown(items, NAMES, { ...OPTIONS, cadence: 'weekly' })

			expect(result.rows).toHaveLength(1)
			expect(result.rows[0]?.count).toBe(7)
			expect(result.rows[0]?.totalCents).toBe(16154)
			expect(result.rows[0]?.totalCents).not.toBe(16156)
			expect(result.totalCents).toBe(16154)
		})

		it('rounds ONCE PER BUCKET at biweekly too — the other non-integral cadence', () => {
			// Biweekly: round(70000 × 12/26) = 32308 vs 7 × round(10000 × 12/26) = 32305.
			const items: CategoryBreakdownItem[] = Array.from({ length: 7 }, () => ({
				categoryId: 'cat-a',
				amount: 10000,
				frequency: 'monthly' as const,
			}))

			const result = buildCategoryBreakdown(items, NAMES, { ...OPTIONS, cadence: 'biweekly' })

			expect(result.rows).toHaveLength(1)
			expect(result.rows[0]?.count).toBe(7)
			expect(result.rows[0]?.totalCents).toBe(32308)
			expect(result.rows[0]?.totalCents).not.toBe(32305)
			expect(result.totalCents).toBe(32308)
			expect(result.rows.reduce((sum, row) => sum + row.totalCents, 0)).toBe(result.totalCents)
		})

		it('reconciles at monthly and annually too', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'weekly' },
				{ categoryId: 'cat-b', amount: 30000, frequency: 'biweekly' },
				{ categoryId: null, amount: 50000, frequency: 'monthly' },
			]

			for (const cadence of ['monthly', 'annually'] as const) {
				const result = buildCategoryBreakdown(items, NAMES, { ...OPTIONS, cadence })
				expect(result.rows.reduce((sum, row) => sum + row.totalCents, 0)).toBe(result.totalCents)
			}

			const monthly = buildCategoryBreakdown(items, NAMES, OPTIONS)
			expect(monthly.rows.map((row) => row.totalCents)).toEqual([65000, 43333, 50000])
			expect(monthly.totalCents).toBe(158333)
		})
	})

	describe('shares', () => {
		it('sums same-sign shares to 100%', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 60000, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: 30000, frequency: 'monthly' },
				{ categoryId: 'cat-c', amount: 10000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.totalCents).toBe(100000)
			expect(result.rows.map((row) => row.sharePercent)).toEqual([60, 30, 10])
			expect(result.rows.reduce((sum, row) => sum + row.sharePercent, 0)).toBeCloseTo(100, 6)
		})

		it('returns the UNROUNDED share float (display quantizes, the math does not)', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: 20000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			const share = result.rows[1]?.sharePercent ?? 0
			expect(share).toBeGreaterThan(33.3)
			expect(share).toBeLessThan(33.34)
			expect(Number.isInteger(share)).toBe(false)
		})

		it('yields 200%/100% for a mixed-sign pair — documented, not accidental', () => {
			// Math.abs on both sides means opposite-sign shares don't sum to 100.
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: -5000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.totalCents).toBe(5000)
			expect(result.rows[0]?.totalCents).toBe(10000)
			expect(result.rows[0]?.sharePercent).toBe(200)
			expect(result.rows[1]?.totalCents).toBe(-5000)
			expect(result.rows[1]?.sharePercent).toBe(100)
		})

		it('yields 0% for every row when opposite signs cancel EXACTLY', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: -10000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.totalCents).toBe(0)
			expect(result.rows.map((row) => row.totalCents)).toEqual([10000, -10000])
			expect(result.rows.map((row) => row.sharePercent)).toEqual([0, 0])
		})

		it('yields unbounded shares when opposite signs NEARLY cancel', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: -9999, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.totalCents).toBe(1)
			expect(result.rows[0]?.sharePercent).toBe(1000000)
			expect(result.rows[1]?.sharePercent).toBe(999900)
		})
	})

	describe('degenerate states', () => {
		it('returns an empty result for no items', () => {
			const result = buildCategoryBreakdown([], NAMES, OPTIONS)
			expect(result.rows).toEqual([])
			expect(result.totalCents).toBe(0)
		})

		it('gives every row a 0 share when the side totals 0 cents — never NaN', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 0, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: 0, frequency: 'weekly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.totalCents).toBe(0)
			for (const row of result.rows) {
				expect(row.sharePercent).toBe(0)
				expect(Number.isNaN(row.sharePercent)).toBe(false)
				expect(Number.isFinite(row.sharePercent)).toBe(true)
			}
		})

		it('collapses every uncategorized item into ONE 100% row', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: null, amount: 10000, frequency: 'monthly' },
				{ categoryId: undefined, amount: 20000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.rows).toHaveLength(1)
			expect(result.rows[0]?.categoryId).toBeNull()
			expect(result.rows[0]?.label).toBe('Uncategorized')
			expect(result.rows[0]?.totalCents).toBe(30000)
			expect(result.rows[0]?.count).toBe(2)
			expect(result.rows[0]?.sharePercent).toBe(100)
		})

		it('folds a DANGLING categoryId into Uncategorized and never leaks the raw id', () => {
			const danglingId = '9f1c2b7e-0000-4aaa-8bbb-ccccdddd1111'
			const items: CategoryBreakdownItem[] = [
				{ categoryId: danglingId, amount: 10000, frequency: 'monthly' },
				{ categoryId: null, amount: 5000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.rows).toHaveLength(1)
			expect(result.rows[0]?.categoryId).toBeNull()
			expect(result.rows[0]?.totalCents).toBe(15000)
			expect(result.rows[0]?.count).toBe(2)
			for (const row of result.rows) {
				expect(row.label).not.toContain(danglingId)
			}
		})

		it('folds a BLANK resolved name into Uncategorized rather than a blank-labelled row', () => {
			const names = new Map([['cat-blank', '   ']])
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-blank', amount: 10000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, names, OPTIONS)

			expect(result.rows).toHaveLength(1)
			expect(result.rows[0]?.categoryId).toBeNull()
			expect(result.rows[0]?.label).toBe('Uncategorized')
			for (const row of result.rows) {
				expect(row.label).not.toBe('')
			}
		})

		it('trims a padded category name rather than keying on the padding', () => {
			const names = new Map([['cat-pad', '  Groceries  ']])
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-pad', amount: 10000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, names, OPTIONS)

			expect(result.rows[0]?.label).toBe('Groceries')
			expect(result.rows[0]?.categoryId).toBe('cat-pad')
		})

		it('enumerates ROWS, not categories — an unused category produces no row', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.rows).toHaveLength(1)
			expect(result.rows.map((row) => row.label)).not.toContain('Housing')
			expect(result.rows.map((row) => row.label)).not.toContain('Transport')
		})
	})

	describe('ordering', () => {
		it('sorts by descending magnitude and keeps Uncategorized LAST even when largest', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: null, amount: 90000, frequency: 'monthly' },
				{ categoryId: 'cat-a', amount: 10000, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: 50000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.rows.map((row) => row.label)).toEqual(['Housing', 'Groceries', 'Uncategorized'])
			expect(result.rows[2]?.totalCents).toBe(90000)
		})

		it('sorts by MAGNITUDE, so a large negative row outranks a small positive one', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 1000, frequency: 'monthly' },
				{ categoryId: 'cat-b', amount: -80000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

			expect(result.rows.map((row) => row.label)).toEqual(['Housing', 'Groceries'])
		})

		it('breaks an exact tie by label ascending', () => {
			const names = new Map([
				['cat-z', 'Zebra'],
				['cat-al', 'Alpha'],
			])
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-z', amount: 50000, frequency: 'monthly' },
				{ categoryId: 'cat-al', amount: 50000, frequency: 'monthly' },
			]

			const result = buildCategoryBreakdown(items, names, OPTIONS)

			expect(result.rows.map((row) => row.label)).toEqual(['Alpha', 'Zebra'])
		})

		it('is TOTAL: equal magnitude AND equal label still resolves deterministically', () => {
			// Same-name categories across profiles are reachable, so ordering needs an id tie-break.
			const names = new Map([
				['cat-zzz', 'Groceries'],
				['cat-aaa', 'Groceries'],
			])
			const forward: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-zzz', amount: 50000, frequency: 'monthly' },
				{ categoryId: 'cat-aaa', amount: 50000, frequency: 'monthly' },
			]
			const reversed = [...forward].reverse()

			const a = buildCategoryBreakdown(forward, names, OPTIONS)
			const b = buildCategoryBreakdown(reversed, names, OPTIONS)

			expect(a.rows.map((row) => row.categoryId)).toEqual(['cat-aaa', 'cat-zzz'])
			expect(b.rows.map((row) => row.categoryId)).toEqual(['cat-aaa', 'cat-zzz'])
		})
	})

	describe('malformed input throws rather than silently dropping data', () => {
		it('throws on an unknown frequency', () => {
			const items = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'quarterly' },
			] as unknown as CategoryBreakdownItem[]

			expect(() => buildCategoryBreakdown(items, NAMES, OPTIONS)).toThrow()
		})

		it('throws on a non-finite amount', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: Number.NaN, frequency: 'monthly' },
			]

			expect(() => buildCategoryBreakdown(items, NAMES, OPTIONS)).toThrow()
		})

		it('throws on an unknown cadence', () => {
			const items: CategoryBreakdownItem[] = [
				{ categoryId: 'cat-a', amount: 10000, frequency: 'monthly' },
			]

			expect(() =>
				buildCategoryBreakdown(items, NAMES, {
					...OPTIONS,
					cadence: 'quarterly' as unknown as typeof OPTIONS.cadence,
				})
			).toThrow()
		})
	})
})
