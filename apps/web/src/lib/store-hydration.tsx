import { useEffect } from 'react'
import type { SessionSeed } from '../context/session-seed'
import { useBalanceStore } from '../stores/balanceStore'
import { useCategoryStore } from '../stores/categoryStore'
import { useCurrencyStore } from '../stores/currencyStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useIncomeStore } from '../stores/incomeStore'
import { useOverviewDurationStore } from '../stores/overviewDurationStore'
import { usePlannerVisibilityStore } from '../stores/plannerVisibilityStore'
import { useProfileStore } from '../stores/profileStore'
import { useRetirementPlannerStore } from '../stores/retirementPlannerStore'
import { useSavingsStore } from '../stores/savingsStore'
import { useTableSortStore } from '../stores/tableSortStore'
import { applyAccountBoundary, readCookieString, sessionForBoundary } from './sync/accountBoundary'

/**
 * Stores use skipHydration so localStorage is read after mount. Route content hydrates in a later pass,
 * so a selector must derive from its argument, never call a state method.
 */
export function StoreHydration({ seed }: { seed?: SessionSeed | null } = {}) {
	// Read once at mount: the session is fixed for the life of a document.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design (see above).
	useEffect(() => {
		const stores = [
			useIncomeStore,
			useExpenseStore,
			useSavingsStore,
			useBalanceStore,
			useCategoryStore,
			useCurrencyStore,
			useProfileStore,
			useOverviewDurationStore,
			usePlannerVisibilityStore,
			useTableSortStore,
			useRetirementPlannerStore,
		]

		for (const store of stores) {
			Promise.resolve(store.persist.rehydrate()).catch((error) => {
				console.error('Store rehydration failed:', error)
			})
		}

		// Must run after rehydrate (an earlier write would replace saved data with defaults) and before route content paints.
		const session = sessionForBoundary(seed, readCookieString())
		if (session !== undefined) {
			applyAccountBoundary(session)
		}
	}, [])

	return null
}
