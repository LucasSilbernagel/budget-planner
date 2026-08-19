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
    expect(extractors.currentBalance(goal('a', null, 600_00))).toBe(600_00)
    expect(extractors.target(goal('a', 900_00, 0))).toBe(900_00)
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

  it('reads Monthly Allocation from the solver pool for AUTOMATIC accounts only', () => {
    // Membership in `allocations` is what discriminates automatic from manual
    // (story 26.3) — an automatic account's stored `monthlyAllocation` is not
    // what its row displays.
    const extractors = createSavingsSortExtractors({ auto: 250_00 }, () => null)
    expect(extractors.monthlyAllocation(goal('auto', null, 0, 999_00))).toBe(250_00)
    expect(extractors.monthlyAllocation(goal('manual', null, 0, 30_00))).toBe(30_00)
    // A corrupt negative manual amount is floored at 0, matching the cell.
    expect(extractors.monthlyAllocation(goal('manual-neg', null, 0, -5))).toBe(0)
    expect(extractors.monthlyAllocation(goal('manual-null', null, 0, null))).toBe(0)
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
    maxContributionLimit: number | undefined,
    monthlyContribution = 0,
    frequency = 'monthly'
  ) => ({ name, type, currentBalance, maxContributionLimit, monthlyContribution, frequency })

  it('sorts Type by the ENUM, investment before debt', () => {
    const rows = [entry('loan', 'debt', 0, undefined), entry('tfsa', 'investment', 0, undefined)]
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

  it('treats a debt row as having NO contribution limit or room, even when one is stored', () => {
    // ⚠️ `remainingContributionRoom` never reads `type` — it returns a number for
    // ANY row carrying a finite limit. A legacy or server-pulled debt row with a
    // limit would therefore sort among the numbers while its cells render
    // 'None' and an em-dash. The type branch is what keeps sort and display in
    // agreement.
    const debtWithLimit = entry('loan', 'debt', 100_00, 500_00)
    expect(extractors.maxContribution(debtWithLimit)).toBeNull()
    expect(extractors.remainingRoom(debtWithLimit)).toBeNull()

    const investment = entry('tfsa', 'investment', 100_00, 500_00)
    expect(extractors.maxContribution(investment)).toBe(500_00)
    expect(extractors.remainingRoom(investment)).toBe(400_00)
  })

  it('normalizes Contribution by its cadence', () => {
    const weekly = entry('w', 'investment', 0, undefined, 100_00, 'weekly')
    const monthly = entry('m', 'investment', 0, undefined, 300_00, 'monthly')
    // Raw ascending would be weekly (100_00) then monthly (300_00); normalized,
    // the weekly contribution is worth 433_33/month and outranks it.
    expect(extractors.contribution(weekly)).toBe(433_33)
    expect(
      sortRowsBy([weekly, monthly], keyOf(extractors, 'contribution'), 'asc').map((r) => r.name)
    ).toEqual(['m', 'w'])
  })

  it('places a contribution with an unreadable cadence last, without throwing', () => {
    const corrupt = entry('bad', 'investment', 0, undefined, 100_00, 'fortnightly')
    expect(() => extractors.contribution(corrupt)).not.toThrow()
    expect(extractors.contribution(corrupt)).toBeNull()
  })

  it('sorts a negative debt balance below every positive one', () => {
    const rows = [
      entry('tfsa', 'investment', 100_00, undefined),
      entry('loan', 'debt', -500_00, undefined),
    ]
    expect(sortRowsBy(rows, keyOf(extractors, 'currentBalance'), 'asc').map((r) => r.name)).toEqual(
      ['loan', 'tfsa']
    )
  })
})
