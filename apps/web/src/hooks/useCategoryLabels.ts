import { useMemo } from 'react'
import { type ClientCategory, useCategoryStore, useLiveCategories } from '../stores/categoryStore'
import { useProfileStore } from '../stores/profileStore'

/**
 * Category-name resolution for display surfaces (Story 30.4b, FR54).
 *
 * Rows carry a `categoryId` uuid, never a name — a first-class entity is what
 * makes rename and delete possible at all (Story 30.4a). Every surface that
 * shows a category therefore has to resolve id → name, and every surface has to
 * survive the id resolving to nothing.
 *
 * ⚠️ A DANGLING `categoryId` IS A NORMAL STATE, NOT CORRUPTION. There is no
 * foreign key in `localStorage`, and three routine paths produce a row whose
 * category this device does not have:
 *   1. Pull pagination — `getSyncChanges` caps at `MAX_PULL_LIMIT = 500` with a
 *      cursor by `updatedAt`, so a long-untouched category and a freshly-edited
 *      income row can arrive in different pages.
 *   2. Deleted on another device — `applyServerChanges` REMOVES a tombstoned row
 *      from the store outright, so the category vanishes here while local rows
 *      still reference it.
 *   3. Soft-deleted locally — the tombstone stays in the store but must not be
 *      shown as a live category.
 * (Today only 3 is reachable: category rows cannot reach the server at all, see
 * `deferred-work.md`. 1 and 2 become live with the sync-create repair, so the
 * fallbacks are built and unit-tested now rather than retrofitted later.)
 *
 * All three resolve the same way: the row presents as UNCATEGORIZED and falls
 * back to its own name (Decision 10, Lucas 2026-08-10).
 */

/**
 * Live (non-tombstoned) categories as id → name.
 *
 * ⚠️ Tombstones are EXCLUDED on purpose, which makes a row pointing at a
 * soft-deleted category a deliberate MISS — that is AC-3's third cause, and it
 * must present as uncategorized exactly like the other two. `getCategoryById`
 * would find such a row; resolving through it would show the name of a category
 * the user has already deleted.
 *
 * ⚠️ The map is derived in `useMemo` from the raw array rather than inside the
 * zustand selector: a selector that builds a new Map on every read re-renders
 * every consumer on any unrelated store write and breaks outright under zustand
 * 5's stricter equality (the same reasoning as `useLiveCategories`).
 */
export function useCategoryNameMap(): ReadonlyMap<string, string> {
  const categories = useCategoryStore((state) => state.categories)
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const category of categories) {
      if (!category.isDeleted) {
        map.set(category.id, category.name)
      }
    }
    return map
  }, [categories])
}

/**
 * Categories belonging to the active profile.
 *
 * ⚠️ Added by code review 30.4b. `isDuplicateName` scopes to the ACTIVE profile
 * (`categoryStore.ts`), matching the DB's per-(user, profile, kind, name) unique
 * index — but every READ shipped by 30.4b filtered on kind and tombstone only.
 * Two profiles each legitimately owning "Groceries" therefore rendered as two
 * indistinguishable rows in the manager and two identical options in the picker,
 * which reads as a duplicate bug. Reads must be scoped the same way writes are.
 *
 * ⚠️ A `profileId` of `null` means UNSCOPED and is shown under EVERY profile —
 * it is NOT compared for equality against the active id. This is load-bearing,
 * and a strict `===` here was caught failing during the review fix: `profileStore`
 * initialises `activeProfileId` to `DEFAULT_PROFILE.id` and it is essentially
 * never null, so a strict comparison would HIDE every null-profile category
 * outright — and pulled rows carry the server's value verbatim, so null is a
 * real, reachable state. Hiding a user's categories is a far worse failure than
 * the duplicate-looking list this filter exists to fix.
 */
export function useCategoriesForActiveProfile(): ClientCategory[] {
  const categories = useLiveCategories()
  const activeProfileId = useProfileStore((state) => state.activeProfileId)
  return useMemo(
    () =>
      categories.filter(
        (category) => category.profileId === null || category.profileId === activeProfileId
      ),
    [categories, activeProfileId]
  )
}

/**
 * The name to GROUP this row by in the overview pies.
 *
 * Returns the category's name when the reference resolves, and the row's own
 * name otherwise (Decision 10). Never returns an empty string.
 *
 * ⚠️ The empty-string guard is load-bearing, not defensive noise.
 * `aggregateByCategoryAndType` keys on `` `${type}:${category ?? name}` `` — `??`
 * is NULLISH, so it catches `undefined`/`null` but happily passes `''` straight
 * through. An empty label produces the map key `"expense:"`, a blank slice and a
 * blank legend row, and `generateColorMap` rejects `''` so the slice silently
 * falls through to an index-based colour. `addCategory` refuses blank names, but
 * a rehydrated or server-pulled row is not validated by the store, so the guard
 * is reachable without a bug anywhere in this file.
 */
export function resolveCategoryLabel(
  categoryId: string | null | undefined,
  ownName: string,
  names: ReadonlyMap<string, string>
): string {
  const resolved = categoryId ? names.get(categoryId)?.trim() : undefined
  if (resolved && resolved.length > 0) {
    return resolved
  }
  // ⚠️ The FALLBACK is guarded too (code review 30.4b). The first version
  // checked the resolved name and returned `ownName` raw — guarding one side of
  // the expression and not the other. A rehydrated or server-pulled row goes
  // into the store unvalidated, so a blank `name` reaches here through exactly
  // the untrusted path the resolved-side guard exists for, and produces the
  // same `"expense:"` map key, blank slice, blank legend row and lost colour.
  const own = ownName.trim()
  return own.length > 0 ? own : UNNAMED_LABEL
}

/**
 * Last-resort label for a row with no usable name and no resolvable category.
 *
 * Deliberately a visible word rather than `''`: an empty grouping key collapses
 * every such row into one blank, uncoloured slice.
 */
export const UNNAMED_LABEL = 'Unnamed'

/**
 * The category name to DISPLAY for a row, or `null` when it is uncategorized.
 *
 * Distinct from {@link resolveCategoryLabel} on purpose: a table cell has to
 * tell "categorized as X" apart from "not categorized" so it can render a
 * placeholder, whereas the pies have to produce a grouping key either way.
 */
export function resolveCategoryName(
  categoryId: string | null | undefined,
  names: ReadonlyMap<string, string>
): string | null {
  if (!categoryId) {
    return null
  }
  const resolved = names.get(categoryId)?.trim()
  return resolved && resolved.length > 0 ? resolved : null
}
