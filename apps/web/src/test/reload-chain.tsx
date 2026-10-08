import { act, cleanup, type RenderResult, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { StoreHydration } from '../lib/store-hydration'
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

/**
 * A copy of StoreHydration's list on purpose, so dropping a store there is caught. Resetting
 * writes through persist, so storage is snapshotted first and written back last.
 */
export const PERSISTED_STORES: readonly unknown[] = [
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

function reloadChain(): void {
	cleanup()

	const snapshot: [string, string][] = []
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)
		if (key !== null) snapshot.push([key, localStorage.getItem(key) ?? ''])
	}

	for (const store of PERSISTED_STORES) {
		const api = store as unknown as {
			setState: (state: never, replace: true) => void
			getInitialState: () => never
		}
		api.setState(api.getInitialState(), true)
	}

	localStorage.clear()
	for (const [key, value] of snapshot) localStorage.setItem(key, value)
}

export async function renderAfterReload(ui: ReactElement): Promise<RenderResult> {
	reloadChain()
	const result = render(
		<>
			<StoreHydration />
			{ui}
		</>
	)
	// `rehydrate()` resolves through a promise; let it settle before asserting.
	await act(async () => {
		await Promise.resolve()
	})
	return result
}
