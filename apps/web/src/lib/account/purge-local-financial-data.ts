/**
 * Purge locally persisted financial data (Story 10-5, AC-5).
 *
 * After a successful server-side account erasure the browser must not keep
 * showing (or retaining) the deleted user's numbers. This resets each financial
 * Zustand store to empty (so the current view updates immediately), clears its
 * persisted localStorage entry (so a refresh does not restore the data), AND
 * clears the durable offline sync queue.
 *
 * Runs ONLY after the server returned 200 (the account is already irreversibly
 * deleted), so it is deliberately **best-effort and never throws**: a failure
 * clearing one store (e.g. localStorage disabled / Safari private mode /
 * SecurityError) must not abort the others and must not be surfaced to the
 * caller as a deletion failure. See account-section.tsx.
 *
 * Functional preference stores are intentionally NOT purged — they are not
 * personal financial data: `budget-planner-currency-prefs-v1` (currencyStore)
 * and `budget-planner-theme-prefs-v1` (themeStore). Default per Task 5 is to
 * leave display preferences intact.
 */

import { useBalanceStore } from '@/stores/balanceStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import { useSavingsStore } from '@/stores/savingsStore'
import { createSyncQueue } from '@budget-planner/core/sync'

/** Run a purge step, swallowing any failure (best-effort — see module doc). */
function safely(step: () => void): void {
  try {
    step()
  } catch (error) {
    // Best-effort: the server erasure already succeeded; a local-cleanup failure
    // must not propagate. Logged for diagnostics only.
    console.error('purgeLocalFinancialData: a local cleanup step failed', error)
  }
}

/**
 * @param userId - the deleted user's id (from `/api/auth/me`). Used to clear the
 *   paid-tier durable sync queue keyed `bp-sync-queue-<userId>`, which holds raw
 *   financial `SyncOperation` payloads that would otherwise survive erasure.
 */
export async function purgeLocalFinancialData(userId: string): Promise<void> {
  // Income / expenses / savings have no reset action — reset the persisted slice
  // directly, then drop the localStorage entry. Each is independently guarded so
  // one failure does not leave later stores unpurged.
  safely(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useIncomeStore.persist.clearStorage()
  })
  safely(() => {
    useExpenseStore.setState({ expenses: [] })
    useExpenseStore.persist.clearStorage()
  })
  safely(() => {
    useSavingsStore.setState({ savingsGoals: [] })
    useSavingsStore.persist.clearStorage()
  })
  // Profiles and balance expose reset() (back to their seeded/empty defaults).
  safely(() => {
    useProfileStore.getState().reset()
    useProfileStore.persist.clearStorage()
  })
  safely(() => {
    useBalanceStore.getState().reset()
    useBalanceStore.persist.clearStorage()
  })

  // Durable offline push queue (paid tier): persisted in localStorage under
  // `bp-sync-queue-<userId>` and holding raw financial payloads. Clearing the
  // Zustand stores alone leaves these behind, so erase them too (AC-5).
  try {
    await createSyncQueue(userId).clear()
  } catch (error) {
    console.error('purgeLocalFinancialData: failed to clear the sync queue', error)
  }
}
