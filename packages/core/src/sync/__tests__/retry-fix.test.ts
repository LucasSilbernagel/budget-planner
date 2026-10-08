import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, SynchronizationService } from '../synchronization'
import type { SyncOperation } from '../types'

function op(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
	return {
		id,
		type: 'update',
		entityType: 'incomeSource',
		entityId: `entity-${id}`,
		data: {},
		timestamp: 5_000,
		deviceId: 'device-test',
		userId: 'user-123',
		...overrides,
	}
}

describe('SynchronizationService Retry Logic Fix', () => {
	let service: SynchronizationService
	let mockQueue: any
	let mockProcessOperation: any

	beforeEach(() => {
		const operations: any[] = []
		mockQueue = {
			add: vi.fn(async (o: SyncOperation) => {
				operations.push(o)
			}),
			close: vi.fn(),
			getAll: vi.fn(() => [...operations]),
			// `runRetry` syncs only if anything is queued.
			getCount: vi.fn(() => operations.length),
			// sync() takes its batch from getReadyOperations, so the mock must implement it.
			getReadyOperations: vi.fn((_batchSize?: number) => [...operations]),
			removeBatch: vi.fn(async (ids: string[]) => {
				const indices = operations
					.map((o: SyncOperation, i: number) => (ids.includes(o.id) ? i : -1))
					.filter((i) => i !== -1)
				for (const i of indices.reverse()) {
					operations.splice(i, 1)
				}
			}),
		}

		mockProcessOperation = vi.fn(async (_op: any) => ({
			success: false,
			conflict: false,
		}))

		service = new SynchronizationService('user-123', {
			autoSync: false,
			processOperation: mockProcessOperation,
		})

		// @ts-expect-error - accessing private property for testing
		service.queue = mockQueue
		// Node has no `navigator`, so the service starts offline; force online.
		// @ts-expect-error - accessing private property for testing
		service.state.isOnline = true
	})

	afterEach(() => {
		service.destroy()
	})

	describe('Failed operations handling', () => {
		it('keeps failed operations IN the queue, and records them as a view', async () => {
			await service.getQueue().add(op('op1', { type: 'create', entityType: 'incomeSource' }))
			await service.getQueue().add(op('op2', { type: 'update', entityType: 'expense' }))

			await service.sync()

			expect(mockProcessOperation).toHaveBeenCalledTimes(2)
			// @ts-expect-error - accessing private property for testing
			expect(service.state.failedOperations.map((o) => o.id)).toEqual(['op1', 'op2'])
			expect(mockQueue.removeBatch).not.toHaveBeenCalled()
			expect(
				service
					.getQueue()
					.getAll()
					.map((o) => o.id)
			).toEqual(['op1', 'op2'])
		})

		it('should not create duplicate operation IDs when retrying', async () => {
			vi.useFakeTimers()
			try {
				const unique = op('op-unique-123', { type: 'create', entityType: 'incomeSource' })
				await service.getQueue().add(unique)

				await service.sync()
				await vi.advanceTimersByTimeAsync(DEFAULT_CONFIG.retryDelay)

				expect(mockProcessOperation).toHaveBeenCalledTimes(2)
				// `runRetry` must not re-add an op that never left the queue.
				expect(mockQueue.add).toHaveBeenCalledTimes(1)
				expect(service.getQueue().getAll()).toEqual([unique])
			} finally {
				vi.useRealTimers()
			}
		})
	})
})
