import type { CategoryKind } from '@budget-planner/db'
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { generateUUID } from '../lib/uuid'
import { useProfileStore } from './profileStore'

/**
 * User-defined income/expense categories (Story 30.4a, FR54).
 *
 * Premium capability, but LOCAL-FIRST: every operation here writes to
 * localStorage and returns synchronously. Sync is additive — the bridge calls
 * are no-ops for anyone without a registered sync handle — so categories work
 * fully offline and the network is never on the critical path.
 *
 * Modelled as a first-class entity rather than a denormalized string on each
 * cashflow row because the feature requires rename and delete: a rename must be
 * reflected by every referencing row with no per-row edit, which a copied string
 * cannot do.
 *
 * ⚠️ Deletion is SOFT (isDeleted tombstone), matching every other synced entity
 * — a hard delete can never be surfaced by a delta-by-updatedAt pull. Callers
 * that need the pickable set must filter, which is what `useLiveCategories`
 * exists for. Reassigning the affected cashflow rows is deliberately NOT done
 * here: that is cross-store orchestration and lives in useCategoryManager, so
 * this store stays dumb (the profileStore/useProfileManager split).
 *
 * ⚠️ THIS STORE VALIDATES ITS OWN WRITES — it does not rely on useCategoryManager.
 * (Code review 30.4a.) The store is the last gate before `syncBridge` hands an
 * operation to the queue, and it is exported through the `stores/index` barrel,
 * so any caller can reach it directly — 30.4b will. A write that the wire would
 * reject must therefore be rejected HERE, or it becomes a row that exists
 * locally and can never sync, reported to the user as nothing at all (the queue
 * gate's ZodError is swallowed by `onQueueError` into a console line).
 */
export interface ClientCategory {
  // Client-generatable uuid PK (Story 5-14), as on every other synced entity.
  id: string
  userId: number
  /**
   * Which profile owns this category (Story 30.4a; scoping added by code review).
   *
   * ⚠️ Unlike every sibling store, category rows ARE profile-tagged. That is not
   * gratuitous divergence: the DB's unique index is per-(user, profile, kind,
   * name), so a duplicate check that ignores the profile rejects names the
   * server would happily accept. Locally-created rows stamp the active profile;
   * pulled rows carry the server's value verbatim. Null = free tier / no profile.
   */
  profileId: string | null
  name: string
  kind: CategoryKind
  isDeleted: boolean
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
}

export interface ClientNewCategory {
  userId?: number // Optional for the free tier (no auth)
  profileId?: string | null
  name: string
  kind: CategoryKind
}

interface CategoryState {
  categories: ClientCategory[]
  /** Returns the created row, or NULL when the name fails the store's invariants. */
  addCategory: (category: ClientNewCategory) => ClientCategory | null
  renameCategory: (id: string, name: string) => void
  deleteCategory: (id: string) => void
  getCategoryById: (id: string) => ClientCategory | undefined
  /** Live (non-tombstoned) categories for one side of the ledger. */
  getCategoriesByKind: (kind: CategoryKind) => ClientCategory[]
  /** True when `name` is already taken by a LIVE category of the same kind. */
  isDuplicateName: (name: string, kind: CategoryKind, excludeId?: string) => boolean
  reset: () => void
}

/**
 * Mirrors `varchar(255)` on `categories.name`, and the `.max(255)` in BOTH sync
 * gates (`syncOperationDataSchema`, server `categorySchema`).
 *
 * ⚠️ Code review 30.4a: this bound was specified by AC-3 and implemented
 * nowhere. Without it a 256-character name is accepted locally, then throws a
 * ZodError inside `validateOperationData` — before the operation ever enters the
 * queue — which `syncEntityCreate` swallows into a `console.error`. The category
 * then exists on this device and can NEVER sync, with nothing shown to the user.
 * On the seed path it is worse: the rejection propagates through `Promise.all`
 * in `seedLocalDataToServer`, `markSeeded` is never called, and the user's
 * entire backlog re-seeds every session for as long as that one row exists.
 */
export const MAX_CATEGORY_NAME_LENGTH = 255

/** The store's write invariant: trimmed, non-empty, and within the column width. */
export const isValidCategoryName = (name: string): boolean => {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_CATEGORY_NAME_LENGTH
}

const toClientCategory = (newCategory: ClientNewCategory): ClientCategory => ({
  ...newCategory,
  userId: newCategory.userId ?? 0, // Default to 0 for the free tier (no auth)
  profileId: newCategory.profileId ?? useProfileStore.getState().activeProfileId ?? null,
  id: generateUUID(),
  isDeleted: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

/**
 * Names are compared case-insensitively on their trimmed form.
 *
 * Deliberately STRICTER than the `create-profile.tsx:86-88` precedent, which
 * compares raw `p.name === form.name`: "Groceries" and "groceries " are the same
 * category to a person, so allowing both would produce two indistinguishable
 * entries in the picker.
 *
 * ⚠️ The DATABASE now agrees (code review 30.4a, Lucas's call). Migration 0012
 * rebuilds the partial unique index over `lower(name)`, so this comparison and
 * the constraint accept and reject exactly the same set. Before that they
 * disagreed in both directions, and the case-sensitive index would have let two
 * offline devices create "Groceries" and "groceries" as separate rows that every
 * client then considered duplicates and no code path reconciled.
 */
const normalizeName = (name: string): string => name.trim().toLocaleLowerCase()

/** Null-safe profile comparison — the free tier has no active profile. */
const sameProfile = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? null) === (b ?? null)

export const useCategoryStore = create<CategoryState>()(
  persist(
    (set, get) => ({
      categories: [],

      addCategory: (newCategory) => {
        const name = newCategory.name.trim()
        // Reject rather than enqueue an operation the wire will refuse. See the
        // store-level JSDoc above: a silently unsyncable row is the worse outcome.
        if (!isValidCategoryName(name)) {
          return null
        }
        const category = toClientCategory({ ...newCategory, name })
        if (get().isDuplicateName(name, category.kind)) {
          return null
        }
        set((state) => ({ categories: [...state.categories, category] }))
        // Paid tier: also push to the server (no-op for the free tier).
        syncEntityCreate('category', category)
        return category
      },

      renameCategory: (id, name) => {
        const previous = get().categories.find((category) => category.id === id)
        // ⚠️ `previous.isDeleted` is load-bearing (code review 30.4a). This is the
        // ONLY store that keeps tombstones in local state, so unlike every
        // sibling a mutation can still "find" a row the server has already
        // dropped. Server-side `entityExists` filters `isDeleted = false`, so the
        // op comes back `Entity not found` → `retryable: false` → it lands in
        // `nonRetryableOperations`, which `synchronization.ts` never passes to
        // `removeBatch`. It would then be retried forever, pin the sync status at
        // FAILED, and re-open the circuit breaker every cycle — suppressing
        // retries for EVERY other entity.
        if (!previous || previous.isDeleted) {
          return
        }
        const trimmed = name.trim()
        if (!isValidCategoryName(trimmed)) {
          return
        }
        if (get().isDuplicateName(trimmed, previous.kind, id)) {
          return
        }
        const updated = { ...previous, name: trimmed, updatedAt: new Date().toISOString() }
        set((state) => ({
          categories: state.categories.map((category) => (category.id === id ? updated : category)),
        }))
        // Paid tier: queue the update with the pre-edit row as the baseVersion.
        syncEntityUpdate('category', updated, previous)
      },

      deleteCategory: (id) => {
        const existing = get().categories.find((category) => category.id === id)
        // Same tombstone guard as renameCategory — see the note there. A
        // double-click on Delete is enough to reach this without it.
        if (!existing || existing.isDeleted) {
          return
        }
        // Soft delete: keep the row so a delta-by-updatedAt pull can surface the
        // deletion on other devices. Reads filter on isDeleted.
        const tombstoned = { ...existing, isDeleted: true, updatedAt: new Date().toISOString() }
        set((state) => ({
          categories: state.categories.map((category) =>
            category.id === id ? tombstoned : category
          ),
        }))
        syncEntityDelete('category', existing)
      },

      getCategoryById: (id) => get().categories.find((category) => category.id === id),

      getCategoriesByKind: (kind) =>
        get().categories.filter((category) => !category.isDeleted && category.kind === kind),

      isDuplicateName: (name, kind, excludeId) => {
        const candidate = normalizeName(name)
        const activeProfileId = useProfileStore.getState().activeProfileId
        return get().categories.some(
          (category) =>
            !category.isDeleted &&
            category.kind === kind &&
            category.id !== excludeId &&
            // Profile-scoped to match the DB's unique index. Without this, a user
            // with two profiles that each legitimately own "Groceries" is refused
            // a name the server accepts.
            sameProfile(category.profileId, activeProfileId) &&
            normalizeName(category.name) === candidate
        )
      },

      reset: () => set({ categories: [] }),
    }),
    {
      name: 'budget-planner-categories-v1',
      // SSR-safe: defer the localStorage read until client-side rehydration
      // (see lib/store-hydration). EVERY store in this app is skipHydration.
      skipHydration: true,
      version: 1,
      partialize: (state) => ({
        categories: state.categories,
      }),
    }
  )
)

// Selector hooks
export const useCategories = () => useCategoryStore((state) => state.categories)

/**
 * Every category that still exists, both kinds.
 *
 * ⚠️ Filters tombstones. A raw `useCategories()` includes soft-deleted rows and
 * must not be used to populate a picker.
 *
 * ⚠️ The filter runs in `useMemo`, NOT inside the zustand selector (code review
 * 30.4a). A selector returning `state.categories.filter(...)` builds a fresh
 * array on every store read; zustand 4's `useSyncExternalStoreWithSelector`
 * memoizes per snapshot so it will not loop today, but it re-renders on every
 * unrelated category write and breaks outright under zustand 5's stricter
 * equality. Subscribing to the raw array and deriving below is stable in both.
 */
export const useLiveCategories = (): ClientCategory[] => {
  const categories = useCategoryStore((state) => state.categories)
  return useMemo(() => categories.filter((category) => !category.isDeleted), [categories])
}
