import { useEffect } from 'react'
import { useBalanceStore } from '../stores/balanceStore'
import { useCurrencyStore } from '../stores/currencyStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useIncomeStore } from '../stores/incomeStore'
import { useProfileStore } from '../stores/profileStore'
import { useSavingsStore } from '../stores/savingsStore'

/**
 * Client-side rehydration for all persisted Zustand stores.
 *
 * Every persisted store is created with `skipHydration: true` so that the
 * localStorage read does NOT happen on the server (which has no localStorage)
 * and does NOT happen during the first client render (which must match the
 * server-rendered HTML to avoid hydration mismatches). Once the app has
 * mounted on the client, we trigger `rehydrate()` to load the user's
 * free-tier data from localStorage (story 1-6).
 */
export function StoreHydration() {
  useEffect(() => {
    void useIncomeStore.persist.rehydrate()
    void useExpenseStore.persist.rehydrate()
    void useSavingsStore.persist.rehydrate()
    void useBalanceStore.persist.rehydrate()
    void useCurrencyStore.persist.rehydrate()
    void useProfileStore.persist.rehydrate()
  }, [])

  return null
}
