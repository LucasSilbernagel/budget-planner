/**
 * Rate-guard copy parity (story 35.3, AC-9).
 *
 * `SOLVER_ERROR_COPY` is keyed on the EXACT error strings core throws. Nothing
 * type-checks that relationship: reword a guard in `packages/core` and the map
 * silently stops matching, so the planner's detail line just disappears. Before
 * this file nothing covered it at all — the pre-existing
 * `'Annual return rate must be a non-negative finite number'` had been thrown
 * since story 26.6 and was never a key.
 *
 * ⚠️ The expected strings are NOT copied from the map. Each case drives the real
 * core function until it throws and feeds the caught message to the real
 * `describeSolverError`. A test that read its expectations out of the map it is
 * checking could not fail (story 33.2's lesson: a guard derived from the thing it
 * guards is not a guard).
 *
 * ⚠️ These guards are unreachable through the planner's own UI —
 * `parsePercentageToDecimal` rejects every malformed rate before core is called
 * (story 35.3 §1.5). This is a contract test for the module boundary, not a
 * user-flow test, and it is deliberately scoped that way.
 */

// @vitest-environment node

import {
  calculateRequiredNestEgg,
  solveRetirementAccumulation,
} from '@budget-planner/core/finance/retirement'
import { describe, expect, it } from 'vitest'
import { describeSolverError } from '../RetirementAccumulationPlanner'

/** Runs `fn`, expecting it to throw, and returns the thrown Error. */
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
      // Core still says what we think it says…
      expect(error.message).toBe(expectedMessage)
      // …and the planner has copy for it. `null` here means the detail line
      // vanishes for this failure, which is the defect this file exists to catch.
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
    // The negative control: `describeSolverError` must not be a function that
    // returns something for everything, or the assertions above are vacuous.
    expect(describeSolverError(new Error('a message core does not throw'))).toBeNull()
    expect(describeSolverError('not an error')).toBeNull()
  })
})
