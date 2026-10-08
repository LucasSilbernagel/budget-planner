/**
 * The pre-paint <head> script parses this blob separately, so these pin the storage contract:
 * the key, the shape, and that only a literal `false` hides.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  PLANNER_VISIBILITY_STORAGE_KEY,
  usePlannerVisibilityStore,
} from '../plannerVisibilityStore'

beforeEach(() => {
  // Order matters: setState writes through persist even under skipHydration. Reset the singleton
  // first, wipe storage second.
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  localStorage.clear()
})

async function rehydrateWith(state: unknown): Promise<boolean> {
  localStorage.setItem(PLANNER_VISIBILITY_STORAGE_KEY, JSON.stringify({ state, version: 0 }))
  await usePlannerVisibilityStore.persist.rehydrate()
  return usePlannerVisibilityStore.getState().showRetirementPlanner
}

describe('plannerVisibilityStore', () => {
  it('defaults to visible (deterministic, SSR-safe)', () => {
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
  })

  it('setShowRetirementPlanner sets the flag', () => {
    usePlannerVisibilityStore.getState().setShowRetirementPlanner(false)
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(false)

    usePlannerVisibilityStore.getState().setShowRetirementPlanner(true)
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
  })

  it('toggleRetirementPlanner flips the flag', () => {
    usePlannerVisibilityStore.getState().toggleRetirementPlanner()
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(false)

    usePlannerVisibilityStore.getState().toggleRetirementPlanner()
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
  })

  it('persists only the flag under the versioned key', () => {
    usePlannerVisibilityStore.getState().setShowRetirementPlanner(false)

    const raw = localStorage.getItem(PLANNER_VISIBILITY_STORAGE_KEY)
    expect(raw).not.toBeNull()

    const parsed = JSON.parse(raw as string)
    expect(parsed.state.showRetirementPlanner).toBe(false)
    expect(Object.keys(parsed.state)).toEqual(['showRetirementPlanner'])
  })

  it('rehydrates a persisted false', async () => {
    expect(await rehydrateWith({ showRetirementPlanner: false })).toBe(false)
  })

  it('rehydrates a persisted true', async () => {
    usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
    expect(await rehydrateWith({ showRetirementPlanner: true })).toBe(true)
  })

  /**
   * `'false'`, `0` and `null` are falsy; a `!value` coercion would hide the planner for a user who
   * never asked.
   */
  it.each([
    ['the string "false"', 'false'],
    ['the number 0', 0],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['an empty string', ''],
  ])('coerces %s back to visible', async (_label, value) => {
    expect(await rehydrateWith({ showRetirementPlanner: value })).toBe(true)
  })

  it('coerces a missing field back to visible', async () => {
    expect(await rehydrateWith({})).toBe(true)
  })

  /**
   * merge does not run when storage is empty, so this asserts the deterministic default, not the
   * sanitizer.
   */
  it('leaves the default visible when nothing is persisted', async () => {
    expect(localStorage.getItem(PLANNER_VISIBILITY_STORAGE_KEY)).toBeNull()
    await usePlannerVisibilityStore.persist.rehydrate()
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
  })
})
