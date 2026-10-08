/** removeProfile is the real deletion path (the sync push enforces no guards). It is synchronous. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearSyncBridge,
	registerSyncBridge,
	type SyncBridgeHandle,
} from '../../lib/sync/syncBridge'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'
import { useProfileStore } from '../profileStore'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeHandle() {
	return {
		userId: SESSION_USER_ID,
		queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
		queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
		queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
	}
}

let handle: ReturnType<typeof makeHandle>

const main = {
	id: 'main',
	userId: SESSION_USER_ID,
	name: 'Main Profile',
	isDefault: true,
	currency: 'NONE',
	updatedAt: '2026-09-01T00:00:00.000Z',
}
const biz = {
	id: 'biz',
	userId: SESSION_USER_ID,
	name: 'Business',
	isDefault: false,
	currency: 'EUR',
	updatedAt: '2026-09-02T00:00:00.000Z',
}
const side = {
	id: 'side',
	userId: SESSION_USER_ID,
	name: 'Side Project',
	isDefault: false,
	currency: 'EUR',
	updatedAt: '2026-09-03T00:00:00.000Z',
}

beforeEach(() => {
	handle = makeHandle()
	localStorage.clear()
	useProfileStore.getState().reset()
})

afterEach(() => {
	clearSyncBridge()
	useProfileStore.getState().reset()
	vi.restoreAllMocks()
})

describe('deleting the DEFAULT profile (story 63.2, AC-2/AC-3)', () => {
	beforeEach(() => {
		registerSyncBridge(handle)
	})

	it('removes it and promotes the post-deletion active profile to default', () => {
		useProfileStore.setState({ profiles: [main, biz, side], activeProfileId: 'side' })

		useProfileStore.getState().removeProfile('main')

		const state = useProfileStore.getState()
		expect(state.profiles.map((p) => p.id)).toEqual(['biz', 'side'])
		// The survivor is the active profile, not the array's first element.
		expect(state.profiles.find((p) => p.isDefault)?.id).toBe('side')
		expect(state.profiles.filter((p) => p.isDefault)).toHaveLength(1)
		expect(state.activeProfileId).toBe('side')
		expect(state.error).toBeNull()
	})

	it('promotes the NEW active profile when the deleted default was itself active', () => {
		useProfileStore.setState({ profiles: [main, biz, side], activeProfileId: 'main' })

		useProfileStore.getState().removeProfile('main')

		const state = useProfileStore.getState()
		// Repointed to the oldest survivor (no createdAt, so the id breaks the tie); the promotion
		// follows that same choice.
		expect(state.activeProfileId).toBe('biz')
		expect(state.profiles.find((p) => p.isDefault)?.id).toBe('biz')
		expect(state.profiles.filter((p) => p.isDefault)).toHaveLength(1)
	})

	it('queues the tombstone AND the promotion, tombstone first', () => {
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'biz' })

		useProfileStore.getState().removeProfile('main')

		// A default deleted locally without a tombstone would return on the next pull.
		expect(handle.queueDelete).toHaveBeenCalledTimes(1)
		expect(handle.queueDelete).toHaveBeenCalledWith('userProfile', 'main', expect.anything())

		// A raw set() would leave the server with zero defaults.
		expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
		const [entityType, entityId, payload] = handle.queueUpdate.mock.calls[0] as [
			string,
			string,
			Record<string, unknown>,
		]
		expect(entityType).toBe('userProfile')
		expect(entityId).toBe('biz')
		expect(payload['isDefault']).toBe(true)
		// dependsOn: core holds the promotion until the tombstone lands, and drops it if the tombstone loses.
		expect(handle.queueUpdate.mock.calls[0]?.[5]).toEqual({
			entityType: 'userProfile',
			entityId: 'main',
			type: 'delete',
		})

		// Tombstone, then promote, so the promotion is the last word over the server's repair pick.
		const deleteOrder = handle.queueDelete.mock.invocationCallOrder[0] as number
		const updateOrder = handle.queueUpdate.mock.invocationCallOrder[0] as number
		expect(deleteOrder).toBeLessThan(updateOrder)
	})

	it('queues NO promotion when the deleted profile was not the default', () => {
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })

		useProfileStore.getState().removeProfile('biz')

		expect(handle.queueDelete).toHaveBeenCalledTimes(1)
		// Positive control: the promotion is conditional.
		expect(handle.queueUpdate).not.toHaveBeenCalled()
		expect(useProfileStore.getState().profiles.find((p) => p.isDefault)?.id).toBe('main')
	})
})

describe('deleting the ACTIVE profile lands on the OLDEST survivor (deferred from 98.1)', () => {
	// Store, id and age order deliberately disagree; only a createdAt comparison picks `zeta`.
	const alpha = { ...biz, id: 'alpha', name: 'Newest', createdAt: '2026-09-03T00:00:00.000Z' }
	const doomed = { ...main, id: 'doomed', name: 'Doomed', createdAt: '2026-09-02T00:00:00.000Z' }
	const zeta = { ...side, id: 'zeta', name: 'Oldest', createdAt: '2026-09-01T00:00:00.000Z' }

	beforeEach(() => {
		registerSyncBridge(handle)
	})

	it('switches to the oldest remaining profile, not the first in store order', () => {
		useProfileStore.setState({
			profiles: [alpha, { ...doomed, isDefault: false }, { ...zeta, isDefault: true }],
			activeProfileId: 'doomed',
		})

		useProfileStore.getState().removeProfile('doomed')

		const state = useProfileStore.getState()
		expect(state.activeProfileId).toBe('zeta')
		expect(state.profiles.find((p) => p.isDefault)?.id).toBe('zeta')
		expect(handle.queueUpdate).not.toHaveBeenCalled()
	})

	it('promotes that same oldest survivor when the deleted active profile was the default', () => {
		useProfileStore.setState({
			profiles: [alpha, { ...doomed, isDefault: true }, zeta],
			activeProfileId: 'doomed',
		})

		useProfileStore.getState().removeProfile('doomed')

		const state = useProfileStore.getState()
		expect(state.activeProfileId).toBe('zeta')
		expect(state.profiles.filter((p) => p.isDefault).map((p) => p.id)).toEqual(['zeta'])
		expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
		expect(handle.queueUpdate.mock.calls[0]?.[1]).toBe('zeta')
	})

	it('leaves the active profile alone when a NON-active profile is deleted', () => {
		useProfileStore.setState({ profiles: [alpha, doomed, zeta], activeProfileId: 'alpha' })

		useProfileStore.getState().removeProfile('zeta')

		expect(useProfileStore.getState().activeProfileId).toBe('alpha')
	})
})

describe('the last-profile guard is UNCHANGED (story 63.2, AC-4)', () => {
	beforeEach(() => {
		registerSyncBridge(handle)
	})

	it('refuses to delete the sole remaining profile and leaves the list intact', () => {
		useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })

		useProfileStore.getState().removeProfile('main')

		const state = useProfileStore.getState()
		expect(state.profiles.map((p) => p.id)).toEqual(['main'])
		expect(state.error).toMatch(/last profile/i)
		expect(handle.queueDelete).not.toHaveBeenCalled()
		expect(handle.queueUpdate).not.toHaveBeenCalled()
	})

	it('refuses the sole profile even when it is NOT the default', () => {
		useProfileStore.setState({ profiles: [biz], activeProfileId: 'biz' })

		useProfileStore.getState().removeProfile('biz')

		expect(useProfileStore.getState().profiles).toHaveLength(1)
		expect(handle.queueDelete).not.toHaveBeenCalled()
	})
})

describe('free tier (no bridge registered)', () => {
	/**
	 * The handle is never registered here, so `not.toHaveBeenCalled` is vacuous without the
	 * positive control below.
	 */
	it('deletes the default locally and makes zero queue calls', () => {
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'biz' })

		useProfileStore.getState().removeProfile('main')

		expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['biz'])
		expect(useProfileStore.getState().profiles.find((p) => p.isDefault)?.id).toBe('biz')
		expect(handle.queueDelete).not.toHaveBeenCalled()
		expect(handle.queueUpdate).not.toHaveBeenCalled()

		registerSyncBridge(handle)
		useProfileStore.setState({ profiles: [main, biz, side], activeProfileId: 'biz' })
		useProfileStore.getState().removeProfile('main')
		expect(handle.queueDelete).toHaveBeenCalledTimes(1)
	})
})

/**
 * Exercises the cascade through removeProfile. Imports the stores itself, so it cannot detect a
 * missing registration.
 */
describe('the cascade destroys the deleted profile’s rows (story 66.3, AC-1)', () => {
	beforeEach(() => {
		registerSyncBridge(handle)
		useProfileStore.setState({ profiles: [main, biz, side], activeProfileId: 'main' } as never)
		useIncomeStore.setState({
			incomeSources: [
				{ id: 'i-biz', profileId: 'biz', name: 'Consulting', amount: 1, frequency: 'monthly' },
				{ id: 'i-main', profileId: 'main', name: 'Salary', amount: 2, frequency: 'monthly' },
				{ id: 'i-legacy', profileId: null, name: 'Legacy', amount: 3, frequency: 'monthly' },
			],
		} as never)
		useExpenseStore.setState({
			expenses: [
				{ id: 'e-biz', profileId: 'biz', name: 'Office', amount: 1, frequency: 'monthly' },
			],
		} as never)
	})

	it('removes them while the SURVIVING and UNSCOPED rows stay', () => {
		useProfileStore.getState().removeProfile('biz')

		expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toEqual(['i-main', 'i-legacy'])
		expect(useExpenseStore.getState().expenses).toEqual([])
	})

	/**
	 * queueDelete stamps the ACTIVE profileId, so a child delete for a non-active profile would miss
	 * server-side; the server cascade removes the children.
	 */
	it('queues ONE delete — the profile itself — and no child operations', () => {
		useProfileStore.getState().removeProfile('biz')

		expect(handle.queueDelete).toHaveBeenCalledTimes(1)
		expect(handle.queueDelete).toHaveBeenCalledWith('userProfile', 'biz', expect.anything())
	})

	it('destroys NOTHING when the last-profile guard refuses the deletion', () => {
		useProfileStore.setState({ profiles: [biz], activeProfileId: 'biz' } as never)

		useProfileStore.getState().removeProfile('biz')

		expect(useProfileStore.getState().profiles).toHaveLength(1)
		expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toContain('i-biz')
		expect(useExpenseStore.getState().expenses).toHaveLength(1)
	})

	/** Not vacuous: the beforeEach registers the handle and the paid test proves the spy records calls. */
	it('cascades on the FREE tier too, once the bridge is unregistered', () => {
		clearSyncBridge()

		useProfileStore.getState().removeProfile('biz')

		expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toEqual(['i-main', 'i-legacy'])
		expect(handle.queueDelete).not.toHaveBeenCalled()
	})

	// The domain stores are not covered by the file-level reset; clear them or rows leak into later
	// tests.
	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] } as never)
		useExpenseStore.setState({ expenses: [] } as never)
	})
})
