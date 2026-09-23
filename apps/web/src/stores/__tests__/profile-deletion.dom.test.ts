/**
 * Profile deletion: the default is deletable, and a survivor inherits `isDefault`
 * (story 63.2, FR97).
 *
 * ⚠️⚠️ THIS IS THE LAYER THAT MATTERS, and the story had to measure its way to
 * that. The epic specified this change as a SERVER change, but
 * `server/functions/profiles.ts:deleteProfile` has ZERO production callers — the
 * import grep over `functions/profiles'` returns only `getProfiles` and
 * `createDefaultProfileForUser`. A user's deletion travels
 * `profile-list.tsx` -> `useProfileManager().deleteProfile` -> THIS STORE ->
 * `syncEntityDelete` -> the sync push, whose handler enforces no guards at all.
 * So `removeProfile` is where the default guard actually lived and where it is
 * actually lifted.
 *
 * ⚠️ `removeProfile` is SYNCHRONOUS and returns `void`. `handleDelete` awaits it,
 * which is a no-op; nothing here or in the UI knows when the server finished.
 *
 * The bridge is driven with a fake handle (no network), matching
 * `store-sync-wiring.dom.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useProfileStore } from '../profileStore'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeHandle() {
  return {
    userId: SESSION_USER_ID,
    queueCreate: vi.fn(async () => {}),
    queueUpdate: vi.fn(async () => {}),
    queueDelete: vi.fn(async () => {}),
  }
}

let handle: ReturnType<typeof makeHandle>

const main = {
  id: 'main',
  userId: SESSION_USER_ID,
  name: 'Main Profile',
  isDefault: true,
  currency: 'NONE',
  updatedAt: '2026-09-01T00:00:00.000Z',
}
const biz = {
  id: 'biz',
  userId: SESSION_USER_ID,
  name: 'Business',
  isDefault: false,
  currency: 'EUR',
  updatedAt: '2026-09-02T00:00:00.000Z',
}
const side = {
  id: 'side',
  userId: SESSION_USER_ID,
  name: 'Side Project',
  isDefault: false,
  currency: 'EUR',
  updatedAt: '2026-09-03T00:00:00.000Z',
}

beforeEach(() => {
  handle = makeHandle()
  localStorage.clear()
  useProfileStore.getState().reset()
})

afterEach(() => {
  clearSyncBridge()
  useProfileStore.getState().reset()
  vi.restoreAllMocks()
})

describe('deleting the DEFAULT profile (story 63.2, AC-2/AC-3)', () => {
  beforeEach(() => {
    registerSyncBridge(handle)
  })

  it('removes it and promotes the post-deletion active profile to default', () => {
    useProfileStore.setState({ profiles: [main, biz, side], activeProfileId: 'side' })

    useProfileStore.getState().removeProfile('main')

    const state = useProfileStore.getState()
    expect(state.profiles.map((p) => p.id)).toEqual(['biz', 'side'])
    // The survivor that inherits `isDefault` is the one the user is LOOKING at,
    // not the array's first element — 'side' was and remains active.
    expect(state.profiles.find((p) => p.isDefault)?.id).toBe('side')
    expect(state.profiles.filter((p) => p.isDefault)).toHaveLength(1)
    expect(state.activeProfileId).toBe('side')
    expect(state.error).toBeNull()
  })

  it('promotes the NEW active profile when the deleted default was itself active', () => {
    useProfileStore.setState({ profiles: [main, biz, side], activeProfileId: 'main' })

    useProfileStore.getState().removeProfile('main')

    const state = useProfileStore.getState()
    // `removeProfile` repoints an active deletion to the first survivor, and the
    // promotion follows that same choice rather than computing a second answer.
    expect(state.activeProfileId).toBe('biz')
    expect(state.profiles.find((p) => p.isDefault)?.id).toBe('biz')
    expect(state.profiles.filter((p) => p.isDefault)).toHaveLength(1)
  })

  it('queues the tombstone AND the promotion, tombstone first', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'biz' })

    useProfileStore.getState().removeProfile('main')

    // ⚠️ THE HIGHEST-RISK ASSERTION IN THIS STORY. `willRemove` used to carry a
    // `!target.isDefault` clause that gated this queueDelete. Leave it in and the
    // default vanishes locally while NO tombstone is ever pushed — it returns on
    // the next pull, on every device, and the local suite stays green because the
    // local list looks right.
    expect(handle.queueDelete).toHaveBeenCalledTimes(1)
    expect(handle.queueDelete).toHaveBeenCalledWith('userProfile', 'main', expect.anything())

    // The promotion is local-only unless it is queued: a raw `set()` writes the
    // flag in the store and tells the server nothing, leaving the account with
    // ZERO defaults server-side.
    expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
    const [entityType, entityId, payload] = handle.queueUpdate.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ]
    expect(entityType).toBe('userProfile')
    expect(entityId).toBe('biz')
    expect(payload['isDefault']).toBe(true)

    // ⚠️ ORDER IS A DATABASE CONSTRAINT, not a preference. The partial unique
    // index is `(userId) WHERE isDefault AND NOT isDeleted`; promote before the
    // old default is tombstoned and two live rows satisfy it.
    const deleteOrder = handle.queueDelete.mock.invocationCallOrder[0] as number
    const updateOrder = handle.queueUpdate.mock.invocationCallOrder[0] as number
    expect(deleteOrder).toBeLessThan(updateOrder)
  })

  it('queues NO promotion when the deleted profile was not the default', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })

    useProfileStore.getState().removeProfile('biz')

    expect(handle.queueDelete).toHaveBeenCalledTimes(1)
    // Positive control for the test above: the promotion is conditional, not
    // something every deletion emits.
    expect(handle.queueUpdate).not.toHaveBeenCalled()
    expect(useProfileStore.getState().profiles.find((p) => p.isDefault)?.id).toBe('main')
  })
})

describe('the last-profile guard is UNCHANGED (story 63.2, AC-4)', () => {
  beforeEach(() => {
    registerSyncBridge(handle)
  })

  it('refuses to delete the sole remaining profile and leaves the list intact', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })

    useProfileStore.getState().removeProfile('main')

    const state = useProfileStore.getState()
    expect(state.profiles.map((p) => p.id)).toEqual(['main'])
    expect(state.error).toMatch(/last profile/i)
    // Nothing reaches the server either — the refusal is not a local-only veto.
    expect(handle.queueDelete).not.toHaveBeenCalled()
    expect(handle.queueUpdate).not.toHaveBeenCalled()
  })

  it('refuses the sole profile even when it is NOT the default', () => {
    useProfileStore.setState({ profiles: [biz], activeProfileId: 'biz' })

    useProfileStore.getState().removeProfile('biz')

    expect(useProfileStore.getState().profiles).toHaveLength(1)
    expect(handle.queueDelete).not.toHaveBeenCalled()
  })
})

describe('free tier (no bridge registered)', () => {
  /**
   * ⚠️ THE ASSERTIONS ON `handle` HERE WERE VACUOUS UNTIL THE POSITIVE CONTROL
   * BELOW (code review). This describe deliberately never calls
   * `registerSyncBridge`, so `expect(handle.queueDelete).not.toHaveBeenCalled()`
   * is true for ANY implementation whatsoever — including one that queued to a
   * different bridge or called `fetch` directly. An unregistered spy cannot
   * report anything. Only the local-state assertions carried weight.
   *
   * The control registers the SAME handle and repeats the SAME deletion, proving
   * the spy can record a call at all — so its silence above means "the free tier
   * queued nothing", not "nothing was ever wired up".
   */
  it('deletes the default locally and makes zero queue calls', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'biz' })

    useProfileStore.getState().removeProfile('main')

    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['biz'])
    expect(useProfileStore.getState().profiles.find((p) => p.isDefault)?.id).toBe('biz')
    expect(handle.queueDelete).not.toHaveBeenCalled()
    expect(handle.queueUpdate).not.toHaveBeenCalled()

    // Positive control for this very handle.
    registerSyncBridge(handle)
    useProfileStore.setState({ profiles: [main, biz, side], activeProfileId: 'biz' })
    useProfileStore.getState().removeProfile('main')
    expect(handle.queueDelete).toHaveBeenCalledTimes(1)
  })
})
