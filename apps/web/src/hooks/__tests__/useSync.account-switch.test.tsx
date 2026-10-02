/**
 * Another account's profiles never reach this account (story 86.2, FR140).
 *
 * Account A synced on this browser and signed out; account B signs in. Nothing
 * resets the persisted profile store on sign-out, so B's sync starts with A's
 * profiles still in it, each carrying A's uuid as its `userId`.
 *
 * Before 86.2:
 *  - `uploadMissingProfiles` queued a create for every one of them under B
 *    (deferred-work, 80.2 dev MED), and
 *  - `reconcileActiveProfile` counted them as "real" profiles, so an active
 *    profile of A's was PRESERVED as a deliberate switch and B's new rows were
 *    stamped with A's `profileId`.
 *
 * Everything here is real except the network: the real `useSync` hook, the
 * real core service and queue on jsdom storage, the real stores. The
 * `ActiveSync` step that removes A's data before any of this runs (D2) is NOT
 * mounted, so these tests pin the two guards on their own.
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/api/client', () => ({
  fetchServerChangesWithMeta: vi.fn(),
  sendSyncOperation: vi.fn(),
}))

import { fetchServerChangesWithMeta, sendSyncOperation } from '../../features/api/client'
import { resetSessionStatusStore } from '../../lib/sync/sessionStatusStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { resetSyncStore, useSync } from '../useSync'

const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000862'
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000862'
const A_MAIN = 'aaaaaaaa-1111-4111-8111-111111111111'
const A_SIDE = 'aaaaaaaa-2222-4222-8222-222222222222'
const B_MAIN = 'bbbbbbbb-1111-4111-8111-111111111111'
/** Created on the Profiles page before the bridge registered (`create-profile.tsx`). */
const LOCAL = 'cccccccc-1111-4111-8111-111111111111'
const A_ROW = 'aaaaaaaa-3333-4333-8333-333333333333'
const B_ROW = 'bbbbbbbb-3333-4333-8333-333333333333'
const ISO = '2026-09-01T00:00:00.000Z'

const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

function profile(id: string, userId: string, isDefault: boolean) {
  return { id, userId, name: `Profile ${id.slice(0, 4)}`, isDefault, currency: 'NONE' }
}

/** B's default profile as the server sends it (`userProfileSchema`). */
const B_MAIN_CHANGE: ServerChange = {
  entityType: 'userProfile',
  entityId: B_MAIN,
  data: { id: B_MAIN, userId: ACCOUNT_B, name: 'Main Profile', isDefault: true, currency: 'NONE' },
  updatedAt: 1000,
  isDeleted: false,
}

/** The ops that really went out, as `type entityType id profileId`. */
function sent(): string[] {
  return send.mock.calls.map(([op]) => {
    const { type, entityType, entityId, profileId } = op as Record<string, string>
    return `${type} ${entityType} ${entityId} ${profileId}`
  })
}

function mountSyncAsB() {
  return renderHook(() => useSync({ userId: ACCOUNT_B, autoSync: false, autoPull: false }))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSyncStore()
  resetSessionStatusStore()
  localStorage.clear()
  useIncomeStore.setState({ incomeSources: [] })
  send.mockResolvedValue({ success: true })
})

describe("uploadMissingProfiles skips another account's profiles (story 86.2, AC 1)", () => {
  it("uploads this browser's own unsynced profile, and none of A's", async () => {
    useProfileStore.setState({
      profiles: [
        profile(A_MAIN, ACCOUNT_A, true),
        profile(A_SIDE, ACCOUNT_A, false),
        profile(LOCAL, 'temp-user', false),
        profile(B_MAIN, ACCOUNT_B, true),
      ],
      activeProfileId: B_MAIN,
    })
    fetchMeta.mockResolvedValue({ changes: [], profileIds: [B_MAIN] })
    const sync = mountSyncAsB()

    await sync.result.current.pull()
    await sync.result.current.forceSync()

    // Positive anchor: the upload really ran and a create really went out.
    expect(sent()).toEqual([`create userProfile ${LOCAL} ${B_MAIN}`])
    sync.unmount()
  })
})

describe("reconcileActiveProfile never keeps another account's profile active (story 86.2, AC 2)", () => {
  beforeEach(() => {
    // A's profile was active when A signed out.
    useProfileStore.setState({
      profiles: [profile(A_MAIN, ACCOUNT_A, true), profile(A_SIDE, ACCOUNT_A, false)],
      activeProfileId: A_SIDE,
    })
    useIncomeStore.setState({
      incomeSources: [
        {
          id: A_ROW,
          userId: ACCOUNT_A,
          profileId: A_SIDE,
          name: 'Their salary',
          amount: 1000,
          frequency: 'monthly',
          categoryId: null,
          sortOrder: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
    })
    fetchMeta.mockResolvedValue({ changes: [B_MAIN_CHANGE], profileIds: [B_MAIN] })
  })

  it("B's first pull switches to B's server default profile", async () => {
    const sync = mountSyncAsB()

    await sync.result.current.pull()

    expect(useProfileStore.getState().activeProfileId).toBe(B_MAIN)
    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([B_MAIN])
    sync.unmount()
  })

  it("a row B creates after the pull carries B's profile, not A's", async () => {
    const sync = mountSyncAsB()
    await sync.result.current.pull()
    // The active-profile effect re-stamps the service's profile after the switch.
    await waitFor(() => expect(useProfileStore.getState().activeProfileId).toBe(B_MAIN))

    await sync.result.current.queueCreate('incomeSource', B_ROW, {
      userId: ACCOUNT_B,
      name: 'Mine',
      amount: 1,
      frequency: 'monthly',
    })
    await sync.result.current.forceSync()

    expect(sent()).toEqual([`create incomeSource ${B_ROW} ${B_MAIN}`])
    sync.unmount()
  })

  it("A's rows are not re-homed onto B's profile like a placeholder's", async () => {
    const sync = mountSyncAsB()

    await sync.result.current.pull()

    // Positive anchor: the reconcile really ran.
    expect(useProfileStore.getState().activeProfileId).toBe(B_MAIN)
    const row = useIncomeStore.getState().incomeSources.find((r) => r.id === A_ROW)
    expect(row?.profileId).toBe(A_SIDE)
    sync.unmount()
  })
})

describe('the refused-edit path reconciles as the session user too (story 86.2)', () => {
  it('a refused profile create is removed and the active profile moves to B’s default', async () => {
    useProfileStore.setState({
      profiles: [profile(B_MAIN, ACCOUNT_B, true), profile(LOCAL, 'temp-user', false)],
      activeProfileId: LOCAL,
    })
    send.mockResolvedValue({ success: false, retryable: false, statusCode: 422, error: 'refused' })
    const sync = mountSyncAsB()
    await sync.result.current.queueCreate('userProfile', LOCAL, {
      userId: ACCOUNT_B,
      name: 'Side',
      isDefault: false,
      currency: 'NONE',
    })

    await sync.result.current.forceSync()

    // Positive anchor: the create really went out and was refused.
    expect(sent()).toEqual([`create userProfile ${LOCAL} ${LOCAL}`])
    await waitFor(() => expect(useProfileStore.getState().activeProfileId).toBe(B_MAIN))
    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([B_MAIN])
    sync.unmount()
  })
})
