import { describe, expect, it } from 'vitest'
import {
	calculateGrossPeriodIncome,
	calculateNetIncomeResult,
	calculateNetPeriodIncome,
	calculateTotalPeriodExpenses,
	type NetIncomeResult,
} from '../netIncome.js'
import type { NormalizableFinancialItem } from '../normalization.js'

type TotalCase = { items: NormalizableFinancialItem[]; expected: number }
type NetCase = {
	income: NormalizableFinancialItem[]
	expenses: NormalizableFinancialItem[]
	expected: number
}

describe('Net Period Income Calculation', () => {
	describe('calculateGrossPeriodIncome', () => {
		it.each<[string, TotalCase]>([
			[
				'should calculate gross income from single monthly source ($500 → 50000 cents)',
				{
					items: [{ amount: 50000, frequency: 'monthly' }],
					expected: 50000,
				},
			],
			[
				'should calculate gross income from weekly source ($100/week)',
				{
					items: [{ amount: 10000, frequency: 'weekly' }],
					expected: 43333,
				},
			],
			// 43333 + 43333 + 50000 = 136666
			[
				'should calculate gross income from multiple sources with different frequencies',
				{
					items: [
						{ amount: 10000, frequency: 'weekly' },
						{ amount: 20000, frequency: 'biweekly' },
						{ amount: 50000, frequency: 'monthly' },
					],
					expected: 136666,
				},
			],
			[
				'should return 0 for empty array',
				{
					items: [],
					expected: 0,
				},
			],
			[
				'should handle negative income amounts',
				{
					items: [{ amount: -50000, frequency: 'monthly' }],
					expected: -50000,
				},
			],
		])('%s', (_title, { items, expected }) => {
			expect(calculateGrossPeriodIncome(items)).toBe(expected)
		})
	})

	describe('calculateTotalPeriodExpenses', () => {
		it.each<[string, TotalCase]>([
			[
				'should calculate total expenses from single monthly expense ($200 → 20000 cents)',
				{
					items: [{ amount: 20000, frequency: 'monthly' }],
					expected: 20000,
				},
			],
			// $50 * 52/12 = $216.666... = 21667 cents (rounded)
			[
				'should calculate total expenses from weekly expense ($50/week)',
				{
					items: [{ amount: 5000, frequency: 'weekly' }],
					expected: 21667,
				},
			],
			// 43333 + 10833 + 20000 = 74166
			[
				'should calculate total expenses from multiple expenses with different frequencies',
				{
					items: [
						{ amount: 10000, frequency: 'weekly' },
						{ amount: 5000, frequency: 'biweekly' },
						{ amount: 20000, frequency: 'monthly' },
					],
					expected: 74166,
				},
			],
			[
				'should return 0 for empty array',
				{
					items: [],
					expected: 0,
				},
			],
			[
				'should handle negative expense amounts',
				{
					items: [{ amount: -20000, frequency: 'monthly' }],
					expected: -20000,
				},
			],
		])('%s', (_title, { items, expected }) => {
			expect(calculateTotalPeriodExpenses(items)).toBe(expected)
		})
	})

	describe('calculateNetPeriodIncome', () => {
		it.each<[string, NetCase]>([
			[
				'should calculate net income with surplus (income > expenses)',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 20000, frequency: 'monthly' }],
					expected: 30000,
				},
			],
			[
				'should calculate net income with deficit (expenses > income)',
				{
					income: [{ amount: 20000, frequency: 'monthly' }],
					expenses: [{ amount: 50000, frequency: 'monthly' }],
					expected: -30000,
				},
			],
			[
				'should calculate net income with break-even (income = expenses)',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [{ amount: 50000, frequency: 'monthly' }],
					expected: 0,
				},
			],
			// 43333 - 21667 = 21666
			[
				'should calculate net income with mixed frequencies',
				{
					income: [{ amount: 10000, frequency: 'weekly' }],
					expenses: [{ amount: 10000, frequency: 'biweekly' }],
					expected: 21666,
				},
			],
			[
				'should handle empty income and expense arrays',
				{
					income: [],
					expenses: [],
					expected: 0,
				},
			],
			[
				'should handle empty expenses array',
				{
					income: [{ amount: 50000, frequency: 'monthly' }],
					expenses: [],
					expected: 50000,
				},
			],
			[
				'should handle empty income array',
				{
					income: [],
					expenses: [{ amount: 20000, frequency: 'monthly' }],
					expected: -20000,
				},
			],
		])('%s', (_title, { income, expenses, expected }) => {
			expect(calculateNetPeriodIncome(income, expenses)).toBe(expected)
		})
	})

	describe('calculateNetIncomeResult', () => {
		it('should return detailed result with surplus', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]

			const result = calculateNetIncomeResult(incomeSources, expenses)

			expect(result).toEqual<NetIncomeResult>({
				grossIncome: 50000,
				totalExpenses: 20000,
				netIncome: 30000,
				isSurplus: true,
			})
		})

		it('should return detailed result with deficit', () => {
			const incomeSources = [{ amount: 20000, frequency: 'monthly' as const }]
			const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

			const result = calculateNetIncomeResult(incomeSources, expenses)

			expect(result).toEqual<NetIncomeResult>({
				grossIncome: 20000,
				totalExpenses: 50000,
				netIncome: -30000,
				isSurplus: false,
			})
		})

		it('should return detailed result with break-even', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
			const expenses = [{ amount: 50000, frequency: 'monthly' as const }]

			const result = calculateNetIncomeResult(incomeSources, expenses)

			expect(result).toEqual<NetIncomeResult>({
				grossIncome: 50000,
				totalExpenses: 50000,
				netIncome: 0,
				isSurplus: false, // 0 is break-even, not surplus
			})
		})

		it('should handle empty arrays', () => {
			const result = calculateNetIncomeResult([], [])

			expect(result).toEqual<NetIncomeResult>({
				grossIncome: 0,
				totalExpenses: 0,
				netIncome: 0,
				isSurplus: false, // 0 is break-even, not surplus
			})
		})
	})

	describe('Mathematical Validation - Zero Tolerance', () => {
		it('should pass exact validation: weekly income vs monthly expense', () => {
			const incomeSources = [{ amount: 10000, frequency: 'weekly' as const }]
			const expenses = [{ amount: 10000, frequency: 'monthly' as const }]

			const result = calculateNetPeriodIncome(incomeSources, expenses)
			// 43333 - 10000 = 33333
			expect(result).toBe(33333)
		})

		it('should pass exact validation: complex scenario with multiple frequencies', () => {
			const incomeSources = [
				{ amount: 10000, frequency: 'weekly' as const },
				{ amount: 5000, frequency: 'biweekly' as const },
			]
			const expenses = [
				{ amount: 20000, frequency: 'monthly' as const },
				{ amount: 5000, frequency: 'weekly' as const },
			]

			const result = calculateNetPeriodIncome(incomeSources, expenses)
			// Income 43333 + 10833 = 54166; expenses 20000 + 21667 = 41667; net 12499.
			expect(result).toBe(12499)
		})
	})

	describe('Edge Cases - Zero Tolerance for Errors', () => {
		it('should handle empty income array', () => {
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			const result = calculateNetPeriodIncome([], expenses)
			expect(result).toBe(-20000)
		})

		it('should handle empty expenses array', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }]
			const result = calculateNetPeriodIncome(incomeSources, [])
			expect(result).toBe(50000)
		})

		it('should handle all negative amounts', () => {
			const incomeSources = [{ amount: -10000, frequency: 'monthly' as const }]
			const expenses = [{ amount: -5000, frequency: 'monthly' as const }]
			const result = calculateNetPeriodIncome(incomeSources, expenses)
			// -10000 - (-5000) = -5000
			expect(result).toBe(-5000)
		})

		it('should handle very large numbers', () => {
			const incomeSources = [{ amount: Number.MAX_SAFE_INTEGER, frequency: 'monthly' as const }]
			const expenses = [{ amount: 0, frequency: 'monthly' as const }]
			const result = calculateNetPeriodIncome(incomeSources, expenses)
			expect(result).toBe(Number.MAX_SAFE_INTEGER)
		})

		it('should handle null incomeSources array', () => {
			const result = calculateNetPeriodIncome(null as any, [])
			expect(result).toBe(0)
		})

		it('should handle undefined incomeSources array', () => {
			const result = calculateNetPeriodIncome(undefined as any, [])
			expect(result).toBe(0)
		})

		it('should handle null expenses array', () => {
			const result = calculateNetPeriodIncome([], null as any)
			expect(result).toBe(0)
		})

		it('should handle undefined expenses array', () => {
			const result = calculateNetPeriodIncome([], undefined as any)
			expect(result).toBe(0)
		})

		it('should handle both null arrays', () => {
			const result = calculateNetPeriodIncome(null as any, null as any)
			expect(result).toBe(0)
		})

		it('should throw error for arrays with null elements', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }, null as any]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			expect(() => calculateNetPeriodIncome(incomeSources, expenses)).toThrow(
				'Amount must be a finite number'
			)
		})

		it('should throw error for arrays with undefined elements', () => {
			const incomeSources = [{ amount: 50000, frequency: 'monthly' as const }, undefined as any]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			expect(() => calculateNetPeriodIncome(incomeSources, expenses)).toThrow(
				'Amount must be a finite number'
			)
		})

		it('should throw error for NaN in income amounts', () => {
			const incomeSources = [{ amount: Number.NaN, frequency: 'monthly' as const }]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			expect(() => calculateNetPeriodIncome(incomeSources, expenses)).toThrow(
				'Amount must be a finite number'
			)
		})

		it('should throw error for Infinity in income amounts', () => {
			const incomeSources = [{ amount: Number.POSITIVE_INFINITY, frequency: 'monthly' as const }]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			expect(() => calculateNetPeriodIncome(incomeSources, expenses)).toThrow(
				'Amount must be a finite number'
			)
		})

		it('should throw error for string numbers (type coercion)', () => {
			const incomeSources = [{ amount: '50000' as any, frequency: 'monthly' as const }]
			const expenses = [{ amount: 20000, frequency: 'monthly' as const }]
			expect(() => calculateNetPeriodIncome(incomeSources, expenses)).toThrow(
				'Amount must be a finite number'
			)
		})
	})
})
