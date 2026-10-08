/** A field missing from core's `retirementPlanSyncSchema` is silently stripped from every pushed plan. */

import {
	RETIREMENT_ADOPTED_CENTS_MAX,
	retirementPlanSyncSchema,
} from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import {
	coerceAdoptedCents,
	coerceRetirementPlan,
	RETIREMENT_PLAN_DEFAULTS,
} from '../../retirement-plan'

describe('AC-5a: the push schema and the plan agree key for key', () => {
	it('retirementPlanSyncSchema declares exactly the keys of RETIREMENT_PLAN_DEFAULTS', () => {
		expect(Object.keys(retirementPlanSyncSchema.shape).sort()).toEqual(
			Object.keys(RETIREMENT_PLAN_DEFAULTS).sort()
		)
	})

	it('the defaults themselves pass the push gate (a fresh plan is always pushable)', () => {
		expect(retirementPlanSyncSchema.parse(RETIREMENT_PLAN_DEFAULTS)).toEqual(
			RETIREMENT_PLAN_DEFAULTS
		)
	})

	it('a coerced plan of wrong-TYPED garbage passes the push gate, every key kept', () => {
		// The coercion does not bound string length; `toServerPayload` clamps that.
		const garbage = coerceRetirementPlan({
			currentAgeInput: 42,
			incomeBasis: 'weekly',
			model: null,
			adoptedMonthlyCents: -5,
			desiredIncomeTouched: 'yes',
		})
		expect(retirementPlanSyncSchema.parse(garbage)).toEqual(garbage)
	})

	it('refuses what jsonb cannot store, accepts a paired emoji (99.2 review)', () => {
		const at = (desiredIncomeInput: string) =>
			retirementPlanSyncSchema.safeParse({ ...RETIREMENT_PLAN_DEFAULTS, desiredIncomeInput })
				.success
		expect(at('1\u00002')).toBe(false)
		expect(at('\ud800')).toBe(false)
		expect(at('\udc00x')).toBe(false)
		expect(at('😀 55,000')).toBe(true)
	})

	it('the adopted-cents bound is the coercion’s bound, at the edge', () => {
		expect(coerceAdoptedCents(RETIREMENT_ADOPTED_CENTS_MAX)).toBe(RETIREMENT_ADOPTED_CENTS_MAX)
		expect(coerceAdoptedCents(RETIREMENT_ADOPTED_CENTS_MAX + 1)).toBeNull()
	})
})
