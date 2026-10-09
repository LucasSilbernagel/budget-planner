import { describe, expect, it } from 'vitest'
import {
	barDomainTicks,
	categoryChartHeight,
	formatCompactAxisTick,
	niceAxisTicks,
} from '../chart-axis'

describe('formatCompactAxisTick', () => {
	it.each<[string, { cases: [number, 'none' | 'symbol', string, string][] }]>([
		[
			'leaves sub-thousand values whole and un-prefixed in currency-less mode',
			{
				cases: [
					[500, 'none', 'NONE', '500'],
					[0, 'none', 'NONE', '0'],
				],
			},
		],
		[
			'abbreviates thousands and millions, dropping the cents',
			{
				cases: [
					[7800, 'none', 'NONE', '8K'],
					[1_500_000, 'none', 'NONE', '1.5M'],
				],
			},
		],
		['keeps the sign on negative values', { cases: [[-2900, 'none', 'NONE', '-3K']] }],
		[
			'prefixes the currency symbol in symbol mode',
			{
				cases: [
					[7800, 'symbol', 'USD', '$8K'],
					[500, 'symbol', 'EUR', '€500'],
				],
			},
		],
		// Reachable from a stale persisted `{mode:'symbol', currency:'NONE'}` blob.
		[
			'stays symbol-less for the NONE currency even in symbol mode (no "NONE" prefix)',
			{
				cases: [
					[7800, 'symbol', 'NONE', '8K'],
					[500, 'symbol', 'NONE', '500'],
				],
			},
		],
		[
			'rolls the K band over to M instead of printing "1000K"',
			{
				cases: [
					[999_600, 'none', 'NONE', '1.0M'],
					[-999_600, 'none', 'NONE', '-1.0M'],
				],
			},
		],
		[
			'coerces non-finite values to 0 instead of rendering "NaN"/"Infinity"',
			{
				cases: [
					[Number.NaN, 'none', 'NONE', '0'],
					[Number.POSITIVE_INFINITY, 'none', 'NONE', '0'],
					[Number.NaN, 'symbol', 'USD', '$0'],
				],
			},
		],
	])('%s', (_title, { cases }) => {
		for (const [value, mode, currency, expected] of cases) {
			expect(formatCompactAxisTick(value, mode, currency)).toBe(expected)
		}
	})
})

describe('niceAxisTicks', () => {
	it('returns round, evenly-spaced, ascending ticks', () => {
		const ticks = niceAxisTicks(0, 8000)
		expect(ticks.every((t) => Number.isInteger(t))).toBe(true)
		expect(ticks).toEqual([...ticks].sort((a, b) => a - b))
		const gaps = ticks.slice(1).map((t, i) => t - ticks[i])
		expect(new Set(gaps).size).toBe(1)
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
		const ticks = niceAxisTicks(-2551, 7801)
		expect(ticks).not.toContain(-2551)
		expect(ticks).not.toContain(7801)
	})

	it('degrades gracefully when min === max', () => {
		expect(niceAxisTicks(5000, 5000)).toEqual([5000])
	})

	it('keeps sub-unit steps uniform instead of rounding them into duplicates', () => {
		// Per-tick `Math.round` would collapse a 0.5 step into duplicate, non-uniform ticks.
		const ticks = niceAxisTicks(0, 2)
		expect(new Set(ticks).size).toBe(ticks.length)
		const gaps = ticks.slice(1).map((t, i) => Number((t - ticks[i]).toFixed(10)))
		expect(new Set(gaps).size).toBe(1)
		expect(ticks).toEqual([...ticks].sort((a, b) => a - b))
	})
})

describe('barDomainTicks', () => {
	// jsdom can't lay out Recharts, so axis independence is pinned at this helper.
	it('derives independent domains for flows vs balances so neither squashes the other', () => {
		const flows = barDomainTicks([9_360_000, -4_800_000])
		const balances = barDomainTicks([500_000, 800_000, -300_000])
		expect(flows.at(-1)).toBeGreaterThan(balances.at(-1) as number)
		expect(flows).not.toEqual(balances)
	})

	it('clamps the domain to include a 0 baseline for diverging bars', () => {
		const ticks = barDomainTicks([500_000, 800_000])
		expect(ticks[0]).toBeLessThanOrEqual(0)
		expect(ticks.at(-1)).toBeGreaterThanOrEqual(800_000)
		const negativeTicks = barDomainTicks([-300_000, -900_000])
		expect(negativeTicks.at(-1)).toBeGreaterThanOrEqual(0)
		expect(negativeTicks[0]).toBeLessThanOrEqual(-900_000)
	})

	it('degenerates to a single [0] tick for an empty dataset (off-screen only)', () => {
		expect(barDomainTicks([])).toEqual([0])
	})
})

describe('categoryChartHeight', () => {
	it('sizes the chart from the bar count with a per-bar slice plus fixed chrome', () => {
		expect(categoryChartHeight(3)).toBe(264)
		expect(categoryChartHeight(2)).toBe(200)
	})

	it('floors a single-bar (or empty) chart so it is never a squashed sliver', () => {
		expect(categoryChartHeight(1)).toBe(136)
		expect(categoryChartHeight(0)).toBe(136)
		expect(categoryChartHeight(1)).toBeGreaterThanOrEqual(120)
	})

	it('grows monotonically so a 3-bar chart is always taller than a 1-bar chart', () => {
		expect(categoryChartHeight(3)).toBeGreaterThan(categoryChartHeight(1))
	})
})
