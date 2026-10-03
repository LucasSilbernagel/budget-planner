/**
 * Remove another account's data from this browser's stores (story 86.2, FR140, D2).
 *
 * Every persisted store is shared by whoever uses the browser, and signing out
 * resets none of them (`lib/account/sign-out.ts`). So when B signs in where A
 * synced before, the stores still hold A's profiles and rows. Left there, B's
 * session ran on A's active profile (`ActiveSync`'s reconciled gate only asks
 * whether the active profile has an owner, not whose), showed A's rows, and
 * uploaded A's profiles and rows into B's account.
 *
 * Since story 90.1 it runs for EVERY session, signed out included (`''`: every
 * real-owned row is then another account's), from the root chunk right after
 * rehydrate (`lib/sync/accountBoundary.ts`), before any page paints.
 *
 * `ActiveSync` also calls this BEFORE the sync engine mounts, so nothing in it (the
 * first pull, the push bridge, the free→paid seed, the profile upload) ever
 * reads A's data. A loses nothing: A's synced data is on the server, and A's
 * unsent edits stay in A's own `bp-sync-queue-<A>` key, which this never touches.
 *
 * ⚠️ Plain `setState` only, never a store action (86.1 G8): an action queues a
 * sync op, and a delete here would erase A's server data from B's session.
 *
 * What is kept: B's own rows, and placeholder rows (`lib/sync/accountOwner.ts`),
 * which are B's to adopt (5-15 AC-2). A kept row stamped with one of A's
 * profiles (a free-tier row added after A signed out, while A's profile was
 * still active) is moved onto the profile that is active now, so it stays on
 * screen; the first pull's reconcile then moves it onto B's server profile
 * (`rehomePlaceholderRows`), exactly as for any placeholder row.
 *
 * ⚠️ It writes persisted stores, so the stores must have been rehydrated first,
 * or the write would replace the saved data with the defaults. `StoreHydration`
 * rehydrates them in a root mount effect, synchronously, and calls this
 * (through `applyAccountBoundary`) in the same effect, after the rehydrate.
 */

import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { isOwnedByAnotherAccount } from './accountOwner'

/** Minimal structural view of a persisted Zustand store used here. */
interface StoreApi {
  getState: () => Record<string, unknown>
  setState: (partial: Record<string, unknown>) => void
}

/** Every store holding profile-scoped financial rows, with its collection. */
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
      // `reset` is a plain write (no sync op): the bootstrap placeholder profile
      // a fresh browser starts with, which the first pull reconciles away.
      useProfileStore.getState().reset()
    } else {
      const stillActive = keptProfiles.some((p) => p.id === activeProfileId)
      const nextActive = keptProfiles.find((p) => p.isDefault) ?? keptProfiles[0]
      useProfileStore.setState({
        profiles: keptProfiles,
        activeProfileId: stillActive ? activeProfileId : nextActive?.id ?? null,
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
