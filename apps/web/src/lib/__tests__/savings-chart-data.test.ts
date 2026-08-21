/**
 * Pure data + chrome layer for the Savings page chart (story 37.1).
 *
 * ⚠️ WHY THIS FILE EXISTS AND WHY IT IS `.test.ts`, NOT `.test.tsx`. jsdom gives
 * Recharts' `ResponsiveContainer` a 0×0 box, so `validateWidthHeight` rejects it
 * and NO SVG ever reaches the DOM — every `.recharts-*` selector returns 0
 * whether the chart is right, broken, or absent. So every decision the chart
 * makes is extracted here, as pure functions with no React import, and pinned
 * with concrete literals in vitest's node env. This is the 24-1
 * `get*Chrome()` pattern.
 */

import type { ClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'
import { describe, expect, it } from 'vitest'
import {
  SAVINGS_SAVED_FILL,
  buildSavingsChartRows,
  getSavingsChartChrome,
  hasPlottableData,
  savingsChartHeight,
  truncateAxisLabel,
} from '../savings-chart-data'

const NOW = '2026-01-01T00:00:00.000Z'

function goal(overrides: Partial<ClientSavingsGoal> & { id: string }): ClientSavingsGoal {
  return {
    name: 'Emergency Fund',
    targetAmount: 1_000_00,
    currentBalance: 400_00,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('buildSavingsChartRows', () => {
  it('carries a usable positive target through as a number', () => {
    const [row] = buildSavingsChartRows([goal({ id: 'a', targetAmount: 1_000_00 })])
    expect(row).toEqual({ id: 'a', label: 'Emergency Fund', saved: 400_00, target: 1_000_00 })
  })

  // Story 16-1: `targetAmount === null` means SAVINGS ACCOUNT, not "0% of a
  // goal". The target must be ABSENT, never a zero-length bar.
  it('folds a null target (a savings account) to an absent target', () => {
    const [row] = buildSavingsChartRows([goal({ id: 'a', targetAmount: null })])
    expect(row?.target).toBeNull()
  })

  // The three corrupt states are reachable: localStorage is user-editable JSON
  // and the store's `migrate` only filters non-objects. `savingsStore.ts:175`
  // and `savingsGoalCalculations.ts:31` both carry live guards for them.
  it.each([
    ['a legacy zero target', 0],
    ['a negative target', -500_00],
    ['a NaN target', Number.NaN],
    ['an Infinity target', Number.POSITIVE_INFINITY],
  ])('folds %s to an absent target', (_label, targetAmount) => {
    const [row] = buildSavingsChartRows([goal({ id: 'a', targetAmount })])
    expect(row?.target).toBeNull()
  })

  // `sync.ts:204` is `z.number().int().default(0)` with NO `.min(0)`, unlike
  // `monthlyAllocation` at `:212`. A negative balance is real data, not corrupt
  // data — plot it and let the diverging domain handle it.
  it('passes a negative balance through unchanged', () => {
    const [row] = buildSavingsChartRows([goal({ id: 'a', currentBalance: -250_00 })])
    expect(row?.saved).toBe(-250_00)
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('coerces a non-finite balance (%s) to 0', (_label, currentBalance) => {
    const [row] = buildSavingsChartRows([goal({ id: 'a', currentBalance })])
    expect(row?.saved).toBe(0)
  })

  // ⚠️ Duplicate names are FULLY LEGAL — no uniqueness check exists in the
  // schema, in `validateSavingsGoal`, or in the store. Rows are unique only by
  // `id`. A build step that grouped or deduped by name would silently drop a
  // row and the user's total would stop matching the table.
  it('keeps two identically-named goals as two distinct rows', () => {
    const rows = buildSavingsChartRows([
      goal({ id: 'a', name: 'Savings', currentBalance: 100_00 }),
      goal({ id: 'b', name: 'Savings', currentBalance: 700_00 }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows.map((r) => r.saved)).toEqual([100_00, 700_00])
  })

  it('preserves input order so the chart matches the table', () => {
    const rows = buildSavingsChartRows([
      goal({ id: 'c', name: 'Car' }),
      goal({ id: 'a', name: 'Attic' }),
      goal({ id: 'b', name: 'Boat' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('returns an empty array for no goals', () => {
    expect(buildSavingsChartRows([])).toEqual([])
  })
})

describe('hasPlottableData', () => {
  it('is false for no rows', () => {
    expect(hasPlottableData([])).toBe(false)
  })

  // A plot of nothing but zeroes teaches the user nothing — AC-4 sends this to
  // the empty state rather than rendering a flat axis.
  it('is false when every row is zero with no target', () => {
    expect(
      hasPlottableData([
        { id: 'a', label: 'A', saved: 0, target: null },
        { id: 'b', label: 'B', saved: 0, target: null },
      ])
    ).toBe(false)
  })

  it('is true when one row has a non-zero balance', () => {
    expect(
      hasPlottableData([
        { id: 'a', label: 'A', saved: 0, target: null },
        { id: 'b', label: 'B', saved: 1, target: null },
      ])
    ).toBe(true)
  })

  // Zero saved against a real target is meaningful — it is "0 of 5,000", which
  // is exactly the shape a new goal has.
  it('is true when a row has a target but nothing saved yet', () => {
    expect(hasPlottableData([{ id: 'a', label: 'A', saved: 0, target: 5_000_00 }])).toBe(true)
  })

  it('is true for a negative balance', () => {
    expect(hasPlottableData([{ id: 'a', label: 'A', saved: -1, target: null }])).toBe(true)
  })
})

describe('savingsChartHeight', () => {
  // Concrete literals, not relative ordering (the 24-1 rule): a range assertion
  // swallows drift, and drift here is a squashed or a stretched chart.
  it('floors at one row so a lone bar is never a sliver', () => {
    expect(savingsChartHeight(0)).toBe(144)
    expect(savingsChartHeight(1)).toBe(144)
  })

  it('scales linearly with the row count', () => {
    expect(savingsChartHeight(3)).toBe(288)
    expect(savingsChartHeight(10)).toBe(792)
  })

  // ⚠️ Deliberately taller per row than `categoryChartHeight` (64px/row): that
  // helper sizes a SINGLE-series chart, and this is the repo's first grouped
  // chart — two bars share each band.
  it('gives each row more room than the single-series helper does', () => {
    expect(savingsChartHeight(4) - savingsChartHeight(3)).toBe(72)
  })
})

describe('getSavingsChartChrome', () => {
  it('returns the desktop chrome', () => {
    expect(getSavingsChartChrome(false)).toEqual({
      yAxisWidth: 132,
      tickFontSize: 12,
      barSize: 14,
      legendFontSize: 12,
      labelMaxChars: 16,
    })
  })

  it('returns the narrow chrome', () => {
    expect(getSavingsChartChrome(true)).toEqual({
      yAxisWidth: 76,
      tickFontSize: 11,
      barSize: 10,
      legendFontSize: 11,
      labelMaxChars: 10,
    })
  })

  it('shrinks every dimension on a narrow viewport', () => {
    const narrow = getSavingsChartChrome(true)
    const desktop = getSavingsChartChrome(false)
    expect(narrow.yAxisWidth).toBeLessThan(desktop.yAxisWidth)
    expect(narrow.tickFontSize).toBeLessThan(desktop.tickFontSize)
    expect(narrow.barSize).toBeLessThan(desktop.barSize)
    expect(narrow.legendFontSize).toBeLessThan(desktop.legendFontSize)
    // ⚠️ The label limit shrinks WITH the gutter. 18 chars at 11px DejaVu is
    // ~110px against a 76px gutter — the label would paint out of the chart.
    expect(narrow.labelMaxChars).toBeLessThan(desktop.labelMaxChars)
  })

  // Concrete floors, not just "smaller than desktop" — a chrome that shrank to
  // 1px would satisfy the ordering assertions above and be unreadable.
  it('keeps the narrow chrome above legibility floors', () => {
    const narrow = getSavingsChartChrome(true)
    expect(narrow.yAxisWidth).toBeGreaterThanOrEqual(60)
    expect(narrow.tickFontSize).toBeGreaterThanOrEqual(10)
    expect(narrow.barSize).toBeGreaterThanOrEqual(8)
    expect(narrow.labelMaxChars).toBeGreaterThanOrEqual(8)
  })
})

describe('truncateAxisLabel', () => {
  it('leaves a short label alone', () => {
    expect(truncateAxisLabel('New Car')).toBe('New Car')
  })

  it('leaves a label exactly at the limit alone', () => {
    const exactly18 = 'abcdefghijklmnopqr'
    expect(exactly18).toHaveLength(18)
    expect(truncateAxisLabel(exactly18)).toBe(exactly18)
  })

  it('truncates a longer label to the limit, ellipsis included', () => {
    const result = truncateAxisLabel('abcdefghijklmnopqrs')
    expect(result).toBe('abcdefghijklmnopq…')
    expect(result).toHaveLength(18)
  })

  // ⚠️ This is the repo's OWN adversarial 320px fixture — `responsive-320.spec.ts`
  // seeds it as savings goal `sav-1`'s name. Recharts SVG <text> neither wraps
  // nor ellipsizes, and the narrow Y-axis gutter is 76px, so an untruncated
  // label paints straight out of the chart.
  it('truncates the 138-character unbroken fixture name', () => {
    const longUnbrokenName = 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3)
    expect(longUnbrokenName).toHaveLength(138)
    expect(truncateAxisLabel(longUnbrokenName)).toHaveLength(18)
  })

  // ⚠️ Code points, not UTF-16 units. A UTF-16 slice cuts a surrogate pair in
  // half and paints a lone-surrogate tofu box right before the ellipsis.
  it('does not split an emoji when truncating', () => {
    const emoji = '💰'.repeat(10) // .length === 20, but 10 code points
    expect(emoji.length).toBe(20)
    expect(truncateAxisLabel(emoji, 6)).toBe('💰💰💰💰💰…')
    expect([...truncateAxisLabel(emoji, 6)]).toHaveLength(6)
    // No lone surrogate anywhere in the result.
    expect(
      /[\uD800-\uDFFF]/.test(truncateAxisLabel(emoji, 6).replace(/[\u{10000}-\u{10FFFF}]/gu, ''))
    ).toBe(false)
  })

  it('counts a short emoji label by code points, not UTF-16 units', () => {
    // 5 code points, .length 10 — must NOT be truncated against a limit of 8.
    expect(truncateAxisLabel('💰💰💰💰💰', 8)).toBe('💰💰💰💰💰')
  })

  it('honours an explicit limit', () => {
    expect(truncateAxisLabel('abcdefghij', 5)).toBe('abcd…')
  })

  it('leaves an empty label alone', () => {
    expect(truncateAxisLabel('')).toBe('')
  })
})

describe('SAVINGS_SAVED_FILL', () => {
  // Pinned so the Savings chart and the Overview's aggregate Savings bar agree.
  // ⚠️ COPIED, not imported: `SAVINGS_COLOR` (`HomePage.tsx:54`) is
  // module-private, and story 30-5 settled that the house answer is to copy the
  // pattern rather than export it. Nothing detects the two drifting apart —
  // declared blind spot, not an oversight.
  it('matches the Overview savings bar colour', () => {
    expect(SAVINGS_SAVED_FILL).toBe('#8B5CF6')
  })
})
