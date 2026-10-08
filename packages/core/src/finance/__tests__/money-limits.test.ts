import { describe, expect, it } from 'vitest'
import { validateBalanceTracking } from '../../services/balanceTracking'
import { validateSavingsGoal } from '../../services/savingsGoals'
import {
	balanceTrackingSchema,
	PG_INT32_MAX,
	savingsGoalSchema,
	syncOperationDataSchema,
} from '../../sync/types'
import { MAX_MONEY_CENTS } from '../money-limits'

const OVER = MAX_MONEY_CENTS + 1

describe('MAX_MONEY_CENTS', () => {
	it('equals the int32 column bound the sync gate enforces', () => {
		expect(MAX_MONEY_CENTS).toBe(PG_INT32_MAX)
		expect(MAX_MONEY_CENTS).toBe(2_147_483_647)
	})
})

describe('the sync operation gate refuses one cent over, accepts the limit (this is the split)', () => {
	const fields = [
		'amount',
		'targetAmount',
		'currentBalance',
		'monthlyAllocation',
		'monthlyContribution',
	] as const
	it.each(fields)('%s', (field) => {
		expect(syncOperationDataSchema.safeParse({ [field]: MAX_MONEY_CENTS }).success).toBe(true)
		expect(syncOperationDataSchema.safeParse({ [field]: OVER }).success).toBe(false)
	})
})

describe('the per-entity pull schemas bound money at the same constant', () => {
	it('savings goal: target, balance, allocation', () => {
		const shape = savingsGoalSchema.shape
		for (const field of ['targetAmount', 'currentBalance', 'monthlyAllocation'] as const) {
			expect(shape[field].safeParse(MAX_MONEY_CENTS).success).toBe(true)
			expect(shape[field].safeParse(OVER).success).toBe(false)
		}
	})

	it('balance row: balance, contribution', () => {
		const shape = balanceTrackingSchema.shape
		for (const field of ['currentBalance', 'monthlyContribution'] as const) {
			expect(shape[field].safeParse(MAX_MONEY_CENTS).success).toBe(true)
			expect(shape[field].safeParse(OVER).success).toBe(false)
		}
	})
})

describe('validateBalanceTracking bounds money at the sync limit', () => {
	const row = {
		type: 'investment' as const,
		name: 'Brokerage',
		currentBalance: 0,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
	}
	const fieldsOf = (input: Partial<typeof row>) =>
		validateBalanceTracking({ ...row, ...input }).map((e) => e.field)

	it('current balance: the limit passes, one cent over is refused', () => {
		expect(fieldsOf({ currentBalance: MAX_MONEY_CENTS })).toEqual([])
		expect(fieldsOf({ currentBalance: OVER })).toEqual(['currentBalance'])
	})

	it('contribution: the limit passes, one cent over is refused', () => {
		expect(fieldsOf({ monthlyContribution: MAX_MONEY_CENTS })).toEqual([])
		expect(fieldsOf({ monthlyContribution: OVER })).toEqual(['monthlyContribution'])
	})
})

describe('validateSavingsGoal bounds money at the sync limit', () => {
	const goal = {
		name: 'House',
		targetAmount: MAX_MONEY_CENTS,
		currentBalance: 0,
		allocationMode: 'manual' as const,
		monthlyAllocation: 0,
	}
	const fieldsOf = (input: Partial<typeof goal>) =>
		validateSavingsGoal({ ...goal, ...input }).map((e) => e.field)

	it('the limit passes on every money field', () => {
		expect(
			fieldsOf({ currentBalance: MAX_MONEY_CENTS, monthlyAllocation: MAX_MONEY_CENTS })
		).toEqual([])
	})

	it('one cent over is refused on target, balance (account) and allocation', () => {
		expect(fieldsOf({ targetAmount: OVER })).toEqual(['targetAmount'])
		// An account (no target), so "exceeds target" cannot be what refuses it.
		expect(
			validateSavingsGoal({ ...goal, targetAmount: null, currentBalance: OVER }).map((e) => e.field)
		).toEqual(['currentBalance'])
		expect(fieldsOf({ monthlyAllocation: OVER })).toEqual(['monthlyAllocation'])
	})
})
