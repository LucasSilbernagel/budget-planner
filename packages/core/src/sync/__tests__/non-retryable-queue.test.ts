/**
 * Non-retryable sync failures: queue disposition and circuit/retry independence.
 *
 * Covers two defects that shipped together and were logged as HIGH in
 * `deferred-work.md` (triaged 2026-09-23):
 *
 * 1. EVERY non-retryable failure was left in the queue forever. A permanently
 *    rejected operation was therefore replayed on every sync, pinned the status
 *    at FAILED and re-opened the circuit breaker each cycle — which suppressed
 *    retries for every OTHER entity.
 * 2. `if (nonRetryable) openCircuit() else if (requeuable) scheduleRetry()` —
 *    the `else if` meant a batch containing BOTH kinds never scheduled its
 *    retry, and since retryable ops are removed from the queue before that
 *    point, they were stranded in memory and lost on reload.
 *
 * ⚠️ The first fix's ORIGINAL shape was itself a data-loss bug, found in code
 * review and corrected here. It removed an operation unless the status code was
 * 401/403 — i.e. it classified on the ABSENCE of a signal. The dominant failure
 * path carries no signal: the transport maps any 200 envelope with
 * `failedCount > 0` to `retryable: false` with NO status code, and the server
 * reaches that envelope for transient faults because `applyOperation` wraps its
 * body in a blanket `catch`. A single dropped connection therefore deleted a
 * queued edit permanently. Removal now requires POSITIVE proof of permanence.
 *
 * Disposition by class:
 *   - 401 auth-blocked  → keep queued (valid op, bad session); OPEN the circuit.
 *   - 403 tier-blocked  → keep queued (valid op, valid session, lapsed plan);
 *                         do NOT open the circuit — re-auth and waiting are both
 *                         powerless, so a cooldown only suppresses other entities.
 *   - permanent status  → drop from the queue, record in `rejectedOperations`.
 *   - anything else     → keep queued.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizationService } from '../synchronization'

type AnyOp = { id: string; type: string; entityType: string }

describe('Non-retryable sync failures', () => {
  let service: SynchronizationService
  let mockQueue: any
  let processOperation: any
  // Per-operation-id result, so one batch can mix failure classes.
  let resultForOp: Map<string, any>

  beforeEach(() => {
    const operations: AnyOp[] = []
    mockQueue = {
      add: vi.fn(async (op: AnyOp) => {
        operations.push(op)
      }),
      getAll: vi.fn(() => [...operations]),
      getReadyOperations: vi.fn(() => [...operations]),
      getCount: vi.fn(() => operations.length),
      removeBatch: vi.fn(async (ids: string[]) => {
        for (let i = operations.length - 1; i >= 0; i--) {
          const op = operations[i]
          if (op && ids.includes(op.id)) operations.splice(i, 1)
        }
      }),
    }

    resultForOp = new Map()
    processOperation = vi.fn(async (op: AnyOp) => resultForOp.get(op.id) ?? { success: true })
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

  describe('queue disposition by failure class', () => {
    it('removes an operation the server PERMANENTLY rejected (422) and records it', async () => {
      await service.queue.add({ id: 'op-reject', type: 'update', entityType: 'category' })
      resultForOp.set('op-reject', {
        success: false,
        error: 'Unprocessable entity',
        retryable: false,
        statusCode: 422,
      })

      await service.sync()

      // It must NOT still be queued — replaying it forever is the defect.
      expect(service.queue.getAll()).toHaveLength(0)
      expect(mockQueue.removeBatch).toHaveBeenCalledWith(['op-reject'])
      // @ts-expect-error - accessing private property for testing
      const rejected = service.state.rejectedOperations
      expect(rejected.map((op: AnyOp) => op.id)).toEqual(['op-reject'])
    })

    it.each([400, 404, 409, 422])(
      'removes an operation rejected with the permanent status %i',
      async (statusCode) => {
        await service.queue.add({ id: 'op-x', type: 'update', entityType: 'category' })
        resultForOp.set('op-x', { success: false, retryable: false, statusCode })

        await service.sync()

        expect(service.queue.getAll()).toHaveLength(0)
      }
    )

    it('KEEPS a non-retryable failure that carries NO status code — the transient-fault shape', async () => {
      await service.queue.add({ id: 'op-blip', type: 'update', entityType: 'category' })
      // Exactly what `features/api/client.ts` returns for a 200 envelope with
      // `failedCount > 0`, which the server emits when `applyOperation` catches a
      // dropped connection or a statement timeout. Deleting this was data loss.
      resultForOp.set('op-blip', {
        success: false,
        error: 'Operation failed on server',
        retryable: false,
      })

      await service.sync()

      expect(service.queue.getAll().map((op: AnyOp) => op.id)).toEqual(['op-blip'])
      expect(mockQueue.removeBatch).not.toHaveBeenCalledWith(['op-blip'])
      // @ts-expect-error - accessing private property for testing
      expect(service.state.rejectedOperations).toHaveLength(0)
    })

    it('KEEPS a non-retryable failure whose status is transient-shaped (408), not in the allow-list', async () => {
      await service.queue.add({ id: 'op-timeout', type: 'create', entityType: 'expense' })
      resultForOp.set('op-timeout', { success: false, retryable: false, statusCode: 408 })

      await service.sync()

      expect(service.queue.getAll().map((op: AnyOp) => op.id)).toEqual(['op-timeout'])
    })

    it('KEEPS an auth-blocked (401) operation queued and OPENS the circuit', async () => {
      await service.queue.add({ id: 'op-auth', type: 'create', entityType: 'expense' })
      resultForOp.set('op-auth', {
        success: false,
        error: 'Unauthorized',
        retryable: false,
        statusCode: 401,
      })

      await service.sync()

      // The operation is valid; only the session is not. It must survive to be
      // synced after re-authentication.
      expect(service.queue.getAll().map((op: AnyOp) => op.id)).toEqual(['op-auth'])
      // @ts-expect-error - accessing private property for testing
      expect(service.state.rejectedOperations).toHaveLength(0)
      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(true)
    })

    it('KEEPS a tier-blocked (403) operation queued but does NOT open the circuit', async () => {
      await service.queue.add({ id: 'op-tier', type: 'create', entityType: 'expense' })
      resultForOp.set('op-tier', {
        success: false,
        error: 'Premium feature: server sync requires an active paid subscription',
        retryable: false,
        statusCode: 403,
      })

      await service.sync()

      // The op is valid and so is the session — the PLAN lapsed. Keep the data
      // for a user who may resubscribe...
      expect(service.queue.getAll().map((op: AnyOp) => op.id)).toEqual(['op-tier'])
      // @ts-expect-error - accessing private property for testing
      expect(service.state.rejectedOperations).toHaveLength(0)
      // ...but a cooldown buys nothing here, and opening the circuit every sync
      // is the exact "suppresses retries for every OTHER entity" defect this
      // split exists to remove. This is the assertion that fails if 403 is
      // folded back in with 401.
      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(false)
      // @ts-expect-error - accessing private property for testing
      expect(service.state.lastError).toContain('not included in your current plan')
    })
  })

  describe('circuit and retry are independent decisions', () => {
    it('schedules the retry even when an auth failure opened the circuit in the same batch, and RECOVERS the op', async () => {
      vi.useFakeTimers()
      await service.queue.add({ id: 'op-auth', type: 'create', entityType: 'expense' })
      await service.queue.add({ id: 'op-transient', type: 'create', entityType: 'incomeSource' })
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

      // The circuit opened because of the auth failure...
      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(true)
      // ...and the retryable op was removed from the queue and parked in memory.
      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations.map((op: AnyOp) => op.id)).toEqual(['op-transient'])

      // The defect: with `else if`, NO timer existed, so nothing would ever put
      // `op-transient` back.
      // @ts-expect-error - accessing private property for testing
      expect(service.retryTimeout).toBeTruthy()

      // ⚠️ A pending timer is not the behaviour under test — RECOVERY is. A timer
      // that fires and does nothing would satisfy the assertion above, so drive
      // it and observe the operation actually coming back.
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

    it('DEFERS a retry past the circuit cooldown and re-queues the operation', async () => {
      vi.useFakeTimers()
      await service.queue.add({ id: 'op-transient', type: 'create', entityType: 'incomeSource' })
      resultForOp.set('op-transient', { success: false, retryable: true })

      // Open the circuit first, so scheduleRetry() takes the open-circuit path.
      // @ts-expect-error - accessing private property for testing
      service.openCircuit()

      await service.sync()

      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations.map((op: AnyOp) => op.id)).toEqual(['op-transient'])
      // A deferred timer must exist: returning early here stranded the operation
      // in memory, where only `runRetry` could have recovered it.
      // @ts-expect-error - accessing private property for testing
      expect(service.retryTimeout).toBeTruthy()

      // Let the cooldown elapse. ⚠️ Assert the OPERATION is recovered, not just
      // that `circuitBroken` flipped — the handler assigns that two statements
      // before calling `runRetry`, so it would still be false if `runRetry` threw
      // or re-queued nothing.
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
      await service.queue.add({ id: 'op-transient', type: 'create', entityType: 'incomeSource' })
      resultForOp.set('op-transient', { success: false, retryable: true })

      // @ts-expect-error - accessing private property for testing
      service.openCircuit()
      await service.sync()
      // @ts-expect-error - accessing private property for testing
      expect(service.retryTimeout).toBeTruthy()

      // A later failure extends the cooldown WITHOUT re-entering scheduleRetry(),
      // so the armed timer is never cleared and still fires on the old schedule.
      await vi.advanceTimersByTimeAsync(29_000)
      // @ts-expect-error - accessing private property for testing
      service.openCircuit()

      // The original timer fires here. It must re-defer rather than force the
      // circuit closed 29s into a freshly extended 30s cooldown.
      await vi.advanceTimersByTimeAsync(10_000)

      // @ts-expect-error - accessing private property for testing
      expect(service.circuitBroken).toBe(true)
      // @ts-expect-error - accessing private property for testing
      expect(service.retryTimeout).toBeTruthy()
    })
  })
})
