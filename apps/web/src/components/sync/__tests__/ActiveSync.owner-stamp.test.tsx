import type { ServerChange } from '@budget-planner/core/sync'
import { cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/api/client', () => ({
	fetchServerChangesWithMeta: vi.fn(),
	sendSyncOperation: vi.fn(),
}))

import { fetchServerChangesWithMeta, sendSyncOperation } from '@/features/api/client'
import { useProfileManager } from '@/hooks/useActiveProfile'
import { resetSyncStore } from '@/hooks/useSync'
import { purgeLocalFinancialData } from '@/lib/account/purge-local-financial-data'
import { seedMarkerKey } from '@/lib/sync/seedLocalData'
import { resetSessionStatusStore } from '@/lib/sync/sessionStatusStore'
import { clearSyncBridge, isSyncActive, syncEntityDelete } from '@/lib/sync/syncBridge'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import { useSavingsStore } from '@/stores/savingsStore'
import { ActiveSync } from '../ActiveSync'

const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000863'
const OTHER_ACCOUNT = 'bbbbbbbb-0000-4000-8000-000000000863'
const A_MAIN = 'aaaaaaaa-1111-4111-8111-111111111863'
const ROW = 'cccccccc-1111-4111-8111-111111111863'
const ISO = '2026-09-01T00:00:00.000Z'

const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const A_MAIN_CHANGE: ServerChange = {
	entityType: 'userProfile',
	entityId: A_MAIN,
	data: { id: A_MAIN, userId: ACCOUNT_A, name: 'Main Profile', isDefault: true, currency: 'NONE' },
	updatedAt: 1000,
	isDeleted: false,
}

function sent(): string[] {
	return send.mock.calls.map(([op]) => {
		const { type, entityType, entityId } = op as Record<string, string>
		return `${type} ${entityType} ${entityId}`
	})
}

function queued(): string[] {
	const ops = JSON.parse(localStorage.getItem(`bp-sync-queue-${ACCOUNT_A}`) ?? '[]') as {
		type: string
		entityType: string
		entityId: string
	}[]
	return ops.map((op) => `${op.type} ${op.entityType} ${op.entityId}`)
}

function incomeRow(id: string): Record<string, unknown> | undefined {
	return useIncomeStore.getState().incomeSources.find((r) => r.id === id) as
		| Record<string, unknown>
		| undefined
}

function seedFreeRow(): void {
	useIncomeStore.setState({
		incomeSources: [
			{
				id: ROW,
				userId: 0,
				profileId: A_MAIN,
				name: 'Rent income',
				amount: 90_000,
				frequency: 'monthly',
				categoryId: null,
				sortOrder: 0,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
}

function holdSendFor(entityId: string): { release: (result: unknown) => void } {
	let release: (result: unknown) => void = () => {}
	const held = new Promise((r) => {
		release = r
	})
	send.mockImplementation(async (op: { entityId: string }) =>
		op.entityId === entityId ? held : { success: true }
	)
	return { release }
}

async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 200))
}

async function signInAsA(): Promise<void> {
	render(<ActiveSync userId={ACCOUNT_A} />)
	await waitFor(() => expect(isSyncActive()).toBe(true))
	await waitFor(() => expect(fetchMeta).toHaveBeenCalled())
	await new Promise((r) => setTimeout(r, 50))
	expect(useProfileStore.getState().activeProfileId).toBe(A_MAIN)
}

beforeEach(() => {
	vi.clearAllMocks()
	resetSyncStore()
	resetSessionStatusStore()
	clearSyncBridge()
	localStorage.clear()
	localStorage.setItem('sync:hasCompletedInitialPull', '1')
	// The backlog was seeded earlier, so every op a test sees is one the test made.
	localStorage.setItem(seedMarkerKey(ACCOUNT_A), '1')
	useProfileStore.setState({
		profiles: [
			{ id: A_MAIN, userId: ACCOUNT_A, name: 'Main Profile', isDefault: true, currency: 'NONE' },
		],
		activeProfileId: A_MAIN,
	})
	useIncomeStore.setState({ incomeSources: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	fetchMeta.mockResolvedValue({ changes: [A_MAIN_CHANGE], profileIds: [A_MAIN] })
	send.mockResolvedValue({ success: true })
})

afterEach(() => {
	cleanup()
	clearSyncBridge()
})

describe('an accepted push marks the row as this account’s, before any pull', () => {
	it('stamps a Profiles-page profile, an income row and a savings goal with the session id', async () => {
		await signInAsA()

		const manager = renderHook(() => useProfileManager())
		const profile = manager.result.current.createProfile({
			name: 'Side',
			isDefault: false,
			currency: 'NONE',
			userId: 'temp-user',
		})
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 100_000, frequency: 'monthly' })
		const income = useIncomeStore.getState().incomeSources[0] as { id: string }
		const goal = useSavingsStore
			.getState()
			.addSavingsGoal({ name: 'Rainy day', targetAmount: 50_000, currentBalance: 0 })
		expect(useProfileStore.getState().profiles.find((p) => p.id === profile.id)?.userId).toBe(
			'temp-user'
		)
		expect(useIncomeStore.getState().incomeSources[0]?.userId).toBe(0)
		expect(useSavingsStore.getState().savingsGoals[0]).not.toHaveProperty('userId')
		const pullsBeforePush = fetchMeta.mock.calls.length

		await waitFor(
			() =>
				expect(sent()).toEqual(
					expect.arrayContaining([
						`create userProfile ${profile.id}`,
						`create incomeSource ${income.id}`,
						`create savingsGoal ${goal.id}`,
					])
				),
			{ timeout: 6000 }
		)

		await new Promise((r) => setTimeout(r, 200))
		expect
			.soft(useProfileStore.getState().profiles.find((p) => p.id === profile.id)?.userId)
			.toBe(ACCOUNT_A)
		expect
			.soft(useIncomeStore.getState().incomeSources.find((r) => r.id === income.id)?.userId)
			.toBe(ACCOUNT_A)
		expect
			.soft(
				(
					useSavingsStore.getState().savingsGoals.find((r) => r.id === goal.id) as {
						userId?: unknown
					}
				)?.userId
			)
			.toBe(ACCOUNT_A)
		expect(fetchMeta.mock.calls.length).toBe(pullsBeforePush)
	}, 15_000)
})

describe('what is NOT stamped', () => {
	it.each([
		[
			'refused permanently (422)',
			{ success: false, retryable: false, statusCode: 422, error: 'no' },
		],
		[
			'kept queued (no rejection, e.g. "Profile not found")',
			{ success: false, retryable: false, error: 'Profile not found' },
		],
		['answered with a conflict', { success: false, conflict: true }],
		['a retryable failure', { success: false, retryable: true, error: 'boom' }],
	])(
		'an update %s leaves the row’s placeholder',
		async (_label, outcome) => {
			seedFreeRow()
			send.mockImplementation(async (op: { entityId: string }) =>
				op.entityId === ROW ? outcome : { success: true }
			)
			await signInAsA()

			useIncomeStore.getState().updateIncomeSource(ROW, { name: 'Rent income (edited)' })
			await waitFor(() => expect(sent()).toContain(`update incomeSource ${ROW}`), {
				timeout: 6000,
			})
			await settle()

			expect(incomeRow(ROW)?.['userId']).toBe(0)
		},
		15_000
	)

	it('a push that lands after sign-out (79.1 teardown) stamps nothing', async () => {
		seedFreeRow()
		const held = holdSendFor(ROW)
		await signInAsA()
		useIncomeStore.getState().updateIncomeSource(ROW, { name: 'Rent income (edited)' })
		await waitFor(() => expect(sent()).toContain(`update incomeSource ${ROW}`), {
			timeout: 6000,
		})

		cleanup()
		held.release({ success: true })
		await settle()

		expect(incomeRow(ROW)?.['userId']).toBe(0)
	}, 15_000)

	it('a row cleared (86.1) while its accepted push was in flight is not re-created', async () => {
		await signInAsA()
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 100_000, frequency: 'monthly' })
		const id = (useIncomeStore.getState().incomeSources[0] as { id: string }).id
		const held = holdSendFor(id)
		await waitFor(() => expect(sent()).toContain(`create incomeSource ${id}`), { timeout: 6000 })

		await purgeLocalFinancialData(ACCOUNT_A)
		expect(useIncomeStore.getState().incomeSources).toEqual([])
		held.release({ success: true })
		await settle()

		expect(useIncomeStore.getState().incomeSources).toEqual([])
	}, 15_000)
})

describe('what a stamp may change', () => {
	it('only `userId`, by a plain write: no other field moves and no sync op is queued', async () => {
		await signInAsA()
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 100_000, frequency: 'monthly' })
		const before = {
			...(useIncomeStore.getState().incomeSources[0] as unknown as Record<string, unknown>),
		}
		await waitFor(() => expect(sent()).toContain(`create incomeSource ${before['id']}`), {
			timeout: 6000,
		})
		await settle()

		expect(incomeRow(before['id'] as string)).toEqual({ ...before, userId: ACCOUNT_A })
		expect(queued()).toEqual([])
		expect(sent()).toEqual([`create incomeSource ${before['id']}`])
	}, 15_000)

	it('a row carrying another real id is left alone', async () => {
		seedFreeRow()
		const held = holdSendFor(ROW)
		await signInAsA()
		useIncomeStore.getState().updateIncomeSource(ROW, { name: 'Rent income (edited)' })
		await waitFor(() => expect(sent()).toContain(`update incomeSource ${ROW}`), {
			timeout: 6000,
		})

		useIncomeStore.setState({
			incomeSources: useIncomeStore
				.getState()
				.incomeSources.map((r) => (r.id === ROW ? { ...r, userId: OTHER_ACCOUNT } : r)),
		})
		held.release({ success: true })
		await settle()

		expect(incomeRow(ROW)?.['userId']).toBe(OTHER_ACCOUNT)
	}, 15_000)

	it('a row removed locally after its op was queued is not brought back', async () => {
		seedFreeRow()
		const held = holdSendFor(ROW)
		await signInAsA()
		useIncomeStore.getState().updateIncomeSource(ROW, { name: 'Rent income (edited)' })
		await waitFor(() => expect(sent()).toContain(`update incomeSource ${ROW}`), {
			timeout: 6000,
		})

		useIncomeStore.setState({ incomeSources: [] })
		held.release({ success: true })
		await settle()

		expect(useIncomeStore.getState().incomeSources).toEqual([])
	}, 15_000)

	it('an accepted DELETE stamps nothing', async () => {
		seedFreeRow()
		await signInAsA()
		syncEntityDelete('incomeSource', incomeRow(ROW) as { id: string })
		await waitFor(() => expect(sent()).toContain(`delete incomeSource ${ROW}`), {
			timeout: 6000,
		})
		await settle()

		expect(incomeRow(ROW)?.['userId']).toBe(0)
	}, 15_000)

	it('an accepted op queued under ANOTHER user id stamps nothing', async () => {
		seedFreeRow()
		localStorage.setItem(
			`bp-sync-queue-${ACCOUNT_A}`,
			JSON.stringify([
				{
					id: 'op-other',
					type: 'update',
					entityType: 'incomeSource',
					entityId: ROW,
					data: {
						userId: OTHER_ACCOUNT,
						name: 'Rent income',
						amount: 90_000,
						frequency: 'monthly',
					},
					timestamp: 1_000,
					deviceId: 'device-test',
					userId: OTHER_ACCOUNT,
					profileId: A_MAIN,
				},
			])
		)
		await signInAsA()
		await waitFor(() => expect(sent()).toContain(`update incomeSource ${ROW}`), {
			timeout: 6000,
		})
		await settle()

		expect(incomeRow(ROW)?.['userId']).toBe(0)
	}, 15_000)
})
