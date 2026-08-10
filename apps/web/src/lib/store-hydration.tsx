import { useEffect } from 'react'
import { useBalanceStore } from '../stores/balanceStore'
import { useCategoryStore } from '../stores/categoryStore'
import { useCurrencyStore } from '../stores/currencyStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useIncomeStore } from '../stores/incomeStore'
import { useOverviewDurationStore } from '../stores/overviewDurationStore'
import { useProfileStore } from '../stores/profileStore'
import { useSavingsStore } from '../stores/savingsStore'
import { useThemeStore } from '../stores/themeStore'

/**
 * Client-side rehydration for all persisted Zustand stores.
 *
 * Every persisted store is created with `skipHydration: true` so that the
 * localStorage read does NOT happen on the server (which has no localStorage)
 * and does NOT happen during the first client render (which must match the
 * server-rendered HTML to avoid hydration mismatches). Once the app has
 * mounted on the client, we trigger `rehydrate()` to load the user's
 * free-tier data from localStorage (story 1-6).
 *
 * Rejections are swallowed per-store: if localStorage is blocked (Safari
 * private mode, `SecurityError`) or holds corrupt JSON, that store simply stays
 * at its default rather than surfacing an unhandled promise rejection.
 */
export function StoreHydration() {
  useEffect(() => {
    const stores = [
      useIncomeStore,
      useExpenseStore,
      useSavingsStore,
      useBalanceStore,
      useCategoryStore,
      useCurrencyStore,
      useProfileStore,
      useThemeStore,
      useOverviewDurationStore,
    ]

    for (const store of stores) {
      Promise.resolve(store.persist.rehydrate()).catch((error) => {
        console.error('Store rehydration failed:', error)
      })
    }
  }, [])

  return null
}
