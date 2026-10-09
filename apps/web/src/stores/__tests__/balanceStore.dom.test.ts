import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearSyncBridge,
	registerSyncBridge,
	type SyncBridgeHandle,
} from '../../lib/sync/syncBridge'
import { useBalanceStore } from '../balanceStore'

const STORAGE_KEY = 'budget-planner:balance-tracking'

beforeEach(() => {
	localStorage.clear()
	useBalanceStore.setState({ entries: [] })
})

describe('balanceStore — v1→v2 frequency backfill', () => {
	it('backfills frequency=monthly for a legacy v1 row lacking one', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 1,
				state: {
					entries: [
						{
							id: 'legacy-uuid-1',
							type: 'investment',
							name: 'Old Brokerage',
							currentBalance: 10000,
							monthlyContribution: 500,
							createdAt: '2024-01-01T00:00:00Z',
							updatedAt: '2024-01-01T00:00:00Z',
						},
					],
				},
			})
		)

		await useBalanceStore.persist.rehydrate()

		const [entry] = useBalanceStore.getState().entries
		expect(entry.frequency).toBe('monthly')
		expect(entry.name).toBe('Old Brokerage')
		expect(entry.monthlyContribution).toBe(500)
		expect(entry.id).toBe('legacy-uuid-1')
	})

	it('preserves an already-present frequency on migration', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 1,
				state: {
					entries: [
						{
							id: 'legacy-uuid-2',
							type: 'debt',
							name: 'Loan',
							currentBalance: -5000,
							monthlyContribution: 100,
							frequency: 'weekly',
							createdAt: '2024-01-01T00:00:00Z',
							updatedAt: '2024-01-01T00:00:00Z',
						},
					],
				},
			})
		)

		await useBalanceStore.persist.rehydrate()

		expect(useBalanceStore.getState().entries[0].frequency).toBe('weekly')
	})
})

describe('balanceStore — partial update validation', () => {
	it('accepts a partial update that omits frequency and preserves the stored cadence', () => {
		const created = useBalanceStore.getState().addBalanceEntry({
			type: 'investment',
			name: 'Brokerage',
			currentBalance: 10000,
			monthlyContribution: 500,
			frequency: 'weekly',
		})
		expect(created).not.toBeNull()
		if (!created) return

		// Validation runs against the merged entry, not the raw partial.
		const updated = useBalanceStore.getState().updateBalanceEntry(created.id, { name: 'Renamed' })
		expect(updated).not.toBeNull()
		expect(updated?.name).toBe('Renamed')
		expect(updated?.frequency).toBe('weekly')
	})
})

describe('balanceStore — the asset type persists and leaves existing rows alone', () => {
	const row = (id: string, type: string, name: string, sortOrder: number) => ({
		id,
		type,
		name,
		currentBalance: 100_000,
		monthlyContribution: 0,
		frequency: 'monthly',
		sortOrder,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	})

	it('rehydrates an asset row unchanged, alongside investment and debt rows', async () => {
		// migrate must be type-blind: it never reads or writes `type`.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 3,
				state: {
					entries: [
						row('inv-1', 'investment', 'ISA', 0),
						row('debt-1', 'debt', 'Mortgage', 1),
						row('asset-1', 'asset', 'Condo', 2),
					],
				},
			})
		)

		await useBalanceStore.persist.rehydrate()
		const entries = useBalanceStore.getState().entries

		expect(entries).toHaveLength(3)
		expect(entries.map((e) => e.type)).toEqual(['investment', 'debt', 'asset'])
		expect(entries.map((e) => e.id)).toEqual(['inv-1', 'debt-1', 'asset-1'])
		// A re-run backfill would re-densify sortOrder and destroy the gaps deletes leave.
		expect(entries.map((e) => e.sortOrder)).toEqual([0, 1, 2])
	})

	it('does not re-type a row whose type this build does not recognise', async () => {
		// Type-blindness also protects a row written by a newer build.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 3,
				state: { entries: [row('future-1', 'crypto', 'Some Coin', 0)] },
			})
		)

		await useBalanceStore.persist.rehydrate()
		expect(useBalanceStore.getState().entries[0]?.type).toBe('crypto')
	})

	it('totals an asset row separately from investments and debts', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 3,
				state: {
					entries: [
						{ ...row('inv-1', 'investment', 'ISA', 0), currentBalance: 5_000_000 },
						{ ...row('asset-1', 'asset', 'Condo', 1), currentBalance: 40_000_000 },
						{ ...row('debt-1', 'debt', 'Mortgage', 2), currentBalance: 30_000_000 },
					],
				},
			})
		)

		await useBalanceStore.persist.rehydrate()
		const { entries } = useBalanceStore.getState()
		const totalFor = (type: string) =>
			entries.filter((e) => e.type === type).reduce((sum, e) => sum + e.currentBalance, 0)

		// Asserted per component: net worth is invariant under classifying an asset as an investment.
		expect(totalFor('investment')).toBe(5_000_000)
		expect(totalFor('asset')).toBe(40_000_000)
		expect(totalFor('debt')).toBe(30_000_000)
	})
})

describe('balanceStore — contributionRecordedAsExpense persists', () => {
	type NewEntry = Parameters<ReturnType<typeof useBalanceStore.getState>['addBalanceEntry']>[0]

	const investment = (overrides: Partial<NewEntry> = {}): NewEntry => ({
		type: 'investment',
		name: 'TFSA',
		currentBalance: 1_000_000,
		monthlyContribution: 50_000,
		frequency: 'monthly',
		...overrides,
	})

	// A passthrough with no code of its own; pinned against a refactor to an explicit field list.
	it('persists the flag through addBalanceEntry', () => {
		const created = useBalanceStore
			.getState()
			.addBalanceEntry(investment({ contributionRecordedAsExpense: true }))
		expect(created?.contributionRecordedAsExpense).toBe(true)
		expect(useBalanceStore.getState().entries[0]?.contributionRecordedAsExpense).toBe(true)
	})

	it('defaults to absent (⇒ deducted) when the caller omits it', () => {
		const created = useBalanceStore.getState().addBalanceEntry(investment())
		expect(created?.contributionRecordedAsExpense).toBeUndefined()
	})

	it('round-trips BOTH directions through updateBalanceEntry', () => {
		const created = useBalanceStore
			.getState()
			.addBalanceEntry(investment({ contributionRecordedAsExpense: true }))
		const id = created?.id as string

		// true → false restores a deduction; a truthy-check merge would drop the `false`.
		useBalanceStore.getState().updateBalanceEntry(id, { contributionRecordedAsExpense: false })
		expect(useBalanceStore.getState().entries[0]?.contributionRecordedAsExpense).toBe(false)

		useBalanceStore.getState().updateBalanceEntry(id, { contributionRecordedAsExpense: true })
		expect(useBalanceStore.getState().entries[0]?.contributionRecordedAsExpense).toBe(true)
	})

	it('REJECTS the flag on a debt row (enforced on the store write path)', () => {
		const created = useBalanceStore.getState().addBalanceEntry(
			investment({
				type: 'debt',
				name: 'Mortgage',
				// Positive: a negative balance is refused on its own, which would make this pass for the wrong reason.
				currentBalance: 30_000_000,
				monthlyContribution: 0,
				contributionRecordedAsExpense: true,
			})
		)
		expect(created).toBeNull()
		expect(useBalanceStore.getState().entries).toHaveLength(0)

		// Acceptance partner over the same shape, so the rejection is not from a malformed fixture.
		const ok = useBalanceStore.getState().addBalanceEntry(
			investment({
				type: 'debt',
				name: 'Mortgage',
				currentBalance: 30_000_000,
				monthlyContribution: 0,
			})
		)
		expect(ok).not.toBeNull()
	})
})

describe('balanceStore — the retired contribution limit is stripped', () => {
	it('drops maxContributionLimit from a legacy row on rehydration', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 3,
				state: {
					entries: [
						{
							id: 'legacy-uuid-limit',
							type: 'investment',
							name: 'Old TFSA',
							currentBalance: 10000,
							maxContributionLimit: 500000,
							monthlyContribution: 500,
							frequency: 'monthly',
							sortOrder: 0,
							createdAt: '2024-01-01T00:00:00Z',
							updatedAt: '2024-01-01T00:00:00Z',
						},
					],
				},
			})
		)

		await useBalanceStore.persist.rehydrate()

		const [entry] = useBalanceStore.getState().entries
		expect(entry).toBeDefined()
		expect('maxContributionLimit' in (entry as object)).toBe(false)
		expect(entry.name).toBe('Old TFSA')
		expect(entry.currentBalance).toBe(10000)
		expect(entry.monthlyContribution).toBe(500)
		expect(entry.frequency).toBe('monthly')
		expect(entry.sortOrder).toBe(0)
	})
})

/** Refused on the store write path: past the queue, a refusal deadlocks sync. */
describe('balanceStore — a negative balance never reaches the sync queue', () => {
	function makeHandle() {
		return {
			userId: '550e8400-e29b-41d4-a716-446655440000',
			queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
			queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
			queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
		}
	}
	const debt = (currentBalance: number) => ({
		type: 'debt' as const,
		name: 'Car loan',
		currentBalance,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
	})
	let handle: ReturnType<typeof makeHandle>

	beforeEach(() => {
		handle = makeHandle()
		registerSyncBridge(handle)
	})

	afterEach(() => {
		clearSyncBridge()
	})

	it('refuses a negative debt on ADD: no row, no queueCreate', () => {
		expect(useBalanceStore.getState().addBalanceEntry(debt(-400_000))).toBeNull()
		expect(useBalanceStore.getState().entries).toHaveLength(0)
		expect(handle.queueCreate).not.toHaveBeenCalled()
		expect(useBalanceStore.getState().addBalanceEntry(debt(400_000))).not.toBeNull()
		expect(handle.queueCreate).toHaveBeenCalledTimes(1)
	})

	it('refuses an UPDATE to a negative balance: row unchanged, no queueUpdate', () => {
		const created = useBalanceStore.getState().addBalanceEntry(debt(400_000))
		if (!created) throw new Error('fixture row was refused')
		expect(
			useBalanceStore.getState().updateBalanceEntry(created.id, { currentBalance: -1 })
		).toBeNull()
		expect(useBalanceStore.getState().entries[0]?.currentBalance).toBe(400_000)
		expect(handle.queueUpdate).not.toHaveBeenCalled()
		// Positive control: a valid update IS queued, so the assertion above is not vacuous.
		expect(
			useBalanceStore.getState().updateBalanceEntry(created.id, { currentBalance: 1 })
		).not.toBeNull()
		expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
	})
})
