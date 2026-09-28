/**
 * useSync — the two timing rules of the refused-edit revert (story 75.2).
 *
 * Transports are mocked here so the TIMING can be controlled; the end-to-end
 * proof against the real server is `components/sync/__tests__/refused-edit-notice.db.test.tsx`.
 *
 *  1. A refusal handled while a pull is IN FLIGHT must still end in a full
 *     (`since === null`) re-pull. Calling `pull()` then is a silent no-op (its
 *     in-flight guard) and the in-flight pull writes a non-null cursor over the
 *     reset — so the revert has to go through `repullRequestedRef`, exactly as a
 *     profile switch does.
 *  2. A refused PROFILE create must not come back every poll. `uploadMissingProfiles`
 *     re-queues a create for every local profile the server lacks, on every
 *     pull; only reverting (removing the profile locally) breaks that loop.
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/api/client', () => ({
  fetchServerChangesWithMeta: vi.fn(),
  sendSyncOperation: vi.fn(),
}))

import { fetchServerChangesWithMeta, sendSyncOperation } from '../../features/api/client'
import { dismissAllRefusalNotices, getRefusalNotices } from '../../lib/sync/refusalNoticeStore'
import { useProfileStore } from '../../stores/profileStore'
import { resetSyncStore, useSync } from '../useSync'

const USER = '66666666-6666-4666-8666-666666666666'
const PROFILE = '77777777-7777-4777-8777-777777777777'
const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const REFUSED = { success: false, retryable: false, statusCode: 422, error: 'refused' }

function incomeChange(updatedAt: number): ServerChange {
  const id = '88888888-8888-4888-8888-888888888888'
  return {
    entityType: 'incomeSource',
    entityId: id,
    data: {
      id,
      userId: USER,
      name: 'Salary',
      amount: 1000,
      frequency: 'monthly',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    updatedAt,
    isDeleted: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSyncStore()
  localStorage.clear()
  dismissAllRefusalNotices()
  useProfileStore.setState({
    profiles: [{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' }],
    activeProfileId: PROFILE,
  })
})

describe('useSync refused-edit revert timing (story 75.2)', () => {
  it('a refusal during an in-flight pull still ends in a FULL re-pull', async () => {
    const sinces: (number | null)[] = []
    let releaseSecond: (value: unknown) => void = () => {}
    fetchMeta.mockImplementation(async (since: number | null) => {
      sinces.push(since)
      if (sinces.length === 1) {
        // First pull advances the cursor to 5000.
        return { changes: [incomeChange(5000)], profileIds: [PROFILE] }
      }
      if (sinces.length === 2) {
        // Second pull is held in flight while the refusal is handled.
        await new Promise((r) => {
          releaseSecond = r
        })
      }
      return { changes: [], profileIds: [PROFILE] }
    })
    send.mockResolvedValue(REFUSED)

    const { result, unmount } = renderHook(() =>
      useSync({ userId: USER, autoSync: false, autoPull: false })
    )
    await waitFor(() => expect(result.current.pull).toBeDefined())
    await result.current.pull()
    expect(sinces).toEqual([null])

    const inFlight = result.current.pull()
    await waitFor(() => expect(sinces).toEqual([null, 5000]))

    await result.current.queueUpdate('expense', '99999999-9999-4999-8999-999999999999', {
      userId: USER,
      name: 'Rent',
      amount: 50000,
      frequency: 'monthly',
    })
    await result.current.forceSync()
    // Positive anchor: the op really went out and really was refused.
    expect(send).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(getRefusalNotices().map((n) => n.outcome)).toEqual(['changed-back']))

    releaseSecond(undefined)
    await inFlight
    // THE CLAIM: a third pull ran, and it was a full snapshot.
    await waitFor(() => expect(sinces).toEqual([null, 5000, null]))
    unmount()
  })

  it('a refused PROFILE create is removed locally, so the next pull does not re-upload it', async () => {
    const LOCAL_ONLY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    useProfileStore.setState({
      profiles: [
        { id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' },
        { id: LOCAL_ONLY, userId: USER, name: 'Side hustle', isDefault: false, currency: 'NONE' },
      ],
      activeProfileId: PROFILE,
    })
    // The server knows only PROFILE, so every pull finds LOCAL_ONLY missing.
    fetchMeta.mockResolvedValue({ changes: [], profileIds: [PROFILE] })
    send.mockImplementation(async (op: { entityType: string; entityId: string }) =>
      op.entityType === 'userProfile' && op.entityId === LOCAL_ONLY ? REFUSED : { success: true }
    )
    const profileCreates = () =>
      send.mock.calls.filter(
        ([op]) => op.entityType === 'userProfile' && op.entityId === LOCAL_ONLY
      ).length

    const { result, unmount } = renderHook(() =>
      useSync({ userId: USER, autoSync: false, autoPull: false })
    )
    await waitFor(() => expect(result.current.pull).toBeDefined())

    // Round 1: the pull queues the missing profile; the push is refused.
    await result.current.pull()
    await result.current.forceSync()
    expect(profileCreates()).toBe(1)
    await waitFor(() =>
      expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([PROFILE])
    )
    expect(getRefusalNotices()).toEqual([
      expect.objectContaining({ name: 'Side hustle', kind: 'profile', outcome: 'removed' }),
    ])

    // Round 2: another poll. Without the revert this re-queues and re-sends it.
    await result.current.pull()
    await result.current.forceSync()
    expect(profileCreates()).toBe(1)
    unmount()
  })
})
