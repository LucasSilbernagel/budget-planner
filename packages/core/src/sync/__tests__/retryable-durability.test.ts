/**
 * Retryable durability and refused-op discard (story 75.3, FR120).
 *
 * Two defects from the 2026-09-24 review (`deferred-work.md`), both pinned here
 * over a REAL `SyncQueue` and a storage double that can refuse writes (the
 * sibling suites' queue doubles always resolve, so neither defect was visible):
 *
 * 1. A retryable op was removed from the PERSISTED queue on its first failure and
 *    held only in `state.failedOperations` (memory) until a retry timer re-added
 *    it. Past the retry budget nothing re-added it, and a reload at any point in
 *    between lost it. It was also invisible to every queue reader meanwhile —
 *    pull's LWW index and `hasPendingOperations` among them.
 * 2. When the storage write for removing a PERMANENTLY refused op failed (quota,
 *    private mode, blocked site data), the op stayed queued, was re-sent and
 *    re-refused every cycle, and the user was never told.
 *
 * ⚠️ The service starts OFFLINE in Node (its `navigator` has no `onLine`), and an
 * offline service sends nothing, so every "not sent" assertion here would pass
 * vacuously. Each test forces `isOnline` and asserts a positive anchor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncQueue } from '../queue'
import { SynchronizationService } from '../synchronization'
import type {
  ProcessOperationResult,
  ServerChange,
  SyncOperation,
  SyncQueueStorage,
  SyncState,
} from '../types'

const USER = 'user-75-3'

type Internals = { queue: SyncQueue; state: SyncState }
const internals = (service: SynchronizationService) => service as unknown as Internals

type TestStorage = SyncQueueStorage & {
  failWrites: boolean
  writes: number
  persistedIds: () => string[]
}

/** Map-backed queue storage whose writes can be switched to THROW. */
function createStorage(): TestStorage {
  const stored = new Map<string, SyncOperation[]>()
  const storage: TestStorage = {
    failWrites: false,
    writes: 0,
    async loadQueue(userId) {
      return [...(stored.get(userId) ?? [])]
    },
    async saveQueue(userId, queue) {
      if (storage.failWrites) {
        throw new Error('QuotaExceededError: the quota has been exceeded.')
      }
      storage.writes++
      stored.set(userId, [...queue])
    },
    async clearQueue(userId) {
      if (storage.failWrites) {
        throw new Error('QuotaExceededError: the quota has been exceeded.')
      }
      stored.delete(userId)
    },
    persistedIds: () => (stored.get(USER) ?? []).map((op) => op.id),
  }
  return storage
}

function op(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id,
    type: 'update',
    entityType: 'incomeSource',
    entityId: `entity-${id}`,
    data: { name: id },
    timestamp: 5_000,
    deviceId: 'device-test',
    userId: USER,
    ...overrides,
  }
}

/** A queue rebuilt from the same storage — what a page reload does. */
async function reload(storage: TestStorage): Promise<string[]> {
  const fresh = new SyncQueue(USER, storage)
  await fresh.initialize()
  return fresh.getAll().map((o) => o.id)
}

const RETRYABLE: ProcessOperationResult = {
  success: false,
  error: 'Network error',
  retryable: true,
}
const REFUSED: ProcessOperationResult = {
  success: false,
  error: 'refused',
  retryable: false,
  statusCode: 422,
}

describe('Retryable durability and refused-op discard (story 75.3)', () => {
  let storage: TestStorage
  let queue: SyncQueue
  let service: SynchronizationService
  let resultFor: Map<string, ProcessOperationResult>
  let processOperation: ReturnType<typeof vi.fn>
  let fetchServerChanges: ReturnType<typeof vi.fn>

  const sentIds = (): string[] =>
    processOperation.mock.calls.map(([sent]) => (sent as SyncOperation).id)

  beforeEach(async () => {
    vi.useFakeTimers()
    storage = createStorage()
    resultFor = new Map()
    processOperation = vi.fn(
      async (sent: SyncOperation) => resultFor.get(sent.id) ?? { success: true }
    )
    fetchServerChanges = vi.fn(async () => [] as ServerChange[])
    service = new SynchronizationService(USER, {
      autoSync: false,
      maxRetries: 3,
      retryDelay: 1_000,
      processOperation,
      fetchServerChanges,
    })
    queue = new SyncQueue(USER, storage)
    await queue.initialize()
    internals(service).queue = queue
    internals(service).state.isOnline = true
  })

  afterEach(() => {
    service.destroy()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** Fail `id` retryably until the retry budget is spent and no timer remains. */
  async function exhaustRetryBudget(id: string): Promise<void> {
    resultFor.set(id, RETRYABLE)
    await service.sync()
    await vi.advanceTimersByTimeAsync(10_000)
    // Positive anchor: the first attempt plus all three retries really went out.
    expect(sentIds().filter((sent) => sent === id)).toHaveLength(4)
    expect(service.getState().retryCount).toBe(3)
    // ⚠️ Not `retryTimeout === null`: `scheduleRetry` never nulls the handle after
    // it fires, so a stale handle stays truthy. Count the live timers instead.
    expect(vi.getTimerCount()).toBe(0)
  }

  describe('AC-1: a retryable op never leaves the persisted queue', () => {
    it('is still persisted after its first retryable failure, and survives a reload', async () => {
      await queue.add(op('flaky'))
      resultFor.set('flaky', RETRYABLE)

      await service.sync()

      expect(sentIds()).toEqual(['flaky'])
      expect(queue.getAll().map((o) => o.id)).toEqual(['flaky'])
      expect(storage.persistedIds()).toEqual(['flaky'])
      expect(await reload(storage)).toEqual(['flaky'])
    })

    it('is still persisted, exactly once, after the retry budget is exhausted', async () => {
      await queue.add(op('flaky'))

      await exhaustRetryBudget('flaky')

      expect(queue.getAll().map((o) => o.id)).toEqual(['flaky'])
      expect(storage.persistedIds()).toEqual(['flaky'])
      expect(await reload(storage)).toEqual(['flaky'])
    })

    it('is still persisted while the circuit breaker is open, and is retried after the cooldown', async () => {
      await queue.add(op('flaky'))
      resultFor.set('flaky', RETRYABLE)
      ;(service as unknown as { openCircuit: () => void }).openCircuit()

      await service.sync()

      expect(sentIds()).toEqual(['flaky'])
      expect(storage.persistedIds()).toEqual(['flaky'])
      expect(await reload(storage)).toEqual(['flaky'])

      // Past the 30 s cooldown the deferred timer fires; the op lands this time.
      resultFor.set('flaky', { success: true })
      await vi.advanceTimersByTimeAsync(40_000)

      expect(sentIds()).toEqual(['flaky', 'flaky'])
      expect(storage.persistedIds()).toEqual([])
    })

    it('keeps `failedOperations` a VIEW of queued ops: set on failure, emptied once the op lands', async () => {
      await queue.add(op('flaky'))
      resultFor.set('flaky', RETRYABLE)

      await service.sync()
      const afterFailure = service.getState()
      expect(afterFailure.failedOperations.map((o) => o.id)).toEqual(['flaky'])
      // A subset of pending, not in addition to it.
      expect(afterFailure.pendingOperations.map((o) => o.id)).toEqual(['flaky'])

      resultFor.set('flaky', { success: true })
      await vi.advanceTimersByTimeAsync(1_000)

      expect(sentIds()).toEqual(['flaky', 'flaky'])
      expect(service.getState().failedOperations).toEqual([])
      expect(service.getState().pendingOperations).toEqual([])
      expect(storage.persistedIds()).toEqual([])
    })
  })

  describe('AC-2: past the budget, the next sync carries the op', () => {
    it('sends it on the next sync once the transport recovers, and resets the budget', async () => {
      await queue.add(op('flaky'))
      await exhaustRetryBudget('flaky')

      resultFor.set('flaky', { success: true })
      const before = sentIds().length
      // Stands in for the web's edit / visibility / online / mount triggers.
      const result = await service.sync()

      expect(sentIds().slice(before)).toEqual(['flaky'])
      expect(result.synchronizedCount).toBe(1)
      expect(queue.getAll()).toEqual([])
      expect(storage.persistedIds()).toEqual([])
      expect(service.getState().retryCount).toBe(0)
    })

    it('resets the retry budget when the queue is found empty', async () => {
      // The op is later dropped by pull LWW, leaving the budget exhausted with
      // nothing queued. An empty queue is a clean state, so the next genuine
      // failure must get its fast retries again.
      await queue.add(op('flaky', { timestamp: 1_000 }))
      await exhaustRetryBudget('flaky')
      fetchServerChanges.mockResolvedValueOnce([
        {
          entityType: 'incomeSource',
          entityId: 'entity-flaky',
          // A VALID row: this server change must WIN LWW, and since story 75.4 a
          // row that fails its schema is refused instead of displacing the op.
          data: {
            name: 'server',
            amount: 100,
            frequency: 'monthly',
            userId: '11111111-1111-4111-8111-111111111111',
          },
          updatedAt: 9_000,
          isDeleted: false,
        },
      ])
      const pulled = await service.pull()
      // Positive anchor: the server row won LWW and took the queued op with it.
      expect(pulled.applied.map((c) => c.entityId)).toEqual(['entity-flaky'])
      expect(queue.getAll()).toEqual([])
      expect(service.getState().failedOperations).toEqual([])

      await service.sync()

      expect(service.getState().retryCount).toBe(0)
      expect(service.getState().failedOperations).toEqual([])
    })
  })

  describe('code review: the retry timer, the empty queue, and accepted-but-unremoved ops', () => {
    it('P2: a timer that outlives its failure does not spend the budget once the op has landed', async () => {
      await queue.add(op('flaky'))
      resultFor.set('flaky', RETRYABLE)
      await service.sync()
      expect(vi.getTimerCount()).toBe(1)

      // An external sync (an edit, tab focus) lands the op before the timer fires.
      resultFor.set('flaky', { success: true })
      await service.sync()
      expect(service.getState().retryCount).toBe(0)
      const sent = sentIds().length

      await vi.advanceTimersByTimeAsync(1_000)

      expect(sentIds()).toHaveLength(sent)
      expect(service.getState().retryCount).toBe(0)
    })

    it('P2: a timer that fires while offline neither counts an attempt nor syncs the kept-queued rest', async () => {
      await queue.add(op('flaky'))
      await queue.add(op('kept', { timestamp: 6_000 }))
      resultFor.set('flaky', RETRYABLE)
      resultFor.set('kept', { success: false, retryable: false, statusCode: 403 })
      await service.sync()
      expect(sentIds()).toEqual(['flaky', 'kept'])
      internals(service).state.isOnline = false

      await vi.advanceTimersByTimeAsync(1_000)

      expect(sentIds()).toEqual(['flaky', 'kept'])
      expect(service.getState().retryCount).toBe(0)
      expect(queue.getAll().map((o) => o.id)).toEqual(['flaky', 'kept'])
    })

    it('P3: a queue emptied OUTSIDE the service (the web sweep) leaves no stale pending or failed view', async () => {
      await queue.add(op('flaky'))
      resultFor.set('flaky', RETRYABLE)
      await service.sync()
      expect(service.getState().pendingOperations.map((o) => o.id)).toEqual(['flaky'])

      await queue.discardBatch(['flaky'])
      await service.sync()

      expect(service.getState().pendingOperations).toEqual([])
      expect(service.getState().failedOperations).toEqual([])
    })

    it('P4: an op the server ACCEPTED but storage would not remove gets no fast retry', async () => {
      await queue.add(op('accepted'))
      storage.failWrites = true

      const result = await service.sync()

      // Positive anchor: it was sent and accepted; the removal is what failed.
      expect(sentIds()).toEqual(['accepted'])
      expect(result.failedCount).toBe(1)
      expect(queue.getAll().map((o) => o.id)).toEqual(['accepted'])
      expect(service.getState().failedOperations).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('AC-3 / AC-4: a refused op whose removal cannot be persisted', () => {
    async function refuseWhileStorageFails(): Promise<ReturnType<typeof vi.fn>> {
      await queue.add(op('bad'))
      await queue.add(op('later', { timestamp: 6_000 }))
      resultFor.set('bad', REFUSED)
      resultFor.set('later', RETRYABLE)
      const rejected = vi.fn()
      service.onOperationsRejected(rejected)
      storage.failWrites = true
      // `discardBatch` logs the refused write; expected here, so keep it quiet.
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await service.sync()
      return rejected
    }

    it('is announced once and is NOT re-sent in this session', async () => {
      const rejected = await refuseWhileStorageFails()

      expect(sentIds()).toEqual(['bad', 'later'])
      expect(rejected).toHaveBeenCalledTimes(1)
      expect(rejected.mock.calls[0]?.[0].map((o: SyncOperation) => o.id)).toEqual(['bad'])
      expect(service.getState().rejectedOperations.map((o) => o.id)).toEqual(['bad'])

      resultFor.set('later', { success: true })
      const before = sentIds().length
      await service.sync()

      // Positive anchor: the second sync DID send — just not the refused op.
      expect(sentIds().slice(before)).toEqual(['later'])
      expect(rejected).toHaveBeenCalledTimes(1)
    })

    it('LIMIT: it comes back on a reload while storage is still refusing writes', async () => {
      await refuseWhileStorageFails()

      // Storage never took the removal, so a rebuilt queue still has it. It will
      // be sent once more, refused once more and announced once more.
      expect(await reload(storage)).toEqual(['bad', 'later'])
      expect(queue.getAll().map((o) => o.id)).toEqual(['later'])
    })

    it('converges: the next successful write by any mutator persists the removal', async () => {
      await refuseWhileStorageFails()

      storage.failWrites = false
      await queue.add(op('fresh', { timestamp: 7_000 }))

      expect(await reload(storage)).toEqual(['later', 'fresh'])
    })
  })

  describe('code review 75.4: an op that lost pull LWW is dropped even when storage refuses', () => {
    it('does not push the stale edit over the value the pull just applied', async () => {
      // Before: `removeBatch` threw on the storage failure, the op stayed queued,
      // and the next sync sent the OLD local edit over the NEWER server value the
      // pull had just applied. Its comment called that "a redundant retry".
      await queue.add(op('stale', { timestamp: 1_000 }))
      storage.failWrites = true
      fetchServerChanges.mockResolvedValueOnce([
        {
          entityType: 'incomeSource',
          entityId: 'entity-stale',
          data: {
            name: 'newer server value',
            amount: 100,
            frequency: 'monthly',
            userId: '11111111-1111-4111-8111-111111111111',
          },
          updatedAt: 9_000,
          isDeleted: false,
        },
      ])

      const pulled = await service.pull()

      // Positive anchors: the server row won and was applied.
      expect(pulled.applied.map((c) => c.entityId)).toEqual(['entity-stale'])
      expect(queue.getAll()).toEqual([])
      // The stated limit: storage refused the write, so it still holds the op.
      expect(storage.persistedIds()).toEqual(['stale'])

      storage.failWrites = false
      const before = sentIds().length
      await service.sync()
      expect(sentIds().slice(before)).not.toContain('stale')
    })
  })

  describe('AC-5: queue readers see a retryable op while it waits', () => {
    it('(a) pull LWW suppresses an OLDER server row for an op that failed retryably', async () => {
      await queue.add(op('flaky', { timestamp: 5_000 }))
      resultFor.set('flaky', RETRYABLE)
      await service.sync()
      fetchServerChanges.mockResolvedValueOnce([
        {
          entityType: 'incomeSource',
          entityId: 'entity-flaky',
          data: { name: 'older server value' },
          updatedAt: 4_000,
          isDeleted: false,
        },
      ])

      const pulled = await service.pull()

      expect(pulled.success).toBe(true)
      expect(pulled.applied).toEqual([])
      expect(pulled.conflicts.map((c) => c.entityId)).toEqual(['entity-flaky'])
      expect(queue.getAll().map((o) => o.id)).toEqual(['flaky'])
    })

    it('(b) a retryably failed profile create still counts as pending for its profile', async () => {
      await queue.add(
        op('profile-create', {
          type: 'create',
          entityType: 'userProfile',
          entityId: 'profile-1',
        })
      )
      resultFor.set('profile-create', RETRYABLE)

      await service.sync()

      expect(sentIds()).toEqual(['profile-create'])
      expect(queue.hasPendingOperations('userProfile', 'profile-1')).toBe(true)
    })

    it('(c) the retry does not duplicate the op', async () => {
      await queue.add(op('flaky'))
      resultFor.set('flaky', RETRYABLE)
      await service.sync()

      await vi.advanceTimersByTimeAsync(1_000)

      // Positive anchor: the retry really ran.
      expect(sentIds()).toEqual(['flaky', 'flaky'])
      expect(queue.getAll().map((o) => o.id)).toEqual(['flaky'])
      expect(storage.persistedIds()).toEqual(['flaky'])
    })
  })

  describe('SyncQueue.discardBatch', () => {
    it('removes and persists when storage accepts the write', async () => {
      await queue.add(op('a'))
      await queue.add(op('b'))

      const outcome = await queue.discardBatch(['a'])

      expect(outcome).toEqual({ removed: 1, persisted: true })
      expect(queue.getAll().map((o) => o.id)).toEqual(['b'])
      expect(storage.persistedIds()).toEqual(['b'])
    })

    it('still removes from memory, without throwing, when storage refuses the write', async () => {
      await queue.add(op('a'))
      await queue.add(op('b'))
      storage.failWrites = true
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      const outcome = await queue.discardBatch(['a'])
      // Code review P5: the storage error is logged, not swallowed.
      const logged = error.mock.calls.map((call) => String(call[1]))
      error.mockRestore()

      expect(logged).toEqual([expect.stringContaining('QuotaExceededError')])
      expect(outcome).toEqual({ removed: 1, persisted: false })
      expect(queue.getAll().map((o) => o.id)).toEqual(['b'])
      expect(storage.persistedIds()).toEqual(['a', 'b'])
    })

    it('does not write when nothing matches', async () => {
      await queue.add(op('a'))
      const writes = storage.writes

      expect(await queue.discardBatch(['missing'])).toEqual({ removed: 0, persisted: true })
      expect(storage.writes).toBe(writes)
    })
  })
})
