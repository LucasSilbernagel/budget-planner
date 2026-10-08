import type { ServerChange } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useCategoryStore } from '../../../stores/categoryStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import {
	RETIREMENT_PLAN_DEFAULTS,
	RETIREMENT_PLANNER_PARKED_KEY_PREFIX,
	useRetirementPlannerStore,
} from '../../../stores/retirementPlannerStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { applyServerChangesToStores, findLocalRow, stampSyncedOwner } from '../applyServerChanges'

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** Server-shaped uuid; local store fixtures below use `userId: 0`, the client free-tier shape. */
const SERVER_USER_ID = '11111111-1111-4111-8111-111111111111'

function incomeChange(overrides: Partial<ServerChange> = {}): ServerChange {
	return {
		entityType: 'incomeSource',
		entityId: UUID_A,
		data: {
			id: UUID_A,
			userId: SERVER_USER_ID,
			name: 'Salary',
			amount: 500000,
			frequency: 'monthly',
			createdAt: '2026-06-28T00:00:00.000Z',
			updatedAt: '2026-06-28T00:00:00.000Z',
		},
		updatedAt: 2000,
		isDeleted: false,
		...overrides,
	}
}

describe('applyServerChangesToStores — uuid reconciliation (Story 5-14)', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useSavingsStore.setState({ savingsGoals: [] })
	})

	it('AC-4: a client-created row pulled back yields exactly ONE row (no duplicate)', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: UUID_A,
					userId: 0,
					categoryId: null,
					name: 'Salary (local)',
					amount: 500000,
					frequency: 'monthly',
					createdAt: '2026-06-28T00:00:00.000Z',
					updatedAt: '2026-06-28T00:00:00.000Z',
				},
			],
		})

		applyServerChangesToStores(
			[incomeChange({ data: { ...incomeChange().data, name: 'Salary (server)' } })],
			SERVER_USER_ID
		)

		const rows = useIncomeStore.getState().incomeSources.filter((s) => s.id === UUID_A)
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe('Salary (server)')
		expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
	})

	it('inserts a brand-new pulled row keyed by its uuid', () => {
		applyServerChangesToStores(
			[incomeChange({ entityId: UUID_B, data: { ...incomeChange().data, id: UUID_B } })],
			SERVER_USER_ID
		)

		const sources = useIncomeStore.getState().incomeSources
		expect(sources).toHaveLength(1)
		expect(sources[0].id).toBe(UUID_B)
	})

	it('a tombstone removes the row matched by uuid', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: UUID_A,
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 500000,
					frequency: 'monthly',
					createdAt: '2026-06-28T00:00:00.000Z',
					updatedAt: '2026-06-28T00:00:00.000Z',
				},
			],
		})

		applyServerChangesToStores([incomeChange({ isDeleted: true, updatedAt: 3000 })], SERVER_USER_ID)

		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
	})

	it('P3: skips a change with a missing/empty entityId instead of inserting an orphan', () => {
		applyServerChangesToStores([incomeChange({ entityId: '' })], SERVER_USER_ID)
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
	})

	it('reconciles each entity type by uuid into its own store/collection', () => {
		applyServerChangesToStores(
			[
				{
					entityType: 'savingsGoal',
					entityId: UUID_B,
					data: {
						id: UUID_B,
						userId: SERVER_USER_ID,
						name: 'Emergency fund',
						targetAmount: 1000000,
						currentBalance: 250000,
						allocationMode: 'automatic',
						createdAt: '2026-06-28T00:00:00.000Z',
						updatedAt: '2026-06-28T00:00:00.000Z',
					},
					updatedAt: 2000,
					isDeleted: false,
				},
			],
			SERVER_USER_ID
		)

		const goals = useSavingsStore.getState().savingsGoals
		expect(goals).toHaveLength(1)
		expect(goals[0].id).toBe(UUID_B)
	})
})

const SERVER_PROFILE_DEFAULT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SERVER_PROFILE_OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function profileChange(id: string, isDefault: boolean, name: string): ServerChange {
	return {
		entityType: 'userProfile',
		entityId: id,
		data: {
			id,
			userId: SERVER_USER_ID,
			name,
			isDefault,
			currency: 'NONE',
		},
		updatedAt: 2000,
		isDeleted: false,
	}
}

describe('applyServerChangesToStores — active-profile reconciliation (Story 5-15)', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useProfileStore.setState({
			profiles: [
				{
					id: 'local-default',
					userId: '',
					name: 'Main Profile',
					isDefault: true,
					currency: 'NONE',
				},
			],
			activeProfileId: 'local-default',
		})
	})

	it('repoints a stale active profile to the pulled DEFAULT server profile', () => {
		applyServerChangesToStores(
			[
				profileChange(SERVER_PROFILE_OTHER, false, 'Side'),
				profileChange(SERVER_PROFILE_DEFAULT, true, 'Main'),
			],
			SERVER_USER_ID
		)

		expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_DEFAULT)
	})

	it('falls back to the first profile when none is marked default', () => {
		applyServerChangesToStores([profileChange(SERVER_PROFILE_OTHER, false, 'Side')], SERVER_USER_ID)
		expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_OTHER)
	})

	it('leaves an already-valid active profile untouched', () => {
		useProfileStore.setState({
			profiles: [
				{
					id: SERVER_PROFILE_DEFAULT,
					userId: SERVER_USER_ID,
					name: 'Main',
					isDefault: true,
					currency: 'NONE',
				},
			],
			activeProfileId: SERVER_PROFILE_DEFAULT,
		})

		applyServerChangesToStores([profileChange(SERVER_PROFILE_OTHER, false, 'Side')], SERVER_USER_ID)

		expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_DEFAULT)
	})

	it('does NOT touch the active profile on a non-profile (income) pull', () => {
		applyServerChangesToStores([incomeChange()], SERVER_USER_ID)
		expect(useProfileStore.getState().activeProfileId).toBe('local-default')
	})

	/** The stale active id forces the isDefault arm, the only way to observe the promotion. */
	it('lands on the PROMOTED default after the old default was deleted elsewhere', () => {
		applyServerChangesToStores(
			[
				// Promoted profile second on purpose: resolving by position would pass with it first.
				profileChange(SERVER_PROFILE_OTHER, false, 'Side'),
				profileChange(SERVER_PROFILE_DEFAULT, true, 'Promoted'),
			],
			SERVER_USER_ID
		)

		expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_DEFAULT)
		const profiles = useProfileStore.getState().profiles
		expect(profiles.filter((p) => p.isDefault)).toHaveLength(1)
		expect(profiles.find((p) => p.isDefault)?.name).toBe('Promoted')
	})
})

describe('applyServerChangesToStores — placeholder re-home on reconcile (Story 54.4, AC-6)', () => {
	const TS = '2026-09-15T00:00:00.000Z'
	const OTHER_REAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

	beforeEach(() => {
		useProfileStore.setState({
			profiles: [
				{
					id: 'local-default',
					userId: '',
					name: 'Main Profile',
					isDefault: true,
					currency: 'NONE',
				},
			],
			activeProfileId: 'local-default',
		})
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'stamped-placeholder',
					profileId: 'local-default',
					userId: 0,
					name: 'Added before the server profile arrived',
					amount: 1,
					frequency: 'monthly',
					categoryId: null,
					createdAt: TS,
					updatedAt: TS,
				},
				{
					id: 'stamped-other-real',
					profileId: OTHER_REAL,
					userId: 0,
					name: 'Belongs to a different real profile',
					amount: 2,
					frequency: 'monthly',
					categoryId: null,
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-placeholder',
					profileId: 'local-default',
					userId: 0,
					name: 'Rent',
					amount: 1,
					frequency: 'monthly',
					categoryId: null,
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
		useSavingsStore.setState({
			savingsGoals: [
				{
					id: 'sav-placeholder',
					profileId: 'local-default',
					name: 'Fund',
					targetAmount: null,
					currentBalance: 1,
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
		useBalanceStore.setState({
			entries: [
				{
					id: 'bal-placeholder',
					profileId: 'local-default',
					type: 'investment',
					name: 'ISA',
					currentBalance: 1,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
		useCategoryStore.setState({
			categories: [
				{
					id: 'cat-placeholder',
					userId: 0,
					profileId: 'local-default',
					name: 'Groceries',
					kind: 'expense',
					isDeleted: false,
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
	})

	it('re-homes rows and categories stamped with a dropped placeholder onto the new active profile', () => {
		applyServerChangesToStores(
			[profileChange(SERVER_PROFILE_DEFAULT, true, 'Main')],
			SERVER_USER_ID
		)

		expect(useProfileStore.getState().activeProfileId).toBe(SERVER_PROFILE_DEFAULT)
		const income = useIncomeStore.getState().incomeSources
		expect(income.find((row) => row.id === 'stamped-placeholder')?.profileId).toBe(
			SERVER_PROFILE_DEFAULT
		)
		expect(useExpenseStore.getState().expenses[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
		expect(useSavingsStore.getState().savingsGoals[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
		expect(useBalanceStore.getState().entries[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
		expect(useCategoryStore.getState().categories[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
	})

	it('leaves a row stamped with a different REAL profile untouched', () => {
		// A guard comparing profile objects by identity rather than id would re-home this profile's rows.
		useProfileStore.setState({
			profiles: [
				{
					id: 'local-default',
					userId: '',
					name: 'Main Profile',
					isDefault: true,
					currency: 'NONE',
				},
				{
					id: OTHER_REAL,
					userId: SERVER_USER_ID,
					name: 'Real',
					isDefault: false,
					currency: 'NONE',
				},
			],
			activeProfileId: 'local-default',
		})

		applyServerChangesToStores(
			[profileChange(SERVER_PROFILE_DEFAULT, true, 'Main')],
			SERVER_USER_ID
		)

		const income = useIncomeStore.getState().incomeSources
		expect(income.find((row) => row.id === 'stamped-other-real')?.profileId).toBe(OTHER_REAL)
	})

	it('re-homes nothing when no placeholder was dropped', () => {
		useProfileStore.setState({
			profiles: [
				{ id: OTHER_REAL, userId: SERVER_USER_ID, name: 'Real', isDefault: true, currency: 'NONE' },
			],
			activeProfileId: OTHER_REAL,
		})

		applyServerChangesToStores([profileChange(SERVER_PROFILE_OTHER, false, 'Side')], SERVER_USER_ID)

		const income = useIncomeStore.getState().incomeSources
		expect(income.find((row) => row.id === 'stamped-placeholder')?.profileId).toBe('local-default')
	})

	it('keeps the placeholder when a store write throws, so the next reconcile finishes the re-home', () => {
		const original = useExpenseStore.setState
		useExpenseStore.setState = () => {
			throw new Error('QuotaExceededError')
		}
		try {
			applyServerChangesToStores(
				[profileChange(SERVER_PROFILE_DEFAULT, true, 'Main')],
				SERVER_USER_ID
			)
		} finally {
			useExpenseStore.setState = original
		}

		expect(useProfileStore.getState().profiles.map((p) => p.id)).toContain('local-default')

		applyServerChangesToStores(
			[profileChange(SERVER_PROFILE_DEFAULT, true, 'Main')],
			SERVER_USER_ID
		)
		expect(useExpenseStore.getState().expenses[0]?.profileId).toBe(SERVER_PROFILE_DEFAULT)
		expect(useProfileStore.getState().profiles.map((p) => p.id)).not.toContain('local-default')
	})
})

describe('applyServerChangesToStores — profile icon (Story 54.2)', () => {
	beforeEach(() => {
		useProfileStore.setState({ profiles: [], activeProfileId: null })
	})

	it('lands a pulled icon in the store', () => {
		applyServerChangesToStores(
			[
				{
					entityType: 'userProfile',
					entityId: SERVER_PROFILE_OTHER,
					data: {
						id: SERVER_PROFILE_OTHER,
						userId: SERVER_USER_ID,
						name: 'Business',
						isDefault: false,
						currency: 'EUR',
						icon: '✈️',
					},
					updatedAt: 2000,
					isDeleted: false,
				},
			],
			SERVER_USER_ID
		)

		const stored = useProfileStore.getState().profiles.find((p) => p.id === SERVER_PROFILE_OTHER)
		expect(stored?.icon).toBe('✈️')
	})

	it('lands an explicit null icon without dropping the key or throwing', () => {
		applyServerChangesToStores(
			[
				{
					entityType: 'userProfile',
					entityId: SERVER_PROFILE_OTHER,
					data: {
						id: SERVER_PROFILE_OTHER,
						userId: SERVER_USER_ID,
						name: 'Business',
						isDefault: false,
						currency: 'EUR',
						icon: null,
					},
					updatedAt: 2000,
					isDeleted: false,
				},
			],
			SERVER_USER_ID
		)

		const stored = useProfileStore.getState().profiles.find((p) => p.id === SERVER_PROFILE_OTHER)
		expect(stored).toBeDefined()
		expect(stored?.icon).toBeNull()
	})
})

describe('a pulled userProfile tombstone cascades locally (story 66.3)', () => {
	const DOOMED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

	beforeEach(() => {
		useProfileStore.setState({
			profiles: [
				{ id: DOOMED, userId: SERVER_USER_ID, name: 'Business', isDefault: false, currency: 'EUR' },
				{ id: UUID_A, userId: SERVER_USER_ID, name: 'Main', isDefault: true, currency: 'EUR' },
			],
			activeProfileId: UUID_A,
		} as never)
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'i-doomed',
					userId: 0,
					profileId: DOOMED,
					name: 'Consulting',
					amount: 1,
					frequency: 'monthly',
				},
				{
					id: 'i-keeper',
					userId: 0,
					profileId: UUID_A,
					name: 'Salary',
					amount: 2,
					frequency: 'monthly',
				},
				{
					id: 'i-legacy',
					userId: 0,
					profileId: null,
					name: 'Legacy',
					amount: 3,
					frequency: 'monthly',
				},
			],
		} as never)
		useCategoryStore.setState({
			categories: [
				{
					id: 'c-doomed',
					userId: 0,
					profileId: DOOMED,
					name: 'Software',
					kind: 'expense',
					isDeleted: false,
				},
			],
		} as never)
	})

	it('removes the profile AND its rows, keeping the survivor and the unscoped row', () => {
		applyServerChangesToStores(
			[
				{
					entityType: 'userProfile',
					entityId: DOOMED,
					data: {},
					isDeleted: true,
					updatedAt: Date.now(),
				} as ServerChange,
			],
			SERVER_USER_ID
		)

		expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([UUID_A])
		expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).toEqual([
			'i-keeper',
			'i-legacy',
		])
		expect(useCategoryStore.getState().categories).toEqual([])
	})

	/** Negative control. It also asserts the income tombstone applied, or it could pass vacuously. */
	it('does NOT cascade on a tombstone for any other entity type', () => {
		applyServerChangesToStores(
			[
				{
					entityType: 'incomeSource',
					entityId: 'i-keeper',
					data: {},
					isDeleted: true,
					updatedAt: Date.now(),
				} as ServerChange,
			],
			SERVER_USER_ID
		)

		expect(useIncomeStore.getState().incomeSources.map((r) => r.id)).not.toContain('i-keeper')
		expect(useCategoryStore.getState().categories.map((r) => r.id)).toEqual(['c-doomed'])
		expect(useProfileStore.getState().profiles).toHaveLength(2)
	})
})

describe('the retirement plan (story 99.2)', () => {
	const PLAN = {
		...RETIREMENT_PLAN_DEFAULTS,
		currentAgeInput: '41',
		desiredIncomeInput: '55.000,00',
		desiredIncomeTouched: true,
		desiredIncomeLocale: 'de-DE',
		model: 'perpetual' as const,
	}
	const LOCAL = { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '50' }
	const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222'

	function planChange(overrides: Partial<ServerChange> = {}): ServerChange {
		return {
			entityType: 'retirementPlan',
			entityId: SERVER_USER_ID,
			data: {
				id: SERVER_USER_ID,
				userId: SERVER_USER_ID,
				plan: PLAN,
				isDeleted: false,
				createdAt: '2026-10-05T00:00:00.000Z',
				updatedAt: '2026-10-05T00:00:00.000Z',
			},
			updatedAt: Date.parse('2026-10-05T12:00:00.000Z'),
			isDeleted: false,
			...overrides,
		}
	}

	beforeEach(() => {
		useRetirementPlannerStore.setState({
			plan: { ...LOCAL },
			ownerUserId: SERVER_USER_ID,
			serverUpdatedAt: null,
		})
	})

	it('AC-3: replaces the plan, owned by the session, stamped with the server version', () => {
		applyServerChangesToStores([planChange()], SERVER_USER_ID)
		const state = useRetirementPlannerStore.getState()
		expect(state.plan).toEqual(PLAN)
		expect(state.ownerUserId).toBe(SERVER_USER_ID)
		expect(state.serverUpdatedAt).toBe('2026-10-05T12:00:00.000Z')
	})

	it('AC-3: rebuilds the pulled plan through coerceRetirementPlan (lenient pull, coerced fields)', () => {
		applyServerChangesToStores(
			[planChange({ data: { plan: { currentAgeInput: 7, model: 'hybrid', extra: 1 } } })],
			SERVER_USER_ID
		)
		expect(useRetirementPlannerStore.getState().plan).toEqual(RETIREMENT_PLAN_DEFAULTS)
	})

	it('D9 / AC-7: a plan TOMBSTONE is a store no-op', () => {
		// A full row: the no-op must not depend on an empty payload.
		applyServerChangesToStores([planChange({ isDeleted: true })], SERVER_USER_ID)
		applyServerChangesToStores([planChange({ isDeleted: true, data: {} })], SERVER_USER_ID)
		expect(useRetirementPlannerStore.getState().plan).toEqual(LOCAL)
		expect(useRetirementPlannerStore.getState().serverUpdatedAt).toBeNull()
	})

	it('AC-4: while a plan op is still queued, the local plan is NOT overwritten', () => {
		const asked: [string, string][] = []
		applyServerChangesToStores([planChange()], SERVER_USER_ID, {
			hasPendingOperation: (entityType, entityId) => {
				asked.push([entityType, entityId])
				return true
			},
		})
		expect(asked).toEqual([['retirementPlan', SERVER_USER_ID]])
		expect(useRetirementPlannerStore.getState().plan).toEqual(LOCAL)
	})

	it('AC-4 CONTROL: with nothing queued, the same change applies', () => {
		applyServerChangesToStores([planChange()], SERVER_USER_ID, {
			hasPendingOperation: () => false,
		})
		expect(useRetirementPlannerStore.getState().plan).toEqual(PLAN)
	})

	it('refuses a plan whose id is not the session account (D3)', () => {
		applyServerChangesToStores([planChange({ entityId: OTHER_ACCOUNT })], SERVER_USER_ID)
		expect(useRetirementPlannerStore.getState().plan).toEqual(LOCAL)
	})

	it('never writes the DEFAULTS over the plan for a non-object plan (the coercion would)', () => {
		applyServerChangesToStores([planChange({ data: { plan: null } })], SERVER_USER_ID)
		expect(useRetirementPlannerStore.getState().plan).toEqual(LOCAL)
	})

	it("parks ANOTHER account's plan before overwriting it (90.1 boundary not yet applied)", () => {
		const parked = `${RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${OTHER_ACCOUNT}`
		const stored = new Map<string, string>()
		const storage = {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => stored.set(key, value),
			removeItem: (key: string) => stored.delete(key),
		}
		vi.stubGlobal('localStorage', storage)
		try {
			useRetirementPlannerStore.setState({ ownerUserId: OTHER_ACCOUNT })
			applyServerChangesToStores([planChange()], SERVER_USER_ID)
			expect(JSON.parse(stored.get(parked) ?? 'null')).toEqual(LOCAL)
			expect(useRetirementPlannerStore.getState().plan).toEqual(PLAN)
			expect(useRetirementPlannerStore.getState().ownerUserId).toBe(SERVER_USER_ID)
		} finally {
			vi.unstubAllGlobals()
		}
	})

	it('findLocalRow reads the plan for its owner only', () => {
		expect(findLocalRow('retirementPlan', SERVER_USER_ID)).toEqual({
			id: SERVER_USER_ID,
			plan: LOCAL,
		})
		expect(findLocalRow('retirementPlan', OTHER_ACCOUNT)).toBeUndefined()
	})

	it('stampSyncedOwner leaves the plan alone (a singleton has no placeholder owner)', () => {
		useRetirementPlannerStore.setState({ ownerUserId: '' })
		stampSyncedOwner(
			[
				{
					id: 'op-1',
					type: 'update',
					entityType: 'retirementPlan',
					entityId: SERVER_USER_ID,
					data: {},
					timestamp: 1,
					deviceId: 'd',
					userId: SERVER_USER_ID,
				},
			],
			SERVER_USER_ID
		)
		expect(useRetirementPlannerStore.getState().ownerUserId).toBe('')
	})

	it('a plan in the same batch as a profile does not break the profile reconcile or re-home', () => {
		useProfileStore.setState({ profiles: [], activeProfileId: null })
		applyServerChangesToStores(
			[
				planChange(),
				{
					entityType: 'userProfile',
					entityId: UUID_B,
					data: { id: UUID_B, userId: SERVER_USER_ID, name: 'Main', isDefault: true },
					updatedAt: 3000,
					isDeleted: false,
				},
			],
			SERVER_USER_ID
		)
		expect(useProfileStore.getState().activeProfileId).toBe(UUID_B)
		expect(useRetirementPlannerStore.getState().plan).toEqual(PLAN)
	})
})
