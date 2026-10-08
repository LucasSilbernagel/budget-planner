/**
 * Strict `===`, not isInActiveProfile: unscoped legacy rows must survive a profile delete.
 * Imports no store (stores register here) to avoid a cycle that deadlocks concurrent imports.
 */

interface CascadeStore {
  getState: () => Record<string, unknown>
  setState: (partial: Record<string, unknown>) => void
}

interface CascadeBinding {
  store: CascadeStore
  collection: string
}

/** Keyed by name so a module re-evaluation replaces its entry instead of duplicating it. */
const bindings = new Map<string, CascadeBinding>()

/** `useBalanceStore` registers `entries`, not the sync entity name `balanceTracking`. */
export function registerProfileScopedCollection(store: unknown, collection: string): void {
  const typed = store as CascadeStore
  // A wrong key would silently retain data the user was told is destroyed; check the shape loudly.
  if (!Array.isArray(typed.getState()?.[collection])) {
    console.error(
      `[profile-cascade] "${collection}" is not an array on the registered store. That collection will NOT be cascaded when a profile is deleted.`
    )
  }
  bindings.set(collection, { store: typed, collection })
}

export function registeredProfileScopedCollections(): string[] {
  return [...bindings.keys()]
}

/**
 * Plain setState, not delete actions: the server cascades itself, and queued deletes would carry
 * the active profile rather than this one.
 */
export function cascadeProfileRowRemoval(profileId: string): number {
  if (!profileId) {
    return 0
  }

  let removed = 0
  for (const { store, collection } of bindings.values()) {
    // `Array.isArray`, not `?? []`: a corrupt non-array would throw after the profile is gone locally.
    const raw = store.getState()[collection]
    const current = Array.isArray(raw) ? (raw as (Record<string, unknown> | undefined)[]) : []
    const kept = current.filter((row) => row?.['profileId'] !== profileId)
    if (kept.length !== current.length) {
      removed += current.length - kept.length
      store.setState({ [collection]: kept })
    }
  }
  return removed
}
