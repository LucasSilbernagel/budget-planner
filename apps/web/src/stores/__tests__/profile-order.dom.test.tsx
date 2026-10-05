/**
 * Profiles read oldest → newest through the REAL store (story 98.1, FR159, AC 4-5).
 *
 * ⚠️ WHY THROUGH THE STORE, NOT JUST THE COMPARATOR. The store ARRAY reorders on
 * several paths: `applyOne` merges a pulled row by REMOVE-THEN-APPEND (profiles
 * are not in `ORDERED_ENTITY_TYPES`, so nothing re-sorts them), a fresh device's
 * pull arrives in `updatedAt` order, `addProfile` appends, and a rehydrated blob
 * keeps whatever order it was saved in. The fix sorts at the READ boundary
 * (`useProfiles`), so these tests drive each path and then assert what a CONSUMER
 * reads, via `renderHook(useProfiles)` and one `ProfileList` render (card order).
 *
 * Each pulled-path test also asserts the raw store ARRAY is out of order first:
 * that is the positive control proving the path really reorders, so a green
 * consumer assertion is not vacuous.
 */

import { ProfileList } from '@/components/profiles/profile-list'
import { useProfileManager } from '@/hooks/useActiveProfile'
import { applyServerChangesToStores } from '@/lib/sync/applyServerChanges'
import { type ClientProfile, useProfileStore, useProfiles } from '@/stores/profileStore'
import { act, renderHook, renderWithProviders, screen } from '@/test/utils'
import type { ServerChange } from '@budget-planner/core/sync'
import { afterEach, describe, expect, it } from 'vitest'

const SERVER_USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_KEY = 'budget-planner-profiles-v1'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const row = (
  id: string,
  name: string,
  createdAt: string | undefined,
  extra: Partial<ClientProfile> = {}
): ClientProfile => ({
  id,
  userId: SERVER_USER_ID,
  name,
  isDefault: false,
  currency: 'NONE',
  ...(createdAt === undefined ? {} : { createdAt, updatedAt: createdAt }),
  ...extra,
})

const OLDEST = row(A, 'Oldest', '2026-01-01T00:00:00.000Z', { isDefault: true })
const MIDDLE = row(B, 'Middle', '2026-02-01T00:00:00.000Z')
const NEWEST = row(C, 'Newest', '2026-03-01T00:00:00.000Z')

function pulled(profile: ClientProfile, updatedAt: string): ServerChange {
  return {
    entityType: 'userProfile',
    entityId: profile.id,
    data: { ...profile, updatedAt },
    updatedAt: Date.parse(updatedAt),
    isDeleted: false,
  }
}

const storeNames = () => useProfileStore.getState().profiles.map((p) => p.name)

const readNames = () => {
  const { result, unmount } = renderHook(() => useProfiles())
  const names = result.current.map((p) => p.name)
  unmount()
  return names
}

const cardNames = () => {
  const view = renderWithProviders(<ProfileList />)
  const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.trim())
  view.unmount()
  return names
}

afterEach(() => {
  useProfileStore.getState().reset()
  localStorage.removeItem(PROFILE_KEY)
})

describe('profiles read oldest → newest through the real store (story 98.1)', () => {
  it('a pulled rename of the OLDEST profile does not move it to the end', () => {
    useProfileStore.setState({ profiles: [OLDEST, MIDDLE, NEWEST], activeProfileId: A })

    applyServerChangesToStores(
      [pulled({ ...OLDEST, name: 'Oldest renamed' }, '2026-06-01T00:00:00.000Z')],
      SERVER_USER_ID
    )

    // Control: remove-then-append really moved it to the end of the ARRAY.
    expect(storeNames()).toEqual(['Middle', 'Newest', 'Oldest renamed'])
    expect(readNames()).toEqual(['Oldest renamed', 'Middle', 'Newest'])
    expect(cardNames()).toEqual(['Oldest renamed', 'Middle', 'Newest'])
  })

  it('a fresh device pulling in updatedAt order reads by createdAt', () => {
    // Store starts at the bootstrap placeholder; the pull replaces it.
    applyServerChangesToStores(
      [
        pulled(NEWEST, '2026-04-01T00:00:00.000Z'),
        pulled(OLDEST, '2026-05-01T00:00:00.000Z'),
        pulled(MIDDLE, '2026-06-01T00:00:00.000Z'),
      ],
      SERVER_USER_ID
    )

    expect(storeNames()).toEqual(['Newest', 'Oldest', 'Middle'])
    expect(readNames()).toEqual(['Oldest', 'Middle', 'Newest'])
    expect(cardNames()).toEqual(['Oldest', 'Middle', 'Newest'])
  })

  it('a pulled promotion (isDefault flip, bumped updatedAt) keeps the order', () => {
    useProfileStore.setState({
      profiles: [{ ...OLDEST, isDefault: false }, MIDDLE, NEWEST],
      activeProfileId: A,
    })

    applyServerChangesToStores(
      [pulled({ ...MIDDLE, isDefault: true }, '2026-07-01T00:00:00.000Z')],
      SERVER_USER_ID
    )

    expect(storeNames()).toEqual(['Oldest', 'Newest', 'Middle'])
    expect(readNames()).toEqual(['Oldest', 'Middle', 'Newest'])
  })

  it('a local create lands last, even onto an array stored newest-first', () => {
    useProfileStore.setState({ profiles: [NEWEST, MIDDLE, OLDEST], activeProfileId: A })

    const { result, unmount } = renderHook(() => useProfileManager())
    act(() => {
      result.current.createProfile({
        name: 'Created now',
        currency: 'NONE',
        userId: SERVER_USER_ID,
        isDefault: false,
      })
    })
    unmount()

    expect(readNames()).toEqual(['Oldest', 'Middle', 'Newest', 'Created now'])
  })

  it('a local rename keeps the order', () => {
    useProfileStore.setState({ profiles: [MIDDLE, OLDEST, NEWEST], activeProfileId: A })

    const { result, unmount } = renderHook(() => useProfileManager())
    act(() => {
      result.current.modifyProfile(A, { name: 'Oldest renamed locally' })
    })
    unmount()

    expect(readNames()).toEqual(['Oldest renamed locally', 'Middle', 'Newest'])
  })

  it('a delete keeps the survivors in order', () => {
    useProfileStore.setState({ profiles: [NEWEST, MIDDLE, OLDEST], activeProfileId: A })

    act(() => {
      useProfileStore.getState().removeProfile(B)
    })

    expect(readNames()).toEqual(['Oldest', 'Newest'])
  })

  it('a persisted blob saved in the wrong order reads oldest first after rehydrate', async () => {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        state: { profiles: [NEWEST, OLDEST, MIDDLE], activeProfileId: A },
        version: 1,
      })
    )

    await act(async () => {
      await useProfileStore.persist.rehydrate()
    })

    expect(storeNames()).toEqual(['Newest', 'Oldest', 'Middle'])
    expect(readNames()).toEqual(['Oldest', 'Middle', 'Newest'])
  })

  it('puts the bootstrap placeholder (no createdAt) FIRST', () => {
    const placeholder = row('zzzzzzzz-0000-4000-8000-000000000000', 'Main Profile', undefined, {
      userId: '',
      isDefault: true,
    })
    useProfileStore.setState({ profiles: [MIDDLE, placeholder], activeProfileId: placeholder.id })

    expect(readNames()).toEqual(['Main Profile', 'Middle'])
  })

  it('breaks an equal createdAt by id', () => {
    const at = '2026-01-01T00:00:00.000Z'
    useProfileStore.setState({
      profiles: [row(C, 'Third id', at), row(A, 'First id', at), row(B, 'Second id', at)],
      activeProfileId: A,
    })

    expect(readNames()).toEqual(['First id', 'Second id', 'Third id'])
  })

  it('returns a stable array between renders while the store is unchanged (no render loop)', () => {
    useProfileStore.setState({ profiles: [NEWEST, OLDEST], activeProfileId: A })

    const { result, rerender, unmount } = renderHook(() => useProfiles())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    unmount()
  })
})
