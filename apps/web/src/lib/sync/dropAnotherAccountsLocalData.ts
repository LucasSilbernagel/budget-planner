/**
 * Plain setState only: a store action would queue a delete erasing the other account's server data.
 * Stores must be rehydrated first, or the write replaces saved data with defaults.
 */

import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { isOwnedByAnotherAccount } from './accountOwner'

interface StoreApi {
	getState: () => Record<string, unknown>
	setState: (partial: Record<string, unknown>) => void
}

const ROW_STORES: readonly { store: StoreApi; collection: string }[] = [
	{ store: useIncomeStore as unknown as StoreApi, collection: 'incomeSources' },
	{ store: useExpenseStore as unknown as StoreApi, collection: 'expenses' },
	{ store: useSavingsStore as unknown as StoreApi, collection: 'savingsGoals' },
	{ store: useBalanceStore as unknown as StoreApi, collection: 'entries' },
	{ store: useCategoryStore as unknown as StoreApi, collection: 'categories' },
]

export function dropAnotherAccountsLocalData(sessionUserId: string): void {
	const { profiles, activeProfileId } = useProfileStore.getState()
	const keptProfiles = profiles.filter((p) => !isOwnedByAnotherAccount(p.userId, sessionUserId))
	const droppedProfileIds = new Set(
		profiles.filter((p) => !keptProfiles.includes(p)).map((p) => p.id)
	)

	if (droppedProfileIds.size > 0) {
		if (keptProfiles.length === 0) {
			// `reset` is a plain write (no sync op).
			useProfileStore.getState().reset()
		} else {
			const stillActive = keptProfiles.some((p) => p.id === activeProfileId)
			const nextActive = keptProfiles.find((p) => p.isDefault) ?? keptProfiles[0]
			useProfileStore.setState({
				profiles: keptProfiles,
				activeProfileId: stillActive ? activeProfileId : (nextActive?.id ?? null),
			})
		}
	}
	const nowActive = useProfileStore.getState().activeProfileId

	for (const { store, collection } of ROW_STORES) {
		const rows = (store.getState()[collection] as Record<string, unknown>[] | undefined) ?? []
		let changed = false
		const next: Record<string, unknown>[] = []
		for (const row of rows) {
			if (isOwnedByAnotherAccount(row['userId'], sessionUserId)) {
				changed = true
				continue
			}
			const profileId = row['profileId']
			if (typeof profileId === 'string' && droppedProfileIds.has(profileId)) {
				changed = true
				next.push({ ...row, profileId: nowActive })
				continue
			}
			next.push(row)
		}
		if (changed) {
			store.setState({ [collection]: next })
		}
	}
}
