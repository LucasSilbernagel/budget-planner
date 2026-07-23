import { describe, expect, it } from 'vitest'
import {
  barDomainTicks,
  categoryChartHeight,
  formatCompactAxisTick,
  niceAxisTicks,
} from '../chart-axis'

describe('formatCompactAxisTick', () => {
  it('leaves sub-thousand values whole and un-prefixed in currency-less mode', () => {
    expect(formatCompactAxisTick(500, 'none', 'NONE')).toBe('500')
    expect(formatCompactAxisTick(0, 'none', 'NONE')).toBe('0')
  })

  it('abbreviates thousands and millions, dropping the cents', () => {
    expect(formatCompactAxisTick(7800, 'none', 'NONE')).toBe('8K')
    expect(formatCompactAxisTick(1_500_000, 'none', 'NONE')).toBe('1.5M')
  })

  it('keeps the sign on negative values', () => {
    expect(formatCompactAxisTick(-2900, 'none', 'NONE')).toBe('-3K')
  })

  it('prefixes the currency symbol in symbol mode', () => {
    expect(formatCompactAxisTick(7800, 'symbol', 'USD')).toBe('$8K')
    expect(formatCompactAxisTick(500, 'symbol', 'EUR')).toBe('€500')
  })

  it('stays symbol-less for the NONE currency even in symbol mode (no "NONE" prefix)', () => {
    // Reachable from a stale persisted `{mode:'symbol', currency:'NONE'}` blob;
    // must mirror formatCurrency, which treats NONE as symbol-less.
    expect(formatCompactAxisTick(7800, 'symbol', 'NONE')).toBe('8K')
    expect(formatCompactAxisTick(500, 'symbol', 'NONE')).toBe('500')
  })

  it('rolls the K band over to M instead of printing "1000K"', () => {
    expect(formatCompactAxisTick(999_600, 'none', 'NONE')).toBe('1.0M')
    expect(formatCompactAxisTick(-999_600, 'none', 'NONE')).toBe('-1.0M')
  })

  it('coerces non-finite values to 0 instead of rendering "NaN"/"Infinity"', () => {
    expect(formatCompactAxisTick(Number.NaN, 'none', 'NONE')).toBe('0')
    expect(formatCompactAxisTick(Number.POSITIVE_INFINITY, 'none', 'NONE')).toBe('0')
    expect(formatCompactAxisTick(Number.NaN, 'symbol', 'USD')).toBe('$0')
  })
})

describe('niceAxisTicks', () => {
  it('returns round, evenly-spaced, ascending ticks', () => {
    const ticks = niceAxisTicks(0, 8000)
    expect(ticks.every((t) => Number.isInteger(t))).toBe(true)
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b))
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i])
    expect(new Set(gaps).size).toBe(1) // uniform spacing
    expect(ticks[0]).toBeLessThanOrEqual(0)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(8000)
  })

  it('includes a zero baseline when the range spans zero', () => {
    const ticks = niceAxisTicks(-2900, 7800)
    expect(ticks).toContain(0)
    expect(ticks[0]).toBeLessThanOrEqual(-2900)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(7800)
  })

  it('rounds the endpoints outward to nice steps (no arbitrary data values)', () => {
    // The pre-fix bar axis showed endpoints like -2,551 and 7,801; nice ticks
    // must not contain those exact data-derived numbers.
    const ticks = niceAxisTicks(-2551, 7801)
    expect(ticks).not.toContain(-2551)
    expect(ticks).not.toContain(7801)
  })

  it('degrades gracefully when min === max', () => {
    expect(niceAxisTicks(5000, 5000)).toEqual([5000])
  })

  it('keeps sub-unit steps uniform instead of rounding them into duplicates', () => {
    // A tiny span yields a fractional step (0.5 here). Per-tick Math.round would
    // collapse 0.5/1.5 into 0/1/1/2 — duplicate, non-uniform. Precision-aware
    // rounding must preserve strictly-increasing, uniformly-spaced ticks.
    const ticks = niceAxisTicks(0, 2)
    expect(new Set(ticks).size).toBe(ticks.length) // no duplicates
    const gaps = ticks.slice(1).map((t, i) => Number((t - ticks[i]).toFixed(10)))
    expect(new Set(gaps).size).toBe(1) // uniform spacing
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b))
  })
})

describe('barDomainTicks', () => {
  // Story UX-2's whole point: flows and balances must get INDEPENDENT axis
  // domains so a large flow can't crush a small balance. This is the derivation
  // that guarantees it — feeding it the two datasets' amounts must yield
  // different domains (jsdom can't lay out Recharts, so the axis-independence is
  // pinned here at the helper, not via the rendered SVG).
  it('derives independent domains for flows vs balances (the ux-2 fix)', () => {
    // Flows: annual income $93,600 and expenses -$48,000 (cents).
    const flows = barDomainTicks([9_360_000, -4_800_000])
    // Balances: savings $5,000, investments $8,000, debts -$3,000 (cents).
    const balances = barDomainTicks([500_000, 800_000, -300_000])
    // The flows axis reaches ~$93.6k while the balances axis tops out near $8k —
    // categorically different upper bounds, which is exactly why they're split.
    expect(flows.at(-1)).toBeGreaterThan(balances.at(-1) as number)
    expect(flows).not.toEqual(balances)
  })

  it('clamps the domain to include a 0 baseline for diverging bars', () => {
    // All-positive amounts still get a 0 lower bound so bars share a baseline.
    const ticks = barDomainTicks([500_000, 800_000])
    expect(ticks[0]).toBeLessThanOrEqual(0)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(800_000)
    // All-negative amounts get a 0 upper bound.
    const negativeTicks = barDomainTicks([-300_000, -900_000])
    expect(negativeTicks.at(-1)).toBeGreaterThanOrEqual(0)
    expect(negativeTicks[0]).toBeLessThanOrEqual(-900_000)
  })

  it('degenerates to a single [0] tick for an empty dataset (off-screen only)', () => {
    // Callers gate the chart on a non-empty dataset, but the derivation must not
    // throw on empty input: Math.min(0,...[]) / Math.max(0,...[]) → 0, 0.
    expect(barDomainTicks([])).toEqual([0])
  })
})

describe('categoryChartHeight', () => {
  // Concrete usability FLOORS, not just relative ordering (Epic 24 lesson: a
  // "smaller-but-broken" height passes a purely relative assertion). Story UX-2
  // splits one 5-bar chart into a flows chart (≤2 bars) and a balances chart
  // (≤3 bars); each must give its bars enough vertical room to read at 320px.
  it('sizes the chart from the bar count with a per-bar slice plus fixed chrome', () => {
    // 3 balance bars and 2 flow bars, the real split sizes.
    expect(categoryChartHeight(3)).toBe(264)
    expect(categoryChartHeight(2)).toBe(200)
  })

  it('floors a single-bar (or empty) chart so it is never a squashed sliver', () => {
    // A lone bar (e.g. only savings) must still clear a legible minimum, and a
    // 0-bar call (defensive) must not collapse below the 1-bar floor.
    expect(categoryChartHeight(1)).toBe(136)
    expect(categoryChartHeight(0)).toBe(136)
    expect(categoryChartHeight(1)).toBeGreaterThanOrEqual(120)
  })

  it('grows monotonically so a 3-bar chart is always taller than a 1-bar chart', () => {
    expect(categoryChartHeight(3)).toBeGreaterThan(categoryChartHeight(1))
  })
})
