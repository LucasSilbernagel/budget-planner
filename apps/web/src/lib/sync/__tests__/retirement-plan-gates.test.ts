/**
 * Parity pins for the retirement plan's sync contract (story 99.2, AC-5a).
 *
 * ⚠️ Each pin IMPORTS both sides; no hand-written list. A field added to
 * `RetirementPlan` (and so to `RETIREMENT_PLAN_DEFAULTS`, which the type forces)
 * but not to core's `retirementPlanSyncSchema` would be STRIPPED from every
 * pushed plan by the nested `z.object`, silently: every other device would keep
 * its old value for ever. This file is what turns that into a red test.
 */

import {
  RETIREMENT_ADOPTED_CENTS_MAX,
  retirementPlanSyncSchema,
} from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import {
  RETIREMENT_PLAN_DEFAULTS,
  coerceAdoptedCents,
  coerceRetirementPlan,
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
    // Wrong types and unknown enum values only. The coercion does NOT bound string
    // LENGTH (the gate caps at RETIREMENT_PLAN_STRING_MAX): `toServerPayload`
    // clamps that, pinned in `syncBridge.test.ts` (99.2 code review).
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
