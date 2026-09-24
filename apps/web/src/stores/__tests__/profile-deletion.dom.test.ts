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
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'
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

/**
 * The cascade (story 66.3, FR104, AC-1/AC-2).
 *
 * ⚠️⚠️ THIS DOCBLOCK ONCE DESCRIBED AN IMPORT CYCLE. THERE IS NONE, and the
 * correction is left visible because the stale version survived the whole
 * implementation pass and was caught by code review, not by its author.
 *
 * The first design had `lib/profile-cascade.ts` import all five domain stores,
 * which all import `profileStore`, which imported the cascade — a cycle. Thunks
 * stopped the TDZ `ReferenceError`, this file passed, and that was written up as
 * proof the cycle was harmless. It was not:
 * `components/sync/__tests__/cross-device-sync.db.test.tsx` imports every store in
 * one `Promise.all` and Vite's module runner DEADLOCKED — a 12.8s suite became a
 * 60s hook timeout with its tests silently SKIPPED. `profile-cascade.ts` now
 * imports NO store (each store registers itself), so there is no cycle and this
 * file is NOT a cycle tripwire.
 *
 * What it IS: the cascade exercised end-to-end THROUGH `profileStore.removeProfile`,
 * rather than called directly as `lib/__tests__/profile-cascade.test.ts` does. It
 * imports `useIncomeStore`/`useExpenseStore` itself, so it canNOT detect a MISSING
 * registration — the registry guard tests in that other file cover that.
 */
describe('the cascade destroys the deleted profile’s rows (story 66.3, AC-1)', () => {
  beforeEach(() => {
    registerSyncBridge(handle)
    useProfileStore.setState({ profiles: [main, biz, side], activeProfileId: 'main' } as never)
    useIncomeStore.setState({
      incomeSources: [
        { id: 'i-biz', profileId: 'biz', name: 'Consulting', amount: 1, frequency: 'monthly' },
        { id: 'i-main', profileId: 'main', name: 'Salary', amount: 2, frequency: 'monthly' },
        { id: 'i-legacy', profileId: null, name: 'Legacy', amount: 3, frequency: 'monthly' },
      ],
    } as never)
    useExpenseStore.setState({
      expenses: [
        { id: 'e-biz', profileId: 'biz', name: 'Office', amount: 1, frequency: 'monthly' },
      ],
    } as never)
  })

  it('removes them while the SURVIVING and UNSCOPED rows stay', () => {
    useProfileStore.getState().removeProfile('biz')

    expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toEqual(['i-main', 'i-legacy'])
    expect(useExpenseStore.getState().expenses).toEqual([])
  })

  /**
   * ⚠️⚠️ AC-2. The cascade queues NOTHING for the children: the ONLY delete on
   * the wire is the profile's own. `SyncService.queueDelete` stamps
   * `config.profileId` — the ACTIVE profile at queue time — so a child delete for
   * a NON-active profile (the common case: you delete the one you are not on)
   * would carry 'main' and resolve to "Entity not found" server-side, leaving the
   * row live while the client showed it gone. The server cascade
   * (`deleteProfileWithChildren`) is what removes them there.
   */
  it('queues ONE delete — the profile itself — and no child operations', () => {
    useProfileStore.getState().removeProfile('biz')

    expect(handle.queueDelete).toHaveBeenCalledTimes(1)
    expect(handle.queueDelete).toHaveBeenCalledWith('userProfile', 'biz', expect.anything())
  })

  it('destroys NOTHING when the last-profile guard refuses the deletion', () => {
    useProfileStore.setState({ profiles: [biz], activeProfileId: 'biz' } as never)

    useProfileStore.getState().removeProfile('biz')

    expect(useProfileStore.getState().profiles).toHaveLength(1)
    expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toContain('i-biz')
    expect(useExpenseStore.getState().expenses).toHaveLength(1)
  })

  /**
   * ⚠️ NOT VACUOUS, and the shape is deliberate (the lesson this file already
   * carries at `free tier (no bridge registered)`). The handle IS registered by
   * the `beforeEach` above and this test UNREGISTERS it, and the paid test two
   * cases up proves this same spy records a call — so its silence here means
   * "the free tier queued nothing", not "nothing was ever wired up".
   */
  it('cascades on the FREE tier too, once the bridge is unregistered', () => {
    clearSyncBridge()

    useProfileStore.getState().removeProfile('biz')

    expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toEqual(['i-main', 'i-legacy'])
    expect(handle.queueDelete).not.toHaveBeenCalled()
  })

  // The domain stores are NOT covered by the file-level reset (which only knows
  // `profileStore`), so clear them or these rows leak into every later test in
  // the same worker.
  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] } as never)
    useExpenseStore.setState({ expenses: [] } as never)
  })
})
