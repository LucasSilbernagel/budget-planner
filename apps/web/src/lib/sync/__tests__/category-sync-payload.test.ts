/** categoryId is pinned to null until category sync works; restore the forwarding and rewrite this file then. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearSyncBridge,
	registerSyncBridge,
	syncEntityCreate,
	syncEntityUpdate,
} from '../syncBridge'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeHandle() {
	return {
		userId: SESSION_USER_ID,
		queueCreate: vi.fn(async () => {}),
		queueUpdate: vi.fn(async () => {}),
		queueDelete: vi.fn(async () => {}),
	}
}

let handle: ReturnType<typeof makeHandle>

const row = (categoryId: string | null) => ({
	id: 'row-1',
	userId: 0,
	name: 'Tesco run',
	amount: 8000,
	frequency: 'monthly',
	categoryId,
	updatedAt: '2026-01-01T00:00:00.000Z',
})

function queuedData(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
	expect(mock).toHaveBeenCalledTimes(1)
	const call = mock.mock.calls[0] as unknown[]
	const envelope = call.find(
		(arg) => typeof arg === 'object' && arg !== null && 'data' in (arg as object)
	) as { data: Record<string, unknown> } | undefined
	if (envelope) {
		return envelope.data
	}
	const payload = call.find(
		(arg) => typeof arg === 'object' && arg !== null && 'name' in (arg as object)
	)
	expect(payload, `no payload found in queue call: ${JSON.stringify(call)}`).toBeDefined()
	return payload as Record<string, unknown>
}

beforeEach(() => {
	handle = makeHandle()
	registerSyncBridge(handle)
})

afterEach(() => {
	clearSyncBridge()
	vi.restoreAllMocks()
})

describe('categoryId is pinned to null in the sync payload until the repair lands', () => {
	it.each(['incomeSource', 'expense'] as const)(
		'never forwards a real category uuid on CREATE for %s',
		(entityType) => {
			syncEntityCreate(entityType, row('cat-uuid-1'))

			const data = queuedData(handle.queueCreate)
			// The key must still be present: a partial .set() would leave a prior server value.
			expect(data).toHaveProperty('categoryId')
			expect(data['categoryId']).toBeNull()
			expect(data['name']).toBe('Tesco run')
			expect(data['amount']).toBe(8000)
		}
	)

	it.each(['incomeSource', 'expense'] as const)(
		'never forwards a real category uuid on UPDATE for %s — the path that trips the breaker',
		(entityType) => {
			syncEntityUpdate(entityType, row('cat-uuid-1'), row(null))

			const data = queuedData(handle.queueUpdate)
			expect(data['categoryId']).toBeNull()
			expect(data['name']).toBe('Tesco run')
		}
	)

	it('is null for an already-uncategorized row too', () => {
		syncEntityCreate('expense', row(null))
		expect(queuedData(handle.queueCreate)['categoryId']).toBeNull()
	})
})
