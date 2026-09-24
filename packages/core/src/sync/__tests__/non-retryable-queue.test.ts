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
 * The fix splits non-retryable failures by whether the OPERATION or the SESSION
 * is at fault, because the two need opposite handling:
 *   - 401/403 auth-blocked → the op is VALID; keep it queued for after re-auth.
 *   - anything else        → the server will never accept it; drop it from the
 *                            queue and record it in `state.rejectedOperations`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizationService } from '../synchronization'

type AnyOp = { id: string; type: string; entityType: string }

describe('Non-retryable sync failures', () => {
  let service: SynchronizationService
  let mockQueue: any
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
    service = new SynchronizationService('user-123', {
      autoSync: false,
      processOperation: vi.fn(async (op: AnyOp) => resultForOp.get(op.id) ?? { success: true }),
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

  it('removes a permanently REJECTED operation from the queue and records it', async () => {
    await service.queue.add({ id: 'op-reject', type: 'update', entityType: 'category' })
    // The shape the server returns for "Entity not found" (see categoryStore):
    // a 200 envelope reporting failedCount, so there is no statusCode at all.
    resultForOp.set('op-reject', {
      success: false,
      error: 'Entity not found',
      retryable: false,
    })

    await service.sync()

    // It must NOT still be queued — replaying it forever is the defect.
    expect(service.queue.getAll()).toHaveLength(0)
    expect(mockQueue.removeBatch).toHaveBeenCalledWith(['op-reject'])
    // ...and it must be observable rather than silently vanished.
    // @ts-expect-error - accessing private property for testing
    const rejected = service.state.rejectedOperations
    expect(rejected.map((op: AnyOp) => op.id)).toEqual(['op-reject'])
  })

  it('KEEPS an auth-blocked (401) operation queued — dropping it would be data loss', async () => {
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
    // @ts-expect-error - accessing private property for testing
    expect(service.queue.getAll().map((op: AnyOp) => op.id)).toEqual(['op-auth'])
    // @ts-expect-error - accessing private property for testing
    expect(service.state.rejectedOperations).toHaveLength(0)
    // 403 takes the same path.
    // @ts-expect-error - accessing private property for testing
    expect(service.circuitBroken).toBe(true)
  })

  it('schedules the retry even when an auth failure opened the circuit in the same batch', async () => {
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
    // `op-transient` back. A timer must be pending.
    // @ts-expect-error - accessing private property for testing
    expect(service.retryTimeout).not.toBeNull()
    // @ts-expect-error - accessing private property for testing
    expect(service.retryTimeout).not.toBeUndefined()
  })

  it('DEFERS a retry past the circuit cooldown instead of dropping it', async () => {
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

    // Let the cooldown elapse; the deferred handler closes the circuit and
    // re-queues the operation.
    resultForOp.set('op-transient', { success: true })
    await vi.advanceTimersByTimeAsync(70_000)

    // @ts-expect-error - accessing private property for testing
    expect(service.circuitBroken).toBe(false)
  })
})
