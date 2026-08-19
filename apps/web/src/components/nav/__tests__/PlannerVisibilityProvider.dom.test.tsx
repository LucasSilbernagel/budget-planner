/**
 * PlannerVisibilityProvider tests (story 35.2, review fix).
 *
 * ⚠️ WHY THIS EXISTS. The `<head>` bootstrap only ever SETS
 * `data-hide-retirement`. Shipped without a remover, this happened on a plain
 * reachable path: hide the planner → load a page (attribute stamped) →
 * re-enable in the same session → React re-renders the nav entry → the CSS rule
 * still matches → the entry stays invisible until a full reload. Two review
 * layers found it independently; the e2e that should have caught it asserted
 * `toHaveCount(1)`, which passes on a `display: none` element.
 *
 * These tests pin the two-way sync at the unit level. jsdom cannot evaluate the
 * CSS rule, but the ATTRIBUTE is a real DOM fact it can see — and the attribute
 * is what the rule keys on.
 */

import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
import { PlannerVisibilityProvider } from '../PlannerVisibilityProvider'

const hideAttr = () => document.documentElement.getAttribute('data-hide-retirement')

beforeEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  localStorage.clear()
  document.documentElement.removeAttribute('data-hide-retirement')
})

afterEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  document.documentElement.removeAttribute('data-hide-retirement')
})

describe('PlannerVisibilityProvider', () => {
  it('marks <html> when the planner is hidden', () => {
    usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
    render(<PlannerVisibilityProvider />)
    expect(hideAttr()).toBe('1')
  })

  it('leaves <html> unmarked when the planner is visible', () => {
    render(<PlannerVisibilityProvider />)
    expect(hideAttr()).toBeNull()
  })

  /**
   * THE REGRESSION THIS FIX EXISTS FOR: the `<head>` script has already stamped
   * the attribute, and the user re-enables the planner in the same session.
   */
  it('removes a stale mark left by the pre-paint script when the planner is re-enabled', () => {
    // Simulate the <head> bootstrap having run on a hidden-preference load.
    document.documentElement.setAttribute('data-hide-retirement', '1')
    usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
    render(<PlannerVisibilityProvider />)
    expect(hideAttr(), 'the mark should survive while the planner is still hidden').toBe('1')

    act(() => {
      usePlannerVisibilityStore.getState().setShowRetirementPlanner(true)
    })

    expect(
      hideAttr(),
      'the stale mark survived a re-enable — the nav entry stays CSS-hidden until reload'
    ).toBeNull()
  })

  it('re-marks <html> when the planner is hidden again without a reload', () => {
    render(<PlannerVisibilityProvider />)
    expect(hideAttr()).toBeNull()

    act(() => {
      usePlannerVisibilityStore.getState().setShowRetirementPlanner(false)
    })

    expect(hideAttr()).toBe('1')
  })

  /**
   * ⚠️ Ordering guard. A plain `[value]`-dependency effect would apply the
   * DETERMINISTIC DEFAULT (visible) before rehydration and strip the attribute
   * the `<head>` script just set — reintroducing the flash. The provider
   * rehydrates FIRST and applies from the resolved value, as ThemeProvider does.
   */
  it('applies the PERSISTED value, not the pre-rehydration default', () => {
    localStorage.setItem(
      'budget-planner-planner-visibility-v1',
      JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
    )
    // The store is still at its deterministic default here, as it is on a real
    // first client render.
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)

    document.documentElement.setAttribute('data-hide-retirement', '1')
    render(<PlannerVisibilityProvider />)

    expect(
      hideAttr(),
      'the provider stripped the pre-paint mark before reading the persisted value'
    ).toBe('1')
  })

  it('stops syncing after unmount', () => {
    const { unmount } = render(<PlannerVisibilityProvider />)
    unmount()

    act(() => {
      usePlannerVisibilityStore.getState().setShowRetirementPlanner(false)
    })

    expect(hideAttr(), 'the subscription outlived the component').toBeNull()
  })
})
