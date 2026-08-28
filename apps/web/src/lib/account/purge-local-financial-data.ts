/**
 * Purge locally persisted financial data (Story 10-5, AC-5; Story 17-2).
 *
 * Two callers share this one purge:
 *  - Story 10-5: after a successful server-side account erasure, so the browser
 *    does not keep showing (or retaining) the deleted user's numbers.
 *  - Story 17-2: the all-users "Clear local data" Settings control, letting any
 *    user (including free / unauthenticated) reset this device.
 *
 * It resets each financial Zustand store to empty (so the current view updates
 * immediately), clears its persisted localStorage entry (so a refresh does not
 * restore the data), AND — when a `userId` is supplied — clears the durable
 * offline sync queue keyed to that user.
 *
 * It is deliberately **best-effort and never throws**: a failure clearing one
 * store (e.g. localStorage disabled / Safari private mode / SecurityError) must
 * not abort the others. For the 10-5 caller it also runs after the account is
 * already irreversibly deleted, so a local-cleanup failure must never be
 * surfaced as a deletion failure. See account-section.tsx / local-data-section.tsx.
 *
 * Functional preference stores are intentionally NOT purged — they are not
 * personal financial data: `budget-planner-currency-prefs-v1` (currencyStore)
 * and `budget-planner-theme-prefs-v1` (themeStore). Display preferences are left
 * intact for both callers.
 */

import { useBalanceStore } from '@/stores/balanceStore'
import { useCategoryStore } from '@/stores/categoryStore'
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
 * @param userId - the current user's id (from `/api/auth/me`), when there is a
 *   session. Used to clear the paid-tier durable sync queue keyed
 *   `bp-sync-queue-<userId>`, which holds raw financial `SyncOperation` payloads
 *   that would otherwise survive the purge. Omit it (or pass an empty string)
 *   for free / unauthenticated users: they have no sync queue, so the queue step
 *   is skipped rather than constructing a bogus `bp-sync-queue-undefined` key.
 */
export async function purgeLocalFinancialData(userId?: string): Promise<void> {
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
  // Categories (Story 30.4a) are user-authored financial metadata — the names a
  // user chose for their own spending — so they are purged alongside the rows
  // they categorize, not treated as a display preference.
  safely(() => {
    useCategoryStore.getState().reset()
    useCategoryStore.persist.clearStorage()
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

  // ⚠️ DELIBERATELY NOT PURGED: the persisted table sort
  // (`stores/tableSortStore`, `budget-planner-table-sort-v1`, story 42.1).
  //
  // Raised in review as a possible omission. It is a DISPLAY PREFERENCE — which
  // column a table is ordered by — and carries no financial value, no user-authored
  // text and no row identity, so it sits with `overviewDuration`, `theme`,
  // `currency` and `plannerVisibility`, none of which this function touches.
  // Categories ARE purged because they are user-authored financial metadata; a
  // sort key is not. A sort naming a column whose rows are gone degrades to
  // manual order on its own (`useTableSort`'s `effectiveState`), so leaving it
  // cannot resurface anything about the erased data.
  //
  // Recorded rather than left silent: the next person to read this list should
  // find the reason here instead of assuming the store was forgotten.

  // Durable offline push queue (paid tier): persisted in localStorage under
  // `bp-sync-queue-<userId>` and holding raw financial payloads. Clearing the
  // Zustand stores alone leaves these behind, so erase them too (AC-5). Free /
  // unauthenticated users have no session and no queue, so skip this entirely
  // when no userId is supplied (Story 17-2) — never key it on `undefined`.
  if (userId) {
    try {
      await createSyncQueue(userId).clear()
    } catch (error) {
      console.error('purgeLocalFinancialData: failed to clear the sync queue', error)
    }
  }
}
