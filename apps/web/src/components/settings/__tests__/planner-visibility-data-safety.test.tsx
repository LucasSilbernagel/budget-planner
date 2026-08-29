/**
 * Hiding the Retirement planner deletes nothing (story 35.2, AC-7).
 *
 * ⚠️ READ THIS BEFORE "IMPROVING" THE TEST. The epic asked us to prove that
 * "hiding the planner never deletes retirement inputs". Until story 44.1 that was
 * VACUOUS: the planner persisted nothing of its own — all of its fields were
 * plain `useState` in `RetirementAccumulationPlanner` and reset on every remount
 * and reload anyway, so there was nothing a toggle could have destroyed.
 *
 * **Story 44.1 made it real.** The plan now lives in `stores/retirementPlannerStore`
 * under `budget-planner-retirement-planner-v1`, so "hiding the planner does not
 * delete the plan" is a claim with something behind it, and it is asserted below
 * alongside the shared stores. Note what would make it false: the toggle sits on
 * the same Settings page as "Clear local data", which since 44.1 DOES purge the
 * plan deliberately (`lib/account/purge-local-financial-data.ts`). Two controls,
 * one screen, opposite obligations — which is exactly why this is worth pinning.
 *
 * The other half is unchanged: the four shared stores the planner READS are owned
 * by other pages and consumed in many places, so they are a real regression
 * surface of their own.
 *
 * The cycle is driven through the REAL control, not `setState`, so an
 * implementation that purged something on the way past would be caught.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
import {
  RETIREMENT_PLANNER_STORAGE_KEY,
  RETIREMENT_PLANNER_VERSION,
} from '../../../stores/retirementPlannerStore'
import { RetirementVisibilityToggle } from '../retirement-visibility-toggle'

/** The four persisted keys `RetirementAccumulationPlanner` READS, owned elsewhere. */
const SHARED_KEYS = {
  'budget-planner-income-v1': { state: { incomeSources: [{ id: 'i1', name: 'Salary' }] } },
  'budget-planner-expenses-v1': { state: { expenses: [{ id: 'e1', name: 'Rent' }] } },
  'budget-planner:balance-tracking': { state: { entries: [{ id: 'b1', name: 'ISA' }] } },
  'budget-planner-currency-prefs-v1': { state: { mode: 'symbol', currency: 'USD' } },
} as const

/**
 * Everything the toggle must leave alone: the four shared stores above plus the
 * planner's OWN saved plan (story 44.1). Values chosen to differ from the
 * defaults, so "unchanged" cannot be satisfied by a store that dropped the blob
 * and re-wrote a fresh one.
 */
const PRESERVED_KEYS = {
  ...SHARED_KEYS,
  [RETIREMENT_PLANNER_STORAGE_KEY]: {
    state: {
      plan: {
        currentAgeInput: '42',
        lifeExpectancyInput: '88',
        desiredIncomeInput: '55,000.00',
        desiredIncomeTouched: true,
        desiredIncomeLocale: 'en-US',
        incomeBasis: 'annual',
        annualReturnInput: '7.5',
        postRetirementReturnInput: '3.25',
        postRetirementTouched: true,
        model: 'perpetual',
      },
    },
    // Imported, not a literal: a version bump would otherwise silently reroute
    // this fixture through `migrate` with no compile-time or runtime signal.
    version: RETIREMENT_PLANNER_VERSION,
  },
} as const

beforeEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  localStorage.clear()
  for (const [key, value] of Object.entries(PRESERVED_KEYS)) {
    localStorage.setItem(key, JSON.stringify(value))
  }
})

afterEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
})

describe('hiding the Retirement planner', () => {
  it('leaves every shared store AND the saved plan byte-identical across a hide/show cycle (AC-7)', async () => {
    const user = userEvent.setup()
    const before = Object.fromEntries(
      Object.keys(PRESERVED_KEYS).map((key) => [key, localStorage.getItem(key)])
    )

    render(<RetirementVisibilityToggle />)
    const toggle = screen.getByRole('switch', { name: /show retirement planner/i })

    await user.click(toggle)
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(false)
    for (const key of Object.keys(PRESERVED_KEYS)) {
      expect(localStorage.getItem(key), `${key} changed when the planner was hidden`).toBe(
        before[key]
      )
    }

    await user.click(toggle)
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
    for (const key of Object.keys(PRESERVED_KEYS)) {
      expect(localStorage.getItem(key), `${key} changed when the planner was restored`).toBe(
        before[key]
      )
    }
  })

  it('writes only its own key', async () => {
    const user = userEvent.setup()
    render(<RetirementVisibilityToggle />)

    await user.click(screen.getByRole('switch', { name: /show retirement planner/i }))

    const touched = Object.keys(localStorage).filter(
      (key) => !(key in PRESERVED_KEYS) && key.startsWith('budget-planner')
    )
    expect(touched).toEqual(['budget-planner-planner-visibility-v1'])
  })
})
