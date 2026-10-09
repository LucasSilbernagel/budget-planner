import { describe, expect, it } from 'vitest'
import {
	calculateDebtMetrics,
	calculateProjectedBalance,
	formatProgress,
	formatTimeline,
} from '../balanceCalculations'

describe('formatTimeline', () => {
	it.each([
		[
			'should return "No limit set" for null input',
			{
				months: null,
				expected: 'No limit set',
			},
		],
		['should return "Limit reached" for 0 months', { months: 0, expected: 'Limit reached' }],
		[
			'should return singular "1 month to limit" for 1 month',
			{
				months: 1,
				expected: '1 month to limit',
			},
		],
		[
			'should return plural "X months to limit" for multiple months',
			{
				months: 10,
				expected: '10 months to limit',
			},
		],
	])('%s', (_title, { months, expected }) => {
		expect(formatTimeline(months)).toBe(expected)
	})
})

describe('calculateProjectedBalance', () => {
	it.each([
		[
			'should return current balance for 0 months',
			{
				args: [100000, 10000, 0],
				expected: 100000,
			},
		],
		['should calculate positive projection', { args: [100000, 50000, 5], expected: 350000 }],
		[
			'should calculate negative projection (debt reduction)',
			{
				args: [-100000, -50000, 5],
				expected: -350000,
			},
		],
		[
			'should return current balance for negative months',
			{
				args: [100000, 10000, -5],
				expected: 100000,
			},
		],
	] as const)('%s', (_title, { args: [balance, contribution, months], expected }) => {
		expect(calculateProjectedBalance(balance, contribution, months)).toBe(expected)
	})
})

describe('formatProgress', () => {
	it.each([
		['should return "No limit" for null input', { progress: null, expected: 'No limit' }],
		['should format percentage with % sign', { progress: 50, expected: '50%' }],
		['should format 0%', { progress: 0, expected: '0%' }],
		['should format 100%', { progress: 100, expected: '100%' }],
	])('%s', (_title, { progress, expected }) => {
		expect(formatProgress(progress)).toBe(expected)
	})
})

describe('Edge Case Handling - calculateProjectedBalance', () => {
	it.each([
		[
			'should return currentBalance for NaN currentBalance',
			{
				args: [Number.NaN, 10000, 5],
				expected: Number.NaN,
			},
		],
		[
			'should return currentBalance for Infinity currentBalance',
			{
				args: [Number.POSITIVE_INFINITY, 10000, 5],
				expected: Number.POSITIVE_INFINITY,
			},
		],
		[
			'should return currentBalance for NaN monthlyContribution',
			{
				args: [100000, Number.NaN, 5],
				expected: 100000,
			},
		],
		[
			'should return currentBalance for Infinity monthlyContribution',
			{
				args: [100000, Number.POSITIVE_INFINITY, 5],
				expected: 100000,
			},
		],
		[
			'should return currentBalance for NaN months',
			{
				args: [100000, 10000, Number.NaN],
				expected: 100000,
			},
		],
		[
			'should return currentBalance for Infinity months',
			{
				args: [100000, 10000, Number.POSITIVE_INFINITY],
				expected: 100000,
			},
		],
		[
			'should handle arithmetic overflow gracefully',
			{
				args: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100],
				expected: Number.MAX_SAFE_INTEGER,
			},
		],
	] as const)('%s', (_title, { args: [balance, contribution, months], expected }) => {
		expect(calculateProjectedBalance(balance, contribution, months)).toBe(expected)
	})
})

describe('Debt-Specific Calculations', () => {
	describe('calculateDebtMetrics for credit-card', () => {
		it('reports the payoff timeline, and no progress without a recorded limit', () => {
			const result = calculateDebtMetrics(-100000, 50000, 'credit-card')
			expect(result.progress).toBeNull()
			expect(result.progressLabel).toBe('No limit')
			expect(result.timeline).toBe(2)
			expect(result.timelineLabel).toBe('2 months to pay off')
		})

		it('should handle credit card with no payment', () => {
			const result = calculateDebtMetrics(-100000, undefined, 'credit-card')
			expect(result.progress).toBeNull()
			expect(result.timeline).toBeNull()
			expect(result.timelineLabel).toBe('No payment set')
		})
	})

	describe('calculateDebtMetrics for mortgage', () => {
		it('should calculate payoff percentage with originalBalance', () => {
			const result = calculateDebtMetrics(-180000, 50000, 'mortgage', 200000)
			expect(result.progress).toBe(10)
			expect(result.progressLabel).toBe('10% paid off')
			expect(result.timeline).toBe(4) // 3.6 rounds up to 4
			expect(result.timelineLabel).toBe('4 months to pay off')
		})

		it('should handle mortgage without originalBalance', () => {
			const result = calculateDebtMetrics(-180000, 50000, 'mortgage')
			expect(result.progress).toBeNull()
			expect(result.timeline).toBe(4)
			expect(result.timelineLabel).toBe('4 months to pay off')
		})
	})

	describe('calculateDebtMetrics with invalid inputs', () => {
		it.each([
			['NaN', Number.NaN],
			['Infinity', Number.POSITIVE_INFINITY],
		])('should handle %s inputs gracefully', (_kind, balance) => {
			const result = calculateDebtMetrics(balance, 50000, 'credit-card')
			expect(result.progress).toBeNull()
			expect(result.progressLabel).toBe('Invalid data')
			expect(result.timeline).toBeNull()
			expect(result.timelineLabel).toBe('Invalid data')
		})
	})
})
