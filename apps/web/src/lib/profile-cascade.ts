/**
 * Local cascade: remove the rows a deleted profile owns (Story 66.3, FR104).
 *
 * ## The decision this implements
 *
 * Deleting a profile DESTROYS its financial rows rather than re-homing them onto
 * a survivor (story 66.3, D1). A profile is a separation boundary; reassigning
 * its rows MERGES two ledgers and silently moves the survivor's Overview totals,
 * savings capacity and retirement projection — the single outcome profiles exist
 * to prevent. `server/api/account.ts:deleteUserAccount` is the destroy precedent
 * at exactly this shape, and this codebase has no "archive" concept to be
 * consistent with instead.
 *
 * ## ⚠️⚠️ STRICT EQUALITY, and this is the trap the story is about
 *
 * The predicate below is `row.profileId === profileId` and NOTHING else. It
 * deliberately does NOT reuse {@link isInActiveProfile} (`lib/profile-scope.ts`),
 * which returns TRUE for a `null` or absent `profileId` because an unscoped row
 * is visible under every profile. That rule is correct for a READ and
 * catastrophic for a WRITE: rows persisted before story 54.4 carry no `profileId`
 * at all, so a cascade built on the read predicate would destroy every legacy row
 * on the first profile deletion — on a device whose owner deleted a profile they
 * never used.
 *
 * *Generalisable: a read predicate that is deliberately permissive is the wrong
 * gate for a destructive write.*
 *
 * Pinned by `__tests__/profile-cascade.test.ts`, which keeps an unscoped row and
 * a foreign-profile row in every store and asserts both survive.
 *
 * ## ⚠️⚠️ THIS MODULE IMPORTS NO STORE, AND THAT IS LOAD-BEARING
 *
 * The stores REGISTER themselves here; this module never reaches for them. The
 * first version did import all five directly, resolving them through thunks so
 * the binding was never read during module evaluation — and that was WRONG in a
 * way a sequential load order cannot show. `profileStore` imports this module,
 * and all five domain stores import `profileStore` (they stamp the active profile
 * on create), so a direct import here closes a cycle. The thunks did prevent the
 * TDZ `ReferenceError`, so the store tests passed — but
 * `components/sync/__tests__/cross-device-sync.db.test.tsx` imports every store
 * CONCURRENTLY inside one `Promise.all`, and Vite's module runner DEADLOCKED on
 * the cycle: a 12s suite became a 60s hook timeout. Registration removes the
 * cycle rather than tiptoeing around it.
 *
 * *Generalisable: "the cycle is harmless" proven under one load order says
 * nothing about a concurrent one. Prefer not having the cycle.*
 *
 * A store that has never been imported registers nothing — and holds no rows, so
 * there is nothing for the cascade to remove. The registry cannot be stale in the
 * direction that matters.
 *
 * ## ⚠️ No sync operations are queued here
 *
 * The cascade is LOCAL ONLY. The server destroys the same rows as one consequence
 * of the `userProfile` delete (`server/api/sync.ts:deleteProfileWithChildren`),
 * and routing child deletes through `syncEntityDelete` instead would be broken by
 * construction for the COMMON case: `SyncService.queueDelete` stamps
 * `config.profileId` — the ACTIVE profile at queue time
 * (`packages/core/src/sync/synchronization.ts`) — and you normally delete the
 * profile you are NOT on. Every child delete would then carry the wrong profile
 * and resolve to "Entity not found" at `applyOperation`, leaving the row live
 * server-side while the client showed it gone.
 */

/** The minimal zustand surface this module needs from a domain store. */
interface CascadeStore {
  getState: () => Record<string, unknown>
  setState: (partial: Record<string, unknown>) => void
}

interface CascadeBinding {
  store: CascadeStore
  collection: string
}

/**
 * Keyed by collection name so a module re-evaluation (vitest reloads modules
 * between some files) replaces its entry instead of appending a duplicate, which
 * would double the `removed` count.
 */
const bindings = new Map<string, CascadeBinding>()

/**
 * Declare a profile-scoped collection, called by each domain store at module
 * evaluation.
 *
 * ⚠️ `useBalanceStore` registers `entries`, NOT `balanceTracking` — the store key
 * and the sync entity type disagree, and using the entity name would make the
 * balance arm a silent no-op.
 *
 * ⚠️ `forecastingProfiles` is profile-scoped too, but it is SERVER-ONLY (no local
 * store for saved forecasts), so it appears in the server cascade and not here.
 */
export function registerProfileScopedCollection(store: unknown, collection: string): void {
  const typed = store as CascadeStore
  // ⚠⚠ A WRONG KEY IS A SILENT NO-OP BY CONSTRUCTION, and the failure mode is
  // RETAINING data the user was told is permanently destroyed (code review). A
  // renamed state key still registers, still iterates, still matches nothing and
  // still reports success. Nothing in the type system catches it — `collection`
  // is a bare `string` and the store is reached through `unknown`. So the shape
  // is checked once, here, at module evaluation, where it is loud and cheap.
  if (!Array.isArray(typed.getState()?.[collection])) {
    console.error(
      `[profile-cascade] "${collection}" is not an array on the registered store. That collection will NOT be cascaded when a profile is deleted.`
    )
  }
  bindings.set(collection, { store: typed, collection })
}

/** The registered collection names, in registration order (tests assert on it). */
export function registeredProfileScopedCollections(): string[] {
  return [...bindings.keys()]
}

/**
 * Remove every local row STRICTLY owned by `profileId`, returning how many went.
 *
 * Safe to call when no rows match (returns 0 and writes nothing) and when no sync
 * session is registered — the free tier is localStorage-only and this is a purely
 * local mutation, so the cascade behaves identically on both tiers.
 *
 * A plain `setState`, deliberately NOT each store's `delete*` action: the actions
 * enqueue a sync operation per row, which is exactly what the docblock above
 * explains must not happen here.
 */
export function cascadeProfileRowRemoval(profileId: string): number {
  // An empty id would match nothing under strict equality, but guard explicitly:
  // a bug upstream that passed `''` should be a no-op, not a near-miss.
  if (!profileId) {
    return 0
  }

  let removed = 0
  for (const { store, collection } of bindings.values()) {
    // ⚠️ `Array.isArray`, not `?? []` (code review). `??` covers only null and
    // undefined; ANY other non-array value — a corrupt persisted blob rehydrated
    // into the store — makes `.filter` throw. In `removeProfile` that throw
    // escapes AFTER the profile was removed from the list and BEFORE
    // `syncEntityDelete` runs, so the profile is deleted locally, never
    // tombstoned server-side, and returns on the next device's pull.
    const raw = store.getState()[collection]
    const current = Array.isArray(raw) ? (raw as (Record<string, unknown> | undefined)[]) : []
    // ⚠️ STRICT equality. See the module docblock — `isInActiveProfile` is the
    // WRONG predicate here and an unscoped (null/absent `profileId`) row MUST
    // survive.
    const kept = current.filter((row) => row?.['profileId'] !== profileId)
    if (kept.length !== current.length) {
      removed += current.length - kept.length
      store.setState({ [collection]: kept })
    }
  }
  return removed
}
