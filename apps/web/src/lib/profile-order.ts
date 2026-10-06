/**
 * Display order for profiles: oldest → newest (story 98.1, FR159).
 *
 *     createdAt ASC  ->  id ASC
 *
 * Applied at the READ boundary (`useProfiles` in `stores/profileStore.ts`), not in
 * the store array: one selector covers every write path (local create, pulled
 * updates' remove-then-append in `applyOne`, reconcile's `setProfiles`, rehydrate
 * of a persisted blob), including future ones. The store ARRAY order, and the
 * `[0]` fallbacks that read it, are deliberately left alone (story 98.1 Dev Notes),
 * except `removeProfile`'s next-active pick, which takes the oldest survivor so it
 * matches the server's default repair (deferred-work follow-up to 98.1).
 *
 * ⚠️ Differs from `lib/ordering.ts`'s `sortByDisplayOrder` on purpose: a missing
 * or unparseable `createdAt` sorts FIRST here, not LAST. The bootstrap
 * `DEFAULT_PROFILE` (`profileStore.ts`) carries no `createdAt`, and it is the
 * oldest profile a free user has; sorting it last would put "Main Profile" at the
 * bottom of the list.
 *
 * ⚠️ IMPORT-CYCLE GUARDRAIL: this module imports NOTHING. `profileStore` imports
 * it, and all five domain stores import `profileStore`; anything here that
 * reached a store would recreate the cycle that deadlocked Vite's module runner
 * under `cross-device-sync.db.test.tsx`'s concurrent `Promise.all` import.
 */

export interface CreationOrdered {
  id?: string
  createdAt?: string
}

/** Unparseable/missing `createdAt` sorts FIRST (see module note). */
const FIRST = Number.NEGATIVE_INFINITY

function createdKey(row: CreationOrdered | null | undefined): number {
  const raw = row?.createdAt
  if (typeof raw !== 'string') {
    return FIRST
  }
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : FIRST
}

function idKey(row: CreationOrdered | null | undefined): string {
  const value = row?.id
  return typeof value === 'string' ? value : ''
}

/**
 * Profiles oldest → newest, ties broken by `id`. Non-mutating; returns `[]` for a
 * non-array input.
 *
 * ⚠️ Compared, never subtracted: `-Infinity - -Infinity` is NaN, and a comparator
 * returning NaN leaves the order undefined. `id` uses plain `<`/`>`, not
 * `localeCompare`, so every device orders a tie identically.
 */
export function sortProfilesOldestFirst<T extends CreationOrdered>(
  rows: readonly T[] | null | undefined
): T[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return [...rows].sort((a, b) => {
    const createdA = createdKey(a)
    const createdB = createdKey(b)
    if (createdA !== createdB) {
      return createdA < createdB ? -1 : 1
    }
    const idA = idKey(a)
    const idB = idKey(b)
    if (idA === idB) {
      return 0
    }
    return idA < idB ? -1 : 1
  })
}
