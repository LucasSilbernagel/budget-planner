// removeProfile queues `delete X` then `promote Y`. Sending Y before X lands lets the
// server's promotion bump X, and the next pull then drops the delete as stale.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { SyncQueue } from '../queue'
import { SynchronizationService } from '../synchronization'
import type {
	ProcessOperationFn,
	ProcessOperationResult,
	SyncOperation,
	SyncQueueStorage,
	SyncState,
} from '../types'

const USER = '11111111-1111-4111-8111-111111111111'
const X = '44444444-4444-4444-8444-444444444444'
const Y = '55555555-5555-4555-8555-555555555555'

type Internals = { queue: SyncQueue; state: SyncState }
const internals = (service: SynchronizationService) => service as unknown as Internals

function memoryStorage(): SyncQueueStorage {
	const stored = new Map<string, SyncOperation[]>()
	return {
		async loadQueue(userId) {
			return [...(stored.get(userId) ?? [])]
		},
		async saveQueue(userId, queue) {
			stored.set(userId, [...queue])
		},
		async clearQueue(userId) {
			stored.delete(userId)
		},
	}
}

const deleteX: SyncOperation = {
	id: 'delete-X',
	type: 'delete',
	entityType: 'userProfile',
	entityId: X,
	data: {},
	timestamp: 1_000,
	deviceId: 'device-b',
	userId: USER,
	baseVersion: 500,
}

function promoteY(withLink = true): SyncOperation {
	return {
		id: 'promote-Y',
		type: 'update',
		entityType: 'userProfile',
		entityId: Y,
		data: { isDefault: true },
		timestamp: 1_001,
		deviceId: 'device-b',
		userId: USER,
		baseVersion: 500,
		...(withLink ? { dependsOn: { entityType: 'userProfile', entityId: X, type: 'delete' } } : {}),
	}
}

describe('push honours dependsOn', () => {
	let queue: SyncQueue
	let service: SynchronizationService
	let results: Map<string, ProcessOperationResult>
	let processOperation: Mock<Parameters<ProcessOperationFn>, ReturnType<ProcessOperationFn>>
	let rejected: string[][]

	const queuedIds = () => queue.getAll().map((o) => o.id)
	const sentIds = () => processOperation.mock.calls.map(([o]) => o.id)

	beforeEach(async () => {
		results = new Map()
		processOperation = vi.fn(async (o: SyncOperation) => results.get(o.id) ?? { success: true })
		service = new SynchronizationService(USER, {
			autoSync: false,
			batchSize: 50,
			processOperation,
		})
		queue = new SyncQueue(USER, memoryStorage())
		await queue.initialize()
		internals(service).queue = queue
		internals(service).state.isOnline = true
		rejected = []
		service.onOperationsRejected((ops) => rejected.push(ops.map((o) => o.id)))
	})

	afterEach(() => {
		service.destroy()
		vi.restoreAllMocks()
	})

	it('does NOT send the promotion while its delete failed and is still queued', async () => {
		await queue.add(deleteX)
		await queue.add(promoteY())
		results.set('delete-X', { success: false, retryable: true, error: 'HTTP 503' })

		await service.sync()

		expect(sentIds()).toEqual(['delete-X'])
		expect(queuedIds()).toEqual(['delete-X', 'promote-Y'])
	})

	it('sends the promotion in the same sync once its delete has landed', async () => {
		await queue.add(deleteX)
		await queue.add(promoteY())

		await service.sync()

		expect(sentIds()).toEqual(['delete-X', 'promote-Y'])
		expect(queuedIds()).toEqual([])
	})

	it('sends the promotion once the delete lands in a LATER sync', async () => {
		await queue.add(deleteX)
		await queue.add(promoteY())
		results.set('delete-X', { success: false, retryable: true, error: 'HTTP 503' })
		await service.sync()
		results.delete('delete-X')

		await service.sync()

		expect(sentIds()).toEqual(['delete-X', 'delete-X', 'promote-Y'])
		expect(queuedIds()).toEqual([])
	})

	it('a PERMANENTLY refused delete takes its promotion with it, reported in the same call', async () => {
		await queue.add(deleteX)
		await queue.add(promoteY())
		results.set('delete-X', { success: false, retryable: false, statusCode: 422 })

		await service.sync()

		expect(sentIds()).toEqual(['delete-X'])
		expect(queuedIds()).toEqual([])
		expect(rejected).toEqual([['delete-X', 'promote-Y']])
	})

	it('an op without dependsOn is sent exactly as before', async () => {
		await queue.add(deleteX)
		await queue.add(promoteY(false))
		results.set('delete-X', { success: false, retryable: true, error: 'HTTP 503' })

		await service.sync()

		expect(sentIds()).toEqual(['delete-X', 'promote-Y'])
	})

	it('a dependsOn naming an op that is NOT queued does not hold anything back', async () => {
		await queue.add(promoteY())

		await service.sync()

		expect(sentIds()).toEqual(['promote-Y'])
		expect(queuedIds()).toEqual([])
	})
})
