/**
 * Hiding the Retirement planner deletes nothing (story 35.2, AC-7).
 *
 * ⚠️ READ THIS BEFORE "IMPROVING" THE TEST. The epic asked us to prove that
 * "hiding the planner never deletes retirement inputs". Taken literally that is
 * VACUOUS: the planner persists nothing of its own. All seven of its fields are
 * plain `useState` in `RetirementAccumulationPlanner` — current age, life
 * expectancy, desired income, income basis, annual return, post-retirement
 * return (story 35.3), model — and they already reset on every remount and
 * reload today. There is no `retirementStore`
 * to clear. A test asserting those fields survive a toggle would fail against
 * CORRECT code.
 *
 * So this asserts the claim that IS true and IS worth protecting: the four
 * shared stores the planner reads are byte-identical across a hide/show cycle.
 * Those are owned by other pages and read by many consumers, which makes them a
 * real regression surface — and the toggle sits on the same Settings page as
 * "Clear local data", so "this control deletes nothing" is a claim users need
 * to be true.
 *
 * The cycle is driven through the REAL control, not `setState`, so a future
 * implementation that purged something on the way past would be caught.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
import { RetirementVisibilityToggle } from '../retirement-visibility-toggle'

/** The four persisted keys `RetirementAccumulationPlanner` reads. */
const SHARED_KEYS = {
  'budget-planner-income-v1': { state: { incomeSources: [{ id: 'i1', name: 'Salary' }] } },
  'budget-planner-expenses-v1': { state: { expenses: [{ id: 'e1', name: 'Rent' }] } },
  'budget-planner:balance-tracking': { state: { entries: [{ id: 'b1', name: 'ISA' }] } },
  'budget-planner-currency-prefs-v1': { state: { mode: 'symbol', currency: 'USD' } },
} as const

beforeEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  localStorage.clear()
  for (const [key, value] of Object.entries(SHARED_KEYS)) {
    localStorage.setItem(key, JSON.stringify(value))
  }
})

afterEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
})

describe('hiding the Retirement planner', () => {
  it('leaves every shared store byte-identical across a hide/show cycle (AC-7)', async () => {
    const user = userEvent.setup()
    const before = Object.fromEntries(
      Object.keys(SHARED_KEYS).map((key) => [key, localStorage.getItem(key)])
    )

    render(<RetirementVisibilityToggle />)
    const toggle = screen.getByRole('switch', { name: /show retirement planner/i })

    await user.click(toggle)
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(false)
    for (const key of Object.keys(SHARED_KEYS)) {
      expect(localStorage.getItem(key), `${key} changed when the planner was hidden`).toBe(
        before[key]
      )
    }

    await user.click(toggle)
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
    for (const key of Object.keys(SHARED_KEYS)) {
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
      (key) => !(key in SHARED_KEYS) && key.startsWith('budget-planner')
    )
    expect(touched).toEqual(['budget-planner-planner-visibility-v1'])
  })
})
