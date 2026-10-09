// A lost delete drops the promotion that depends on it; a lost promotion leaves the delete
// queued, since the delete is the user's intent.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { SyncQueue } from '../queue'
import { SynchronizationService } from '../synchronization'
import type { ServerChange, SyncOperation, SyncQueueStorage, SyncState } from '../types'

const USER = '11111111-1111-4111-8111-111111111111'
const P = '22222222-2222-4222-8222-222222222222'
const Q = '33333333-3333-4333-8333-333333333333'
const X = '44444444-4444-4444-8444-444444444444'
const Y = '55555555-5555-4555-8555-555555555555'
const ROW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
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

function op(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
	return {
		id,
		type: 'update',
		entityType: 'incomeSource',
		entityId: ROW,
		data: { name: 'Salary' },
		timestamp: 1_000,
		deviceId: 'device-b',
		userId: USER,
		...overrides,
	}
}

function profileChange(
	id: string,
	{ isDeleted = false, isDefault = false, updatedAt = 2_000 } = {}
): ServerChange {
	return {
		entityType: 'userProfile',
		entityId: id,
		data: {
			id,
			userId: USER,
			name: `Profile ${id.slice(0, 4)}`,
			description: null,
			isDefault,
			currency: 'NONE',
			icon: null,
			isDeleted,
			createdAt: ISO,
			updatedAt: ISO,
		},
		updatedAt,
		isDeleted,
	}
}

describe('pull() lets go of a remotely deleted profile’s queued ops', () => {
	let storage: ReturnType<typeof createStorage>
	let queue: SyncQueue
	let service: SynchronizationService
	let fetchServerChanges: Mock<(since: number | null) => Promise<ServerChange[]>>
	let processOperation: Mock
	let queueSeenByPulledCallback: string[][]

	const queuedIds = (): string[] => queue.getAll().map((o) => o.id)

	beforeEach(async () => {
		vi.useFakeTimers()
		storage = createStorage()
		fetchServerChanges = vi.fn(async (_since: number | null) => [] as ServerChange[])
		// A child create fails with no permanent status, so it would stay queued.
		processOperation = vi.fn(async () => ({ success: false, retryable: false }))
		service = new SynchronizationService(USER, {
			autoSync: false,
			processOperation,
			fetchServerChanges,
		})
		queue = new SyncQueue(USER, storage)
		await queue.initialize()
		internals(service).queue = queue
		internals(service).state.isOnline = true
		queueSeenByPulledCallback = []
		service.onChangesPulled(() => queueSeenByPulledCallback.push(queuedIds()))
	})

	afterEach(() => {
		service.destroy()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('an APPLIED profile tombstone', () => {
		it('drops the queued child ops stamped with that profile, in the same pull, before onChangesPulled', async () => {
			await queue.add(op('child-create', { type: 'create', profileId: P, entityId: ROW }))
			await queue.add(op('child-update', { profileId: P, baseVersion: 500 }))
			await queue.add(
				op('child-category', { entityType: 'category', entityId: X, profileId: P, timestamp: 900 })
			)
			fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])

			const result = await service.pull()

			expect(queuedIds()).toEqual([])
			expect(storage.persistedIds()).toEqual([])
			expect(result.applied.map((c) => [c.entityId, c.isDeleted])).toEqual([[P, true]])
			expect(queueSeenByPulledCallback).toEqual([[]])
			// Not as a conflict: these ops lost no comparison.
			expect(result.discardedForDeletedProfile.map((o) => o.id).sort()).toEqual([
				'child-category',
				'child-create',
				'child-update',
			])
			expect(service.getState().conflictOperations).toEqual([])
			expect(service.getState().pendingOperations).toEqual([])
		})

		it('a later push sends none of them, so the failure count does not climb', async () => {
			await queue.add(op('child-create', { type: 'create', profileId: P }))
			fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])
			await service.sync()
			expect(processOperation).toHaveBeenCalledTimes(1)
			const failuresAfterControl = (service as unknown as { consecutiveFailures: number })
				.consecutiveFailures
			expect(failuresAfterControl).toBeGreaterThan(0)

			await service.pull()
			await service.sync()

			expect(processOperation).toHaveBeenCalledTimes(1)
			expect(
				(service as unknown as { consecutiveFailures: number }).consecutiveFailures
			).toBeLessThanOrEqual(failuresAfterControl)
		})

		it('a queued edit of the deleted profile ITSELF is drained by the same pull (LWW: the tombstone is newer than its baseVersion)', async () => {
			// An update of a profile deleted elsewhere needs no new code: the tombstone's `updatedAt`
			// beats the op's base, so LWW drops it.
			await queue.add(
				op('rename-P', {
					entityType: 'userProfile',
					entityId: P,
					data: { name: 'P renamed' },
					baseVersion: 1_000,
				})
			)
			fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])

			const result = await service.pull()

			expect(queuedIds()).toEqual([])
			expect(service.getState().conflictOperations.map((o) => o.id)).toEqual(['rename-P'])
			expect(result.discardedForDeletedProfile).toEqual([])
		})
	})

	describe('the predicate is strict', () => {
		it('keeps ops for another profile, an unstamped op, and every userProfile op for another profile', async () => {
			await queue.add(op('child-in-P', { profileId: P }))
			await queue.add(op('child-in-Q', { profileId: Q, entityId: X }))
			await queue.add(op('child-unstamped', { entityId: Y }))
			// `op.profileId` is the active-profile stamp: deleting the active default queues the
			// survivor's promotion carrying the deleted profile's id.
			await queue.add(
				op('promote-Y', {
					entityType: 'userProfile',
					entityId: Y,
					profileId: P,
					data: { isDefault: true },
					baseVersion: 1_500,
				})
			)
			await queue.add(
				op('create-Q', { type: 'create', entityType: 'userProfile', entityId: Q, profileId: P })
			)
			fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])

			const result = await service.pull()

			expect(queuedIds()).toEqual(['child-in-Q', 'child-unstamped', 'promote-Y', 'create-Q'])
			expect(result.discardedForDeletedProfile.map((o) => o.id)).toEqual(['child-in-P'])
		})

		it('drops nothing when the tombstone is SUPPRESSED by a winning local edit of that profile', async () => {
			// No baseVersion and newer than the tombstone: local wins and P stays live here.
			await queue.add(
				op('rename-P', {
					entityType: 'userProfile',
					entityId: P,
					profileId: Q,
					data: { name: 'P renamed' },
					timestamp: 3_000,
				})
			)
			await queue.add(op('child-in-P', { profileId: P }))
			fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])

			const result = await service.pull()

			expect(result.conflicts.map((c) => c.entityId)).toEqual([P])
			expect(result.applied).toEqual([])
			expect(queuedIds()).toEqual(['rename-P', 'child-in-P'])
			expect(result.discardedForDeletedProfile).toEqual([])
		})

		it('drops nothing for a LIVE profile change', async () => {
			await queue.add(op('child-in-P', { profileId: P }))
			fetchServerChanges.mockResolvedValueOnce([profileChange(P)])

			const result = await service.pull()

			expect(result.applied.map((c) => c.entityId)).toEqual([P])
			expect(queuedIds()).toEqual(['child-in-P'])
		})
	})

	describe('the delete + promotion pair (one-way dependency)', () => {
		const deleteX = () =>
			op('delete-X', {
				type: 'delete',
				entityType: 'userProfile',
				entityId: X,
				data: {},
				profileId: X,
				baseVersion: 1_000,
			})
		const promoteY = (withLink: boolean) =>
			op('promote-Y', {
				entityType: 'userProfile',
				entityId: Y,
				profileId: X,
				data: { isDefault: true },
				baseVersion: 1_000,
				...(withLink
					? {
							dependsOn: {
								entityType: 'userProfile' as const,
								entityId: X,
								type: 'delete' as const,
							},
						}
					: {}),
			})

		it('a delete that LOSES LWW takes its promotion with it', async () => {
			await queue.add(deleteX())
			await queue.add(promoteY(true))
			// X was edited elsewhere after this device last saw it: the server wins.
			fetchServerChanges.mockResolvedValueOnce([profileChange(X, { isDefault: true })])

			const result = await service.pull()

			expect(queuedIds()).toEqual([])
			expect(result.droppedDependents.map((o) => o.id)).toEqual(['promote-Y'])
			// The promotion lost nothing: it is reported as a dependent, not a conflict.
			expect(service.getState().conflictOperations.map((o) => o.id)).toEqual(['delete-X'])
			expect(queueSeenByPulledCallback).toEqual([[]])
		})

		it('a delete dropped by LWW against a TOMBSTONE keeps its promotion: the deletion HAPPENED', async () => {
			// Another device deleted X first: the queued delete is dropped, but the target state holds,
			// so the promotion still makes sense.
			await queue.add(deleteX())
			await queue.add(promoteY(true))
			fetchServerChanges.mockResolvedValueOnce([profileChange(X, { isDeleted: true })])

			const result = await service.pull()

			expect(queuedIds()).toEqual(['promote-Y'])
			expect(result.droppedDependents).toEqual([])
		})

		it('a promotion that LOSES LWW leaves the delete queued (one-way)', async () => {
			await queue.add(deleteX())
			await queue.add(promoteY(true))
			fetchServerChanges.mockResolvedValueOnce([profileChange(Y)])

			const result = await service.pull()

			expect(queuedIds()).toEqual(['delete-X'])
			expect(result.droppedDependents).toEqual([])
		})

		it('a promotion queued without dependsOn behaves exactly as before', async () => {
			await queue.add(deleteX())
			await queue.add(promoteY(false))
			fetchServerChanges.mockResolvedValueOnce([profileChange(X, { isDefault: true })])

			const result = await service.pull()

			expect(queuedIds()).toEqual(['promote-Y'])
			expect(result.droppedDependents).toEqual([])
		})

		it('a dependent is dropped only when the op it names was dropped, not a different op on that row', async () => {
			// The promotion names X's delete, which was never queued, so it stays.
			await queue.add(
				op('rename-X', { entityType: 'userProfile', entityId: X, data: {}, baseVersion: 1_000 })
			)
			await queue.add(promoteY(true))
			fetchServerChanges.mockResolvedValueOnce([profileChange(X)])

			const result = await service.pull()

			expect(queuedIds()).toEqual(['promote-Y'])
			expect(result.droppedDependents).toEqual([])
		})
	})

	describe('the public entry point', () => {
		it('discardOperationsForDeletedProfile applies the same strict predicate', async () => {
			await queue.add(op('child-in-P', { profileId: P }))
			await queue.add(op('child-in-Q', { profileId: Q, entityId: X }))
			await queue.add(op('promote-Y', { entityType: 'userProfile', entityId: Y, profileId: P }))

			const dropped = await service.discardOperationsForDeletedProfile(P)

			expect(queuedIds()).toEqual(['child-in-Q', 'promote-Y'])
			expect(dropped.map((o) => o.id)).toEqual(['child-in-P'])
			expect(storage.persistedIds()).toEqual(['child-in-Q', 'promote-Y'])
			expect(service.getState().pendingOperations.map((o) => o.id)).toEqual([
				'child-in-Q',
				'promote-Y',
			])
		})

		it('is a no-op for an empty id', async () => {
			await queue.add(op('unstamped', { profileId: '' }))
			expect(await service.discardOperationsForDeletedProfile('')).toEqual([])
			expect(queuedIds()).toEqual(['unstamped'])
		})
	})

	it('a transport failure reports both new fields empty', async () => {
		fetchServerChanges.mockRejectedValueOnce(new Error('offline'))

		const result = await service.pull()

		expect(result.success).toBe(false)
		expect(result.discardedForDeletedProfile).toEqual([])
		expect(result.droppedDependents).toEqual([])
	})
})
