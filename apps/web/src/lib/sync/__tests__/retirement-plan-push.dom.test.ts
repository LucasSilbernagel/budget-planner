/** The queue add is async, so timers advance with `advanceTimersByTimeAsync` to settle it. */

import type { ServerChange, SyncOperation } from '@budget-planner/core/sync/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIncomeStore } from '../../../stores/incomeStore'
import {
	claimRetirementPlanFor,
	RETIREMENT_PLAN_DEFAULTS,
	RETIREMENT_PLANNER_STORAGE_KEY,
	type RetirementPlan,
	useRetirementPlannerStore,
} from '../../../stores/retirementPlannerStore'
import { applyServerChangesToStores, stampSyncedOwner } from '../applyServerChanges'
import { handleRejectedOperations, type RefusalHandlerDeps } from '../refusedEdits'
import {
	hasPendingPlanEdit,
	notePlanOpRefused,
	PLAN_PUSH_DEBOUNCE_MS,
	reconcilePlanAfterInitialPull,
	resetRetirementPlanPushForTests,
} from '../retirementPlanPush'
import { seedOnce } from '../seedLocalData'
import { clearSyncBridge, registerSyncBridge, type SyncBridgeHandle } from '../syncBridge'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

function makeHandle() {
	return {
		userId: USER,
		queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
		queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
		queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
	}
}

let handle: ReturnType<typeof makeHandle>

function queued(): string[] {
	return [
		...handle.queueCreate.mock.calls.map((call) => `create ${call[0]}`),
		...handle.queueUpdate.mock.calls.map((call) => `update ${call[0]}`),
		...handle.queueDelete.mock.calls.map((call) => `delete ${call[0]}`),
	]
}

function planUpdates(): { entityId: string; plan: RetirementPlan; baseVersion?: number }[] {
	return handle.queueUpdate.mock.calls
		.filter((call) => call[0] === 'retirementPlan')
		.map((call) => ({
			entityId: call[1],
			plan: call[2]['plan'] as RetirementPlan,
			baseVersion: call[4],
		}))
}

async function quiet(): Promise<void> {
	await vi.advanceTimersByTimeAsync(PLAN_PUSH_DEBOUNCE_MS)
}

function pulledPlan(plan: RetirementPlan, updatedAt: number, id = USER): ServerChange {
	return {
		entityType: 'retirementPlan',
		entityId: id,
		data: { id, userId: id, plan },
		updatedAt,
		isDeleted: false,
	}
}

function planOp(overrides: Partial<SyncOperation> = {}): SyncOperation {
	return {
		id: 'op-plan',
		type: 'update',
		entityType: 'retirementPlan',
		entityId: USER,
		data: { userId: USER, plan: { ...RETIREMENT_PLAN_DEFAULTS } },
		timestamp: 3_000,
		deviceId: 'd',
		userId: USER,
		...overrides,
	} as SyncOperation
}

const store = () => useRetirementPlannerStore.getState()

beforeEach(() => {
	vi.useFakeTimers()
	localStorage.clear()
	resetRetirementPlanPushForTests()
	useRetirementPlannerStore.setState({
		plan: { ...RETIREMENT_PLAN_DEFAULTS },
		ownerUserId: USER,
		serverUpdatedAt: null,
		localPlanDiverged: false,
	})
	useIncomeStore.setState({ incomeSources: [] })
	handle = makeHandle()
	registerSyncBridge(handle)
})

afterEach(() => {
	clearSyncBridge()
	resetRetirementPlanPushForTests()
	vi.useRealTimers()
})

describe('only the user-intent setters push', () => {
	const intent: [string, () => void][] = [
		['setCurrentAgeInput', () => store().setCurrentAgeInput('41')],
		['setLifeExpectancyInput', () => store().setLifeExpectancyInput('87')],
		['setDesiredIncomeInput', () => store().setDesiredIncomeInput('55,000.00')],
		['markDesiredIncomeAuthored', () => store().markDesiredIncomeAuthored('en-US')],
		['setAdoptedMonthlyCents', () => store().setAdoptedMonthlyCents(240_000)],
		['setIncomeBasis', () => store().setIncomeBasis('monthly')],
		['setAnnualReturnInput', () => store().setAnnualReturnInput('5.5')],
		['setPostRetirementReturn', () => store().setPostRetirementReturn('3.0')],
		['setModel', () => store().setModel('perpetual')],
	]

	it.each(intent)(
		'%s queues ONE update of the whole plan, under the account id',
		async (_, edit) => {
			edit()
			expect(queued()).toEqual([])
			await quiet()
			expect(queued()).toEqual(['update retirementPlan'])
			const [update] = planUpdates()
			expect(update?.entityId).toBe(USER)
			expect(update?.plan).toEqual(store().plan)
			expect(store().plan).not.toEqual(RETIREMENT_PLAN_DEFAULTS)
		}
	)

	it('setDesiredIncomeForLocale (the effects’ writer) queues nothing; an intent setter after it does', async () => {
		store().setDesiredIncomeForLocale('55.000,00', 'de-DE')
		await quiet()
		expect(store().plan.desiredIncomeInput).toBe('55.000,00')
		expect(queued()).toEqual([])
		store().setModel('perpetual')
		await quiet()
		expect(queued()).toEqual(['update retirementPlan'])
	})

	it('resetPlan, the claim and the pull applier queue nothing', async () => {
		store().setDesiredIncomeForLocale('1', 'en-US')
		store().resetPlan()
		claimRetirementPlanFor(OTHER)
		claimRetirementPlanFor(USER)
		claimRetirementPlanFor('')
		expect(store().ownerUserId).toBe('')
		claimRetirementPlanFor(USER)
		applyServerChangesToStores(
			[pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, model: 'perpetual' }, 2_000)],
			USER
		)
		await quiet()
		expect(store().plan.model).toBe('perpetual')
		expect(queued()).toEqual([])
	})

	it('resetPlan DROPS a pending edit (Clear local data never pushes)', async () => {
		store().setModel('perpetual')
		expect(hasPendingPlanEdit()).toBe(true)
		store().resetPlan()
		await quiet()
		expect(hasPendingPlanEdit()).toBe(false)
		expect(queued()).toEqual([])
	})

	it('an owner change DROPS a pending edit: the plan it brings back is never pushed by it', async () => {
		// Without the drop, the old timer would push the parked plan as an edit.
		localStorage.setItem(
			`${RETIREMENT_PLANNER_STORAGE_KEY}:${OTHER}`,
			JSON.stringify({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '58' })
		)
		store().setModel('perpetual')
		expect(hasPendingPlanEdit()).toBe(true)
		claimRetirementPlanFor(OTHER)
		registerSyncBridge({ ...handle, userId: OTHER })
		expect(store().plan.currentAgeInput).toBe('58')
		await quiet()
		expect(queued()).toEqual([])
		store().setModel('perpetual')
		await quiet()
		expect(queued()).toEqual(['update retirementPlan'])
	})

	it('an edit to a plan the session does not own arms no timer (it would block the seed)', async () => {
		useRetirementPlannerStore.setState({ ownerUserId: '' })
		store().setModel('perpetual')
		expect(hasPendingPlanEdit()).toBe(false)
		await quiet()
		expect(queued()).toEqual([])
	})

	it('the free → paid seed uploads local rows but never the plan', async () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
					userId: 0,
					name: 'Salary',
					amount: 500_000,
					frequency: 'monthly',
				} as never,
			],
		})
		useRetirementPlannerStore.setState({
			plan: { ...RETIREMENT_PLAN_DEFAULTS, model: 'perpetual' },
		})

		await seedOnce(USER)

		expect(queued()).toEqual(['create incomeSource'])
	})
})

describe('keystrokes coalesce', () => {
	it('20 keystrokes inside the window queue exactly ONE op, carrying the LAST value', async () => {
		for (let i = 1; i <= 20; i += 1) {
			store().setDesiredIncomeInput((previous) => `${previous}${i % 10}`)
			await vi.advanceTimersByTimeAsync(PLAN_PUSH_DEBOUNCE_MS - 1)
		}
		expect(queued()).toEqual([])
		await vi.advanceTimersByTimeAsync(1)
		expect(queued()).toEqual(['update retirementPlan'])
		expect(planUpdates()[0]?.plan.desiredIncomeInput).toBe('12345678901234567890')
	})

	it('a blur re-echo that formats to the same string queues nothing', async () => {
		applyServerChangesToStores(
			[pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, desiredIncomeInput: '55,000.00' }, 2_000)],
			USER
		)
		store().setDesiredIncomeInput((previous) => previous)
		await quiet()
		expect(queued()).toEqual([])
		store().setDesiredIncomeInput('56,000.00')
		await quiet()
		expect(queued()).toEqual(['update retirementPlan'])
	})

	it('a plan equal to the last one PUSHED queues nothing; a change after it does', async () => {
		store().setModel('perpetual')
		await quiet()
		store().setModel('perpetual')
		await quiet()
		expect(queued()).toEqual(['update retirementPlan'])
		store().setModel('deplete')
		await quiet()
		expect(queued()).toEqual(['update retirementPlan', 'update retirementPlan'])
	})

	it('an edit back to the plan last PULLED queues nothing, whatever the key order of the local object', async () => {
		applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 2_000)], USER)
		// The defaults list the fields in a different order from the coercion.
		useRetirementPlannerStore.setState({ plan: { ...RETIREMENT_PLAN_DEFAULTS } })
		store().setModel('perpetual')
		store().setModel('deplete')
		await quiet()
		expect(queued()).toEqual([])
	})

	it('a FAILED queue add does not make the plan look sent: the same plan is sent again, and it is marked not on the server', async () => {
		handle.queueUpdate.mockRejectedValueOnce(new Error('storage full'))
		vi.spyOn(console, 'error').mockImplementation(() => {})
		store().setModel('perpetual')
		await quiet()
		expect(store().localPlanDiverged).toBe(true)
		store().setModel('perpetual')
		await quiet()
		expect(queued()).toEqual(['update retirementPlan', 'update retirementPlan'])
	})

	it.each([
		['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
		[
			'visibilitychange: hidden',
			() => {
				vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
				document.dispatchEvent(new Event('visibilitychange'))
			},
		],
	])('%s hands a pending edit to the queue at once', async (_, leave) => {
		store().setModel('perpetual')
		leave()
		expect(queued()).toEqual(['update retirementPlan'])
		await quiet()
		expect(queued()).toEqual(['update retirementPlan'])
		expect(hasPendingPlanEdit()).toBe(false)
	})

	it('visibilitychange while still VISIBLE flushes nothing', () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
		store().setModel('perpetual')
		document.dispatchEvent(new Event('visibilitychange'))
		expect(queued()).toEqual([])
		expect(hasPendingPlanEdit()).toBe(true)
	})
})

describe('a pull never overwrites un-pushed typing', () => {
	it('type → push → type again → a pull of this device’s OWN earlier write: the newer value stays and is what is sent, based on that write', async () => {
		useRetirementPlannerStore.setState({ serverUpdatedAt: new Date(1_000).toISOString() })
		store().setCurrentAgeInput('40')
		await quiet()
		const first = planUpdates()[0]
		expect(first?.plan.currentAgeInput).toBe('40')
		expect(first?.baseVersion).toBe(1_000)

		store().setCurrentAgeInput('41')
		applyServerChangesToStores([pulledPlan(first?.plan as RetirementPlan, 5_000)], USER)
		expect(store().plan.currentAgeInput).toBe('41')

		await quiet()
		const second = planUpdates()[1]
		expect(second?.plan.currentAgeInput).toBe('41')
		// Core keeps this op over the change the applier skipped (`5000 <= base`).
		expect(second?.baseVersion).toBe(5_000)
	})

	it('the gap between the flush and the queue holding the op is protected too', async () => {
		let settle: () => void = () => {}
		handle.queueUpdate.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					settle = resolve
				})
		)
		store().setCurrentAgeInput('44')
		await quiet()
		expect(hasPendingPlanEdit()).toBe(true)
		applyServerChangesToStores(
			[pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '30' }, 5_000)],
			USER
		)
		expect(store().plan.currentAgeInput).toBe('44')
		settle()
		await vi.advanceTimersByTimeAsync(0)
		expect(hasPendingPlanEdit()).toBe(false)
	})

	it('a skip never moves the recorded server version BACKWARDS', () => {
		useRetirementPlannerStore.setState({ serverUpdatedAt: new Date(9_000).toISOString() })
		store().setModel('perpetual')
		applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 4_000)], USER)
		expect(store().serverUpdatedAt).toBe(new Date(9_000).toISOString())
	})

	it('a skip for an op still in the QUEUE records the version as well (so the seed does not think the server is empty)', () => {
		applyServerChangesToStores(
			[pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '30' }, 4_000)],
			USER,
			{ hasPendingOperation: () => true }
		)
		expect(store().plan).toEqual(RETIREMENT_PLAN_DEFAULTS)
		expect(store().serverUpdatedAt).toBe(new Date(4_000).toISOString())
	})

	it('CONTROL: with nothing pending the same pull IS applied', () => {
		applyServerChangesToStores(
			[pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '50' }, 5_000)],
			USER
		)
		expect(store().plan.currentAgeInput).toBe('50')
		expect(store().serverUpdatedAt).toBe(new Date(5_000).toISOString())
	})
})

describe('own echo (code review 2026-10-05, HIGH): core dropped the newer queued edit', () => {
	it('a pulled plan this device pushed, while the screen shows a newer one, is skipped and the screen plan re-queued based on the echo', async () => {
		useRetirementPlannerStore.setState({ serverUpdatedAt: new Date(1_000).toISOString() })
		store().setCurrentAgeInput('40')
		await quiet()
		store().setCurrentAgeInput('41')
		await quiet()
		// Edit 2 was queued with the stale base 1000; the echo of edit 1 (t=5000)
		// beats it in core, which drops it and hands the applier the echo.
		applyServerChangesToStores([pulledPlan(planUpdates()[0]?.plan as RetirementPlan, 5_000)], USER)
		expect(store().plan.currentAgeInput).toBe('41')
		const requeued = planUpdates()[2]
		expect(requeued?.plan.currentAgeInput).toBe('41')
		expect(requeued?.baseVersion).toBe(5_000)
	})

	it('CONTROL: an echo equal to the screen plan is simply applied, and nothing is sent', async () => {
		store().setCurrentAgeInput('40')
		await quiet()
		applyServerChangesToStores([pulledPlan(planUpdates()[0]?.plan as RetirementPlan, 5_000)], USER)
		expect(store().serverUpdatedAt).toBe(new Date(5_000).toISOString())
		expect(queued()).toEqual(['update retirementPlan'])
	})

	it('CONTROL: a plan this device never pushed is applied (an effect-rewritten screen plan is not an echo)', () => {
		store().setDesiredIncomeForLocale('55.000,00', 'de-DE')
		applyServerChangesToStores(
			[pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '50' }, 5_000)],
			USER
		)
		expect(store().plan.currentAgeInput).toBe('50')
		expect(queued()).toEqual([])
	})
})

describe('owner and session', () => {
	it('the owner is checked again when the debounce FIRES, not only when it is armed', async () => {
		store().setModel('perpetual')
		// The owner changes without the claim (which would also cancel the timer).
		useRetirementPlannerStore.setState({ ownerUserId: OTHER })
		await quiet()
		expect(queued()).toEqual([])
	})

	it('a plan owned by another account is never queued under this session', async () => {
		useRetirementPlannerStore.setState({ ownerUserId: OTHER })
		store().setModel('perpetual')
		await quiet()
		expect(queued()).toEqual([])
	})

	it('free (signed in, no bridge): no timer, no op; the OWNED edit is kept as not on the server', async () => {
		clearSyncBridge()
		store().setModel('perpetual')
		expect(hasPendingPlanEdit()).toBe(false)
		await quiet()
		expect(store().plan.model).toBe('perpetual')
		expect(store().localPlanDiverged).toBe(true)
		expect(queued()).toEqual([])
	})

	it('signed out (an unclaimed plan): no op, and NOT marked (server wins at sign-in)', async () => {
		clearSyncBridge()
		useRetirementPlannerStore.setState({ ownerUserId: '' })
		store().setModel('perpetual')
		await quiet()
		expect(store().localPlanDiverged).toBe(false)
		expect(queued()).toEqual([])
	})

	it('downgraded or signed out mid-debounce: nothing is queued, the plan is kept and marked', async () => {
		store().setModel('perpetual')
		clearSyncBridge()
		await quiet()
		expect(queued()).toEqual([])
		expect(store().plan.model).toBe('perpetual')
		expect(store().localPlanDiverged).toBe(true)
	})
})

describe('after the initial pull', () => {
	it('the server has no plan (`serverUpdatedAt` null after the pull): ONE create with the whole plan', async () => {
		useRetirementPlannerStore.setState({
			plan: { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '44' },
		})
		await expect(reconcilePlanAfterInitialPull()).resolves.toBe('seeded')
		expect(queued()).toEqual(['create retirementPlan'])
		const [, entityId, data] = handle.queueCreate.mock.calls[0] ?? []
		expect(entityId).toBe(USER)
		expect((data as { plan: RetirementPlan }).plan.currentAgeInput).toBe('44')
		store().setModel('perpetual')
		store().setModel('deplete')
		await quiet()
		expect(queued()).toEqual(['create retirementPlan'])
	})

	it('the server has a plan (the pull set `serverUpdatedAt`): nothing is sent', async () => {
		applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 2_000)], USER)
		await expect(reconcilePlanAfterInitialPull()).resolves.toBe('none')
		expect(queued()).toEqual([])
	})

	it('a plan marked as not on the server is pushed as an UPDATE, even though the server has one', async () => {
		useRetirementPlannerStore.setState({
			plan: { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '52' },
			serverUpdatedAt: new Date(2_000).toISOString(),
			localPlanDiverged: true,
		})
		applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 3_000)], USER)
		expect(store().plan.currentAgeInput).toBe('52')
		await expect(reconcilePlanAfterInitialPull()).resolves.toBe('pushed')
		await vi.advanceTimersByTimeAsync(0)
		expect(queued()).toEqual(['update retirementPlan'])
		expect(planUpdates()[0]?.baseVersion).toBe(3_000)
	})

	it('a failed seed add marks the plan as not on the server (the next session pushes it)', async () => {
		handle.queueCreate.mockRejectedValueOnce(new Error('storage full'))
		await expect(reconcilePlanAfterInitialPull()).rejects.toThrow('storage full')
		expect(store().localPlanDiverged).toBe(true)
	})

	it('another owner’s plan, no session, or a pending edit: nothing', async () => {
		useRetirementPlannerStore.setState({ ownerUserId: OTHER })
		await expect(reconcilePlanAfterInitialPull()).resolves.toBe('none')
		useRetirementPlannerStore.setState({ ownerUserId: USER })
		store().setModel('perpetual')
		await expect(reconcilePlanAfterInitialPull()).resolves.toBe('none')
		expect(queued()).toEqual([])
		clearSyncBridge()
		await expect(reconcilePlanAfterInitialPull()).resolves.toBe('none')
	})
})

describe('a refused plan edit stays on this device until a plan update is accepted', () => {
	function refusalDeps(): RefusalHandlerDeps {
		return {
			queue: {
				getAll: () => [],
				discardBatch: vi.fn(async () => ({ removed: 0, persisted: true })),
			},
			discardOperationsForDeletedProfile: vi.fn(async () => []),
			applyChanges: vi.fn(),
			lookupLocalRow: vi.fn(() => undefined),
			requestFullRepull: vi.fn(),
			notify: vi.fn(),
			markPlanRefused: notePlanOpRefused,
		}
	}

	async function refuseTheLocalPlan(deps = refusalDeps()): Promise<RetirementPlan> {
		useRetirementPlannerStore.setState({
			plan: { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '47' },
			serverUpdatedAt: new Date(1_000).toISOString(),
		})
		await handleRejectedOperations([planOp()], deps)
		return store().plan
	}

	it('refusal → full pull: the local plan is unchanged, and the notice says it is still on this device', async () => {
		const deps = refusalDeps()
		const local = await refuseTheLocalPlan(deps)
		expect(store().localPlanDiverged).toBe(true)
		expect(deps.notify).toHaveBeenCalledWith([
			expect.objectContaining({ entityType: 'retirementPlan', fallback: 'Your retirement plan' }),
		])
		applyServerChangesToStores([pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS }, 4_000)], USER)
		expect(store().plan).toEqual(local)
		expect(store().serverUpdatedAt).toBe(new Date(4_000).toISOString())
	})

	it('a later ACCEPTED plan update clears the marker, and the next pull applies again', async () => {
		await refuseTheLocalPlan()
		stampSyncedOwner([planOp({ id: 'op-plan-2', timestamp: 4_000 })], USER)
		expect(store().localPlanDiverged).toBe(false)
		applyServerChangesToStores(
			[pulledPlan({ ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '60' }, 6_000)],
			USER
		)
		expect(store().plan.currentAgeInput).toBe('60')
	})

	it('one sync: an OLDER op refused after a NEWER update was accepted leaves the marker clear', async () => {
		useRetirementPlannerStore.setState({ localPlanDiverged: false })
		// Core reports accepted before refused within one sync.
		stampSyncedOwner([planOp({ id: 'new', timestamp: 5_000 })], USER)
		await handleRejectedOperations([planOp({ id: 'old', timestamp: 3_000 })], refusalDeps())
		expect(store().localPlanDiverged).toBe(false)
	})

	it('an accepted CREATE (insert-if-absent, may have changed nothing), another entity, or another account’s op does not clear it', async () => {
		await refuseTheLocalPlan()
		stampSyncedOwner(
			[
				planOp({ id: 'c', type: 'create', timestamp: 9_000 }),
				planOp({ id: 'x', entityType: 'expense', entityId: 'row', timestamp: 9_000 }),
				planOp({ id: 'y', entityId: OTHER, userId: OTHER, timestamp: 9_000 }),
			],
			USER
		)
		expect(store().localPlanDiverged).toBe(true)
	})

	it('the same plan typed again after a refusal IS pushed (the refused one is not "synced")', async () => {
		useRetirementPlannerStore.setState({ serverUpdatedAt: new Date(1_000).toISOString() })
		store().setCurrentAgeInput('47')
		await quiet()
		expect(queued()).toEqual(['update retirementPlan'])
		await handleRejectedOperations([planOp({ timestamp: Date.now() + 1 })], refusalDeps())
		store().setCurrentAgeInput('47')
		await quiet()
		expect(queued()).toEqual(['update retirementPlan', 'update retirementPlan'])
	})

	it('an owner change and Clear local data (resetPlan) each clear it', async () => {
		await refuseTheLocalPlan()
		claimRetirementPlanFor(OTHER)
		expect(store().localPlanDiverged).toBe(false)

		claimRetirementPlanFor(USER)
		await refuseTheLocalPlan()
		store().resetPlan()
		expect(store().localPlanDiverged).toBe(false)
	})

	it('a refusal of ANOTHER account’s plan op marks nothing', async () => {
		useRetirementPlannerStore.setState({ ownerUserId: OTHER })
		await handleRejectedOperations([planOp()], refusalDeps())
		expect(store().localPlanDiverged).toBe(false)
	})

	it('is persisted only while set, and a non-boolean persisted value reads as unset', async () => {
		const persisted = () =>
			JSON.parse(localStorage.getItem(RETIREMENT_PLANNER_STORAGE_KEY) ?? '{}').state
		store().setModel('perpetual')
		expect(persisted()).not.toHaveProperty('localPlanDiverged')
		await refuseTheLocalPlan()
		expect(persisted().localPlanDiverged).toBe(true)

		localStorage.setItem(
			RETIREMENT_PLANNER_STORAGE_KEY,
			JSON.stringify({ state: { ...persisted(), localPlanDiverged: 'false' }, version: 1 })
		)
		await useRetirementPlannerStore.persist.rehydrate()
		expect(store().localPlanDiverged).toBe(false)
	})
})
