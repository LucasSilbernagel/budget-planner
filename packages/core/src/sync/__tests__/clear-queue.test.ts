/**
 * `SynchronizationService.clearQueue()` empties the queue the service itself
 * writes (story 86.1, FR139).
 *
 * "Clear local data" and account deletion used to clear storage through a fresh
 * `createSyncQueue(userId)`. The live service kept its own in-memory queue, and
 * every queue write is a whole-queue write from memory, so its next write put
 * the cleared ops back. These tests use a REAL service on the production storage
 * key (the per-test `localStorage` mock), with `navigator.onLine` stubbed true so
 * a "nothing was sent" assertion cannot pass because the service started offline.
 *
 * Decision D2: a sync in flight across the clear sent only ops the clear has
 * removed, so a refusal it gets is neither announced (no revert, no notice) nor
 * recorded, and neither is a conflict.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncQueueClosedError } from '../queue'
import { SynchronizationService } from '../synchronization'
import { SyncStatus } from '../types'
import type {
  FetchServerChangesFn,
  ProcessOperationFn,
  ProcessOperationResult,
  ServerChange,
  SyncOperation,
} from '../types'

const USER = '86868686-8686-4868-8868-868686868686'
const PROFILE = '22222222-2222-4222-8222-222222222222'
const STORAGE_KEY = `bp-sync-queue-${USER}`

const ACCEPTED: ProcessOperationResult = { success: true }
const REFUSED: ProcessOperationResult = {
  success: false,
  error: 'refused',
  retryable: false,
  statusCode: 422,
}
const RETRYABLE: ProcessOperationResult = { success: false, error: 'boom', retryable: true }
const CONFLICT: ProcessOperationResult = { success: false, conflict: true, error: 'conflict' }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function op(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id,
    type: 'update',
    entityType: 'incomeSource',
    entityId: `entity-${id}`,
    data: { name: id },
    timestamp: 1_000,
    deviceId: 'device-test',
    userId: USER,
    profileId: PROFILE,
    ...overrides,
  }
}

function persistedIds(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw) as SyncOperation[]).map((o) => o.id) : []
}

describe('SynchronizationService.clearQueue (story 86.1)', () => {
  const services: SynchronizationService[] = []

  async function makeService(
    processOperation: ProcessOperationFn,
    fetchServerChanges: FetchServerChangesFn = async () => []
  ): Promise<SynchronizationService> {
    const service = new SynchronizationService(USER, {
      autoSync: false,
      maxRetries: 3,
      retryDelay: 1_000,
      processOperation,
      fetchServerChanges,
    })
    services.push(service)
    await service.initialize()
    return service
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { onLine: true })
  })

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.destroy()
    }
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('empties memory AND storage, so the next write carries only the new op', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A'), op('B')]))
    const service = await makeService(vi.fn(async () => ACCEPTED))
    // Positive anchor: the service loaded both ops.
    expect(
      service
        .getQueue()
        .getAll()
        .map((o) => o.id)
    ).toEqual(['A', 'B'])

    await service.clearQueue()
    expect(persistedIds()).toEqual([])
    await service.getQueue().add(op('C'))

    expect(persistedIds()).toEqual(['C'])
  })

  it('a refusal that lands after the clear is not announced or recorded (D2)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const held = deferred<ProcessOperationResult>()
    const send = vi.fn(async () => held.promise)
    const service = await makeService(send)
    const rejected = vi.fn()
    service.onOperationsRejected(rejected)

    const inFlight = service.sync()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await service.clearQueue()
    held.resolve(REFUSED)
    await inFlight

    expect(rejected).not.toHaveBeenCalled()
    expect(service.getState().rejectedOperations).toEqual([])
    expect(persistedIds()).toEqual([])
    // Code review P-1: nor is the cleared op's failure recorded as this sync's.
    expect(service.getState().status).toBe(SyncStatus.COMPLETED)
    expect(service.getState().lastError).toBeUndefined()
  })

  it('a 401 that lands after the clear records no failure either (P-1)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const held = deferred<ProcessOperationResult>()
    const send = vi.fn(async () => held.promise)
    const service = await makeService(send)

    const inFlight = service.sync()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await service.clearQueue()
    held.resolve({ success: false, retryable: false, statusCode: 401, error: 'session expired' })
    await inFlight

    expect(service.getState().status).toBe(SyncStatus.COMPLETED)
    expect(service.getState().lastError).toBeUndefined()
  })

  it('stops sending the rest of a batch once it is cleared (code review D-2)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([op('A'), op('B', { timestamp: 2_000 }), op('C', { timestamp: 3_000 })])
    )
    const held = deferred<ProcessOperationResult>()
    const send = vi.fn(async (sent: SyncOperation) => (sent.id === 'A' ? held.promise : ACCEPTED))
    const service = await makeService(send)

    const inFlight = service.sync()
    // Positive anchor: the batch really started with A.
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await service.clearQueue()
    held.resolve(ACCEPTED)
    await inFlight

    expect(send.mock.calls.map(([sent]) => sent.id)).toEqual(['A'])
    expect(persistedIds()).toEqual([])
  })

  it('an op queued AFTER the clear is not swept up with a cleared refused create (code review P-3)', async () => {
    const ENTITY = 'entity-shared'
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([op('A', { type: 'create', entityId: ENTITY })])
    )
    const held = deferred<ProcessOperationResult>()
    const send = vi.fn(async () => held.promise)
    const service = await makeService(send)
    const rejected = vi.fn()
    service.onOperationsRejected(rejected)

    const inFlight = service.sync()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await service.clearQueue()
    await service.getQueue().add(op('X', { entityId: ENTITY, timestamp: 5_000 }))
    held.resolve(REFUSED)
    await inFlight

    expect(persistedIds()).toEqual(['X'])
    expect(rejected).not.toHaveBeenCalled()
  })

  it('a clear made while the refusal is being removed still suppresses it (the clear queues behind that removal)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const service = await makeService(vi.fn(async () => REFUSED))
    const rejected = vi.fn()
    service.onOperationsRejected(rejected)
    const statuses: SyncStatus[] = []
    service.onStatusChange((state) => statuses.push(state.status))
    const queue = service.getQueue()
    const discard = queue.discardBatch.bind(queue)
    let clearing: Promise<void> | undefined
    // The clear is requested AFTER the refusal's removal entered the queue's
    // mutation chain, so the queue runs it second: the sync resumes before the
    // clear has run, and must still treat its batch as cleared.
    queue.discardBatch = async (ids: string[]) => {
      const removal = discard(ids)
      clearing = service.clearQueue()
      return removal
    }

    await service.sync()
    await clearing

    // Positive anchor: the removal path really ran and the clear really ran.
    expect(clearing).toBeDefined()
    expect(persistedIds()).toEqual([])
    expect(rejected).not.toHaveBeenCalled()
    // The refusal's failure is not recorded either (the second D2 point, P-1):
    // not even for a moment, which `clearQueue`'s own reset would hide.
    expect(statuses).not.toContain(SyncStatus.FAILED)
    expect(service.getState().status).toBe(SyncStatus.COMPLETED)
    expect(service.getState().lastError).toBeUndefined()
  })

  it('without a clear, the same refusal IS announced (control for the test above)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const service = await makeService(vi.fn(async () => REFUSED))
    const rejected = vi.fn()
    service.onOperationsRejected(rejected)

    await service.sync()

    expect(rejected).toHaveBeenCalledTimes(1)
    expect(service.getState().rejectedOperations.map((o) => o.id)).toEqual(['A'])
  })

  it('a conflict that lands after the clear is not recorded (D2)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const held = deferred<ProcessOperationResult>()
    const send = vi.fn(async () => held.promise)
    const service = await makeService(send)

    const inFlight = service.sync()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await service.clearQueue()
    held.resolve(CONFLICT)
    await inFlight

    expect(service.getState().conflictOperations).toEqual([])
  })

  it('forgets a refused op it had recorded before the clear (P-2)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const service = await makeService(vi.fn(async () => REFUSED))
    await service.sync()
    // Positive anchor: the refusal is in the record.
    expect(service.getState().rejectedOperations.map((o) => o.id)).toEqual(['A'])
    expect(service.getState().lastError).toBe('refused')

    await service.clearQueue()

    expect(service.getState().rejectedOperations).toEqual([])
    // P-1: the error the cleared op caused goes with it.
    expect(service.getState().lastError).toBeUndefined()
  })

  it('forgets a conflict it had recorded before the clear (P-2)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const service = await makeService(vi.fn(async () => CONFLICT))
    await service.sync()
    expect(service.getState().conflictOperations.map((o) => o.id)).toEqual(['A'])

    await service.clearQueue()

    expect(service.getState().conflictOperations).toEqual([])
  })

  it('forgets an ESCALATED op, and the FAILED status it left (P-1, P-2)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const service = await makeService(vi.fn(async () => RETRYABLE))
    for (
      let attempt = 0;
      attempt < 6 && service.getState().escalatedOperations.length === 0;
      attempt++
    ) {
      await service.sync()
      await vi.advanceTimersByTimeAsync(1_100)
    }
    // Positive anchor: the op really escalated (79.2: 4 failures past the time floor).
    expect(service.getState().escalatedOperations.map((o) => o.id)).toEqual(['A'])
    expect(service.getState().status).toBe(SyncStatus.FAILED)

    await service.clearQueue()

    expect(service.getState().escalatedOperations).toEqual([])
    expect(service.getState().status).toBe(SyncStatus.COMPLETED)
  })

  it('forgets every derived view, notifies, and arms no further send', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const send = vi.fn(async () => RETRYABLE)
    const service = await makeService(send)
    await service.sync()
    // Positive anchor: the failure is recorded and a retry is armed.
    expect(service.getState().failedOperations.map((o) => o.id)).toEqual(['A'])
    const statuses = vi.fn()
    service.onStatusChange(statuses)

    await service.clearQueue()

    const state = service.getState()
    expect(state.pendingOperations).toEqual([])
    expect(state.failedOperations).toEqual([])
    expect(state.escalatedOperations).toEqual([])
    expect(state.conflictOperations).toEqual([])
    expect(statuses).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps the pull cursor (D1: no re-pull of the whole account)', async () => {
    const ISO = '2026-09-01T00:00:00.000Z'
    const INCOME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const change: ServerChange = {
      entityType: 'incomeSource',
      entityId: INCOME,
      data: {
        id: INCOME,
        userId: USER,
        profileId: PROFILE,
        name: 'Salary',
        amount: 500_000,
        frequency: 'monthly',
        categoryId: null,
        sortOrder: 0,
        isDeleted: false,
        createdAt: ISO,
        updatedAt: ISO,
      },
      updatedAt: 5_000,
      isDeleted: false,
    }
    const service = await makeService(
      vi.fn(async () => ACCEPTED),
      (async () => [change]) as FetchServerChangesFn
    )
    await service.pull()
    const cursor = service.getState().lastPullTimestamp
    // Positive anchor: the pull really set a cursor.
    expect(cursor).not.toBeNull()

    await service.clearQueue()

    expect(service.getState().lastPullTimestamp).toBe(cursor)
  })

  it('rejects with SyncQueueClosedError when destroyed while the clear is queued, leaving storage as it was (code review P-4)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([op('A')]))
    const service = await makeService(vi.fn(async () => ACCEPTED))

    const clearing = service.clearQueue()
    service.destroy()

    await expect(clearing).rejects.toBeInstanceOf(SyncQueueClosedError)
    // The caller (`purgeLocalFinancialData`) falls back to a fresh queue for this key.
    expect(persistedIds()).toEqual(['A'])
  })

  it('rejects on a destroyed service, so the caller can fall back', async () => {
    const service = await makeService(vi.fn(async () => ACCEPTED))
    service.destroy()

    await expect(service.clearQueue()).rejects.toThrow(/destroyed/)
  })
})
