import { describe, expect, it } from 'vitest'
import { formatCompactAxisTick, niceAxisTicks } from '../chart-axis'

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
