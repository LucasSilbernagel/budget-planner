// A client gate refusal throws before `queue.add`, so tests check the queue, not just the throw.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { INCOME_BASES, RETIREMENT_MODELS } from '../../finance/retirement'
import { SyncQueue } from '../queue'
import { SynchronizationService } from '../synchronization'
import {
	RETIREMENT_ADOPTED_CENTS_MAX,
	RETIREMENT_PLAN_STRING_MAX,
	retirementPlanSyncSchema,
	SERVER_ROW_SCHEMAS,
	type ServerChange,
	type SyncOperation,
	type SyncQueueStorage,
	type SyncState,
	syncOperationDataSchema,
	validateServerRow,
} from '../types'

const USER = '11111111-1111-4111-8111-111111111111'
const PROFILE = '22222222-2222-4222-8222-222222222222'
const ISO = '2026-10-05T00:00:00.000Z'

/** Every field non-default so a dropped key cannot pass by luck. */
const PLAN = {
	currentAgeInput: '41',
	lifeExpectancyInput: '88',
	desiredIncomeInput: '55.000,00',
	desiredIncomeTouched: true,
	desiredIncomeLocale: 'de-DE',
	adoptedMonthlyCents: 240_000,
	incomeBasis: 'monthly',
	annualReturnInput: '5.5',
	postRetirementReturnInput: '3.0',
	postRetirementTouched: true,
	model: 'perpetual',
} as const

type Internals = { queue: SyncQueue; state: SyncState }

function createStorage(): SyncQueueStorage {
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

describe('G3: retirementPlanSyncSchema (the push gate)', () => {
	it('accepts a whole plan and returns every key unchanged', () => {
		expect(retirementPlanSyncSchema.parse(PLAN)).toEqual(PLAN)
	})

	it.each(Object.keys(PLAN))('REQUIRES %s (no .default(), no .optional())', (key) => {
		const { [key]: _dropped, ...rest } = PLAN as Record<string, unknown>
		expect(retirementPlanSyncSchema.safeParse(rest).success).toBe(false)
	})

	it('carries a cleared field as the empty string and an un-adopted figure as null', () => {
		const cleared = { ...PLAN, currentAgeInput: '', adoptedMonthlyCents: null }
		expect(retirementPlanSyncSchema.parse(cleared)).toEqual(cleared)
	})

	it('takes its enums from the ONE exported constant each (no hand-mirrored list)', () => {
		expect(retirementPlanSyncSchema.shape.incomeBasis.options).toEqual([...INCOME_BASES])
		expect(retirementPlanSyncSchema.shape.model.options).toEqual([...RETIREMENT_MODELS])
	})

	it('bounds adoptedMonthlyCents at the largest value whose ×12 is a safe integer', () => {
		expect(Number.isSafeInteger(RETIREMENT_ADOPTED_CENTS_MAX * 12)).toBe(true)
		expect(Number.isSafeInteger((RETIREMENT_ADOPTED_CENTS_MAX + 1) * 12)).toBe(false)
		const at = { ...PLAN, adoptedMonthlyCents: RETIREMENT_ADOPTED_CENTS_MAX }
		const over = { ...PLAN, adoptedMonthlyCents: RETIREMENT_ADOPTED_CENTS_MAX + 1 }
		expect(retirementPlanSyncSchema.safeParse(at).success).toBe(true)
		expect(retirementPlanSyncSchema.safeParse(over).success).toBe(false)
		expect(retirementPlanSyncSchema.safeParse({ ...PLAN, adoptedMonthlyCents: -1 }).success).toBe(
			false
		)
		expect(retirementPlanSyncSchema.safeParse({ ...PLAN, adoptedMonthlyCents: 1.5 }).success).toBe(
			false
		)
	})

	it('bounds every string', () => {
		const long = 'x'.repeat(RETIREMENT_PLAN_STRING_MAX + 1)
		expect(retirementPlanSyncSchema.safeParse({ ...PLAN, currentAgeInput: long }).success).toBe(
			false
		)
	})
})

describe('G2: syncOperationDataSchema carries the plan', () => {
	it('keeps the WHOLE nested plan (a missing declaration would strip it)', () => {
		expect(syncOperationDataSchema.parse({ plan: PLAN, userId: USER })).toEqual({
			plan: PLAN,
			userId: USER,
		})
	})

	it('strips an undeclared NESTED key, which is why the parity pin exists', () => {
		const parsed = syncOperationDataSchema.parse({ plan: { ...PLAN, extra: 1 }, userId: USER })
		expect(parsed['plan']).toEqual(PLAN)
	})
})

describe('G2 + AC-6a: the queue gate, through the real service', () => {
	let queue: SyncQueue
	let service: SynchronizationService

	beforeEach(async () => {
		service = new SynchronizationService(USER, {
			autoSync: false,
			processOperation: vi.fn(async () => ({ success: true })),
			profileId: PROFILE,
		})
		queue = new SyncQueue(USER, createStorage())
		await queue.initialize()
		;(service as unknown as Internals).queue = queue
	})

	afterEach(() => {
		service.destroy()
	})

	it('queues an update carrying every plan field', async () => {
		await service.queueUpdate('retirementPlan', USER, { plan: PLAN, userId: USER }, USER)
		const [queued] = queue.getAll()
		expect(queued?.entityType).toBe('retirementPlan')
		expect(queued?.data).toEqual({ plan: PLAN, userId: USER })
	})

	it('refuses a plan op with NO plan before queue.add — nothing queued', async () => {
		await expect(
			service.queueUpdate('retirementPlan', USER, { userId: USER }, USER)
		).rejects.toThrow()
		expect(queue.getAll()).toEqual([])
	})

	it('refuses a plan op whose plan is missing a field — nothing queued', async () => {
		const { model: _model, ...partial } = PLAN
		await expect(
			service.queueCreate('retirementPlan', USER, { plan: partial, userId: USER }, USER)
		).rejects.toThrow()
		expect(queue.getAll()).toEqual([])
	})

	it('refuses a plan DELETE (the plan has no delete op) — nothing queued', async () => {
		await expect(service.queueDelete('retirementPlan', USER, USER)).rejects.toThrow()
		expect(queue.getAll()).toEqual([])
	})

	it('CONTROL — the refinement is per-entity: an income update without a plan still queues', async () => {
		await service.queueUpdate('incomeSource', PROFILE, { name: 'Salary' }, USER)
		expect(queue.getAll()).toHaveLength(1)
	})
})

describe('G4: the LENIENT pull gate', () => {
	const planRow = (plan: unknown, overrides: Partial<ServerChange> = {}): ServerChange => ({
		entityType: 'retirementPlan',
		entityId: USER,
		data: { id: USER, userId: USER, plan, isDeleted: false, createdAt: ISO, updatedAt: ISO },
		updatedAt: 2_000,
		isDeleted: false,
		...overrides,
	})

	it('is registered for retirementPlan', () => {
		expect(SERVER_ROW_SCHEMAS.retirementPlan).toBeDefined()
	})

	it('accepts a whole plan', () => {
		expect(validateServerRow(planRow(PLAN))).toEqual({ ok: true })
	})

	it('accepts a plan from a NEWER client (an unknown field, a value this client would coerce)', () => {
		expect(validateServerRow(planRow({ ...PLAN, futureField: 7, model: 'hybrid' }))).toEqual({
			ok: true,
		})
	})

	it.each([
		['null', null],
		['an array', []],
		['a string', '{}'],
		['a number', 3],
	])('refuses a plan that is %s (AC-6g), naming the field and no value', (_label, plan) => {
		const verdict = validateServerRow(planRow(plan))
		expect(verdict.ok).toBe(false)
		expect(verdict.ok === false && verdict.fields).toEqual(['plan:invalid_type'])
	})

	it('refuses a row whose userId is not a uuid', () => {
		const change = planRow(PLAN)
		change.data['userId'] = 'nope'
		expect(validateServerRow(change).ok).toBe(false)
	})
})

describe('G5: a plan op is never stranded by a deleted profile', () => {
	let queue: SyncQueue
	let service: SynchronizationService
	let fetchServerChanges: Mock<(since: number | null) => Promise<ServerChange[]>>

	const planOp = (id: string): SyncOperation => ({
		id,
		type: 'update',
		entityType: 'retirementPlan',
		entityId: USER,
		data: { plan: PLAN, userId: USER },
		timestamp: 1_000,
		deviceId: 'device-b',
		userId: USER,
		profileId: PROFILE,
	})
	const childOp = {
		id: 'child',
		type: 'update',
		entityType: 'incomeSource',
		entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		data: { name: 'Salary' },
		timestamp: 1_000,
		deviceId: 'device-b',
		userId: USER,
		profileId: PROFILE,
	} satisfies SyncOperation

	beforeEach(async () => {
		fetchServerChanges = vi.fn(async (_since: number | null) => [] as ServerChange[])
		service = new SynchronizationService(USER, {
			autoSync: false,
			processOperation: vi.fn(async () => ({ success: true })),
			fetchServerChanges,
		})
		queue = new SyncQueue(USER, createStorage())
		await queue.initialize()
		;(service as unknown as Internals).queue = queue
		;(service as unknown as Internals).state.isOnline = true
	})

	afterEach(() => {
		service.destroy()
	})

	it('a pulled profile TOMBSTONE drops the child op and KEEPS the plan op', async () => {
		await queue.add(planOp('plan'))
		await queue.add(childOp)
		fetchServerChanges.mockResolvedValueOnce([
			{
				entityType: 'userProfile',
				entityId: PROFILE,
				data: {},
				updatedAt: 2_000,
				isDeleted: true,
			},
		])

		await service.pull()

		expect(queue.getAll().map((o) => o.id)).toEqual(['plan'])
	})

	it('discardOperationsForDeletedProfile drops the child op and KEEPS the plan op', async () => {
		await queue.add(planOp('plan'))
		await queue.add(childOp)

		const dropped = await service.discardOperationsForDeletedProfile(PROFILE)

		expect(dropped.map((o) => o.id)).toEqual(['child'])
		expect(queue.getAll().map((o) => o.id)).toEqual(['plan'])
	})
})
