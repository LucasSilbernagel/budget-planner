/**
 * useSync — an edit that keeps failing reaches the user, and clears itself
 * (story 79.2, FR128).
 *
 * The transport is mocked so each attempt's outcome can be chosen. The failure
 * used is the UNCLASSIFIED one (`retryable: false`, no status code): what the
 * client returns for a per-op server fault, and the class no timer retries, so
 * each attempt here is one explicit `forceSync()`.
 */

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/api/client', () => ({
  fetchServerChangesWithMeta: vi.fn(),
  sendSyncOperation: vi.fn(),
}))

import { fetchServerChangesWithMeta, sendSyncOperation } from '../../features/api/client'
import {
  dismissRefusalNotice,
  getRefusalNotices,
  resetRefusalNotices,
} from '../../lib/sync/refusalNoticeStore'
import { useProfileStore } from '../../stores/profileStore'
import { resetSyncStore, useSync } from '../useSync'

const USER = '79279279-2792-4792-8792-792792792792'
const PROFILE = '79200000-0000-4000-8000-000000000792'
const EXPENSE = '79211111-1111-4111-8111-111111111792'
const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const UNCLASSIFIED = { success: false, retryable: false, error: 'Operation failed on server' }
/**
 * `retryDelay: 0` sets the escalation TIME FLOOR (`maxRetries × retryDelay`,
 * code review 79.2) to zero, so four back-to-back attempts are enough here. The
 * floor itself is pinned in core's `escalate-stuck-op.test.ts`. Module-level, so
 * the hook's effect does not re-run on every render.
 */
const NO_TIME_FLOOR = { retryDelay: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  resetSyncStore()
  localStorage.clear()
  resetRefusalNotices()
  fetchMeta.mockResolvedValue({ changes: [], profileIds: [PROFILE] })
  useProfileStore.setState({
    profiles: [{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' }],
    activeProfileId: PROFILE,
  })
})

async function mountWithStuckEdit() {
  send.mockResolvedValue(UNCLASSIFIED)
  const hook = renderHook(() =>
    useSync({ userId: USER, autoSync: false, autoPull: false, syncConfig: NO_TIME_FLOOR })
  )
  await waitFor(() => expect(hook.result.current.queueUpdate).toBeDefined())
  await hook.result.current.queueUpdate('expense', EXPENSE, {
    userId: USER,
    name: 'Rent',
    amount: 50000,
    frequency: 'monthly',
  })
  return hook
}

describe('useSync not-synced notice (story 79.2)', () => {
  it('appears after the 4th failed attempt, naming the entry, and not before', async () => {
    const { result, unmount } = await mountWithStuckEdit()

    for (let i = 0; i < 3; i++) {
      await result.current.forceSync()
    }
    // Positive anchor: three attempts really went out and really failed.
    expect(send).toHaveBeenCalledTimes(3)
    expect(getRefusalNotices()).toEqual([])

    await result.current.forceSync()
    expect(send).toHaveBeenCalledTimes(4)
    await waitFor(() =>
      expect(getRefusalNotices()).toEqual([
        expect.objectContaining({
          key: `expense:${EXPENSE}`,
          name: 'Rent',
          kind: 'expense',
          outcome: 'not-synced',
          change: 'update',
        }),
      ])
    )
    unmount()
  })

  it('clears itself when a later attempt lands, with no user action', async () => {
    const { result, unmount } = await mountWithStuckEdit()
    for (let i = 0; i < 4; i++) {
      await result.current.forceSync()
    }
    await waitFor(() => expect(getRefusalNotices()).toHaveLength(1))

    send.mockResolvedValue({ success: true })
    await result.current.forceSync()

    expect(send).toHaveBeenCalledTimes(5)
    await waitFor(() => expect(getRefusalNotices()).toEqual([]))
    unmount()
  })

  it('stays dismissed while the edit keeps failing', async () => {
    const { result, unmount } = await mountWithStuckEdit()
    for (let i = 0; i < 4; i++) {
      await result.current.forceSync()
    }
    await waitFor(() => expect(getRefusalNotices()).toHaveLength(1))

    dismissRefusalNotice(`expense:${EXPENSE}`)
    await result.current.forceSync()
    await result.current.forceSync()

    expect(send).toHaveBeenCalledTimes(6)
    expect(getRefusalNotices()).toEqual([])
    unmount()
  })

  it('teardown clears the notice', async () => {
    const { result, unmount } = await mountWithStuckEdit()
    for (let i = 0; i < 4; i++) {
      await result.current.forceSync()
    }
    await waitFor(() => expect(getRefusalNotices()).toHaveLength(1))

    unmount()

    expect(getRefusalNotices()).toEqual([])
  })

  // ⚠️ Measured in code review 79.2 (mutation M10): this stays GREEN with the
  // teardown reverted to `dismissAllRefusalNotices`. A new service's first status
  // carries an EMPTY escalated view, and the reconcile forgets every dismissal
  // whose row is not in it, so the dismissal is gone before the edit re-escalates.
  // `resetRefusalNotices` is defence in depth; its own clearing is pinned at store
  // level (`notSyncedNotices.test.ts`). This test pins the OUTCOME only.
  it('a dismissal does not survive into the next session: the still-stuck edit is named again', async () => {
    const first = await mountWithStuckEdit()
    for (let i = 0; i < 4; i++) {
      await first.result.current.forceSync()
    }
    await waitFor(() => expect(getRefusalNotices()).toHaveLength(1))
    dismissRefusalNotice(`expense:${EXPENSE}`)
    await first.result.current.forceSync()
    expect(send).toHaveBeenCalledTimes(5)
    expect(getRefusalNotices()).toEqual([])

    first.unmount()

    // A new session over the same persisted queue: the edit is still stuck.
    const second = renderHook(() =>
      useSync({ userId: USER, autoSync: false, autoPull: false, syncConfig: NO_TIME_FLOOR })
    )
    await waitFor(() => expect(second.result.current.forceSync).toBeDefined())
    for (let i = 0; i < 4; i++) {
      await second.result.current.forceSync()
    }
    expect(send).toHaveBeenCalledTimes(9)
    await waitFor(() => expect(getRefusalNotices().map((n) => n.outcome)).toEqual(['not-synced']))
    second.unmount()
  })

  it('isSyncing is true for the WHOLE push, so "Try again" stays disabled (D5)', async () => {
    const { result, unmount } = await mountWithStuckEdit()
    let release: (value: unknown) => void = () => undefined
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(UNCLASSIFIED)
        })
    )

    const inFlight = result.current.forceSync()
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    // The push has emitted its IN_PROGRESS status by now. Before the fix that
    // notification wrote `isSyncing: false` while the request was still open.
    await waitFor(() => expect(result.current.isSyncing).toBe(true))

    release(undefined)
    await inFlight
    await waitFor(() => expect(result.current.isSyncing).toBe(false))
    unmount()
  })
})
