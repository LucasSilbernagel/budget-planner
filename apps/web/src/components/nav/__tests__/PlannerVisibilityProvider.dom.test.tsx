// jsdom can't evaluate the CSS rule, but the attribute it keys on is a real DOM fact.

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

  it('removes a stale mark left by the pre-paint script when the planner is re-enabled', () => {
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

  /** Ordering guard: applying before rehydration would strip the attribute the <head> script set. */
  it('applies the PERSISTED value, not the pre-rehydration default', () => {
    localStorage.setItem(
      'budget-planner-planner-visibility-v1',
      JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
    )
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
