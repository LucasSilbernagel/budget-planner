import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createSynchronizationService, type SynchronizationService } from '../synchronization'
import type { FetchServerChangesFn, ServerChange } from '../types'

const testUserId = 'user-abc'

function serverChange(overrides: Partial<ServerChange> = {}): ServerChange {
	return {
		entityType: 'incomeSource',
		entityId: 'srv-1',
		// A valid row: core validates a pulled row before it can win LWW, and the
		// income schema requires a uuid userId.
		data: {
			name: 'Salary',
			amount: 500000,
			frequency: 'monthly',
			userId: '11111111-1111-4111-8111-111111111111',
		},
		updatedAt: 1000,
		isDeleted: false,
		...overrides,
	}
}

describe('SynchronizationService.pull', () => {
	let service: SynchronizationService
	let fetchServerChanges: Mock<Parameters<FetchServerChangesFn>, ReturnType<FetchServerChangesFn>>

	beforeEach(() => {
		vi.useFakeTimers()
		fetchServerChanges = vi.fn<Parameters<FetchServerChangesFn>, ReturnType<FetchServerChangesFn>>()
		service = createSynchronizationService(testUserId, {
			autoSync: false,
			debug: false,
			processOperation: async () => ({ success: true }),
			fetchServerChanges,
		})
	})

	afterEach(() => {
		vi.useRealTimers()
		service.destroy()
	})

	it('starts with a null pull cursor, tracked separately from the push cursor', () => {
		const state = service.getState()
		expect(state.lastPullTimestamp).toBeNull()
		expect(state.lastSyncTimestamp).toBeNull()
	})

	it('applies a pulled create and surfaces it via onChangesPulled', async () => {
		const change = serverChange({ entityId: 'srv-1', updatedAt: 1500 })
		fetchServerChanges.mockResolvedValue([change])
		const pulled: ServerChange[][] = []
		service.onChangesPulled((changes) => pulled.push(changes))

		const result = await service.pull()

		expect(result.success).toBe(true)
		expect(result.changesPulledCount).toBe(1)
		expect(result.applied).toEqual([change])
		expect(result.conflicts).toEqual([])
		expect(result.lastPullTimestamp).toBe(1500)
		expect(pulled).toEqual([[change]])
		expect(service.getState().lastPullTimestamp).toBe(1500)
	})

	it('passes the current cursor to the transport (null on first pull)', async () => {
		fetchServerChanges.mockResolvedValue([])
		await service.pull()
		expect(fetchServerChanges).toHaveBeenCalledWith(null)
	})

	it('surfaces a pulled delete (tombstone) so the host can remove it locally', async () => {
		const tombstone = serverChange({ entityId: 'srv-9', isDeleted: true, updatedAt: 2000 })
		fetchServerChanges.mockResolvedValue([tombstone])

		const result = await service.pull()

		expect(result.changesPulledCount).toBe(1)
		expect(result.applied[0].isDeleted).toBe(true)
		expect(result.applied[0].entityId).toBe('srv-9')
	})

	it('preserves a NEWER queued local edit against an older server change', async () => {
		vi.setSystemTime(5000)
		await service.queueUpdate(
			'incomeSource',
			'srv-1',
			{ name: 'Local newer', amount: 999 },
			testUserId
		)

		const change = serverChange({ entityId: 'srv-1', updatedAt: 1000 })
		fetchServerChanges.mockResolvedValue([change])
		const pulled: ServerChange[][] = []
		service.onChangesPulled((changes) => pulled.push(changes))

		const result = await service.pull()

		expect(result.changesPulledCount).toBe(0)
		expect(result.applied).toEqual([])
		expect(result.conflicts).toEqual([change])
		expect(pulled).toEqual([])
		const stillQueued = service
			.getQueue()
			.getAll()
			.some((op) => op.entityId === 'srv-1')
		expect(stillQueued).toBe(true)
	})

	it('server loses a TIE to a still-queued local edit (deviceId tiebreaker rule)', async () => {
		vi.setSystemTime(3000)
		await service.queueUpdate(
			'incomeSource',
			'srv-1',
			{ name: 'Local tie', amount: 111 },
			testUserId
		)

		const change = serverChange({ entityId: 'srv-1', updatedAt: 3000 })
		fetchServerChanges.mockResolvedValue([change])

		const result = await service.pull()

		expect(result.applied).toEqual([])
		expect(result.conflicts).toEqual([change])
		expect(
			service
				.getQueue()
				.getAll()
				.some((op) => op.entityId === 'srv-1')
		).toBe(true)
	})

	it('a strictly-newer server change wins LWW and drops the stale local op', async () => {
		vi.setSystemTime(1000)
		await service.queueUpdate(
			'incomeSource',
			'srv-1',
			{ name: 'Local older', amount: 222 },
			testUserId
		)

		const change = serverChange({ entityId: 'srv-1', updatedAt: 9000 })
		fetchServerChanges.mockResolvedValue([change])

		const result = await service.pull()

		expect(result.changesPulledCount).toBe(1)
		expect(result.applied).toEqual([change])
		expect(
			service
				.getQueue()
				.getAll()
				.some((op) => op.entityId === 'srv-1')
		).toBe(false)
	})

	it('advances the cursor and does not re-pull the same change', async () => {
		fetchServerChanges.mockResolvedValueOnce([serverChange({ updatedAt: 4242 })])
		await service.pull()
		expect(service.getState().lastPullTimestamp).toBe(4242)

		fetchServerChanges.mockResolvedValueOnce([])
		await service.pull()
		expect(fetchServerChanges).toHaveBeenLastCalledWith(4242)
	})

	it('advances the cursor to the MAX updatedAt across a batch', async () => {
		fetchServerChanges.mockResolvedValue([
			serverChange({ entityId: 'a', updatedAt: 100 }),
			serverChange({ entityId: 'b', updatedAt: 700 }),
			serverChange({ entityId: 'c', updatedAt: 300 }),
		])
		const result = await service.pull()
		expect(result.lastPullTimestamp).toBe(700)
	})

	it('is a no-op when the server returns no changes (empty / future cursor)', async () => {
		fetchServerChanges.mockResolvedValue([])
		const pulled: ServerChange[][] = []
		service.onChangesPulled((c) => pulled.push(c))

		const result = await service.pull()

		expect(result.success).toBe(true)
		expect(result.changesPulledCount).toBe(0)
		expect(result.lastPullTimestamp).toBeNull()
		expect(pulled).toEqual([])
	})

	it('fails loud (does not no-op) when no transport is configured', async () => {
		const noTransport = createSynchronizationService(testUserId, {
			autoSync: false,
			processOperation: async () => ({ success: true }),
		})
		await expect(noTransport.pull()).rejects.toThrow(/fetchServerChanges/)
		noTransport.destroy()
	})

	it('returns a failure result (cursor unchanged) when the transport throws', async () => {
		fetchServerChanges.mockResolvedValueOnce([serverChange({ updatedAt: 50 })])
		await service.pull()
		fetchServerChanges.mockRejectedValueOnce(new Error('network down'))

		const result = await service.pull()

		expect(result.success).toBe(false)
		expect(result.error).toContain('network down')
		expect(result.lastPullTimestamp).toBe(50)
		expect(service.getState().lastPullTimestamp).toBe(50)
	})

	it('forcePull is an alias for pull (manual trigger)', async () => {
		fetchServerChanges.mockResolvedValue([serverChange({ updatedAt: 123 })])
		const result = await service.forcePull()
		expect(result.changesPulledCount).toBe(1)
		expect(result.lastPullTimestamp).toBe(123)
	})

	it('drops ALL queued ops for an entity when the server wins LWW (review P4)', async () => {
		vi.setSystemTime(1000)
		await service.queueCreate(
			'incomeSource',
			'srv-1',
			{ name: 'older create', amount: 1 },
			testUserId
		)
		vi.setSystemTime(2000)
		await service.queueUpdate(
			'incomeSource',
			'srv-1',
			{ name: 'newer update', amount: 2 },
			testUserId
		)
		expect(
			service
				.getQueue()
				.getAll()
				.filter((o) => o.entityId === 'srv-1')
		).toHaveLength(2)

		fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 9000 })])
		const result = await service.pull()

		expect(result.changesPulledCount).toBe(1)
		// Both ops go, so the older one can't re-push stale data over the pulled value.
		expect(
			service
				.getQueue()
				.getAll()
				.some((o) => o.entityId === 'srv-1')
		).toBe(false)
	})

	it('resetPullCursor() clears the cursor so the next pull is a full snapshot (review P7)', async () => {
		fetchServerChanges.mockResolvedValueOnce([serverChange({ updatedAt: 4242 })])
		await service.pull()
		expect(service.getState().lastPullTimestamp).toBe(4242)

		service.resetPullCursor()
		expect(service.getState().lastPullTimestamp).toBeNull()

		fetchServerChanges.mockResolvedValueOnce([])
		await service.pull()
		expect(fetchServerChanges).toHaveBeenLastCalledWith(null)
	})

	it('does NOT advance the cursor past a suppressed change', async () => {
		vi.setSystemTime(5000)
		await service.queueUpdate('incomeSource', 'srv-1', { name: 'local', amount: 1 }, testUserId)
		fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 1000 })])

		const result = await service.pull()

		// Suppressed: the cursor stays put so the change is re-pulled until the local op
		// pushes, instead of being skipped forever by the server's `> cursor` filter.
		expect(result.conflicts).toHaveLength(1)
		expect(result.lastPullTimestamp).toBeNull()
		expect(service.getState().lastPullTimestamp).toBeNull()
	})

	it('caps the cursor below the earliest suppressed change, not past it', async () => {
		vi.setSystemTime(5000)
		await service.queueUpdate('incomeSource', 'srv-2', { name: 'local', amount: 1 }, testUserId)
		fetchServerChanges.mockResolvedValue([
			serverChange({ entityId: 'srv-1', updatedAt: 100 }),
			serverChange({ entityId: 'srv-2', updatedAt: 1000 }),
			serverChange({ entityId: 'srv-3', updatedAt: 2000 }),
		])

		const result = await service.pull()

		// The cursor advances past the applied change but not past the suppressed one.
		expect(result.lastPullTimestamp).toBe(100)
	})

	it('surfaces a discarded local op in conflictOperations so the UI count reflects it', async () => {
		vi.setSystemTime(1000)
		await service.queueUpdate(
			'incomeSource',
			'srv-1',
			{ name: 'local older', amount: 1 },
			testUserId
		)
		fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 9000 })])

		expect(service.getState().conflictOperations).toHaveLength(0)
		await service.pull()

		expect(service.getState().conflictOperations).toHaveLength(1)
		expect(service.getState().conflictOperations[0].entityId).toBe('srv-1')
	})

	it('baseVersion (causal) overrides wall-clock — local wins when change <= base, despite an OLDER op timestamp', async () => {
		vi.setSystemTime(100)
		await service.queueUpdate(
			'incomeSource',
			'srv-1',
			{ name: 'local', amount: 1 },
			testUserId,
			undefined,
			5000
		)
		fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 5000 })])

		const result = await service.pull()

		// Wall-clock LWW would favour the server, but baseVersion shows the op already
		// incorporated v5000, so local wins.
		expect(result.conflicts).toHaveLength(1)
		expect(result.applied).toHaveLength(0)
		expect(
			service
				.getQueue()
				.getAll()
				.some((o) => o.entityId === 'srv-1')
		).toBe(true)
	})

	it('baseVersion (causal) overrides wall-clock — server wins when change > base, despite a NEWER op timestamp', async () => {
		vi.setSystemTime(9000)
		await service.queueUpdate(
			'incomeSource',
			'srv-1',
			{ name: 'local', amount: 1 },
			testUserId,
			undefined,
			1000
		)
		fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 2000 })])

		const result = await service.pull()

		// Wall-clock LWW would favour the op, but the server has a concurrent change
		// newer than baseVersion, so the server wins.
		expect(result.applied).toHaveLength(1)
		expect(result.conflicts).toHaveLength(0)
		expect(
			service
				.getQueue()
				.getAll()
				.some((o) => o.entityId === 'srv-1')
		).toBe(false)
	})
})
