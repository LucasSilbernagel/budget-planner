/**
 * Per-category breakdown tests (story 30.5, FR54 part 2).
 *
 * Concrete floors only: every money figure is a hand-worked integer-cent
 * literal, never a value recomputed with the helper under test. `toBeCloseTo`
 * appears exactly once, on a percentage sum — money is always `toBe`.
 */

import { describe, expect, it } from 'vitest'
import { type CategoryBreakdownItem, buildCategoryBreakdown } from '../categoryBreakdown.js'

const NAMES = new Map<string, string>([
  ['cat-a', 'Groceries'],
  ['cat-b', 'Housing'],
  ['cat-c', 'Transport'],
])

const OPTIONS = { cadence: 'monthly' as const, uncategorizedLabel: 'Uncategorized' }

describe('buildCategoryBreakdown', () => {
  describe('grouping and frequency normalization (AC-1)', () => {
    it('merges two items sharing a categoryId into one frequency-normalized row', () => {
      // Worked by hand, at cadence `monthly`:
      //   $100.00 weekly  → Math.round(10000 * 52/12) = Math.round(43333.33…) = 43333
      //   $500.00 monthly → 50000
      //   bucket (monthly space)                      = 93333
      //   row total = denormalizeFromMonthly(93333, 'monthly')  = 93333
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
      // A weekly $100 and an annual $100 are wildly different per-month sums.
      // Raw summing would make both rows 10000; normalization must not.
      const items: CategoryBreakdownItem[] = [
        { categoryId: 'cat-a', amount: 10000, frequency: 'weekly' },
        { categoryId: 'cat-b', amount: 10000, frequency: 'annually' },
      ]

      const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

      // weekly:   Math.round(10000 * 52/12) = 43333
      // annually: Math.round(10000 * 1/12)  = 833
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

  describe('cadence (AC-3)', () => {
    it('expresses every total at the requested cadence', () => {
      const items: CategoryBreakdownItem[] = [
        { categoryId: 'cat-a', amount: 10000, frequency: 'weekly' },
        { categoryId: 'cat-a', amount: 50000, frequency: 'monthly' },
      ]

      const monthly = buildCategoryBreakdown(items, NAMES, { ...OPTIONS, cadence: 'monthly' })
      const annually = buildCategoryBreakdown(items, NAMES, { ...OPTIONS, cadence: 'annually' })

      // Same bucket (93333 monthly), one denormalization per bucket:
      //   monthly:  93333 / 1      = 93333
      //   annually: 93333 / (1/12) = 1119996
      expect(monthly.rows[0]?.totalCents).toBe(93333)
      expect(annually.rows[0]?.totalCents).toBe(1119996)
      // A helper that ignored `cadence` would pass the monthly assertion alone.
      expect(annually.rows[0]?.totalCents).not.toBe(monthly.rows[0]?.totalCents)
      expect(annually.totalCents).toBe(1119996)
    })
  })

  describe('reconciliation (AC-2)', () => {
    it('reconciles at weekly, where per-bucket rounding is NOT trivially exact', () => {
      // ⚠️ A NON-INTEGRAL cadence is what catches a wrong rounding order:
      // monthly (×1) and annually (×12) are integral, so they reconcile no
      // matter where the rounding happens. TWO cadences qualify, not one —
      // `weekly` (×12/52) here and `biweekly` (×12/26) below. `biweekly` is
      // unreachable from the UI (`OverviewDuration` offers three values) but
      // the exported API takes the full `Frequency` union, so it is a real
      // caller-facing path.
      //
      // Seven $100.00/month items, each in its OWN category:
      //   bucket (monthly space) per row                      = 10000
      //   row total = Math.round(10000 * 12/52) = Math.round(2307.69…) = 2308
      //   result total = 7 × 2308                             = 16156
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

      // The ACCEPTED, documented divergence from the Financial Overview card,
      // which rounds ONCE over the whole set: Math.round(70000 * 12/52) = 16154.
      // Pinned as a literal so a later "fix" that breaks per-side reconciliation
      // shows up here as a deliberate change rather than a silent one.
      expect(result.totalCents).not.toBe(16154)
    })

    it('rounds ONCE PER BUCKET, not per item, when many items share one category', () => {
      // ⚠️⚠️ THE TEST ABOVE CANNOT CATCH A PER-ITEM DENORMALIZATION: with one
      // item per bucket the two orders are arithmetically identical. Only a
      // MULTI-ITEM bucket separates them.
      //
      // Seven $100.00/month items, all in ONE category, at `weekly`:
      //   correct (per bucket): Math.round(70000 * 12/52) = Math.round(16153.8…) = 16154
      //   wrong (per item):     7 × Math.round(10000 * 12/52) = 7 × 2308      = 16156
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
      // The sibling of the test above, on the cadence the UI cannot currently
      // reach. Seven $100.00/month items, all in ONE category, at `biweekly`:
      //   correct (per bucket): Math.round(70000 * 12/26) = Math.round(32307.69…) = 32308
      //   wrong (per item):     7 × Math.round(10000 * 12/26) = 7 × 4615      = 32305
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

      // And the literal figures at monthly:
      //   weekly   10000 → 43333
      //   biweekly 30000 → Math.round(30000 * 26/12) = 65000
      //   monthly  50000 → 50000  (Uncategorized)
      const monthly = buildCategoryBreakdown(items, NAMES, OPTIONS)
      expect(monthly.rows.map((row) => row.totalCents)).toEqual([65000, 43333, 50000])
      expect(monthly.totalCents).toBe(158333)
    })
  })

  describe('shares (AC-2)', () => {
    it('sums same-sign shares to 100%', () => {
      const items: CategoryBreakdownItem[] = [
        { categoryId: 'cat-a', amount: 60000, frequency: 'monthly' },
        { categoryId: 'cat-b', amount: 30000, frequency: 'monthly' },
        { categoryId: 'cat-c', amount: 10000, frequency: 'monthly' },
      ]

      const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

      expect(result.totalCents).toBe(100000)
      expect(result.rows.map((row) => row.sharePercent)).toEqual([60, 30, 10])
      // Percentages are the ONE place toBeCloseTo is allowed — never money.
      expect(result.rows.reduce((sum, row) => sum + row.sharePercent, 0)).toBeCloseTo(100, 6)
    })

    it('returns the UNROUNDED share float (display quantizes, the math does not)', () => {
      const items: CategoryBreakdownItem[] = [
        { categoryId: 'cat-a', amount: 10000, frequency: 'monthly' },
        { categoryId: 'cat-b', amount: 20000, frequency: 'monthly' },
      ]

      const result = buildCategoryBreakdown(items, NAMES, OPTIONS)

      // 10000 / 30000 = 33.333…%, not 33 and not 33.3
      const share = result.rows[1]?.sharePercent ?? 0
      expect(share).toBeGreaterThan(33.3)
      expect(share).toBeLessThan(33.34)
      expect(Number.isInteger(share)).toBe(false)
    })

    it('yields 200%/100% for a mixed-sign pair — documented, not accidental', () => {
      // ⚠️ `Math.abs` on BOTH sides (the shipped `getPercentageOfTotal` shape)
      // means shares do NOT sum to 100 when rows have opposite signs. Pinned
      // here so the behaviour is intentional rather than discovered as a bug.
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
      // ⚠️ The degenerate boundary of the rule above, and the reason the web
      // layer suppresses the Share column on a sign-mixed side: the zero-guard
      // fires on a side holding real money, so both rows read 0% while showing
      // ±$100.00. Correct per the guard, meaningless to a reader — pinned here
      // so the suppression rule upstream has a reason recorded in the core.
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
      // The other degenerate boundary: a 1-cent net denominator. No threshold
      // can separate this from the 200%/100% case above, which is why the web
      // layer keys its suppression on sign homogeneity (an EXACT test) rather
      // than on the magnitude of the denominator.
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

  describe('degenerate states (AC-4)', () => {
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
      // The `resolveCategoryLabel` empty-string guard recurring here: a
      // rehydrated or server-pulled category is not validated by the store, so
      // a whitespace-only name is reachable without a bug anywhere.
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

      // NAMES carries three categories; only one is used.
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
      // ⚠️ Reachable, not theoretical: the breakdown resolves labels through the
      // UNSCOPED name map, so two ids from different profiles can carry the same
      // name. Without an id tie-break the comparator returns 0 and the order
      // falls back to input order — store order, which can differ between
      // devices holding identical data.
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

      // Same data in either input order yields the same row order.
      expect(a.rows.map((row) => row.categoryId)).toEqual(['cat-aaa', 'cat-zzz'])
      expect(b.rows.map((row) => row.categoryId)).toEqual(['cat-aaa', 'cat-zzz'])
    })
  })

  describe('malformed input throws rather than silently dropping data (AC-4 contract)', () => {
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
