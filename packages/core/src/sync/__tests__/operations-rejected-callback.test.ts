import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizationService } from '../synchronization'
import type { ProcessOperationFn, SyncOperation } from '../types'

type AnyOp = { id: string; type: string; entityType: string; entityId?: string }

describe('onOperationsRejected (story 75.2)', () => {
  let service: SynchronizationService
  let mockQueue: any
  let operations: AnyOp[]
  let resultForOp: Map<string, any>
  let processOperation: Mock<Parameters<ProcessOperationFn>, ReturnType<ProcessOperationFn>>

  function op(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
    return {
      id,
      type: 'update',
      entityType: 'savingsGoal',
      entityId: `row-${id}`,
      data: {},
      timestamp: 5_000,
      deviceId: 'device-test',
      userId: 'user-123',
      ...overrides,
    }
  }

  function refuse(id: string) {
    resultForOp.set(id, { success: false, retryable: false, statusCode: 422 })
  }

  beforeEach(() => {
    operations = []
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
          const o = operations[i]
          if (o && ids.includes(o.id)) operations.splice(i, 1)
        }
      }),
      discardBatch: vi.fn(async (ids: string[]) => {
        const before = operations.length
        for (let i = operations.length - 1; i >= 0; i--) {
          const o = operations[i]
          if (o && ids.includes(o.id)) operations.splice(i, 1)
        }
        return { removed: before - operations.length, persisted: true }
      }),
    }
    resultForOp = new Map()
    processOperation = vi.fn(async (o: SyncOperation) => resultForOp.get(o.id) ?? { success: true })
    service = new SynchronizationService('user-123', {
      autoSync: false,
      // Large enough that the 60-op cap test is one batch.
      batchSize: 100,
      processOperation,
    })
    // @ts-expect-error - accessing private property for testing
    service.queue = mockQueue
    // @ts-expect-error - accessing private property for testing
    service.state.isOnline = true
  })

  afterEach(() => {
    service.destroy()
  })

  it("fires once per sync with THAT sync's refusals, after they have left the queue", async () => {
    const seen: { ids: string[]; queuedAtCall: string[] }[] = []
    service.onOperationsRejected((ops) => {
      seen.push({ ids: ops.map((o) => o.id), queuedAtCall: operations.map((o) => o.id) })
    })
    operations.push(op('bad'), op('good'))
    refuse('bad')

    await service.sync()

    expect(seen).toEqual([{ ids: ['bad'], queuedAtCall: [] }])

    operations.push(op('later'))
    await service.sync()
    expect(seen).toHaveLength(1)
  })

  it("includes a refused create's follow-ups (D1) in the same call", async () => {
    const seen: string[][] = []
    service.onOperationsRejected((ops) => seen.push(ops.map((o) => o.id).sort()))
    operations.push(
      op('create', { type: 'create', entityId: 'g-1' }),
      op('update', { entityId: 'g-1' })
    )
    refuse('create')
    resultForOp.set('update', { success: false, conflict: true })

    await service.sync()

    expect(seen).toEqual([['create', 'update']])
  })

  it('fires for ops whose discard could not be PERSISTED — they have left this session', async () => {
    const callback = vi.fn()
    service.onOperationsRejected(callback)
    operations.push(op('bad'))
    refuse('bad')
    mockQueue.discardBatch.mockImplementationOnce(async (ids: string[]) => {
      for (let i = operations.length - 1; i >= 0; i--) {
        const o = operations[i]
        if (o && ids.includes(o.id)) operations.splice(i, 1)
      }
      return { removed: 1, persisted: false }
    })

    await service.sync()

    expect(processOperation.mock.calls.map(([o]) => o.id)).toEqual(['bad'])
    // Without these the test also passed when `removeBatch` removed the op.
    expect(mockQueue.discardBatch).toHaveBeenCalledWith(['bad'])
    expect(mockQueue.removeBatch).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]?.[0].map((o: AnyOp) => o.id)).toEqual(['bad'])
  })

  it('does NOT fire if the discard itself throws unexpectedly — the op may still be queued', async () => {
    const callback = vi.fn()
    service.onOperationsRejected(callback)
    operations.push(op('bad'))
    refuse('bad')
    mockQueue.discardBatch.mockRejectedValueOnce(new Error('unexpected'))

    await service.sync()

    expect(processOperation.mock.calls.map(([o]) => o.id)).toEqual(['bad'])
    expect(callback).not.toHaveBeenCalled()
  })

  it('does NOT fire for kept-queued classes (401, 403, unclassified) or retryable failures', async () => {
    const callback = vi.fn()
    service.onOperationsRejected(callback)
    operations.push(op('auth'), op('tier'), op('unclassified'), op('retry'))
    resultForOp.set('auth', { success: false, retryable: false, statusCode: 401 })
    resultForOp.set('tier', { success: false, retryable: false, statusCode: 403 })
    resultForOp.set('unclassified', { success: false, retryable: false })
    resultForOp.set('retry', { success: false, retryable: true })

    await service.sync()

    expect(processOperation.mock.calls.map(([o]) => o.id).sort()).toEqual(
      ['auth', 'retry', 'tier', 'unclassified'].sort()
    )
    expect(callback).not.toHaveBeenCalled()
  })

  it('a throwing subscriber does not stop the others or break the sync', async () => {
    const second = vi.fn()
    service.onOperationsRejected(() => {
      throw new Error('subscriber bug')
    })
    service.onOperationsRejected(second)
    operations.push(op('bad'))
    refuse('bad')

    const result = await service.sync()

    expect(second).toHaveBeenCalledTimes(1)
    expect(result).toBeDefined()
    expect(operations).toHaveLength(0)
  })

  it('unsubscribe and destroy() both stop delivery', async () => {
    const unsubscribed = vi.fn()
    const off = service.onOperationsRejected(unsubscribed)
    off()
    operations.push(op('bad'))
    refuse('bad')
    await service.sync()
    expect(unsubscribed).not.toHaveBeenCalled()

    // A refusal landing after `destroy()` reaches no subscriber and stays queued for the
    // next session.
    const afterDestroy = vi.fn()
    service.onOperationsRejected(afterDestroy)
    operations.push(op('bad-2'))
    let release: (result: Awaited<ReturnType<ProcessOperationFn>>) => void = () => {}
    processOperation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const inFlight = service.sync()
    await vi.waitFor(() =>
      expect(processOperation.mock.calls.map(([o]) => o.id)).toContain('bad-2')
    )
    service.destroy()
    release({ success: false, retryable: false, statusCode: 422 })
    await inFlight
    expect(afterDestroy).not.toHaveBeenCalled()
    expect(operations.map((o) => o.id)).toContain('bad-2')
  })

  it('state.rejectedOperations is capped at the 50 most recent, not grown for ever', async () => {
    for (let i = 0; i < 60; i++) {
      operations.push(op(`bad-${i}`))
      refuse(`bad-${i}`)
    }

    await service.sync()

    // @ts-expect-error - accessing private property for testing
    const recorded: AnyOp[] = service.state.rejectedOperations
    expect(recorded).toHaveLength(50)
    expect(recorded[0]?.id).toBe('bad-10')
    expect(recorded[49]?.id).toBe('bad-59')
  })
})
