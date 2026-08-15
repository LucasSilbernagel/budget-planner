/**
 * overviewDurationStore tests (story 12-2, FR31).
 *
 * The store is the single source of truth for the Financial Overview's duration
 * selector. These tests pin the behaviors the overview relies on:
 *   - a deterministic `'annually'` default (SSR-safe: identical on the server and
 *     first client paint — no navigator/OS derivation);
 *   - setting the duration;
 *   - the persisted localStorage shape (`{ state: { duration } }` under the key).
 *
 * Runs in jsdom (`.dom.test.ts`) for a real `localStorage`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DURATION_LABEL,
  DURATION_OPTION_LABEL,
  OVERVIEW_DURATION_STORAGE_KEY,
  VALID_DURATIONS,
  useOverviewDurationStore,
} from '../overviewDurationStore'

beforeEach(() => {
  localStorage.clear()
  // Reset the module singleton between tests.
  useOverviewDurationStore.setState({ duration: 'annually' })
})

describe('overviewDurationStore', () => {
  it('defaults to annually (deterministic, SSR-safe)', () => {
    expect(useOverviewDurationStore.getState().duration).toBe('annually')
  })

  it('setDuration sets the duration', () => {
    useOverviewDurationStore.getState().setDuration('weekly')
    expect(useOverviewDurationStore.getState().duration).toBe('weekly')

    useOverviewDurationStore.getState().setDuration('monthly')
    expect(useOverviewDurationStore.getState().duration).toBe('monthly')
  })

  it('persists only the duration under the versioned key', () => {
    useOverviewDurationStore.getState().setDuration('weekly')

    const raw = localStorage.getItem(OVERVIEW_DURATION_STORAGE_KEY)
    expect(raw).not.toBeNull()

    const parsed = JSON.parse(raw as string)
    expect(parsed.state.duration).toBe('weekly')
    // partialize keeps the persisted payload to just `duration`.
    expect(Object.keys(parsed.state)).toEqual(['duration'])
  })

  it('rehydrates a valid persisted duration', async () => {
    localStorage.setItem(
      OVERVIEW_DURATION_STORAGE_KEY,
      JSON.stringify({ state: { duration: 'weekly' }, version: 0 })
    )
    await useOverviewDurationStore.persist.rehydrate()
    expect(useOverviewDurationStore.getState().duration).toBe('weekly')
  })

  it('coerces a corrupt/unknown persisted duration back to the default on rehydrate', async () => {
    localStorage.setItem(
      OVERVIEW_DURATION_STORAGE_KEY,
      JSON.stringify({ state: { duration: 'daily' }, version: 0 })
    )
    await useOverviewDurationStore.persist.rehydrate()
    // An invalid frequency would otherwise throw in the core denormalizer and
    // crash the dashboard; the merge guard falls back to the default instead.
    expect(useOverviewDurationStore.getState().duration).toBe('annually')
  })
})

describe('overviewDurationStore — biweekly as the fourth duration (story 32.1, FR58)', () => {
  it('setDuration accepts biweekly', () => {
    useOverviewDurationStore.getState().setDuration('biweekly')
    expect(useOverviewDurationStore.getState().duration).toBe('biweekly')
  })

  /**
   * ⚠️ THE TEST THAT CATCHES THE DRIFT TRAP.
   *
   * Before 32.1 the union (`OverviewDuration`) and the coercion set
   * (`VALID_DURATIONS`) were two SEPARATE literals, and `readonly
   * OverviewDuration[]` accepts a 3-element subset — so widening only the union
   * type-checks, and every other test stays green, while `coerceDuration`
   * silently resets a persisted `biweekly` to `annually` on every reload.
   *
   * This is the only assertion that fails in that scenario. 32.1 derives
   * `VALID_DURATIONS` from `DURATION_LABEL`'s keys so the drift is structurally
   * impossible, but this test pins the behaviour regardless of implementation.
   */
  it('rehydrates a persisted biweekly rather than coercing it to the default', async () => {
    localStorage.setItem(
      OVERVIEW_DURATION_STORAGE_KEY,
      JSON.stringify({ state: { duration: 'biweekly' }, version: 0 })
    )
    await useOverviewDurationStore.persist.rehydrate()
    expect(useOverviewDurationStore.getState().duration).toBe('biweekly')
  })

  it('exposes exactly the four entry frequencies, in ascending-period order', () => {
    expect(VALID_DURATIONS).toEqual(['weekly', 'biweekly', 'monthly', 'annually'])
  })

  /**
   * The rendered `<option>` list is built from `DURATION_OPTION_LABEL`, while the
   * coercion set comes from `DURATION_LABEL`'s keys. If those two maps drift
   * apart, a user-selectable option becomes one the store silently rejects on
   * reload — so this pins that they agree.
   *
   * ⚠️ Deliberately does NOT assert `Object.keys(DURATION_LABEL)` against
   * `VALID_DURATIONS`: the store DERIVES the latter from the former, so that
   * comparison is a tautology that passes under any content (caught by code
   * review 32.1). The literal assertion above is what pins the actual key set.
   */
  it('keeps the option-label map in step with the valid set', () => {
    expect(Object.keys(DURATION_OPTION_LABEL)).toEqual([...VALID_DURATIONS])
  })

  it('labels biweekly with the shipped "(per …)" suffix convention', () => {
    expect(DURATION_LABEL).toEqual({
      weekly: '(per week)',
      biweekly: '(per 2 weeks)',
      monthly: '(per month)',
      annually: '(per year)',
    })
  })

  it('labels the biweekly option to match the frequency selects on the entry pages', () => {
    expect(DURATION_OPTION_LABEL.biweekly).toBe('Bi-weekly')
  })
})
