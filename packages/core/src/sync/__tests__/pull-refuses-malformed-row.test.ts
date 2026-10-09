// Each "stays queued" assertion has a positive anchor, because the local-wins branch also
// keeps ops queued.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { SyncQueue } from '../queue'
import { SynchronizationService } from '../synchronization'
import type {
	ConflictResult,
	RefusedServerChange,
	ServerChange,
	SyncOperation,
	SyncQueueStorage,
	SyncState,
} from '../types'

const USER = '11111111-1111-4111-8111-111111111111'
const PROFILE = '22222222-2222-4222-8222-222222222222'
const INCOME_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const INCOME_Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ISO = '2026-09-01T00:00:00.000Z'

type Internals = { queue: SyncQueue; state: SyncState }
const internals = (service: SynchronizationService) => service as unknown as Internals

function createStorage(): SyncQueueStorage & { persistedIds: () => string[] } {
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
		persistedIds: () => (stored.get(USER) ?? []).map((op) => op.id),
	}
}

function localUpdate(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
	return {
		id,
		type: 'update',
		entityType: 'incomeSource',
		entityId: INCOME_X,
		data: { name: 'Salary (edited here)', amount: 610_000 },
		timestamp: 1_000,
		deviceId: 'device-test',
		userId: USER,
		...overrides,
	}
}

/** Every field valid unless `data` overrides it, so the override is the only reason to refuse. */
function incomeChange(
	data: Record<string, unknown> = {},
	overrides: Partial<ServerChange> = {}
): ServerChange {
	const entityId = overrides.entityId ?? INCOME_X
	return {
		entityType: 'incomeSource',
		entityId,
		data: {
			id: entityId,
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
			...data,
		},
		updatedAt: 2_000,
		isDeleted: false,
		...overrides,
	}
}

describe('pull() refuses a malformed server row before LWW can drop the local edit', () => {
	let storage: ReturnType<typeof createStorage>
	let queue: SyncQueue
	let service: SynchronizationService
	let fetchServerChanges: Mock<[since: number | null], Promise<ServerChange[]>>
	let conflicts: ConflictResult[]
	let pulled: ServerChange[][]
	let refusedCalls: RefusedServerChange[][]

	const queuedIds = (): string[] => queue.getAll().map((op) => op.id)

	beforeEach(async () => {
		vi.useFakeTimers()
		storage = createStorage()
		fetchServerChanges = vi.fn(async (_since: number | null) => [] as ServerChange[])
		service = new SynchronizationService(USER, {
			autoSync: false,
			processOperation: async () => ({ success: true }),
			fetchServerChanges,
		})
		queue = new SyncQueue(USER, storage)
		await queue.initialize()
		internals(service).queue = queue
		conflicts = []
		pulled = []
		refusedCalls = []
		service.onConflict((conflict) => conflicts.push(conflict))
		service.onChangesPulled((changes) => pulled.push(changes))
		service.onServerChangesRefused((refused) => refusedCalls.push(refused))
	})

	afterEach(() => {
		service.destroy()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('the recorded repro', () => {
		it('keeps the local edit queued when a STRING amount loses it LWW', async () => {
			await queue.add(localUpdate('local-x'))
			fetchServerChanges.mockResolvedValueOnce([incomeChange({ amount: '500000' })])

			const result = await service.pull()

			expect(fetchServerChanges).toHaveBeenCalledTimes(1)
			expect(result.success).toBe(true)
			expect(result.lastPullTimestamp).toBe(2_000)

			const expected: RefusedServerChange = {
				entityType: 'incomeSource',
				entityId: INCOME_X,
				fields: ['amount:invalid_type'],
			}
			expect(result.refused).toEqual([expected])
			expect(refusedCalls).toEqual([[expected]])

			expect(queuedIds()).toEqual(['local-x'])
			expect(storage.persistedIds()).toEqual(['local-x'])
			// Via the service's own queue: ops are added to the injected queue directly, so
			// `state.pendingOperations` is never refreshed.
			expect(
				service
					.getQueue()
					.getAll()
					.map((op) => op.id)
			).toEqual(['local-x'])

			expect(conflicts).toEqual([])
			expect(service.getState().conflictOperations).toEqual([])
			expect(result.conflicts).toEqual([])

			expect(result.applied).toEqual([])
			expect(result.changesPulledCount).toBe(0)
			expect(pulled).toEqual([])
		})

		it('CONTROL: the same setup with a VALID amount still drops the local edit (server wins)', async () => {
			await queue.add(localUpdate('local-x'))
			const valid = incomeChange({ amount: 500_000 })
			fetchServerChanges.mockResolvedValueOnce([valid])

			const result = await service.pull()

			expect(result.lastPullTimestamp).toBe(2_000)
			expect(result.refused).toEqual([])
			expect(refusedCalls).toEqual([])
			expect(queuedIds()).toEqual([])
			expect(storage.persistedIds()).toEqual([])
			expect(conflicts).toHaveLength(1)
			expect(service.getState().conflictOperations.map((op) => op.id)).toEqual(['local-x'])
			expect(result.applied).toEqual([valid])
			expect(pulled).toEqual([[valid]])
		})

		it('keeps EVERY queued op for the entity, not just the newest', async () => {
			await queue.add(localUpdate('older', { type: 'create', timestamp: 500 }))
			await queue.add(localUpdate('newer', { timestamp: 1_000 }))
			fetchServerChanges.mockResolvedValueOnce([incomeChange({ amount: '500000' })])

			const result = await service.pull()

			expect(result.refused.map((r) => r.entityId)).toEqual([INCOME_X])
			expect(queuedIds()).toEqual(['older', 'newer'])
			expect(storage.persistedIds()).toEqual(['older', 'newer'])
		})

		it('keeps the local edit when the server wins by baseVersion, not by wall clock', async () => {
			// Newer wall clock, but based on server v1000: a change at 2000 is concurrent.
			await queue.add(localUpdate('local-x', { timestamp: 9_000, baseVersion: 1_000 }))
			fetchServerChanges.mockResolvedValueOnce([incomeChange({ frequency: 'fortnightly' })])

			const result = await service.pull()

			expect(result.refused).toEqual([
				{
					entityType: 'incomeSource',
					entityId: INCOME_X,
					fields: ['frequency:invalid_enum_value'],
				},
			])
			expect(queuedIds()).toEqual(['local-x'])
			expect(conflicts).toEqual([])
		})
	})

	describe('cursor and suppression semantics', () => {
		it('ADVANCES the cursor past a refused row with no queued op (66.2 decision)', async () => {
			fetchServerChanges.mockResolvedValueOnce([incomeChange({ amount: '500000' })])

			const result = await service.pull()

			expect(result.refused.map((r) => r.entityId)).toEqual([INCOME_X])
			expect(result.lastPullTimestamp).toBe(2_000)
			expect(service.getState().lastPullTimestamp).toBe(2_000)
			expect(pulled).toEqual([])

			fetchServerChanges.mockResolvedValueOnce([])
			await service.pull()
			expect(fetchServerChanges).toHaveBeenLastCalledWith(2_000)
		})

		it('a malformed row that LOSES to a local edit is still a conflict, with the cursor held', async () => {
			// Local newer (5000) than the server row (2000): suppressed, never validated.
			await queue.add(localUpdate('local-x', { timestamp: 5_000 }))
			const malformed = incomeChange({ amount: '500000' })
			fetchServerChanges.mockResolvedValueOnce([malformed])

			const result = await service.pull()

			expect(fetchServerChanges).toHaveBeenCalledTimes(1)
			expect(result.conflicts).toEqual([malformed])
			expect(result.refused).toEqual([])
			expect(refusedCalls).toEqual([])
			expect(result.lastPullTimestamp).toBeNull()
			expect(queuedIds()).toEqual(['local-x'])
			expect(conflicts).toHaveLength(1)
		})

		it('a server-winning TOMBSTONE with a malformed payload still drops the ops and applies', async () => {
			await queue.add(localUpdate('local-x'))
			const tombstone = incomeChange({ amount: '500000' }, { isDeleted: true })
			fetchServerChanges.mockResolvedValueOnce([tombstone])

			const result = await service.pull()

			expect(result.refused).toEqual([])
			expect(result.applied).toEqual([tombstone])
			expect(queuedIds()).toEqual([])
			expect(conflicts).toHaveLength(1)
		})

		it('one refused row does not block a valid row in the same pull', async () => {
			const valid = incomeChange({}, { entityId: INCOME_Y, updatedAt: 3_000 })
			fetchServerChanges.mockResolvedValueOnce([incomeChange({ amount: '500000' }), valid])

			const result = await service.pull()

			expect(result.refused.map((r) => r.entityId)).toEqual([INCOME_X])
			expect(result.applied).toEqual([valid])
			expect(result.changesPulledCount).toBe(1)
			expect(pulled).toEqual([[valid]])
			expect(result.lastPullTimestamp).toBe(3_000)
		})
	})

	describe('the verdict', () => {
		it('passes the ORIGINAL change through, not the parse output (which strips undeclared keys)', async () => {
			const valid = incomeChange()
			fetchServerChanges.mockResolvedValueOnce([valid])

			const result = await service.pull()

			expect(result.applied[0]).toBe(valid)
			expect(result.applied[0]?.data['profileId']).toBe(PROFILE)
			expect(result.applied[0]?.data['sortOrder']).toBe(0)
		})

		it('passes an unknown (newer-server) entity type through unvalidated', async () => {
			const future = {
				...incomeChange(),
				entityType: 'somethingNew',
			} as unknown as ServerChange
			fetchServerChanges.mockResolvedValueOnce([future])

			const result = await service.pull()

			expect(result.refused).toEqual([])
			expect(result.applied).toEqual([future])
		})

		it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
			'an entityType named %s (an Object.prototype key) passes through instead of crashing the pull',
			async (entityType) => {
				// A bare `SERVER_ROW_SCHEMAS[entityType]` lookup finds inherited functions, and `.safeParse`
				// would throw inside the LWW loop.
				const hostile = { ...incomeChange(), entityType } as unknown as ServerChange
				fetchServerChanges.mockResolvedValueOnce([hostile])

				const result = await service.pull()

				expect(result.success).toBe(true)
				expect(result.refused).toEqual([])
				expect(result.applied).toEqual([hostile])
				expect(result.lastPullTimestamp).toBe(2_000)
			}
		)

		it('reports field paths and codes, never the refused value', async () => {
			fetchServerChanges.mockResolvedValueOnce([incomeChange({ amount: '500000' })])

			const result = await service.pull()

			expect(result.refused).toHaveLength(1)
			expect(JSON.stringify(result.refused)).not.toContain('500000')
			expect(JSON.stringify(refusedCalls)).not.toContain('500000')
		})

		it('reports a missing root-level shape as (root)', async () => {
			fetchServerChanges.mockResolvedValueOnce([
				incomeChange({}, { data: 'not an object' as unknown as Record<string, unknown> }),
			])

			const result = await service.pull()

			expect(result.refused).toEqual([
				{ entityType: 'incomeSource', entityId: INCOME_X, fields: ['(root):invalid_type'] },
			])
		})
	})

	describe('onServerChangesRefused', () => {
		it('is not called for a pull in which every row is valid', async () => {
			fetchServerChanges.mockResolvedValueOnce([incomeChange()])
			const result = await service.pull()
			expect(result.applied).toHaveLength(1)
			expect(refusedCalls).toEqual([])
		})

		it('a throwing callback does not stop the others or the pull', async () => {
			const after: RefusedServerChange[][] = []
			service.onServerChangesRefused(() => {
				throw new Error('boom')
			})
			service.onServerChangesRefused((refused) => after.push(refused))
			fetchServerChanges.mockResolvedValueOnce([incomeChange({ amount: '500000' })])

			const result = await service.pull()

			expect(result.success).toBe(true)
			expect(refusedCalls).toHaveLength(1)
			expect(after).toHaveLength(1)
		})

		it('unsubscribes, and destroy() clears every subscriber', async () => {
			const late: RefusedServerChange[][] = []
			const unsubscribe = service.onServerChangesRefused((refused) => late.push(refused))
			unsubscribe()
			fetchServerChanges.mockResolvedValueOnce([incomeChange({ amount: '500000' })])
			await service.pull()
			expect(refusedCalls).toHaveLength(1)
			expect(late).toEqual([])

			// Holds a pull in flight across the teardown: the fetch happened, and its malformed row
			// reaches no subscriber.
			let release: (changes: ServerChange[]) => void = () => {}
			fetchServerChanges.mockImplementationOnce(
				() =>
					new Promise<ServerChange[]>((resolve) => {
						release = resolve
					})
			)
			const inFlight = service.pull()
			await vi.waitFor(() => expect(fetchServerChanges).toHaveBeenCalledTimes(2))
			service.destroy()
			release([incomeChange({ amount: '600000' })])
			await inFlight
			expect(refusedCalls).toHaveLength(1)
		})

		it('a transport failure reports refused: []', async () => {
			fetchServerChanges.mockRejectedValueOnce(new Error('offline'))
			const result = await service.pull()
			expect(result.success).toBe(false)
			expect(result.refused).toEqual([])
		})
	})
})
