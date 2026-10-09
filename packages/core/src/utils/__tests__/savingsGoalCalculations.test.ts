import { describe, expect, it } from 'vitest'
import {
	calculateMonthlySavingsNeeded,
	calculateProgress,
	calculateRemaining,
	formatPercentage,
	getProgressInfo,
	getProgressStatus,
} from '../savingsGoalCalculations'

describe('savingsGoalCalculations', () => {
	describe('calculateProgress', () => {
		it.each([
			[
				'should return 60% when currentBalance is 60% of targetAmount',
				{
					target: 100000,
					current: 60000,
					expected: 60,
				},
			],
			[
				'should return 0% when currentBalance is 0',
				{
					target: 100000,
					current: 0,
					expected: 0,
				},
			],
			[
				'should return 100% when currentBalance equals targetAmount',
				{
					target: 100000,
					current: 100000,
					expected: 100,
				},
			],
			[
				'should return 0 when targetAmount is 0 (division by zero protection)',
				{
					target: 0,
					current: 100,
					expected: 0,
				},
			],
			[
				'should return 0 when targetAmount is negative',
				{
					target: -100,
					current: 50,
					expected: 0,
				},
			],
			[
				'should return 50% when currentBalance is half of targetAmount',
				{
					target: 20000,
					current: 10000,
					expected: 50,
				},
			],
			[
				'should return 25% when currentBalance is 25% of targetAmount',
				{
					target: 40000,
					current: 10000,
					expected: 25,
				},
			],
			[
				'should return 75% when currentBalance is 75% of targetAmount',
				{
					target: 40000,
					current: 30000,
					expected: 75,
				},
			],
			[
				'should handle currentBalance exceeding targetAmount',
				{
					target: 10000,
					current: 15000,
					expected: 100,
				},
			],
		])('%s', (_title, { target, current, expected }) => {
			expect(calculateProgress(target, current)).toBe(expected)
		})
	})

	describe('formatPercentage', () => {
		it.each([
			[60, '60%'],
			[0, '0%'],
			[100, '100%'],
			[33, '33%'],
		])('should format %i as "%s"', (value, expected) => {
			expect(formatPercentage(value)).toBe(expected)
		})
	})

	describe('calculateRemaining', () => {
		it.each([
			[
				'should return remaining amount when not complete',
				{
					target: 10000,
					current: 6000,
					expected: 4000,
				},
			],
			[
				'should return 0 when target is reached',
				{
					target: 10000,
					current: 10000,
					expected: 0,
				},
			],
			[
				'should return 0 when currentBalance exceeds target',
				{
					target: 10000,
					current: 15000,
					expected: 0,
				},
			],
			[
				'should return targetAmount when currentBalance is 0',
				{
					target: 5000,
					current: 0,
					expected: 5000,
				},
			],
		])('%s', (_title, { target, current, expected }) => {
			expect(calculateRemaining(target, current)).toBe(expected)
		})
	})

	describe('calculateMonthlySavingsNeeded', () => {
		it.each([
			[
				'should calculate correct monthly amount for 12 months',
				{
					args: [120000, 0, 12],
					expected: 10000,
				},
			],
			[
				'should calculate correct monthly amount with existing balance',
				{
					args: [120000, 60000, 6],
					expected: 10000,
				},
			],
			[
				'should return 0 when goal is already complete',
				{
					args: [10000, 15000, 12],
					expected: 0,
				},
			],
			// 3333.67 per month rounds up to 3334
			[
				'should round up to ensure target is reached',
				{
					args: [10001, 0, 3],
					expected: 3334,
				},
			],
		] as const)('%s', (_title, { args: [target, current, months], expected }) => {
			expect(calculateMonthlySavingsNeeded(target, current, months)).toBe(expected)
		})

		it('should return 0 when months is 0 or negative', () => {
			expect(calculateMonthlySavingsNeeded(10000, 0, 0)).toBe(0)
			expect(calculateMonthlySavingsNeeded(10000, 0, -5)).toBe(0)
		})
	})

	describe('getProgressStatus', () => {
		it.each([
			[
				'should return "Complete" when progress is 100',
				{
					progress: 100,
					expected: 'Complete',
				},
			],
			[
				'should return "Complete" when progress is 101',
				{
					progress: 101,
					expected: 'Complete',
				},
			],
			['should return "On Track" when progress is 75', { progress: 75, expected: 'On Track' }],
			[
				'should return "In Progress" when progress is 50',
				{
					progress: 50,
					expected: 'In Progress',
				},
			],
			[
				'should return "In Progress" when progress is 25',
				{
					progress: 25,
					expected: 'In Progress',
				},
			],
			['should return "Started" when progress is 10', { progress: 10, expected: 'Started' }],
			['should return "Started" when progress is 1', { progress: 1, expected: 'Started' }],
			[
				'should return "Not Started" when progress is 0',
				{
					progress: 0,
					expected: 'Not Started',
				},
			],
			[
				'should return "Not Started" when progress is negative',
				{
					progress: -5,
					expected: 'Not Started',
				},
			],
		])('%s', (_title, { progress, expected }) => {
			expect(getProgressStatus(progress)).toBe(expected)
		})
	})

	describe('getProgressInfo', () => {
		it.each([
			[
				'60% complete',
				{
					current: 60000,
					percentage: 60,
					formattedPercentage: '60%',
					remainingAmount: 40000,
					status: 'In Progress',
					isComplete: false,
				},
			],
			[
				'completed',
				{
					current: 100000,
					percentage: 100,
					formattedPercentage: '100%',
					remainingAmount: 0,
					status: 'Complete',
					isComplete: true,
				},
			],
			[
				'not started',
				{
					current: 0,
					percentage: 0,
					formattedPercentage: '0%',
					remainingAmount: 100000,
					status: 'Not Started',
					isComplete: false,
				},
			],
		])(
			'should return complete progress info for %s goal',
			(_goal, {
				current,
				percentage,
				formattedPercentage,
				remainingAmount,
				status,
				isComplete,
			}) => {
				const info = getProgressInfo(100000, current)
				expect(info.percentage).toBe(percentage)
				expect(info.formattedPercentage).toBe(formattedPercentage)
				expect(info.remainingAmount).toBe(remainingAmount)
				expect(info.status).toBe(status)
				expect(info.isComplete).toBe(isComplete)
			}
		)
	})
})
