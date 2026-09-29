/**
 * useSync — a refusal that lands after the hook unmounted is not lost (story 79.1).
 *
 * The cleanup unsubscribes `onOperationsRejected` and destroys the service, but a
 * push already in flight used to run on: its refused CREATE left the persisted
 * queue with nobody listening, so the row was never reverted and never named,
 * and the next session had nothing left to learn it from.
 *
 * After 79.1 the dead service leaves the queue alone, so the NEXT session sends
 * the op again, is refused again, and this time names and reverts it.
 *
 * Transports are mocked so the push can be HELD across the unmount.
 */

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/api/client', () => ({
  fetchServerChangesWithMeta: vi.fn(),
  sendSyncOperation: vi.fn(),
}))

import { fetchServerChangesWithMeta, sendSyncOperation } from '../../features/api/client'
import { dismissAllRefusalNotices, getRefusalNotices } from '../../lib/sync/refusalNoticeStore'
import {
  resetSessionStatusStore,
  setLastPullTimestamp,
  useLastPullTimestamp,
} from '../../lib/sync/sessionStatusStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { resetSyncStore, useSync } from '../useSync'

const USER = '66666666-6666-4666-8666-666666666666'
const PROFILE = '77777777-7777-4777-8777-777777777777'
const ROW = '88888888-8888-4888-8888-888888888888'
const ISO = '2026-09-01T00:00:00.000Z'
const QUEUE_KEY = `bp-sync-queue-${USER}`
const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const REFUSED = { success: false, retryable: false, statusCode: 422, error: 'refused' }

function queuedIds(): string[] {
  const raw = localStorage.getItem(QUEUE_KEY)
  return raw ? (JSON.parse(raw) as { entityId: string }[]).map((op) => op.entityId) : []
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSyncStore()
  resetSessionStatusStore()
  localStorage.clear()
  dismissAllRefusalNotices()
  useProfileStore.setState({
    profiles: [{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' }],
    activeProfileId: PROFILE,
  })
  useIncomeStore.setState({
    incomeSources: [
      {
        id: ROW,
        userId: USER,
        profileId: PROFILE,
        name: 'Side gig',
        amount: 1000,
        frequency: 'monthly',
        categoryId: null,
        sortOrder: 0,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
  fetchMeta.mockResolvedValue({ changes: [], profileIds: [PROFILE] })
})

describe('useSync teardown mid-sync (story 79.1)', () => {
  it('a create refused after unmount is refused again, named and reverted by the next session', async () => {
    let release: (value: unknown) => void = () => {}
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    send.mockResolvedValue(REFUSED)

    // Session 1: queue the create and start the push.
    const first = renderHook(() => useSync({ userId: USER, autoSync: false, autoPull: false }))
    await first.result.current.queueCreate('incomeSource', ROW, {
      userId: USER,
      name: 'Side gig',
      amount: 1000,
      frequency: 'monthly',
    })
    const inFlight = first.result.current.forceSync()
    // Positive anchor: the create really went out before the teardown.
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    first.unmount()
    release(REFUSED)
    await inFlight

    // Nobody was listening, so nothing was named or reverted — and the op is
    // still queued for the next session to learn the refusal again.
    expect(getRefusalNotices()).toEqual([])
    expect(useIncomeStore.getState().incomeSources.map((row) => row.id)).toEqual([ROW])
    expect(queuedIds()).toEqual([ROW])

    // Session 2: same user. Push until the loaded queue goes out.
    const second = renderHook(() => useSync({ userId: USER, autoSync: false, autoPull: false }))
    await waitFor(async () => {
      await second.result.current.forceSync()
      expect(send).toHaveBeenCalledTimes(2)
    })

    await waitFor(() =>
      expect(getRefusalNotices().map((notice) => [notice.name, notice.outcome])).toEqual([
        ['Side gig', 'removed'],
      ])
    )
    expect(useIncomeStore.getState().incomeSources).toEqual([])
    expect(queuedIds()).toEqual([])
    second.unmount()
  })

  it("a pull that resolves after unmount writes nothing into the next session's stores (code review 79.1)", async () => {
    let release: (value: unknown) => void = () => {}
    fetchMeta.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    // What the NEXT session's initial-sync check would read.
    setLastPullTimestamp(4242)
    const cursor = renderHook(() => useLastPullTimestamp())

    const first = renderHook(() => useSync({ userId: USER, autoSync: false, autoPull: false }))
    const inFlight = first.result.current.pull()
    // Positive anchor: the pull really reached the transport before the teardown.
    await waitFor(() => expect(fetchMeta).toHaveBeenCalledTimes(1))

    first.unmount()
    release({ changes: [], profileIds: [PROFILE] })
    const result = await inFlight

    expect(result?.error).toBe('Sync service destroyed')
    expect(cursor.result.current).toBe(4242)
    cursor.unmount()
  })
})
