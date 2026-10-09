// The service starts offline in Node, so each test forces `isOnline` and anchors on send
// counts; otherwise "not escalated" would pass vacuously.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { SyncQueue } from '../queue'
import { SynchronizationService } from '../synchronization'
import type {
	FetchServerChangesFn,
	ProcessOperationFn,
	ProcessOperationResult,
	ServerChange,
	SyncOperation,
	SyncQueueStorage,
	SyncState,
} from '../types'

const USER = 'user-79-2'

type Internals = {
	queue: SyncQueue
	state: SyncState
	failureCounts: Map<string, number>
}
const internals = (service: SynchronizationService) => service as unknown as Internals

type TestStorage = SyncQueueStorage & { persistedIds: () => string[] }

function createStorage(): TestStorage {
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

const RETRYABLE: ProcessOperationResult = { success: false, error: 'HTTP 503', retryable: true }
/** The 200 envelope with `failedCount > 0` and no status. */
const UNCLASSIFIED: ProcessOperationResult = {
	success: false,
	error: 'Operation failed on server',
	retryable: false,
}
const AUTH: ProcessOperationResult = { success: false, retryable: false, statusCode: 401 }
const TIER: ProcessOperationResult = { success: false, retryable: false, statusCode: 403 }
const CONFLICT: ProcessOperationResult = { success: false, conflict: true }
const REFUSED: ProcessOperationResult = {
	success: false,
	error: 'refused',
	retryable: false,
	statusCode: 422,
}

describe('escalating an op that keeps failing', () => {
	let storage: TestStorage
	let queue: SyncQueue
	let service: SynchronizationService
	let resultFor: Map<string, ProcessOperationResult>
	let processOperation: Mock<Parameters<ProcessOperationFn>, ReturnType<ProcessOperationFn>>
	let fetchServerChanges: Mock<Parameters<FetchServerChangesFn>, ReturnType<FetchServerChangesFn>>

	const sentCount = (id: string): number =>
		processOperation.mock.calls.filter(([sent]) => sent.id === id).length
	const escalatedIds = (): string[] => service.getState().escalatedOperations.map((o) => o.id)
	const countOf = (id: string): number | undefined => internals(service).failureCounts.get(id)

	/** The clock advances `retryDelay` after each sync, as the fast retry path would. */
	async function failTimes(id: string, n: number, result = UNCLASSIFIED): Promise<void> {
		resultFor.set(id, result)
		for (let i = 0; i < n; i++) {
			await service.sync()
			vi.advanceTimersByTime(1_000)
		}
	}

	beforeEach(async () => {
		vi.useFakeTimers()
		storage = createStorage()
		resultFor = new Map()
		processOperation = vi.fn(
			async (sent: SyncOperation) => resultFor.get(sent.id) ?? { success: true }
		)
		fetchServerChanges = vi.fn(async (_since: number | null): Promise<ServerChange[]> => [])
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

	describe('the threshold is maxRetries + 1 consecutive failed attempts', () => {
		it('a RETRYABLE op, retried by the timer, escalates on its 4th attempt and not before', async () => {
			await queue.add(op('flaky'))
			resultFor.set('flaky', RETRYABLE)

			await service.sync()
			await vi.advanceTimersByTimeAsync(1_000)
			await vi.advanceTimersByTimeAsync(1_000)

			expect(sentCount('flaky')).toBe(3)
			expect(escalatedIds()).toEqual([])

			await vi.advanceTimersByTimeAsync(1_000)

			expect(sentCount('flaky')).toBe(4)
			expect(escalatedIds()).toEqual(['flaky'])
		})

		it('an UNCLASSIFIED op, which no timer retries, escalates on its 4th explicit sync', async () => {
			await queue.add(op('stuck'))

			await failTimes('stuck', 3)
			expect(sentCount('stuck')).toBe(3)
			expect(escalatedIds()).toEqual([])
			// No timer carries an unclassified failure: the count grows only per sync.
			expect(vi.getTimerCount()).toBe(0)

			await failTimes('stuck', 1)
			expect(sentCount('stuck')).toBe(4)
			expect(escalatedIds()).toEqual(['stuck'])
		})

		it('follows a tuned maxRetries', async () => {
			service.updateConfig({ maxRetries: 1 })
			await queue.add(op('stuck'))

			await failTimes('stuck', 1)
			expect(sentCount('stuck')).toBe(1)
			expect(escalatedIds()).toEqual([])
			await failTimes('stuck', 1)

			expect(sentCount('stuck')).toBe(2)
			expect(escalatedIds()).toEqual(['stuck'])
		})

		it.each([
			['401 (auth-blocked)', AUTH],
			['403 (tier-blocked)', TIER],
			['a conflict', CONFLICT],
		])('%s never escalates, and resets the count', async (_label, result) => {
			await queue.add(op('stuck'))

			await failTimes('stuck', 3)
			await failTimes('stuck', 5, result)

			expect(sentCount('stuck')).toBe(8)
			expect(escalatedIds()).toEqual([])
			expect(countOf('stuck')).toBeUndefined()

			// Three more failures are not enough: the count restarted from zero.
			await failTimes('stuck', 3)
			expect(escalatedIds()).toEqual([])
			await failTimes('stuck', 1)
			expect(sentCount('stuck')).toBe(12)
			expect(escalatedIds()).toEqual(['stuck'])
		})

		it('a success before the threshold forgets the count', async () => {
			await queue.add(op('flaky'))

			await failTimes('flaky', 3)
			expect(countOf('flaky')).toBe(3)
			await failTimes('flaky', 1, { success: true })

			expect(sentCount('flaky')).toBe(4)
			expect(queue.getAll()).toEqual([])
			expect(countOf('flaky')).toBeUndefined()
			expect(escalatedIds()).toEqual([])
		})

		it('a permanent refusal forgets the count (the op leaves through 75.1, not through escalation)', async () => {
			await queue.add(op('bad'))

			await failTimes('bad', 3)
			await failTimes('bad', 1, REFUSED)

			expect(sentCount('bad')).toBe(4)
			expect(queue.getAll()).toEqual([])
			expect(countOf('bad')).toBeUndefined()
			expect(escalatedIds()).toEqual([])
		})

		it('an op HELD by dependsOn keeps its count while it is not sent', async () => {
			const promote = op('promote', {
				entityType: 'userProfile',
				entityId: 'profile-Y',
				dependsOn: { entityType: 'userProfile', entityId: 'profile-X', type: 'delete' },
			})
			await queue.add(promote)
			await failTimes('promote', 3)
			expect(countOf('promote')).toBe(3)

			await queue.add(
				op('delete-X', {
					type: 'delete',
					entityType: 'userProfile',
					entityId: 'profile-X',
					timestamp: 1_000,
				})
			)
			await failTimes('delete-X', 1)

			expect(sentCount('delete-X')).toBe(1)
			expect(sentCount('promote')).toBe(3)
			expect(countOf('promote')).toBe(3)

			resultFor.set('delete-X', { success: true })
			await service.sync()

			expect(sentCount('promote')).toBe(4)
			expect(escalatedIds()).toEqual(['promote'])
		})

		it('an op not attempted because the device went offline mid-batch keeps its count', async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 3)

			await queue.add(op('first', { timestamp: 1_000 }))
			processOperation.mockImplementationOnce(async () => {
				internals(service).state.isOnline = false
				return { success: true }
			})
			await service.sync()

			expect(sentCount('first')).toBe(1)
			expect(sentCount('stuck')).toBe(3)
			expect(countOf('stuck')).toBe(3)

			internals(service).state.isOnline = true
			await failTimes('stuck', 1)
			expect(sentCount('stuck')).toBe(4)
			expect(escalatedIds()).toEqual(['stuck'])
		})

		it('counts per op: a healthy neighbour does not escalate with the stuck op', async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 4)
			await queue.add(op('fine'))
			await service.sync()

			expect(sentCount('fine')).toBe(1)
			expect(escalatedIds()).toEqual(['stuck'])
		})
	})

	describe('an escalated op is still queued and persisted', () => {
		it('is in the queue, in storage, and survives a reload', async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 4)
			expect(escalatedIds()).toEqual(['stuck'])

			expect(queue.getAll().map((o) => o.id)).toEqual(['stuck'])
			expect(storage.persistedIds()).toEqual(['stuck'])
			const reloaded = new SyncQueue(USER, storage)
			await reloaded.initialize()
			expect(reloaded.getAll().map((o) => o.id)).toEqual(['stuck'])

			await failTimes('stuck', 1)
			expect(sentCount('stuck')).toBe(5)
			expect(queue.getAll().map((o) => o.id)).toEqual(['stuck'])
		})
	})

	describe('the view drops an op once it leaves the queue', () => {
		it('when a later sync lands it', async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 4)
			expect(escalatedIds()).toEqual(['stuck'])

			const statuses: string[][] = []
			service.onStatusChange((state) => {
				statuses.push(state.escalatedOperations.map((o) => o.id))
			})
			await failTimes('stuck', 1, { success: true })

			expect(sentCount('stuck')).toBe(5)
			expect(escalatedIds()).toEqual([])
			expect(statuses.at(-1)).toEqual([])
			expect(countOf('stuck')).toBeUndefined()
		})

		it('when a pull drops it as having lost last-writer-wins', async () => {
			await queue.add(op('stuck', { timestamp: 5_000 }))
			await failTimes('stuck', 4)
			expect(escalatedIds()).toEqual(['stuck'])

			fetchServerChanges.mockResolvedValueOnce([
				{
					entityType: 'incomeSource',
					entityId: 'entity-stuck',
					data: { id: 'entity-stuck', name: 'server', amount: 10, frequency: 'monthly' },
					updatedAt: 9_000,
					isDeleted: true,
				},
			])
			const statuses: string[][] = []
			service.onStatusChange((state) => {
				statuses.push(state.escalatedOperations.map((o) => o.id))
			})
			await service.pull()

			expect(fetchServerChanges).toHaveBeenCalledTimes(1)
			expect(queue.getAll()).toEqual([])
			expect(escalatedIds()).toEqual([])
			expect(statuses.at(-1)).toEqual([])
			expect(countOf('stuck')).toBeUndefined()
		})

		it('when the queue is emptied outside the service, at the next state refresh', async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 4)
			expect(escalatedIds()).toEqual(['stuck'])

			// The refused-create sweep reaches the raw queue through `getQueue()`.
			await service.getQueue().discardBatch(['stuck'])
			await service.sync()

			expect(sentCount('stuck')).toBe(4)
			expect(escalatedIds()).toEqual([])
			expect(countOf('stuck')).toBeUndefined()
		})
	})

	describe('escalation does not release the pull cursor', () => {
		const suppressedAndOther: ServerChange[] = [
			{
				entityType: 'incomeSource',
				entityId: 'entity-stuck',
				data: { id: 'entity-stuck', name: 'server', amount: 10, frequency: 'monthly' },
				updatedAt: 4_000,
				isDeleted: false,
			},
			{
				entityType: 'incomeSource',
				entityId: 'entity-other',
				data: { id: 'entity-other', name: 'other', amount: 20, frequency: 'monthly' },
				updatedAt: 6_000,
				isDeleted: false,
			},
		]

		it('control: a NON-escalated queued op holds the cursor at the same place', async () => {
			await queue.add(op('stuck', { timestamp: 5_000 }))
			await failTimes('stuck', 1)
			expect(sentCount('stuck')).toBe(1)
			expect(escalatedIds()).toEqual([])

			fetchServerChanges.mockResolvedValue(suppressedAndOther)
			await service.pull()

			expect(fetchServerChanges).toHaveBeenCalledTimes(1)
			expect(service.getState().lastPullTimestamp).toBeNull()
		})

		it('holds the cursor below a change the escalated op suppresses, until the op lands', async () => {
			await queue.add(op('stuck', { timestamp: 5_000 }))
			await failTimes('stuck', 4)
			expect(escalatedIds()).toEqual(['stuck'])

			const changes: ServerChange[] = [
				{
					// Older than the queued edit: the local edit wins, so this is suppressed.
					entityType: 'incomeSource',
					entityId: 'entity-stuck',
					data: { id: 'entity-stuck', name: 'server', amount: 10, frequency: 'monthly' },
					updatedAt: 4_000,
					isDeleted: false,
				},
				{
					entityType: 'incomeSource',
					entityId: 'entity-other',
					data: { id: 'entity-other', name: 'other', amount: 20, frequency: 'monthly' },
					updatedAt: 6_000,
					isDeleted: false,
				},
			]
			fetchServerChanges.mockResolvedValue(changes)

			await service.pull()
			await service.pull()

			expect(fetchServerChanges).toHaveBeenCalledTimes(2)
			expect(service.getState().lastPullTimestamp).toBeNull()
			expect(queue.getAll().map((o) => o.id)).toEqual(['stuck'])

			await failTimes('stuck', 1, { success: true })
			await service.pull()

			expect(fetchServerChanges).toHaveBeenCalledTimes(3)
			expect(service.getState().lastPullTimestamp).toBe(6_000)
		})
	})

	describe('a destroyed service escalates nothing', () => {
		it('does not count a failure that resolves after destroy()', async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 3)
			expect(countOf('stuck')).toBe(3)

			let resolvePush: (result: ProcessOperationResult) => void = () => undefined
			processOperation.mockImplementationOnce(
				() =>
					new Promise<ProcessOperationResult>((resolve) => {
						resolvePush = resolve
					})
			)
			const inFlight = service.sync()
			await vi.waitFor(() => expect(sentCount('stuck')).toBe(4))
			const notified: string[][] = []
			service.onStatusChange((state) => {
				notified.push(state.escalatedOperations.map((o) => o.id))
			})

			service.destroy()
			resolvePush(UNCLASSIFIED)
			const result = await inFlight

			expect(result.error).toBe('Sync service destroyed')
			expect(countOf('stuck')).toBe(3)
			expect(escalatedIds()).toEqual([])
			expect(notified).toEqual([])
		})
	})

	describe('code review 79.2', () => {
		it('TIME FLOOR: four quick attempts inside the floor do not escalate; the next pull after it does', async () => {
			await queue.add(op('blip'))
			resultFor.set('blip', UNCLASSIFIED)
			for (let i = 0; i < 4; i++) {
				await service.sync()
			}
			expect(sentCount('blip')).toBe(4)
			expect(countOf('blip')).toBe(4)
			expect(escalatedIds()).toEqual([])

			const notified: string[][] = []
			service.onStatusChange((state) => {
				notified.push(state.escalatedOperations.map((o) => o.id))
			})
			vi.advanceTimersByTime(3_000)
			await service.pull()

			expect(fetchServerChanges).toHaveBeenCalledTimes(1)
			expect(escalatedIds()).toEqual(['blip'])
			expect(notified.at(-1)).toEqual(['blip'])
		})

		it('TIME FLOOR: a blip that clears inside the floor is never escalated', async () => {
			await queue.add(op('blip'))
			resultFor.set('blip', UNCLASSIFIED)
			for (let i = 0; i < 5; i++) {
				await service.sync()
			}
			resultFor.set('blip', { success: true })
			await service.sync()

			expect(sentCount('blip')).toBe(6)
			expect(queue.getAll()).toEqual([])
			expect(escalatedIds()).toEqual([])
		})

		it('a reset (401) starts a NEW run: its time floor is measured from the new first failure', async () => {
			await queue.add(op('flaky'))
			await failTimes('flaky', 3)
			// A success would take the op out of the queue; a 401 resets it and keeps it.
			await failTimes('flaky', 1, AUTH)
			resultFor.set('flaky', UNCLASSIFIED)
			for (let i = 0; i < 4; i++) {
				await service.sync()
			}
			expect(sentCount('flaky')).toBe(8)
			expect(countOf('flaky')).toBe(4)
			// The earlier run's start time was forgotten, so the floor is not yet met.
			expect(escalatedIds()).toEqual([])
		})

		it('a deleted-profile discard drops the op from the view and notifies', async () => {
			await queue.add(op('stuck', { profileId: 'profile-P' }))
			await failTimes('stuck', 4)
			expect(escalatedIds()).toEqual(['stuck'])
			const notified: string[][] = []
			service.onStatusChange((state) => {
				notified.push(state.escalatedOperations.map((o) => o.id))
			})

			const dropped = await service.discardOperationsForDeletedProfile('profile-P')

			expect(dropped.map((o) => o.id)).toEqual(['stuck'])
			expect(escalatedIds()).toEqual([])
			expect(notified.at(-1)).toEqual([])
			expect(countOf('stuck')).toBeUndefined()
		})

		it("runRetry's early return notifies when the view changed under it", async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 4)
			expect(escalatedIds()).toEqual(['stuck'])
			const stuck = queue.getAll()[0] as SyncOperation
			internals(service).state.failedOperations = [stuck]
			await service.getQueue().discardBatch(['stuck'])
			const notified: string[][] = []
			service.onStatusChange((state) => {
				notified.push(state.escalatedOperations.map((o) => o.id))
			})

			await (service as unknown as { runRetry: () => Promise<void> }).runRetry()

			expect(sentCount('stuck')).toBe(4)
			expect(escalatedIds()).toEqual([])
			expect(notified).toEqual([[]])
		})

		it('a duplicated op id counts once per sync', async () => {
			await queue.add(op('dup'))
			await queue.add(op('dup'))
			resultFor.set('dup', UNCLASSIFIED)

			await service.sync()

			expect(sentCount('dup')).toBe(2)
			expect(countOf('dup')).toBe(1)
		})

		it('a duplicated op id with one copy landed is not counted', async () => {
			await queue.add(op('dup'))
			await queue.add(op('dup'))
			processOperation.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce(UNCLASSIFIED)

			await service.sync()

			expect(sentCount('dup')).toBe(2)
			expect(countOf('dup')).toBeUndefined()
		})

		it('updateConfig(maxRetries) re-derives the view and notifies', async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 4)
			expect(escalatedIds()).toEqual(['stuck'])
			const notified: string[][] = []
			service.onStatusChange((state) => {
				notified.push(state.escalatedOperations.map((o) => o.id))
			})

			service.updateConfig({ maxRetries: 10 })

			expect(sentCount('stuck')).toBe(4)
			expect(escalatedIds()).toEqual([])
			expect(notified).toEqual([[]])
		})

		it('updateConfig of anything else neither refreshes nor notifies', async () => {
			await queue.add(op('stuck'))
			await failTimes('stuck', 4)
			const notified: string[][] = []
			service.onStatusChange((state) => {
				notified.push(state.escalatedOperations.map((o) => o.id))
			})

			service.updateConfig({ profileId: 'profile-Q' })

			expect(sentCount('stuck')).toBe(4)
			expect(escalatedIds()).toEqual(['stuck'])
			expect(notified).toEqual([])
		})
	})
})
