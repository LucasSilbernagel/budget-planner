import { describe, expect, it } from 'vitest'
import type { SortKeyExtractor, SortKeyExtractors } from '../table-sort'
import { sortRowsBy } from '../table-sort'
import {
  createBalanceSortExtractors,
  createFlowSortExtractors,
  createSavingsSortExtractors,
} from '../table-sort-keys'

/**
 * The per-column sort KEYS for story 34.2 (FR61).
 *
 * Two properties are load-bearing and are asserted directly rather than through
 * a rendered table: a key is never `NaN` and never throws, and a key agrees with
 * what the cell displays.
 */

/**
 * Narrows a PARTIAL extractor map for a key the test knows is present.
 *
 * The map is partial because a column can be unavailable in some states (Category
 * is Premium-only). A missing key here is a test-setup error, not a condition
 * under test, so it throws loudly rather than being silently optional-chained
 * into `undefined` — which would turn an assertion about ordering into an
 * assertion about nothing.
 */
function keyOf<Row, Key extends string>(
  extractorMap: SortKeyExtractors<Row, Key>,
  key: Key
): SortKeyExtractor<Row> {
  const extractor = extractorMap[key]
  if (extractor === undefined) {
    throw new Error(`test setup: no extractor for "${key}"`)
  }
  return extractor
}

const flowRow = (
  name: string,
  amount: number,
  frequency: string,
  categoryId: string | null = null
) => ({ name, amount, frequency, categoryId })

describe('flow (Income / Expenses) sort keys', () => {
  const extractors = createFlowSortExtractors(new Map(), true)

  it('normalizes Amount by frequency rather than reading the raw number', () => {
    // ⚠️ The fixture whose RAW and NORMALIZED orders disagree. Raw ascending is
    // 500_00 (monthly) then 600_00 (annually); normalized ascending is the
    // annual row first, because 600_00/12 = 5000 < 500_00.
    const monthly = flowRow('monthly', 500_00, 'monthly')
    const annual = flowRow('annual', 600_00, 'annually')
    expect(keyOf(extractors, 'amount')(annual)).toBe(5000)
    expect(keyOf(extractors, 'amount')(monthly)).toBe(500_00)
    expect(
      sortRowsBy([monthly, annual], keyOf(extractors, 'amount'), 'asc').map((r) => r.name)
    ).toEqual(['annual', 'monthly'])
  })

  it('orders Frequency by cadence, not alphabetically', () => {
    const rows = [
      flowRow('a', 100, 'annually'),
      flowRow('w', 100, 'weekly'),
      flowRow('m', 100, 'monthly'),
      flowRow('b', 100, 'biweekly'),
    ]
    // Alphabetical would be annually, biweekly, monthly, weekly — i.e. exactly
    // the reverse of the meaningful order for two of the four.
    expect(sortRowsBy(rows, keyOf(extractors, 'frequency'), 'asc').map((r) => r.name)).toEqual([
      'w',
      'b',
      'm',
      'a',
    ])
  })

  it('returns null — never NaN — for a corrupt amount or an unknown cadence', () => {
    expect(keyOf(extractors, 'amount')(flowRow('bad-amount', Number.NaN, 'monthly'))).toBeNull()
    expect(
      keyOf(extractors, 'amount')(flowRow('inf', Number.POSITIVE_INFINITY, 'monthly'))
    ).toBeNull()
    expect(keyOf(extractors, 'amount')(flowRow('bad-freq', 100, 'fortnightly'))).toBeNull()
    // ⚠️ The Frequency key has its own guard: getNormalizationMultiplier does not
    // throw on an unknown cadence, it returns undefined, so an unguarded key
    // would yield NaN here and silently scramble the array.
    expect(keyOf(extractors, 'frequency')(flowRow('bad-freq', 100, 'fortnightly'))).toBeNull()
  })

  it('never throws on a row core would reject', () => {
    expect(() => keyOf(extractors, 'amount')(flowRow('x', Number.NaN, 'nope'))).not.toThrow()
  })

  it('sorts Category by the RESOLVED label, with every unresolvable row last', () => {
    const names = new Map([
      ['cat-z', 'Zebra'],
      ['cat-a', 'Apple'],
      // A blank name is what separates `resolveCategoryName` from a raw map
      // lookup: the raw lookup returns '   ', which would sort FIRST, while the
      // cell renders the uncategorized placeholder.
      ['cat-blank', '   '],
    ])
    const withNames = createFlowSortExtractors(names, true)
    const rows = [
      flowRow('zebra', 1, 'monthly', 'cat-z'),
      flowRow('blank', 1, 'monthly', 'cat-blank'),
      flowRow('none', 1, 'monthly', null),
      flowRow('dangling', 1, 'monthly', 'cat-missing'),
      flowRow('apple', 1, 'monthly', 'cat-a'),
    ]
    expect(keyOf(withNames, 'category')(rows[1] as (typeof rows)[number])).toBeNull()
    const asc = sortRowsBy(rows, keyOf(withNames, 'category'), 'asc').map((r) => r.name)
    expect(asc.slice(0, 2)).toEqual(['apple', 'zebra'])
    expect(asc.slice(2).sort()).toEqual(['blank', 'dangling', 'none'])
  })
})

it('OMITS the Category key entirely when the column is not rendered', () => {
  // ⚠️ Omitted, not merely unused. `useTableSort` degrades a sort whose key has
  // no extractor back to manual order — that is what stops an entitled user's
  // Category sort outliving the column when entitlement lapses, which would
  // otherwise leave the table sorted by an invisible key with the move arrows
  // disabled and no desktop control to clear it.
  const gated = createFlowSortExtractors(new Map([['cat-a', 'Apple']]), false)
  expect(gated.category).toBeUndefined()
  expect(gated.name).toBeTypeOf('function')
  expect(gated.amount).toBeTypeOf('function')
  expect(gated.frequency).toBeTypeOf('function')
})

describe('savings sort keys', () => {
  const goal = (
    id: string,
    targetAmount: number | null,
    currentBalance: number,
    monthlyAllocation: number | null = null
  ) => ({ id, name: id, targetAmount, currentBalance, monthlyAllocation })

  it('sorts money columns RAW — a balance is a stock, not a per-period flow', () => {
    const extractors = createSavingsSortExtractors({}, () => null)
    expect(keyOf(extractors, 'currentBalance')(goal('a', null, 600_00))).toBe(600_00)
    expect(keyOf(extractors, 'target')(goal('a', 900_00, 0))).toBe(900_00)
  })

  it('places a goal with no target last, in both directions', () => {
    const extractors = createSavingsSortExtractors({}, () => null)
    const rows = [goal('account', null, 0), goal('big', 900_00, 0), goal('small', 100_00, 0)]
    expect(sortRowsBy(rows, keyOf(extractors, 'target'), 'asc').map((r) => r.id)).toEqual([
      'small',
      'big',
      'account',
    ])
    expect(sortRowsBy(rows, keyOf(extractors, 'target'), 'desc').map((r) => r.id)).toEqual([
      'big',
      'small',
      'account',
    ])
  })

  it('reads Monthly Allocation from the solver pool for AUTOMATIC rows only', () => {
    // Membership in `allocations` is what discriminates automatic from manual
    // (story 26.3) — an automatic row's stored `monthlyAllocation` is not what
    // its row displays.
    const extractors = createSavingsSortExtractors({ auto: 250_00 }, () => null)
    expect(keyOf(extractors, 'monthlyAllocation')(goal('auto', 500_00, 0, 999_00))).toBe(250_00)
    expect(keyOf(extractors, 'monthlyAllocation')(goal('manual', 500_00, 0, 30_00))).toBe(30_00)
    // A corrupt negative manual amount is floored at 0, matching the cell.
    expect(keyOf(extractors, 'monthlyAllocation')(goal('manual-neg', 500_00, 0, -5))).toBe(0)
    expect(keyOf(extractors, 'monthlyAllocation')(goal('manual-null', 500_00, 0, null))).toBe(0)
  })

  it('⚠️ keys a target-less ACCOUNT by its displayed figure, exactly like a goal (72.1)', () => {
    // Story 72.1 reverses 64.1 / FR98, which keyed every account as null because
    // its cell rendered “—”. The cell now shows the account's real figure, so the
    // key must follow it: manual ⇒ its floored stored amount, automatic ⇒ its
    // share from `allocations`.
    const extractors = createSavingsSortExtractors({ 'acct-auto': 250_00 }, () => null)
    expect(keyOf(extractors, 'monthlyAllocation')(goal('acct-fixed', null, 0, 300_00))).toBe(300_00)
    expect(keyOf(extractors, 'monthlyAllocation')(goal('acct-clean', null, 0, null))).toBe(0)
    expect(keyOf(extractors, 'monthlyAllocation')(goal('acct-auto', null, 0, null))).toBe(250_00)
    // Measured descending in 64.1: a 300.00 account and a 100.00 goal. Now both
    // figures are visible, so the account sorts ABOVE the goal by the figure shown.
    const rows = [goal('goal-fixed', 500_00, 0, 100_00), goal('acct-fixed', null, 0, 300_00)]
    expect(
      sortRowsBy(rows, keyOf(extractors, 'monthlyAllocation'), 'desc').map((r) => r.id)
    ).toEqual(['acct-fixed', 'goal-fixed'])
  })

  it('places absent Progress last', () => {
    const progress: Record<string, number | null> = { a: 50, b: null, c: 10 }
    const extractors = createSavingsSortExtractors({}, (id) => progress[id] ?? null)
    const rows = [goal('a', 1, 0), goal('b', null, 0), goal('c', 1, 0)]
    expect(sortRowsBy(rows, keyOf(extractors, 'progress'), 'asc').map((r) => r.id)).toEqual([
      'c',
      'a',
      'b',
    ])
    expect(sortRowsBy(rows, keyOf(extractors, 'progress'), 'desc').map((r) => r.id)).toEqual([
      'a',
      'c',
      'b',
    ])
  })
})

describe('balance sort keys', () => {
  const extractors = createBalanceSortExtractors()
  const entry = (
    name: string,
    type: string,
    currentBalance: number,
    monthlyContribution = 0,
    frequency = 'monthly'
  ) => ({ name, type, currentBalance, monthlyContribution, frequency })

  it('sorts Type by the ENUM: investment, then asset, then debt', () => {
    const rows = [
      entry('loan', 'debt', 0),
      entry('condo', 'asset', 0),
      entry('tfsa', 'investment', 0),
    ]
    // ⚠️ Story 43.4: this key was BINARY (`type === 'investment' ? 0 : 1`), which
    // would have tied every asset with every debt. `BalanceRow.type` is `string`,
    // so nothing in the compiler could see that.
    // ⚠️ Sorting by the DISPLAYED label would give Asset, Debt, Investment —
    // assets adjacent to debts, the one grouping the page never shows.
    expect(sortRowsBy(rows, keyOf(extractors, 'type'), 'asc').map((r) => r.name)).toEqual([
      'tfsa',
      'condo',
      'loan',
    ])
    expect(sortRowsBy(rows, keyOf(extractors, 'type'), 'desc').map((r) => r.name)).toEqual([
      'loan',
      'condo',
      'tfsa',
    ])
  })

  it('sorts a prototype-named type LAST instead of reading Object.prototype', () => {
    // ⚠️ A rank map keyed by a raw string is prototype-exposed: `RANK['constructor']`
    // returns an inherited FUNCTION, which is not nullish, so a `?? FALLBACK` never
    // fires and the comparator receives a function as a sort key. Unknown types are
    // reachable — `balanceStore.dom.test.ts` pins that a hand-edited or
    // newer-build row survives rehydrate untouched.
    const rows = [
      entry('weird', 'constructor', 0),
      entry('tfsa', 'investment', 0),
      entry('loan', 'debt', 0),
    ]
    expect(keyOf(extractors, 'type')(rows[0] as never)).toBe(3)
    expect(sortRowsBy(rows, keyOf(extractors, 'type'), 'asc').map((r) => r.name)).toEqual([
      'tfsa',
      'loan',
      'weird',
    ])
  })

  it('gives an asset row NO contribution sort key, matching its em-dash cell', () => {
    // Rule 2: sort by what the CELL SHOWS. The Contribution cell is an em-dash for
    // an asset, so keying it at 0 would sort it among real zero-contribution rows.
    const asset = entry('condo', 'asset', 40_000_000, 50_000, 'monthly')
    expect(keyOf(extractors, 'contribution')(asset)).toBeNull()
  })

  it('legacy two-type ordering still holds on its own', () => {
    const rows = [entry('loan', 'debt', 0), entry('tfsa', 'investment', 0)]
    // ⚠️ Sorting by the DISPLAYED label would invert this: the labels are
    // 'Investment' and 'Debt', and 'Debt'.localeCompare('Investment') < 0.
    expect(sortRowsBy(rows, keyOf(extractors, 'type'), 'asc').map((r) => r.name)).toEqual([
      'tfsa',
      'loan',
    ])
    expect(sortRowsBy(rows, keyOf(extractors, 'type'), 'desc').map((r) => r.name)).toEqual([
      'loan',
      'tfsa',
    ])
  })

  /**
   * Story 49.1 (FR75). This replaces 'treats a debt row as having NO contribution
   * limit or room', which proved the `maxContribution` / `remainingRoom`
   * extractors branched on `type`. Both extractors are gone with their columns.
   *
   * ⚠️ Asserted as an EXACT SET rather than two `toBeUndefined()` absence checks.
   * An absence check on an extractor that is already gone can never fail again
   * (48.1's vacuity trap); the exact set still reddens if either extractor is
   * re-added AND if a surviving one is dropped — which is what keeps the
   * `BalanceSortKey` union and the rendered header list in agreement.
   */
  it('exposes exactly one extractor per rendered column, and no retired ones', () => {
    expect(Object.keys(extractors).sort()).toEqual(
      ['type', 'name', 'currentBalance', 'contribution'].sort()
    )
  })

  it('normalizes Contribution by its cadence', () => {
    const weekly = entry('w', 'investment', 0, 100_00, 'weekly')
    const monthly = entry('m', 'investment', 0, 300_00, 'monthly')
    // Raw ascending would be weekly (100_00) then monthly (300_00); normalized,
    // the weekly contribution is worth 433_33/month and outranks it.
    expect(keyOf(extractors, 'contribution')(weekly)).toBe(433_33)
    expect(
      sortRowsBy([weekly, monthly], keyOf(extractors, 'contribution'), 'asc').map((r) => r.name)
    ).toEqual(['m', 'w'])
  })

  it('places a contribution with an unreadable cadence last, without throwing', () => {
    const corrupt = entry('bad', 'investment', 0, 100_00, 'fortnightly')
    expect(() => keyOf(extractors, 'contribution')(corrupt)).not.toThrow()
    expect(keyOf(extractors, 'contribution')(corrupt)).toBeNull()
  })

  /**
   * Story 102.1 (FR169, AC-3): a debt's Contribution cell shows its LINKED
   * EXPENSE's payment (or "Not linked"), never its own stored contribution, so
   * the key reads the same thing (rule 2: sort by what the cell shows).
   */
  describe('a debt sorts by its linked expense (story 102.1)', () => {
    const payments: Record<string, { amount: unknown; frequency: unknown }> = {
      'e-weekly': { amount: 100_00, frequency: 'weekly' },
      'e-monthly': { amount: 300_00, frequency: 'monthly' },
    }
    const linked = createBalanceSortExtractors((row) => {
      const id = row.paymentExpenseId
      return typeof id === 'string' ? payments[id] ?? null : null
    })
    const debt = (name: string, paymentExpenseId: string | null, monthlyContribution = 0) => ({
      ...entry(name, 'debt', -100_00, monthlyContribution),
      paymentExpenseId,
    })

    it('keys a linked debt at the expense payment, normalized by ITS cadence', () => {
      expect(keyOf(linked, 'contribution')(debt('car', 'e-weekly'))).toBe(433_33)
      expect(
        sortRowsBy(
          [debt('car', 'e-weekly'), debt('loan', 'e-monthly')],
          keyOf(linked, 'contribution'),
          'asc'
        ).map((r) => r.name)
      ).toEqual(['loan', 'car'])
    })

    it('⚠️ never keys a debt at its own stored contribution', () => {
      // A pre-102.1 debt can still hold one; the cell no longer shows it.
      expect(keyOf(linked, 'contribution')(debt('old', null, 999_00))).toBeNull()
    })

    it('keys an unlinked or dangling debt null (the cell says "Not linked")', () => {
      expect(keyOf(linked, 'contribution')(debt('none', null))).toBeNull()
      expect(keyOf(linked, 'contribution')(debt('gone', 'e-deleted'))).toBeNull()
    })

    it('keys every debt null when no resolver is given', () => {
      expect(keyOf(extractors, 'contribution')(debt('car', 'e-weekly', 50_00))).toBeNull()
    })

    it('leaves investment contributions on their own field', () => {
      const tfsa = entry('tfsa', 'investment', 0, 300_00)
      expect(keyOf(linked, 'contribution')(tfsa)).toBe(300_00)
    })
  })

  // Story 103.1 (FR171): this test was "sorts a negative debt balance below
  // every positive one". The cell now shows a debt as the amount OWED, so rule 2
  // (sort by what the cell shows) keys a legacy −500 debt at 500, above 100.
  it('keys a legacy negative debt by the amount owed its cell shows (Story 103.1)', () => {
    const rows = [entry('tfsa', 'investment', 100_00), entry('loan', 'debt', -500_00)]
    expect(keyOf(extractors, 'currentBalance')(rows[1] as (typeof rows)[number])).toBe(500_00)
    expect(sortRowsBy(rows, keyOf(extractors, 'currentBalance'), 'asc').map((r) => r.name)).toEqual(
      ['tfsa', 'loan']
    )
  })

  it('keeps a negative INVESTMENT raw (D3: only debts are read as a magnitude)', () => {
    expect(keyOf(extractors, 'currentBalance')(entry('bad', 'investment', -100_00))).toBe(-100_00)
  })

  it('keys a corrupt debt balance null, as before (the helper passes NaN through)', () => {
    expect(keyOf(extractors, 'currentBalance')(entry('nan', 'debt', Number.NaN))).toBeNull()
  })
})
