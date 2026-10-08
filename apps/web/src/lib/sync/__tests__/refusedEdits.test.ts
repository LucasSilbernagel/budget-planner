import {
	type ServerChange,
	type SyncOperation,
	SyncQueue,
	type SyncQueueStorage,
} from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	addRefusalNotices,
	dismissAllRefusalNotices,
	dismissRefusalNotice,
	getRefusalNotices,
} from '../refusalNoticeStore'
import {
	describeRefusedRow,
	handleRejectedOperations,
	type RefusalHandlerDeps,
} from '../refusedEdits'

let seq = 0
function op(overrides: Partial<SyncOperation>): SyncOperation {
	seq++
	return {
		id: `op-${seq}`,
		type: 'update',
		entityType: 'expense',
		entityId: 'row-1',
		data: { userId: 'u', name: 'Rent' },
		timestamp: 1000 + seq,
		deviceId: 'd',
		userId: 'u',
		...overrides,
	} as SyncOperation
}

function deps(overrides: Partial<RefusalHandlerDeps> = {}) {
	const queued: SyncOperation[] = []
	const applied: ServerChange[][] = []
	const base: RefusalHandlerDeps & { queued: SyncOperation[]; applied: ServerChange[][] } = {
		queued,
		applied,
		queue: {
			getAll: () => [...queued],
			discardBatch: vi.fn(async (ids: string[]) => {
				const before = queued.length
				for (let i = queued.length - 1; i >= 0; i--) {
					if (ids.includes((queued[i] as SyncOperation).id)) queued.splice(i, 1)
				}
				return { removed: before - queued.length, persisted: true }
			}),
		},
		discardOperationsForDeletedProfile: vi.fn(async (_profileId: string) => []),
		applyChanges: vi.fn((changes: ServerChange[]) => {
			applied.push(changes)
		}),
		lookupLocalRow: vi.fn(() => undefined),
		requestFullRepull: vi.fn(),
		notify: vi.fn(),
		...overrides,
	}
	return base
}

describe('describeRefusedRow — naming a refused row', () => {
	it("uses the newest op's non-blank name, and the kind the user knows", () => {
		const notice = describeRefusedRow(
			[op({ data: { name: 'Old' }, timestamp: 1 }), op({ data: { name: 'New' }, timestamp: 2 })],
			undefined
		)
		expect(notice).toMatchObject({
			key: 'expense:row-1',
			name: 'New',
			kind: 'expense',
			outcome: 'changed-back',
		})
	})

	it('treats a whitespace-only name as ABSENT and falls back (63.2 defect)', () => {
		const notice = describeRefusedRow([op({ data: { name: '   ' } })], { name: '\t' })
		expect(notice.name).toBeNull()
		expect(notice.fallback).toBe('An expense')
	})

	it('a delete carries no name — the local row supplies it when it is still there', () => {
		const notice = describeRefusedRow([op({ type: 'delete', data: { userId: 'u' } })], {
			name: 'Rent',
		})
		expect(notice).toMatchObject({ name: 'Rent', outcome: 'restored' })
	})

	it('a create in the group makes it "removed", even with follow-ups', () => {
		const notice = describeRefusedRow([op({ type: 'create' }), op({ type: 'delete' })], undefined)
		expect(notice.outcome).toBe('removed')
	})

	it('names a balance entry as an investment or a debt, from the op or the local row', () => {
		expect(
			describeRefusedRow([op({ entityType: 'balanceTracking', data: { type: 'debt' } })], undefined)
				.kind
		).toBe('debt')
		expect(
			describeRefusedRow([op({ entityType: 'balanceTracking', type: 'delete', data: {} })], {
				type: 'investment',
			}).fallback
		).toBe('An investment')
		expect(
			describeRefusedRow([op({ entityType: 'balanceTracking', data: {} })], undefined).kind
		).toBe('balance')
	})

	it.each([
		['incomeSource', 'income', 'An income entry'],
		['savingsGoal', 'savings', 'A savings entry'],
		['userProfile', 'profile', 'A profile'],
		['category', 'category', 'A category'],
	] as const)('%s → %s / %s', (entityType, kind, fallback) => {
		const notice = describeRefusedRow([op({ entityType, data: {} })], undefined)
		expect(notice).toMatchObject({ kind, fallback, name: null })
	})
})

describe('handleRejectedOperations — reverting', () => {
	beforeEach(() => {
		dismissAllRefusalNotices()
	})

	it('ONE notice per row, even when a create arrives with its follow-ups', async () => {
		const d = deps()
		await handleRejectedOperations(
			[op({ type: 'create' }), op({}), op({ entityId: 'row-2', data: { name: 'Gym' } })],
			d
		)
		const notices = (d.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
		expect(notices.map((n: { key: string }) => n.key)).toEqual(['expense:row-1', 'expense:row-2'])
	})

	it('a refused create: drops ops for the row still queued, then removes it with a TOMBSTONE', async () => {
		const d = deps()
		// Queued after the queue was swept, e.g. an edit made mid-push.
		d.queued.push(op({ id: 'late', entityId: 'row-1' }), op({ id: 'other', entityId: 'row-9' }))

		await handleRejectedOperations([op({ type: 'create' })], d)

		expect(d.queued.map((o) => o.id)).toEqual(['other'])
		expect(d.applied).toEqual([
			[
				expect.objectContaining({
					entityType: 'expense',
					entityId: 'row-1',
					isDeleted: true,
				}),
			],
		])
		expect(d.requestFullRepull).not.toHaveBeenCalled()
	})

	it('a refused PROFILE create lets go of its children’s queued ops too (story 76.2)', async () => {
		const d = deps()
		await handleRejectedOperations(
			[op({ type: 'create', entityType: 'userProfile', entityId: 'p-1' })],
			d
		)

		// Their queued ops would otherwise fail `Profile not found` forever.
		expect(d.discardOperationsForDeletedProfile).toHaveBeenCalledTimes(1)
		expect(d.discardOperationsForDeletedProfile).toHaveBeenCalledWith('p-1')
		expect(d.applied).toHaveLength(1)
		// After the synthetic tombstone: the rows go first, then their queued ops.
		const tombstoneOrder = (d.applyChanges as ReturnType<typeof vi.fn>).mock
			.invocationCallOrder[0] as number
		const discardOrder = (d.discardOperationsForDeletedProfile as ReturnType<typeof vi.fn>).mock
			.invocationCallOrder[0] as number
		expect(tombstoneOrder).toBeLessThan(discardOrder)
	})

	it('a refused create of any OTHER entity type does not touch a profile’s ops', async () => {
		const d = deps()
		await handleRejectedOperations([op({ type: 'create' })], d)
		expect(d.discardOperationsForDeletedProfile).not.toHaveBeenCalled()
	})

	it('names a refused create from the local row BEFORE the tombstone removes it', async () => {
		let rowPresent = true
		const d = deps({
			lookupLocalRow: vi.fn(() => (rowPresent ? { name: 'Local name' } : undefined)),
			applyChanges: vi.fn(() => {
				rowPresent = false
			}),
		})
		await handleRejectedOperations([op({ type: 'create', data: {} })], d)
		const notices = (d.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? []
		expect(notices[0]?.name).toBe('Local name')
	})

	it('refused updates and deletes: ONE full re-pull for the whole sync, no tombstone', async () => {
		const d = deps()
		await handleRejectedOperations(
			[op({}), op({ entityId: 'row-2' }), op({ type: 'delete', entityId: 'row-3' })],
			d
		)
		expect(d.requestFullRepull).toHaveBeenCalledTimes(1)
		expect(d.applyChanges).not.toHaveBeenCalled()
	})

	it('one row that cannot be read gets a fallback notice, and the other rows are still handled', async () => {
		const d = deps({
			lookupLocalRow: vi.fn((_type, id: string): undefined => {
				if (id === 'row-bad') throw new Error('corrupt store')
				return
			}),
		})
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		await handleRejectedOperations(
			[op({ entityId: 'row-bad', data: {} }), op({ entityId: 'row-2', data: { name: 'Gym' } })],
			d
		)
		error.mockRestore()
		const notices = (d.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? []
		expect(notices.map((n: { key: string; name: string | null }) => [n.key, n.name])).toEqual([
			['expense:row-bad', null],
			['expense:row-2', 'Gym'],
		])
		expect(d.requestFullRepull).toHaveBeenCalledTimes(1)
	})

	it('a throwing re-pull request does not swallow the notices', async () => {
		const d = deps({
			requestFullRepull: vi.fn(() => {
				throw new Error('service gone')
			}),
		})
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		await handleRejectedOperations([op({})], d)
		error.mockRestore()
		expect(d.notify).toHaveBeenCalledTimes(1)
	})

	it('an unpersisted discard (storage refusing writes) still drops the ops, reverts and notifies', async () => {
		const d = deps()
		d.queued.push(op({ id: 'late', entityId: 'row-1' }))
		const discard = d.queue.discardBatch
		d.queue.discardBatch = vi.fn(async (ids: string[]) => ({
			...(await discard(ids)),
			persisted: false,
		}))
		const info = vi.spyOn(console, 'info').mockImplementation(() => {})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		await handleRejectedOperations([op({ type: 'create' })], d)
		const warned = warn.mock.calls.length
		info.mockRestore()
		warn.mockRestore()
		expect(d.queue.discardBatch).toHaveBeenCalledWith(['late'])
		expect(d.queued).toEqual([])
		expect(warned).toBe(1)
		expect(d.applyChanges).toHaveBeenCalledTimes(1)
		expect(d.notify).toHaveBeenCalledTimes(1)
	})

	it('over a REAL queue whose storage refuses writes, the leftover still leaves this session', async () => {
		// The doubles only implement discardBatch; a real SyncQueue's removeBatch keeps the op when the write fails.
		let failWrites = false
		const saved = new Map<string, SyncOperation[]>()
		const storage: SyncQueueStorage = {
			loadQueue: async (userId) => [...(saved.get(userId) ?? [])],
			saveQueue: async (userId, queue) => {
				if (failWrites) throw new Error('QuotaExceededError')
				saved.set(userId, [...queue])
			},
			clearQueue: async (userId) => {
				saved.delete(userId)
			},
		}
		const queue = new SyncQueue('u', storage)
		await queue.initialize()
		await queue.add(op({ id: 'late', entityId: 'row-1' }))
		await queue.add(op({ id: 'other', entityId: 'row-9' }))
		failWrites = true
		const d = deps({ queue })
		const quiet = [
			vi.spyOn(console, 'error').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'info').mockImplementation(() => {}),
		]

		await handleRejectedOperations([op({ type: 'create', entityId: 'row-1' })], d)
		for (const spy of quiet) spy.mockRestore()

		expect(queue.getAll().map((o) => o.id)).toEqual(['other'])
		// The stated limit: storage never took the removal.
		expect((saved.get('u') ?? []).map((o) => o.id)).toEqual(['late', 'other'])
		expect(d.applyChanges).toHaveBeenCalledTimes(1)
		expect(d.notify).toHaveBeenCalledTimes(1)
	})

	it('an unexpected throw from the queue does not stop the revert or the notice', async () => {
		const d = deps()
		d.queued.push(op({ id: 'late' }))
		d.queue.discardBatch = vi.fn(async () => {
			throw new Error('QuotaExceededError')
		})
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		await handleRejectedOperations([op({ type: 'create' })], d)
		error.mockRestore()
		expect(d.applyChanges).toHaveBeenCalledTimes(1)
		expect(d.notify).toHaveBeenCalledTimes(1)
	})
})

describe('refusalNoticeStore', () => {
	beforeEach(() => {
		dismissAllRefusalNotices()
	})

	const notice = (key: string) => ({
		key,
		entityType: 'expense' as const,
		name: 'Rent',
		kind: 'expense',
		fallback: 'An expense',
		outcome: 'changed-back' as const,
	})

	it('shows a row once: a notice already on screen is not added again', () => {
		addRefusalNotices([notice('a'), notice('a')])
		addRefusalNotices([notice('a'), notice('b')])
		expect(getRefusalNotices().map((n) => n.key)).toEqual(['a', 'b'])
	})

	it('a later refusal of the same row with a DIFFERENT outcome replaces it, moved to the end', () => {
		addRefusalNotices([notice('a'), notice('b')])
		addRefusalNotices([{ ...notice('a'), outcome: 'restored' }])
		expect(getRefusalNotices().map((n) => [n.key, n.outcome])).toEqual([
			['b', 'changed-back'],
			['a', 'restored'],
		])
	})

	it('dismissing empties it — nothing is kept, so it cannot grow for the session', () => {
		addRefusalNotices([notice('a'), notice('b')])
		dismissRefusalNotice('a')
		expect(getRefusalNotices().map((n) => n.key)).toEqual(['b'])
		dismissAllRefusalNotices()
		expect(getRefusalNotices()).toEqual([])
	})
})

describe('a refused retirement plan edit (story 99.2)', () => {
	const planOp = (type: SyncOperation['type']) =>
		op({ type, entityType: 'retirementPlan', entityId: 'u', data: { userId: 'u', plan: {} } })

	it('is named "Your retirement plan", kind "retirement plan"', () => {
		const notice = describeRefusedRow([planOp('update')], undefined)
		expect(notice).toMatchObject({
			entityType: 'retirementPlan',
			name: null,
			kind: 'retirement plan',
			fallback: 'Your retirement plan',
		})
	})

	it.each(['create', 'update'] as const)(
		'a refused %s reverts NOTHING: no tombstone, no re-pull, still notified',
		async (type) => {
			const d = deps()
			await handleRejectedOperations([planOp(type)], d)
			expect(d.applyChanges).not.toHaveBeenCalled()
			expect(d.requestFullRepull).not.toHaveBeenCalled()
			expect(d.notify).toHaveBeenCalledTimes(1)
		}
	)

	it('CONTROL: a refused expense update in the same sync still re-pulls', async () => {
		const d = deps()
		await handleRejectedOperations([planOp('update'), op({ type: 'update' })], d)
		expect(d.requestFullRepull).toHaveBeenCalledTimes(1)
	})
})
