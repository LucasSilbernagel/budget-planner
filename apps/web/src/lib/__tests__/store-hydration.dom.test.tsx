/** Every store uses `skipHydration`, so one missing from `StoreHydration`'s list silently starts empty. */

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { usePlannerVisibilityStore } from '../../stores/plannerVisibilityStore'
import { useProfileStore } from '../../stores/profileStore'
import { useRetirementPlannerStore } from '../../stores/retirementPlannerStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { useTableSortStore } from '../../stores/tableSortStore'
import { StoreHydration } from '../store-hydration'

const PERSISTED_STORES = [
	['income', useIncomeStore],
	['expense', useExpenseStore],
	['savings', useSavingsStore],
	['balance', useBalanceStore],
	['category', useCategoryStore],
	['currency', useCurrencyStore],
	['profile', useProfileStore],
	['overviewDuration', useOverviewDurationStore],
	['plannerVisibility', usePlannerVisibilityStore],
	['tableSort', useTableSortStore],
	['retirementPlanner', useRetirementPlannerStore],
] as const

afterEach(() => {
	vi.restoreAllMocks()
})

describe('StoreHydration', () => {
	it('rehydrates every persisted store on mount', () => {
		const spies = PERSISTED_STORES.map(
			([name, store]) =>
				[name, vi.spyOn(store.persist, 'rehydrate').mockResolvedValue(undefined)] as const
		)

		render(<StoreHydration />)

		for (const [name, spy] of spies) {
			expect(spy, `${name} store was never rehydrated`).toHaveBeenCalledTimes(1)
		}
	})

	it('rehydrates the category store specifically (Story 30.4a)', () => {
		const spy = vi.spyOn(useCategoryStore.persist, 'rehydrate').mockResolvedValue(undefined)

		render(<StoreHydration />)

		expect(spy).toHaveBeenCalledTimes(1)
	})

	it('a failing store does not prevent the others from rehydrating', async () => {
		// `mockRejectedValue` never throws synchronously, so assert the handling, not `not.toThrow()`.
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		const failure = new Error('SecurityError')
		vi.spyOn(useIncomeStore.persist, 'rehydrate').mockRejectedValue(failure)
		const categorySpy = vi.spyOn(useCategoryStore.persist, 'rehydrate').mockResolvedValue(undefined)

		const unhandled: unknown[] = []
		const onUnhandled = (event: PromiseRejectionEvent) => {
			unhandled.push(event.reason)
			event.preventDefault()
		}
		globalThis.addEventListener?.('unhandledrejection', onUnhandled)

		try {
			render(<StoreHydration />)

			await vi.waitFor(() => {
				expect(consoleError).toHaveBeenCalled()
			})

			expect(consoleError).toHaveBeenCalledWith('Store rehydration failed:', failure)

			expect(categorySpy).toHaveBeenCalledTimes(1)

			await Promise.resolve()
			expect(unhandled).toHaveLength(0)
		} finally {
			globalThis.removeEventListener?.('unhandledrejection', onUnhandled)
		}
	})
})
