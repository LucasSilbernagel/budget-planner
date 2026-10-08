// Expected strings come from the real core throw, not from the map under test.
// @vitest-environment node

import {
	calculateRequiredNestEgg,
	solveRetirementAccumulation,
} from '@budget-planner/core/finance/retirement'
import { describe, expect, it } from 'vitest'
import { describeSolverError } from '../RetirementAccumulationPlanner'

function thrownBy(fn: () => unknown): Error {
	try {
		fn()
	} catch (error) {
		expect(error).toBeInstanceOf(Error)
		return error as Error
	}
	throw new Error('expected the call to throw, but it returned normally')
}

const solvableBase = {
	currentAge: 35,
	currentSavedCents: 5_954_100,
	monthlySavingsCents: 179_900,
	annualReturnRate: 0.06,
	postRetirementReturnRate: 0.06,
	desiredAnnualIncomeCents: 6_000_000,
	lifeExpectancy: 90,
	model: 'deplete' as const,
}

describe('rate-guard copy parity with core', () => {
	const cases: Array<{ name: string; trigger: () => unknown; expectedMessage: string }> = [
		{
			name: 'solver: non-finite accumulation rate',
			trigger: () => solveRetirementAccumulation({ ...solvableBase, annualReturnRate: Number.NaN }),
			expectedMessage: 'Annual return rate must be a non-negative finite number',
		},
		{
			name: 'solver: negative accumulation rate',
			trigger: () => solveRetirementAccumulation({ ...solvableBase, annualReturnRate: -0.01 }),
			expectedMessage: 'Annual return rate must be a non-negative finite number',
		},
		{
			name: 'solver: non-finite post-retirement rate',
			trigger: () =>
				solveRetirementAccumulation({ ...solvableBase, postRetirementReturnRate: Number.NaN }),
			expectedMessage: 'Post-retirement return rate must be a non-negative finite number',
		},
		{
			name: 'solver: negative post-retirement rate',
			trigger: () =>
				solveRetirementAccumulation({ ...solvableBase, postRetirementReturnRate: -0.01 }),
			expectedMessage: 'Post-retirement return rate must be a non-negative finite number',
		},
		{
			name: 'calculateRequiredNestEgg: non-finite accumulation rate',
			trigger: () => calculateRequiredNestEgg(6_000_000, Number.NaN, 0.06, 65, 90, 'deplete'),
			expectedMessage: 'Annual return rate must be a finite number',
		},
		{
			name: 'calculateRequiredNestEgg: non-finite post-retirement rate',
			trigger: () =>
				calculateRequiredNestEgg(6_000_000, 0.06, Number.POSITIVE_INFINITY, 65, 90, 'deplete'),
			expectedMessage: 'Post-retirement return rate must be a finite number',
		},
		{
			name: 'calculateRequiredNestEgg: negative post-retirement rate (deplete)',
			trigger: () => calculateRequiredNestEgg(6_000_000, 0.06, -1, 65, 90, 'deplete'),
			expectedMessage: 'Post-retirement return rate must be a non-negative finite number',
		},
	]

	for (const { name, trigger, expectedMessage } of cases) {
		it(`${name} → core throws the phase-named message, and the planner can render it`, () => {
			const error = thrownBy(trigger)
			expect(error.message).toBe(expectedMessage)
			expect(describeSolverError(error)).not.toBeNull()
			expect(describeSolverError(error)).not.toBe('')
		})
	}

	it('names the two phases differently, so a user can tell which rate is at fault', () => {
		const accumulation = describeSolverError(
			thrownBy(() => solveRetirementAccumulation({ ...solvableBase, annualReturnRate: -0.01 }))
		)
		const postRetirement = describeSolverError(
			thrownBy(() =>
				solveRetirementAccumulation({ ...solvableBase, postRetirementReturnRate: -0.01 })
			)
		)

		expect(accumulation).not.toBe(postRetirement)
		expect(accumulation).toMatch(/while saving/i)
		expect(postRetirement).toMatch(/post-retirement/i)
	})

	it('returns null for an error it genuinely has no copy for', () => {
		expect(describeSolverError(new Error('a message core does not throw'))).toBeNull()
		expect(describeSolverError('not an error')).toBeNull()
	})
})
