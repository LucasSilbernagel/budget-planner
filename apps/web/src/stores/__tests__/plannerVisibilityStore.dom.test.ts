/**
 * plannerVisibilityStore tests (story 35.2, FR55).
 *
 * The store is the single source of truth for whether the Retirement planner is
 * surfaced. Two independent readers depend on the persisted shape:
 *   - `lib/store-hydration` → the React tree (nav + route);
 *   - `lib/nav/no-flash-planner-visibility-script` → a pre-paint `<head>` script
 *     that hard-parses the same blob before any module can load.
 *
 * So these tests pin the *storage contract*, not just the in-memory behavior:
 * the key, the partialized shape, and — load-bearing — that anything other than
 * a literal `false` means SHOW. The script implements that same rule separately;
 * if the two ever disagree, a corrupt blob hides the planner on the first frame
 * and reveals it after hydration.
 *
 * Runs in jsdom (`.dom.test.ts`) for a real `localStorage`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  PLANNER_VISIBILITY_STORAGE_KEY,
  usePlannerVisibilityStore,
} from '../plannerVisibilityStore'

beforeEach(() => {
  // ⚠️ Order matters. `setState` on a persisted store hits the WRITE path even
  // under `skipHydration`, so clearing first and resetting second leaves a blob
  // behind — and any test asserting "nothing is persisted yet" would then fail
  // against correct code. Reset the singleton first, wipe storage second.
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  localStorage.clear()
})

/** Seed a raw persisted blob and rehydrate, the way a page load would. */
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
    // partialize keeps the persisted payload to just the one field — the
    // pre-paint script parses this exact shape.
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
   * ⚠️ Only a literal `false` hides the planner.
   *
   * `'false'`, `0` and `null` are all falsy, so a coercion written as
   * `!value` or `value === false ? … : …` on an untyped blob would hide the
   * planner for a user who never asked — and, worse, would disagree with the
   * pre-paint script if only one of the two readers were written that way.
   * Every one of these must resolve to SHOW.
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
   * A first-ever visit: nothing persisted at all.
   *
   * ⚠️ `merge` does NOT run when storage holds no blob — zustand's rehydrate is
   * a no-op, so this asserts the *deterministic default* survives, not the
   * sanitizer. Pre-setting `false` here (as a first draft of this test did)
   * would assert a state no load path can produce and fail against correct code.
   */
  it('leaves the default visible when nothing is persisted', async () => {
    expect(localStorage.getItem(PLANNER_VISIBILITY_STORAGE_KEY)).toBeNull()
    await usePlannerVisibilityStore.persist.rehydrate()
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
  })
})
