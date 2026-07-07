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
import { OVERVIEW_DURATION_STORAGE_KEY, useOverviewDurationStore } from '../overviewDurationStore'

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
