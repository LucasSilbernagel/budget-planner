/**
 * Tests for the retry logic fix
 * Verifies that failed operations are removed from queue before re-queuing
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizationService } from '../synchronization'

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
    it('should remove failed operations from queue before re-queuing', async () => {
      // Add some operations to the queue
      await service.queue.add({ id: 'op1', type: 'create', entityType: 'incomeSource' })
      await service.queue.add({ id: 'op2', type: 'update', entityType: 'expense' })

      // Trigger sync which will fail
      await service.sync()

      // Check that failed operations were moved to state
      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations.length).toBe(2)

      // Check that queue.removeBatch was called with failed operation IDs
      expect(mockQueue.removeBatch).toHaveBeenCalled()

      // The queue should now be empty (operations removed)
      // @ts-expect-error - accessing private property for testing
      expect(service.queue.getAll().length).toBe(0)
    })

    it('should not create duplicate operation IDs when retrying', async () => {
      // This test verifies the fix for: "scheduleRetry re-queues failed operations creating duplicate operation IDs"

      // Add an operation
      const op = {
        id: 'op-unique-123',
        type: 'create',
        entityType: 'incomeSource',
        userId: 'user-123',
      }
      await service.queue.add(op)

      // Trigger sync which will fail
      await service.sync()

      // Check queue.removeBatch was called
      expect(mockQueue.removeBatch).toHaveBeenCalledWith(['op-unique-123'])

      // The operation should be in failedOperations
      // @ts-expect-error - accessing private property for testing
      expect(service.state.failedOperations).toContainEqual(op)

      // Queue should be empty
      // @ts-expect-error - accessing private property for testing
      expect(service.queue.getAll().length).toBe(0)
    })
  })
})
