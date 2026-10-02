/**
 * `onOperationsSynced` — the operations the server ACCEPTED in one sync (story
 * 86.3).
 *
 * Before 86.3 nothing outside the service learned which ops landed: they were
 * removed from the queue silently, so the web layer could not mark a pushed row
 * as the session's until a later pull replaced it. The web layer now stamps the
 * session's id on each accepted create/update (`stampSyncedOwner` in
 * `apps/web/src/lib/sync/applyServerChanges.ts`).
 *
 * Real services on the production storage key (the per-test `localStorage`
 * mock), so the queue, its removal and the teardown are the real ones.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizationService } from '../synchronization'
import type { ProcessOperationFn, ProcessOperationResult, SyncOperation } from '../types'

const USER = '11111111-1111-4111-8111-111111111863'
const PROFILE = '22222222-2222-4222-8222-222222222863'
const STORAGE_KEY = `bp-sync-queue-${USER}`

const ACCEPTED: ProcessOperationResult = { success: true }
const REFUSED: ProcessOperationResult = {
  success: false,
  error: 'refused',
  retryable: false,
  statusCode: 422,
}
const KEPT_QUEUED: ProcessOperationResult = {
  success: false,
  error: 'Profile not found',
  retryable: false,
}
const CONFLICT: ProcessOperationResult = { success: false, conflict: true }
const RETRYABLE: ProcessOperationResult = { success: false, error: 'boom', retryable: true }

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function op(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id,
    type: 'create',
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

function seed(ops: SyncOperation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ops))
}

function persistedIds(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw) as SyncOperation[]).map((o) => o.id) : []
}

describe('onOperationsSynced (story 86.3)', () => {
  const services: SynchronizationService[] = []

  async function makeService(
    processOperation: ProcessOperationFn
  ): Promise<SynchronizationService> {
    const service = new SynchronizationService(USER, {
      autoSync: false,
      batchSize: 100,
      maxRetries: 3,
      retryDelay: 1_000,
      processOperation,
      fetchServerChanges: async () => [],
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

  it('fires once per sync with exactly the ops the server accepted', async () => {
    const outcomes = new Map<string, ProcessOperationResult>([
      ['refused', REFUSED],
      ['kept', KEPT_QUEUED],
      ['conflict', CONFLICT],
      ['retryable', RETRYABLE],
    ])
    seed([
      op('ok-create'),
      op('ok-update', { type: 'update', timestamp: 1_001 }),
      op('refused', { type: 'update', timestamp: 1_002 }),
      op('kept', { timestamp: 1_003 }),
      op('conflict', { type: 'update', timestamp: 1_004 }),
      op('retryable', { timestamp: 1_005 }),
    ])
    const send = vi.fn(async (sent: SyncOperation) => outcomes.get(sent.id) ?? ACCEPTED)
    const service = await makeService(send)
    const synced = vi.fn()
    service.onOperationsSynced(synced)

    await service.sync()

    // Positive anchor: every op really went out.
    expect(send).toHaveBeenCalledTimes(6)
    expect(synced).toHaveBeenCalledTimes(1)
    expect(synced.mock.calls[0]?.[0].map((o: SyncOperation) => o.id)).toEqual([
      'ok-create',
      'ok-update',
    ])
    // ...and they had left the queue when it fired; the kept ones had not.
    expect(persistedIds()).toEqual(['kept', 'conflict', 'retryable'])
  })

  it('does not fire for a sync in which nothing was accepted', async () => {
    seed([op('kept')])
    const service = await makeService(vi.fn(async () => KEPT_QUEUED))
    const synced = vi.fn()
    service.onOperationsSynced(synced)

    await service.sync()

    expect(synced).not.toHaveBeenCalled()
  })

  it('does not fire for a push that lands after destroy()', async () => {
    seed([op('X')])
    const held = deferred<ProcessOperationResult>()
    const send = vi.fn(async () => held.promise)
    const service = await makeService(send)
    const synced = vi.fn()
    service.onOperationsSynced(synced)

    const inFlight = service.sync()
    // Positive anchor: X really went out before the teardown.
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    service.destroy()
    held.resolve(ACCEPTED)
    const result = await inFlight

    expect(result.error).toBe('Sync service destroyed')
    expect(synced).not.toHaveBeenCalled()
  })

  it('still reports an accepted op whose queue removal failed: the server committed it', async () => {
    seed([op('X')])
    const service = await makeService(vi.fn(async () => ACCEPTED))
    // @ts-expect-error - private queue, to make its removal fail
    vi.spyOn(service.queue, 'removeBatch').mockRejectedValueOnce(new Error('quota'))
    const synced = vi.fn()
    service.onOperationsSynced(synced)

    await service.sync()

    expect(synced.mock.calls.map(([ops]) => ops.map((o: SyncOperation) => o.id))).toEqual([['X']])
    // Positive anchor: the removal really failed, so X is still queued.
    expect(persistedIds()).toEqual(['X'])
  })

  it('reports an op accepted before a clear (86.1): it landed', async () => {
    seed([op('X'), op('Y', { timestamp: 2_000 })])
    const held = deferred<ProcessOperationResult>()
    const send = vi.fn(async (sent: SyncOperation) => (sent.id === 'X' ? held.promise : ACCEPTED))
    const service = await makeService(send)
    const synced = vi.fn()
    service.onOperationsSynced(synced)

    const inFlight = service.sync()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await service.clearQueue()
    held.resolve(ACCEPTED)
    await inFlight

    // Y was cleared before it was sent; X had landed.
    expect(send.mock.calls.map(([sent]) => sent.id)).toEqual(['X'])
    expect(synced.mock.calls.map(([ops]) => ops.map((o: SyncOperation) => o.id))).toEqual([['X']])
  })

  it('one throwing callback stops neither the others nor the sync', async () => {
    seed([op('X')])
    const service = await makeService(vi.fn(async () => ACCEPTED))
    const after = vi.fn()
    service.onOperationsSynced(() => {
      throw new Error('subscriber bug')
    })
    service.onOperationsSynced(after)

    const result = await service.sync()

    expect(result.success).toBe(true)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('each callback gets its own copy, and unsubscribing stops delivery', async () => {
    seed([op('X')])
    const service = await makeService(vi.fn(async () => ACCEPTED))
    const first = vi.fn((ops: SyncOperation[]) => {
      ops.length = 0
    })
    const second = vi.fn()
    service.onOperationsSynced(first)
    const unsubscribe = service.onOperationsSynced(second)

    await service.sync()
    expect(second.mock.calls[0]?.[0].map((o: SyncOperation) => o.id)).toEqual(['X'])

    unsubscribe()
    await service.queueCreate(
      'incomeSource',
      'entity-Z',
      { userId: USER, name: 'Z', amount: 1, frequency: 'monthly' },
      USER
    )
    await service.sync()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(2)
  })
})
