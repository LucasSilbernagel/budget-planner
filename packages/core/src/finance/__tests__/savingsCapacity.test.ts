// savingsCapacityPercentage = totalExpenses / grossIncome × 100.

import { describe, expect, it } from 'vitest'
import type { NormalizableFinancialItem } from '../normalization.js'
import {
	calculateMaxAllocableSavings,
	calculateMaxDynamicallyAllocableSavings,
	calculateSavingsCapacityPercentage,
	calculateSavingsCapacityResult,
	type SavingsCapacityResult,
} from '../savingsCapacity.js'

type CapacityCase = {
	income: NormalizableFinancialItem[]
	expenses: NormalizableFinancialItem[]
	expected: number
}

describe('Savings Capacity Calculation', () => {
	describe('calculateMaxAllocableSavings', () => {
		it.each<[string, CapacityCase]>([
			[
				'should return net period income as max allocable savings',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 20000, frequency: 'monthly' }],
					expected: 30000,
				},
			],
			[
				'should return negative value when expenses exceed income',
				{
					income: [{ amount: 20000, frequency: 'monthly' }],
					expenses: [{ amount: 50000, frequency: 'monthly' }],
					expected: -30000,
				},
			],
			[
				'should return 0 for break-even',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 50000, frequency: 'monthly' }],
					expected: 0,
				},
			],
			[
				'should handle empty arrays',
				{
					income: [],
					expenses: [],
					expected: 0,
				},
			],
			[
				'should return full income when no expenses',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [],
					expected: 50000,
				},
			],
			// grossIncome 43333 (weekly), totalExpenses 21667 (biweekly)
			[
				'should handle mixed frequencies',
				{
					income: [{ amount: 10000, frequency: 'weekly' }],
					expenses: [{ amount: 10000, frequency: 'biweekly' }],
					expected: 21666,
				},
			],
		])('%s', (_title, { income, expenses, expected }) => {
			expect(calculateMaxAllocableSavings(income, expenses)).toBe(expected)
		})
	})

	describe('calculateMaxDynamicallyAllocableSavings', () => {
		it.each<[string, CapacityCase]>([
			[
				'should return positive net income unchanged',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 20000, frequency: 'monthly' }],
					expected: 30000,
				},
			],
			[
				'should return 0 when net income is negative',
				{
					income: [{ amount: 20000, frequency: 'monthly' }],
					expenses: [{ amount: 50000, frequency: 'monthly' }],
					expected: 0,
				},
			],
			[
				'should return 0 when net income is 0',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 50000, frequency: 'monthly' }],
					expected: 0,
				},
			],
			[
				'should handle empty arrays',
				{
					income: [],
					expenses: [],
					expected: 0,
				},
			],
			[
				'should return full income when no expenses',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [],
					expected: 50000,
				},
			],
		])('%s', (_title, { income, expenses, expected }) => {
			expect(calculateMaxDynamicallyAllocableSavings(income, expenses)).toBe(expected)
		})
	})

	describe('calculateSavingsCapacityPercentage', () => {
		it.each<[string, CapacityCase]>([
			[
				'should calculate savings capacity percentage with surplus',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 20000, frequency: 'monthly' }],
					expected: 40,
				},
			],
			[
				'should return 0 when expenses are 0',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [],
					expected: 0,
				},
			],
			[
				'should return 0 when income is 0',
				{
					income: [],
					expenses: [{ amount: 50000, frequency: 'monthly' }],
					expected: 0,
				},
			],
			[
				'should return 100 when expenses equal income (break-even)',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 50000, frequency: 'monthly' }],
					expected: 100,
				},
			],
			// (10000 / 43333) × 100 ≈ 23.08 → 23
			[
				'should calculate correct percentage with mixed frequencies',
				{
					income: [{ amount: 10000, frequency: 'weekly' }],
					expenses: [{ amount: 10000, frequency: 'monthly' }],
					expected: 23,
				},
			],
			[
				'should return 50% when expenses are half of income',
				{
					income: [{ amount: 10000, frequency: 'monthly' }],
					expenses: [{ amount: 5000, frequency: 'monthly' }],
					expected: 50,
				},
			],
			[
				'should return >100% when expenses exceed gross income (overspending)',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 75000, frequency: 'monthly' }],
					expected: 150,
				},
			],
		])('%s', (_title, { income, expenses, expected }) => {
			expect(calculateSavingsCapacityPercentage(income, expenses)).toBe(expected)
		})
	})

	describe('calculateSavingsCapacityResult', () => {
		it('should return detailed result with surplus', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]

			const result = calculateSavingsCapacityResult(incomeSources, expenses)

			expect(result).toEqual<SavingsCapacityResult>({
				grossIncome: 50000,
				netPeriodIncome: 30000,
				savingsCapacityPercentage: 40,
				maxAllocableSavings: 30000,
			})
		})

		it('should return detailed result with deficit', () => {
			const incomeSources = [{ amount: 20000, frequency: 'monthly' as const }]
			const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

			const result = calculateSavingsCapacityResult(incomeSources, expenses)

			// Deficit: (50000 / 20000) × 100 = 250%.
			expect(result).toEqual<SavingsCapacityResult>({
				grossIncome: 20000,
				netPeriodIncome: -30000,
				savingsCapacityPercentage: 250,
				maxAllocableSavings: -30000,
			})
		})

		it('should return >100% percentage when overspending', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
			const expenses = [{ amount: 75000, frequency: 'monthly' as const }]

			const result = calculateSavingsCapacityResult(incomeSources, expenses)
			expect(result).toEqual<SavingsCapacityResult>({
				grossIncome: 50000,
				netPeriodIncome: -25000,
				savingsCapacityPercentage: 150,
				maxAllocableSavings: -25000,
			})
		})

		it('should handle empty arrays', () => {
			const result = calculateSavingsCapacityResult([], [])

			expect(result).toEqual<SavingsCapacityResult>({
				grossIncome: 0,
				netPeriodIncome: 0,
				savingsCapacityPercentage: 0,
				maxAllocableSavings: 0,
			})
		})
	})

	describe('Mathematical Validation - Zero Tolerance', () => {
		it('should pass exact validation: formula (expenses/grossIncome × 100)', () => {
			const incomeSources = [{ amount: 10000, frequency: 'monthly' as const }]
			const expenses = [{ amount: 2500, frequency: 'monthly' as const }]

			const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
			expect(result).toBe(25)
		})

		it('should pass exact validation: 100% when expenses equal income', () => {
			const incomeSources = [{ amount: 10000, frequency: 'monthly' as const }]
			const expenses = [{ amount: 10000, frequency: 'monthly' as const }]

			const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
			expect(result).toBe(100)
		})

		it('should pass exact validation: 0% when no expenses', () => {
			const incomeSources = [{ amount: 10000, frequency: 'monthly' as const }]
			const expenses: Array<{ amount: number; frequency: any }> = []

			const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
			expect(result).toBe(0)
		})
	})

	describe('Edge Cases - Zero Tolerance for Errors', () => {
		it('should handle empty income array', () => {
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			const result = calculateSavingsCapacityPercentage([], expenses)
			expect(result).toBe(0)
		})

		it('should handle empty expenses array', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
			const result = calculateSavingsCapacityPercentage(incomeSources, [])
			expect(result).toBe(0)
		})

		it('should handle very large numbers', () => {
			const incomeSources = [{ amount: Number.MAX_SAFE_INTEGER, frequency: 'monthly' as const }]
			const expenses = [{ amount: 0, frequency: 'monthly' as const }]
			const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
			expect(result).toBe(0)
		})

		it('should handle negative income and expenses', () => {
			const incomeSources = [{ amount: -10000, frequency: 'monthly' as const }]
			const expenses = [{ amount: -5000, frequency: 'monthly' as const }]
			const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
			// Both negative: (-10000 - -5000) / -10000 × 100 = 50%
			expect(result).toBe(50)
		})

		it('should handle null incomeSources array', () => {
			const result = calculateSavingsCapacityPercentage(null as any, [])
			expect(result).toBe(0)
		})

		it('should handle undefined incomeSources array', () => {
			const result = calculateSavingsCapacityPercentage(undefined as any, [])
			expect(result).toBe(0)
		})

		it('should handle null expenses array', () => {
			const result = calculateSavingsCapacityPercentage([], null as any)
			expect(result).toBe(0)
		})

		it('should handle both null arrays', () => {
			const result = calculateSavingsCapacityPercentage(null as any, null as any)
			expect(result).toBe(0)
		})

		it('should throw error for NaN in income amounts', () => {
			const incomeSources = [{ amount: Number.NaN, frequency: 'monthly' as const }]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			expect(() => calculateSavingsCapacityPercentage(incomeSources, expenses)).toThrow(
				'Amount must be a finite number'
			)
		})

		it('should throw error for arrays with null elements', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }, null as any]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			expect(() => calculateSavingsCapacityPercentage(incomeSources, expenses)).toThrow(
				'Amount must be a finite number'
			)
		})

		it('should throw error for arrays with undefined elements', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }, undefined as any]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			expect(() => calculateSavingsCapacityPercentage(incomeSources, expenses)).toThrow(
				'Amount must be a finite number'
			)
		})

		it('should return 0 for negative zero in savings capacity calculation', () => {
			const incomeSources = [{ amount: -0, frequency: 'monthly' as const }]
			const expenses = [{ amount: 0, frequency: 'monthly' as const }]
			const result = calculateSavingsCapacityPercentage(incomeSources, expenses)
			// -0 / -0 is NaN; return 0 so the UI never shows NaN.
			expect(result).toBe(0)
		})

		it('should handle null inputs to calculateSavingsCapacityResult', () => {
			const result = calculateSavingsCapacityResult(null as any, null as any)
			expect(result).toEqual({
				grossIncome: 0,
				netPeriodIncome: 0,
				savingsCapacityPercentage: 0,
				maxAllocableSavings: 0,
			})
		})
	})
})
