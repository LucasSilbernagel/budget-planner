// Removal needs positive proof of permanence: 401, 403 and unclassified failures stay queued.
// 403 must not open the circuit: a cooldown would only suppress other entities.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizationService } from '../synchronization'
import type { SyncOperation } from '../types'

type AnyOp = { id: string; type: string; entityType: string; entityId?: string }

// Each op gets its own entityId unless the test names one: ops sharing one are the same row.
function op(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id,
    type: 'update',
    entityType: 'category',
    entityId: `entity-${id}`,
    data: {},
    timestamp: 5_000,
    deviceId: 'device-test',
    userId: 'user-123',
    ...overrides,
  }
}

describe('Non-retryable sync failures', () => {
  let service: SynchronizationService
  let mockQueue: any
  let processOperation: any
  let resultForOp: Map<string, any>

  beforeEach(() => {
    const operations: AnyOp[] = []
    mockQueue = {
      add: vi.fn(async (o: AnyOp) => {
        operations.push(o)
      }),
      close: vi.fn(),
      getAll: vi.fn(() => [...operations]),
      getReadyOperations: vi.fn(() => [...operations]),
      getCount: vi.fn(() => operations.length),
      removeBatch: vi.fn(async (ids: string[]) => {
        for (let i = operations.length - 1; i >= 0; i--) {
          const op = operations[i]
          if (op && ids.includes(op.id)) operations.splice(i, 1)
        }
      }),
      discardBatch: vi.fn(async (ids: string[]) => {
        const before = operations.length
        for (let i = operations.length - 1; i >= 0; i--) {
          const op = operations[i]
          if (op && ids.includes(op.id)) operations.splice(i, 1)
        }
        return { removed: before - operations.length, persisted: true }
      }),
    }

    resultForOp = new Map()
    processOperation = vi.fn(async (o: AnyOp) => resultForOp.get(o.id) ?? { success: true })
    service = new SynchronizationService('user-123', {
      autoSync: false,
      processOperation,
    })

    // @ts-expect-error - accessing private property for testing
    service.queue = mockQueue
    // @ts-expect-error - accessing private property for testing
    service.state.isOnline = true
  })

  afterEach(() => {
    service.destroy()
    vi.useRealTimers()
  })

  describe("a permanently refused CREATE takes its row's queued follow-ups with it", () => {
    const create = op('op-create', { type: 'create', entityType: 'savingsGoal', entityId: 'g-1' })
    const update = op('op-update', { type: 'update', entityType: 'savingsGoal', entityId: 'g-1' })
    const del = op('op-delete', { type: 'delete', entityType: 'savingsGoal', entityId: 'g-1' })

    function refuse(id: string) {
      resultForOp.set(id, { success: false, retryable: false, statusCode: 422 })
    }

    it('drops the create AND every queued op for the same row, and records them all as rejected', async () => {
      await service.getQueue().add(create)
      await service.getQueue().add(update)
      await service.getQueue().add(del)
      refuse('op-create')
      // What the server answers for an op on a row that was never created.
      resultForOp.set('op-update', { success: false, conflict: true })
      resultForOp.set('op-delete', { success: false, error: 'Entity not found', retryable: false })

      await service.sync()

      expect(service.getQueue().getAll()).toHaveLength(0)
      // @ts-expect-error - accessing private property for testing
      const state = service.state
      expect(state.rejectedOperations.map((o: AnyOp) => o.id).sort()).toEqual(
        ['op-create', 'op-delete', 'op-update'].sort()
      )
      expect(state.conflictOperations.map((o: AnyOp) => o.id)).not.toContain('op-update')
      expect(state.failedOperations.map((o: AnyOp) => o.id)).not.toContain('op-delete')
    })

    it('drops a follow-up that failed RETRYABLY in the same batch, so no retry re-sends it', async () => {
      await service.getQueue().add(create)
      await service.getQueue().add(update)
      refuse('op-create')
      resultForOp.set('op-update', { success: false, retryable: true })

      await service.sync()

      expect(service.getQueue().getAll()).toHaveLength(0)
      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations.map((o: AnyOp) => o.id)).not.toContain('op-update')
    })

    it('CONTROL — leaves ops for OTHER rows, and ops of another entity type with the same id', async () => {
      const otherRow = op('op-other', {
        type: 'update',
        entityType: 'savingsGoal',
        entityId: 'g-2',
      })
      const otherType = op('op-type', { type: 'update', entityType: 'expense', entityId: 'g-1' })
      await service.getQueue().add(create)
      await service.getQueue().add(otherRow)
      await service.getQueue().add(otherType)
      refuse('op-create')
      resultForOp.set('op-other', { success: false, retryable: false })
      resultForOp.set('op-type', { success: false, retryable: false })

      await service.sync()

      expect(
        service
          .getQueue()
          .getAll()
          .map((o: AnyOp) => o.id)
          .sort()
      ).toEqual(['op-other', 'op-type'])
    })

    it("CONTROL — a refused UPDATE does NOT take the row's other ops (the row exists server-side)", async () => {
      const update2 = op('op-update-2', {
        type: 'update',
        entityType: 'savingsGoal',
        entityId: 'g-1',
      })
      await service.getQueue().add(update)
      await service.getQueue().add(update2)
      refuse('op-update')
      resultForOp.set('op-update-2', { success: false, retryable: false })

      await service.sync()

      expect(
        service
          .getQueue()
          .getAll()
          .map((o: AnyOp) => o.id)
      ).toEqual(['op-update-2'])
    })
  })

  describe('queue disposition by failure class', () => {
    it('removes an operation the server PERMANENTLY rejected (422) and records it', async () => {
      await service.getQueue().add(op('op-reject', { type: 'update', entityType: 'category' }))
      resultForOp.set('op-reject', {
        success: false,
        error: 'Unprocessable entity',
        retryable: false,
        statusCode: 422,
      })

      await service.sync()

      expect(service.getQueue().getAll()).toHaveLength(0)
      expect(mockQueue.discardBatch).toHaveBeenCalledWith(['op-reject'])
      // @ts-expect-error - accessing private property for testing
      const rejected = service.state.rejectedOperations
      expect(rejected.map((o: AnyOp) => o.id)).toEqual(['op-reject'])
    })

    it.each([400, 404, 409, 422])(
      'removes an operation rejected with the permanent status %i',
      async (statusCode) => {
        await service.getQueue().add(op('op-x', { type: 'update', entityType: 'category' }))
        resultForOp.set('op-x', { success: false, retryable: false, statusCode })

        await service.sync()

        expect(service.getQueue().getAll()).toHaveLength(0)
      }
    )

    it('KEEPS a non-retryable failure that carries NO status code — the transient-fault shape', async () => {
      await service.getQueue().add(op('op-blip', { type: 'update', entityType: 'category' }))
      // What the transport returns for a 200 envelope with `failedCount > 0`, e.g. a caught blip.
      resultForOp.set('op-blip', {
        success: false,
        error: 'Operation failed on server',
        retryable: false,
      })

      await service.sync()

      expect(
        service
          .getQueue()
          .getAll()
          .map((o: AnyOp) => o.id)
      ).toEqual(['op-blip'])
      expect(mockQueue.removeBatch).not.toHaveBeenCalledWith(['op-blip'])
      // @ts-expect-error - accessing private property for testing
      expect(service.state.rejectedOperations).toHaveLength(0)
    })

    it('KEEPS a non-retryable failure whose status is transient-shaped (408), not in the allow-list', async () => {
      await service.getQueue().add(op('op-timeout', { type: 'create', entityType: 'expense' }))
      resultForOp.set('op-timeout', { success: false, retryable: false, statusCode: 408 })

      await service.sync()

      expect(
        service
          .getQueue()
          .getAll()
          .map((o: AnyOp) => o.id)
      ).toEqual(['op-timeout'])
    })

    it('KEEPS an auth-blocked (401) operation queued and OPENS the circuit', async () => {
      await service.getQueue().add(op('op-auth', { type: 'create', entityType: 'expense' }))
      resultForOp.set('op-auth', {
        success: false,
        error: 'Unauthorized',
        retryable: false,
        statusCode: 401,
      })

      await service.sync()

      expect(
        service
          .getQueue()
          .getAll()
          .map((o: AnyOp) => o.id)
      ).toEqual(['op-auth'])
      // @ts-expect-error - accessing private property for testing
      expect(service.state.rejectedOperations).toHaveLength(0)
      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(true)
    })

    it('KEEPS a tier-blocked (403) operation queued but does NOT open the circuit', async () => {
      await service.getQueue().add(op('op-tier', { type: 'create', entityType: 'expense' }))
      resultForOp.set('op-tier', {
        success: false,
        error: 'Premium feature: server sync requires an active paid subscription',
        retryable: false,
        statusCode: 403,
      })

      await service.sync()

      expect(
        service
          .getQueue()
          .getAll()
          .map((o: AnyOp) => o.id)
      ).toEqual(['op-tier'])
      // @ts-expect-error - accessing private property for testing
      expect(service.state.rejectedOperations).toHaveLength(0)
      // Fails if 403 is folded back in with 401.
      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(false)
      // @ts-expect-error - accessing private property for testing
      expect(service.state.lastError).toContain('not included in your current plan')
    })
  })

  describe('circuit and retry are independent decisions', () => {
    it('schedules the retry even when an auth failure opened the circuit in the same batch, and RECOVERS the op', async () => {
      vi.useFakeTimers()
      await service.getQueue().add(op('op-auth', { type: 'create', entityType: 'expense' }))
      await service
        .getQueue()
        .add(op('op-transient', { type: 'create', entityType: 'incomeSource' }))
      resultForOp.set('op-auth', {
        success: false,
        error: 'Unauthorized',
        retryable: false,
        statusCode: 401,
      })
      resultForOp.set('op-transient', {
        success: false,
        error: 'Service unavailable',
        retryable: true,
      })

      await service.sync()

      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(true)
      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations.map((o: AnyOp) => o.id)).toEqual(['op-transient'])

      // @ts-expect-error - accessing private property for testing
      expect(service.retryTimeout).toBeTruthy()

      // A timer that fires and does nothing would satisfy the assertion above, so drive it and
      // observe the operation actually coming back.
      const callsBefore = processOperation.mock.calls.length
      resultForOp.set('op-transient', { success: true })
      resultForOp.set('op-auth', { success: true })
      await vi.advanceTimersByTimeAsync(70_000)

      expect(processOperation.mock.calls.length).toBeGreaterThan(callsBefore)
      expect(processOperation.mock.calls.some(([op]: [AnyOp]) => op.id === 'op-transient')).toBe(
        true
      )
      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations).toHaveLength(0)
    })

    it('DEFERS a retry past the circuit cooldown and then retries the operation', async () => {
      vi.useFakeTimers()
      await service
        .getQueue()
        .add(op('op-transient', { type: 'create', entityType: 'incomeSource' }))
      resultForOp.set('op-transient', { success: false, retryable: true })

      // Open the circuit first, so scheduleRetry() takes the open-circuit path.
      // @ts-expect-error - accessing private property for testing
      service.openCircuit()

      await service.sync()

      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations.map((o: AnyOp) => o.id)).toEqual(['op-transient'])
      // @ts-expect-error - accessing private property for testing
      expect(service.retryTimeout).toBeTruthy()

      // Assert the operation is recovered, not just `circuitBroken`: that flips before `runRetry`
      // runs, so it would be false even if `runRetry` synced nothing.
      const callsBefore = processOperation.mock.calls.length
      resultForOp.set('op-transient', { success: true })
      await vi.advanceTimersByTimeAsync(70_000)

      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(false)
      expect(processOperation.mock.calls.length).toBeGreaterThan(callsBefore)
      expect(processOperation.mock.calls.some(([op]: [AnyOp]) => op.id === 'op-transient')).toBe(
        true
      )
      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations).toHaveLength(0)
    })

    it('does NOT close a circuit that was re-opened after the deferred timer was armed', async () => {
      vi.useFakeTimers()
      await service
        .getQueue()
        .add(op('op-transient', { type: 'create', entityType: 'incomeSource' }))
      resultForOp.set('op-transient', { success: false, retryable: true })

      // @ts-expect-error - accessing private property for testing
      service.openCircuit()
      await service.sync()
      // @ts-expect-error - accessing private property for testing
      expect(service.retryTimeout).toBeTruthy()

      // A later failure extends the cooldown without re-entering scheduleRetry(), so the armed
      // timer still fires on the old schedule.
      await vi.advanceTimersByTimeAsync(29_000)
      // @ts-expect-error - accessing private property for testing
      service.openCircuit()

      // The original timer fires here and must re-defer, not close the freshly extended cooldown.
      await vi.advanceTimersByTimeAsync(10_000)

      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(true)
      // @ts-expect-error - accessing private property for testing
      expect(service.retryTimeout).toBeTruthy()
    })
  })
})
