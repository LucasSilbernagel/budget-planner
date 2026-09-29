/**
 * A torn-down sync service never touches the queue (story 79.1, FR129).
 *
 * `useSync` destroys its service on sign-out, account switch or any effect
 * re-run, and builds a new one for the next session. A sync (or pull) already
 * in flight used to run to completion on the DEAD service:
 *
 *  - a refused op left storage with no listener subscribed, so it was never
 *    reverted and never named;
 *  - its whole-queue write went to the SAME storage key (`bp-sync-queue-<userId>`)
 *    as the new instance's, and overwrote whatever the new instance had queued;
 *  - it could still arm a retry, drain or auto-sync timer and send again.
 *
 * DECISION: skip mutation. After `destroy()` the old service leaves the queue
 * exactly as persisted; the next session re-sends it and learns every outcome
 * again (a refused op is refused again, now with a listener; an accepted create
 * or delete is acknowledged as already applied by the server).
 *
 * Every test is a real interleave: the transport is held on a deferred promise,
 * `destroy()` runs while it is held, and only then is it resolved. Each anchors
 * on the request that really went out before `destroy()`.
 *
 * ⚠️ The services here are REAL and use the production storage key through the
 * per-test `localStorage` mock (`vitest.setup.ts`), so two instances for one
 * user genuinely share storage. `navigator.onLine` is stubbed true: in Node it
 * is undefined, the service would start offline, and every "not sent"
 * assertion would pass vacuously.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizationService } from '../synchronization'
import type {
  FetchServerChangesFn,
  ProcessOperationFn,
  ProcessOperationResult,
  ServerChange,
  SyncOperation,
} from '../types'

const USER = '11111111-1111-4111-8111-111111111111'
const PROFILE = '22222222-2222-4222-8222-222222222222'
const INCOME_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ISO = '2026-09-01T00:00:00.000Z'
const STORAGE_KEY = `bp-sync-queue-${USER}`

const ACCEPTED: ProcessOperationResult = { success: true }
const REFUSED: ProcessOperationResult = {
  success: false,
  error: 'refused',
  retryable: false,
  statusCode: 422,
}
const RETRYABLE: ProcessOperationResult = { success: false, error: 'boom', retryable: true }
const UNCLASSIFIED: ProcessOperationResult = { success: false, error: 'batch', retryable: false }

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

function seed(ops: SyncOperation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ops))
}

function persistedIds(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw) as SyncOperation[]).map((o) => o.id) : []
}

/** A production-shaped, VALID pulled income row. */
function incomeChange(updatedAt: number): ServerChange {
  return {
    entityType: 'incomeSource',
    entityId: INCOME_X,
    data: {
      id: INCOME_X,
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
    updatedAt,
    isDeleted: false,
  }
}

const VALID_INCOME = { userId: USER, name: 'Rent', amount: 50_000, frequency: 'monthly' }

describe('a torn-down sync never touches the queue (story 79.1)', () => {
  const services: SynchronizationService[] = []

  /** A real service for USER. Tracked so `afterEach` tears every one down. */
  async function makeService(
    processOperation: ProcessOperationFn,
    extra: {
      fetchServerChanges?: FetchServerChangesFn
      autoSync?: boolean
      initialize?: boolean
    } = {}
  ): Promise<SynchronizationService> {
    const service = new SynchronizationService(USER, {
      autoSync: extra.autoSync ?? false,
      autoSyncInterval: 30_000,
      maxRetries: 3,
      retryDelay: 1_000,
      processOperation,
      fetchServerChanges: extra.fetchServerChanges ?? (async () => []),
    })
    services.push(service)
    if (extra.initialize !== false) {
      await service.initialize()
    }
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

  describe('AC-1: a push that resolves after destroy() changes nothing', () => {
    it.each([
      ['accepted', ACCEPTED],
      ['refused (422)', REFUSED],
      ['retryable', RETRYABLE],
      ['unclassified', UNCLASSIFIED],
    ])('%s: storage untouched, no further send, no timer', async (_label, outcome) => {
      seed([op('X'), op('Z', { timestamp: 2_000 })])
      const held = deferred<ProcessOperationResult>()
      const send = vi.fn(async (sent: SyncOperation) => (sent.id === 'X' ? held.promise : ACCEPTED))
      const service = await makeService(send)

      const inFlight = service.sync()
      // Positive anchor: X really went out before the teardown.
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      service.destroy()
      held.resolve(outcome)
      const result = await inFlight

      // The destroyed early return ran — not a closed-queue rejection caught
      // somewhere further down (code review 79.1).
      expect(result.error).toBe('Sync service destroyed')
      // Nothing after X: the rest of the batch is not sent by a dead service.
      expect(send.mock.calls.map(([sent]) => sent.id)).toEqual(['X'])
      expect(persistedIds()).toEqual(['X', 'Z'])

      // No retry, drain or re-sync timer survives the teardown.
      await vi.advanceTimersByTimeAsync(120_000)
      expect(send).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('a refused op is refused again by the NEXT session, and this time it is reported', async () => {
      seed([op('X', { type: 'create', entityId: INCOME_X })])
      const held = deferred<ProcessOperationResult>()
      const sendA = vi.fn(async (_sent: SyncOperation) => held.promise)
      const serviceA = await makeService(sendA)
      const lostByA = vi.fn()
      serviceA.onOperationsRejected(lostByA)

      const inFlight = serviceA.sync()
      await vi.waitFor(() => expect(sendA).toHaveBeenCalledTimes(1))
      serviceA.destroy()
      held.resolve(REFUSED)
      await inFlight
      expect(lostByA).not.toHaveBeenCalled()
      expect(persistedIds()).toEqual(['X'])

      // The next session for the same user.
      const sendB = vi.fn(async (_sent: SyncOperation) => REFUSED)
      const serviceB = await makeService(sendB)
      const reported: SyncOperation[][] = []
      serviceB.onOperationsRejected((ops) => reported.push(ops))

      await serviceB.sync()

      expect(sendB.mock.calls.map(([sent]) => sent.id)).toEqual(['X'])
      expect(reported.map((ops) => ops.map((o) => o.id))).toEqual([['X']])
      expect(persistedIds()).toEqual([])
    })
  })

  describe("AC-2: the new instance's queue survives the old one settling", () => {
    it('an accepted push resolving on the dead service does not overwrite the new queue', async () => {
      seed([op('X')])
      const held = deferred<ProcessOperationResult>()
      const sendA = vi.fn(async (_sent: SyncOperation) => held.promise)
      const serviceA = await makeService(sendA)

      const inFlight = serviceA.sync()
      await vi.waitFor(() => expect(sendA).toHaveBeenCalledTimes(1))
      serviceA.destroy()

      const sendB = vi.fn(async (_sent: SyncOperation) => ACCEPTED)
      const serviceB = await makeService(sendB)
      expect(
        serviceB
          .getQueue()
          .getAll()
          .map((o) => o.id)
      ).toEqual(['X'])
      await serviceB.getQueue().add(op('Y', { timestamp: 3_000 }))
      expect(persistedIds()).toEqual(['X', 'Y'])

      held.resolve(ACCEPTED)
      await inFlight

      expect(persistedIds()).toEqual(['X', 'Y'])

      // B pushes both: X again (the server acknowledges a replayed op) and Y.
      await serviceB.sync()
      expect(sendB.mock.calls.map(([sent]) => sent.id)).toEqual(['X', 'Y'])
      expect(persistedIds()).toEqual([])
    })
  })

  describe('AC-3: the other entry points honour the teardown', () => {
    it('a pull resolving after destroy() drops no queued op', async () => {
      seed([op('X', { entityId: INCOME_X, timestamp: 1_000 })])
      const held = deferred<ServerChange[]>()
      const fetchServerChanges = vi.fn(async (_since: number | null) => held.promise)
      const service = await makeService(async () => ACCEPTED, { fetchServerChanges })
      const pulled = vi.fn()
      service.onChangesPulled(pulled)

      const inFlight = service.pull()
      await vi.waitFor(() => expect(fetchServerChanges).toHaveBeenCalledTimes(1))
      service.destroy()
      // Strictly newer than the queued op: a LIVE pull would drop X (LWW).
      held.resolve([incomeChange(9_000)])
      await inFlight

      expect(persistedIds()).toEqual(['X'])
      expect(pulled).not.toHaveBeenCalled()
    })

    it('control: a LIVE pull with the same row does drop the op', async () => {
      seed([op('X', { entityId: INCOME_X, timestamp: 1_000 })])
      const service = await makeService(async () => ACCEPTED, {
        fetchServerChanges: async () => [incomeChange(9_000)],
      })

      await service.pull()

      expect(persistedIds()).toEqual([])
    })

    it('initialize() settling after destroy() arms no auto-sync timer', async () => {
      const service = await makeService(async () => ACCEPTED, {
        autoSync: true,
        initialize: false,
      })

      const loading = service.initialize()
      service.destroy()
      await loading

      expect(vi.getTimerCount()).toBe(0)
    })

    it('control: a live initialize() with autoSync arms the auto-sync timer', async () => {
      await makeService(async () => ACCEPTED, { autoSync: true })

      expect(vi.getTimerCount()).toBe(1)
    })

    it('sync, pull, discard and queue calls made AFTER destroy() do nothing', async () => {
      seed([op('X', { profileId: PROFILE })])
      const send = vi.fn(async () => ACCEPTED)
      const fetchServerChanges = vi.fn(async (_since: number | null) => [])
      const service = await makeService(send, { fetchServerChanges })

      service.destroy()

      const result = await service.sync()
      expect(result.success).toBe(false)
      expect(result.error).toBe('Sync service destroyed')
      const pulled = await service.pull()
      expect(pulled.success).toBe(false)
      expect(await service.discardOperationsForDeletedProfile(PROFILE)).toEqual([])
      await expect(
        service.queueCreate('incomeSource', 'new-row', VALID_INCOME, USER)
      ).rejects.toThrow(/destroyed/)
      await expect(service.queueUpdate('incomeSource', 'X', VALID_INCOME, USER)).rejects.toThrow(
        /destroyed/
      )
      await expect(service.queueDelete('incomeSource', 'X', USER)).rejects.toThrow(/destroyed/)

      expect(send).not.toHaveBeenCalled()
      expect(fetchServerChanges).not.toHaveBeenCalled()
      expect(persistedIds()).toEqual(['X'])
      expect(service.isDestroyed()).toBe(true)
    })

    it('control: the same calls on a live service do send, fetch, drop and queue', async () => {
      seed([op('X'), op('P', { profileId: 'deleted-profile', timestamp: 2_000 })])
      const send = vi.fn(async () => ACCEPTED)
      const fetchServerChanges = vi.fn(async (_since: number | null) => [])
      const service = await makeService(send, { fetchServerChanges })

      expect(await service.discardOperationsForDeletedProfile('deleted-profile')).toHaveLength(1)
      expect(persistedIds()).toEqual(['X'])
      await service.sync()
      await service.pull()
      await service.queueCreate('incomeSource', 'new-row', VALID_INCOME, USER)
      await service.queueUpdate('incomeSource', 'new-row', VALID_INCOME, USER)
      await service.queueDelete('incomeSource', 'new-row', USER)

      expect(send).toHaveBeenCalledTimes(1)
      expect(fetchServerChanges).toHaveBeenCalledTimes(1)
      expect(persistedIds()).toHaveLength(3)
      expect(service.isDestroyed()).toBe(false)
    })

    it('a pull whose fetch FAILS after destroy() writes no state (code review 79.1)', async () => {
      let fail: (error: Error) => void = () => {}
      const fetchServerChanges = vi.fn(
        (_since: number | null) =>
          new Promise<ServerChange[]>((_resolve, reject) => {
            fail = reject
          })
      )
      const service = await makeService(async () => ACCEPTED, { fetchServerChanges })

      const inFlight = service.pull()
      await vi.waitFor(() => expect(fetchServerChanges).toHaveBeenCalledTimes(1))
      service.destroy()
      fail(new Error('network down'))
      const result = await inFlight

      expect(result.error).toBe('Sync service destroyed')
      expect(service.getState().lastError).toBeUndefined()
    })

    it('a profile discard that runs after destroy() drops nothing and does not reject (code review 79.1)', async () => {
      seed([op('P', { profileId: 'deleted-profile' })])
      const service = await makeService(async () => ACCEPTED)

      // Called while live (past the entry check); the queue's work runs on a
      // later microtask, after the teardown closed it.
      const discarding = service.discardOperationsForDeletedProfile('deleted-profile')
      service.destroy()

      await expect(discarding).resolves.toEqual([])
      expect(persistedIds()).toEqual(['P'])
    })

    it('startAutoSync() after destroy() arms nothing (code review 79.1)', async () => {
      const service = await makeService(async () => ACCEPTED)
      service.destroy()

      service.startAutoSync()

      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
