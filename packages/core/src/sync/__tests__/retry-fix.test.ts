/**
 * Tests for the retry logic fix.
 *
 * ⚠️ Story 75.3 INVERTED this file. It used to assert that failed operations
 * are REMOVED from the queue before `runRetry` re-queues them, which was its
 * guard against duplicate ids. That removal was defect A3: the op lived only in
 * memory until the retry, and past the retry budget, or across a reload, it was
 * lost. Retryable ops now never leave the queue and `runRetry` never re-adds, so
 * the duplicate-id property is kept by a different mechanism. Both properties
 * are pinned below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, SynchronizationService } from '../synchronization'

describe('SynchronizationService Retry Logic Fix', () => {
  let service: SynchronizationService
  let mockQueue: any
  let mockProcessOperation: any

  beforeEach(() => {
    // Mock queue to track operations
    const operations: any[] = []
    mockQueue = {
      add: vi.fn(async (op: any) => {
        operations.push(op)
      }),
      getAll: vi.fn(() => [...operations]),
      // `runRetry` reads it since story 75.3 (it syncs only if anything is queued).
      getCount: vi.fn(() => operations.length),
      // sync() pulls the batch to process via getReadyOperations; the mock must
      // implement it or sync() throws before any operation is processed.
      getReadyOperations: vi.fn((_batchSize?: number) => [...operations]),
      removeBatch: vi.fn(async (ids: string[]) => {
        const indices = operations
          .map((op: any, i: number) => (ids.includes(op.id) ? i : -1))
          .filter((i) => i !== -1)
        for (const i of indices.reverse()) {
          operations.splice(i, 1)
        }
      }),
    }

    // Mock processOperation that always fails
    mockProcessOperation = vi.fn(async (_op: any) => ({
      success: false,
      conflict: false,
    }))

    // Create service with mocked dependencies
    service = new SynchronizationService('user-123', {
      autoSync: false,
      processOperation: mockProcessOperation,
    })

    // Replace the queue with our mock
    // @ts-expect-error - accessing private property for testing
    service.queue = mockQueue
    // The node test environment has no `navigator`, so the service initializes
    // offline and sync() would early-return. Force online to exercise the retry path.
    // @ts-expect-error - accessing private property for testing
    service.state.isOnline = true
  })

  afterEach(() => {
    // Clear the pending retry timer scheduled by sync() on failure.
    service.destroy()
  })

  describe('Failed operations handling', () => {
    it('keeps failed operations IN the queue, and records them as a view', async () => {
      await service.queue.add({ id: 'op1', type: 'create', entityType: 'incomeSource' })
      await service.queue.add({ id: 'op2', type: 'update', entityType: 'expense' })

      // Trigger sync which will fail
      await service.sync()

      // Positive anchor: both really were sent.
      expect(mockProcessOperation).toHaveBeenCalledTimes(2)
      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations.map((op: any) => op.id)).toEqual(['op1', 'op2'])
      expect(mockQueue.removeBatch).not.toHaveBeenCalled()
      // @ts-expect-error - accessing private property for testing
      expect(service.queue.getAll().map((op: any) => op.id)).toEqual(['op1', 'op2'])
    })

    it('should not create duplicate operation IDs when retrying', async () => {
      vi.useFakeTimers()
      try {
        const op = {
          id: 'op-unique-123',
          type: 'create',
          entityType: 'incomeSource',
          userId: 'user-123',
        }
        await service.queue.add(op)

        await service.sync()
        // Let the retry timer fire (this suite uses the default delay); the retry fails too.
        await vi.advanceTimersByTimeAsync(DEFAULT_CONFIG.retryDelay)

        // Positive anchor: the retry really ran.
        expect(mockProcessOperation).toHaveBeenCalledTimes(2)
        // Still exactly one copy: `runRetry` must not re-add an op that never left.
        expect(mockQueue.add).toHaveBeenCalledTimes(1)
        // @ts-expect-error - accessing private property for testing
        expect(service.queue.getAll()).toEqual([op])
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
