import type { CategoryKind } from '@budget-planner/db'
import { useMemo } from 'react'
import {
  type ClientCategory,
  MAX_CATEGORY_NAME_LENGTH,
  useCategoryStore,
} from '../stores/categoryStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useIncomeStore } from '../stores/incomeStore'

/**
 * Category management orchestration (Story 30.4a, FR54).
 *
 * Follows the `useProfileManager` split (hooks/useActiveProfile.ts): the store
 * stays dumb and owns only its own slice, while this hook owns anything that
 * spans stores. Deleting a category is exactly that — it must also clear the
 * reference from every income and expense row that pointed at it.
 *
 * ⚠️ The cascade goes through the domain stores' own `update*` actions rather
 * than a bulk `setState`. That is deliberate: those actions enqueue a sync
 * update per row (syncBridge), so the un-categorization propagates to other
 * devices. A bulk setState would fix this device and let another device push the
 * stale categoryId straight back — the row would silently re-attach itself to a
 * category the user deleted.
 *
 * The operations are module-level constants rather than `useCallback`s: they
 * close over nothing (every read goes through `getState()`), so they already
 * have stable identities, and keeping them out of React means the whole
 * cross-store cascade is unit-testable without a render context.
 *
 * ⚠️ This hook is a CONVENIENCE, not the enforcement point (code review 30.4a).
 * `categoryStore` validates its own writes, because it is exported through the
 * `stores/index` barrel and nothing obliges a caller to come through here.
 * What this layer adds is the user-facing `reason`/`message` pair.
 */

export interface CategoryValidationError {
  /**
   * ⚠️ `not-found` and `too-long` were added by code review 30.4a. Previously a
   * missing category was reported as `reason: 'empty'` — so a UI branching on
   * the discriminant (the documented purpose) would focus the name input and say
   * "please enter a name" when the category had actually been deleted on another
   * device mid-edit. The message and the machine-readable reason disagreed.
   */
  reason: 'empty' | 'too-long' | 'duplicate' | 'not-found'
  message: string
}

export interface UseCategoryManagerResult {
  /**
   * Create a category. Returns the created row, or a validation error — never
   * throws, so callers can render an inline message.
   */
  createCategory: (
    name: string,
    kind: CategoryKind
  ) => { ok: true; category: ClientCategory } | { ok: false; error: CategoryValidationError }
  /** Rename a category, with the same validation as create. */
  renameCategory: (
    id: string,
    name: string
  ) => { ok: true } | { ok: false; error: CategoryValidationError }
  /**
   * Soft-delete a category and clear it from every referencing row.
   * Returns how many income/expense rows were un-categorized.
   */
  deleteCategory: (id: string) => { affectedRowCount: number }
  /**
   * How many income/expense rows reference this category, read imperatively at
   * call time.
   *
   * ⚠️ This is a SNAPSHOT and does not subscribe to either store (code review
   * 30.4a). To display a live count in a confirmation dialog — where a stale
   * number means the user confirms a destructive action against the wrong figure
   * — use `useCategoryRowCount(id)` below, which subscribes properly.
   */
  countRowsUsing: (id: string) => number
}

function validate(
  name: string,
  kind: CategoryKind,
  excludeId?: string
): CategoryValidationError | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return { reason: 'empty', message: 'Please enter a category name' }
  }
  // AC-3's `≤255` clause. Both sync gates and the varchar(255) column enforce
  // this; without it here the row is created locally and can never sync.
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
    return {
      reason: 'too-long',
      message: `Category names cannot be longer than ${MAX_CATEGORY_NAME_LENGTH} characters`,
    }
  }
  if (useCategoryStore.getState().isDuplicateName(trimmed, kind, excludeId)) {
    return { reason: 'duplicate', message: 'A category with this name already exists' }
  }
  return null
}

const NOT_FOUND: CategoryValidationError = {
  reason: 'not-found',
  message: 'Category not found',
}

function countRowsUsing(id: string): number {
  const income = useIncomeStore
    .getState()
    .incomeSources.filter((row) => row.categoryId === id).length
  const expense = useExpenseStore.getState().expenses.filter((row) => row.categoryId === id).length
  return income + expense
}

function createCategory(name: string, kind: CategoryKind) {
  const error = validate(name, kind)
  if (error) {
    return { ok: false as const, error }
  }
  const category = useCategoryStore.getState().addCategory({ name, kind })
  if (!category) {
    // The store re-checked and refused. Surface its reason rather than a
    // silent no-op — the store is authoritative, this layer only explains.
    return {
      ok: false as const,
      error: validate(name, kind) ?? {
        reason: 'duplicate' as const,
        message: 'A category with this name already exists',
      },
    }
  }
  return { ok: true as const, category }
}

function renameCategory(id: string, name: string) {
  const existing = useCategoryStore.getState().getCategoryById(id)
  // A tombstoned row is gone as far as the user is concerned — the store
  // refuses to mutate it, so reporting it as present would be a lie.
  if (!existing || existing.isDeleted) {
    return { ok: false as const, error: NOT_FOUND }
  }
  const error = validate(name, existing.kind, id)
  if (error) {
    return { ok: false as const, error }
  }
  useCategoryStore.getState().renameCategory(id, name)
  return { ok: true as const }
}

function deleteCategory(id: string): { affectedRowCount: number } {
  const existing = useCategoryStore.getState().getCategoryById(id)
  // Already tombstoned: do nothing at all. Re-running the cascade would enqueue
  // a second delete for a row the server has already dropped, which comes back
  // non-retryable and is never removed from the queue. See categoryStore.
  if (!existing || existing.isDeleted) {
    return { affectedRowCount: 0 }
  }

  const affectedIncome = useIncomeStore
    .getState()
    .incomeSources.filter((row) => row.categoryId === id)
  const affectedExpenses = useExpenseStore
    .getState()
    .expenses.filter((row) => row.categoryId === id)

  // Clear the reference FIRST, so no row is ever observable pointing at a
  // category that has already been tombstoned.
  for (const row of affectedIncome) {
    useIncomeStore.getState().updateIncomeSource(row.id, { categoryId: null })
  }
  for (const row of affectedExpenses) {
    useExpenseStore.getState().updateExpense(row.id, { categoryId: null })
  }

  useCategoryStore.getState().deleteCategory(id)

  return { affectedRowCount: affectedIncome.length + affectedExpenses.length }
}

/** Stable across renders by construction — no memoization needed. */
const CATEGORY_MANAGER: UseCategoryManagerResult = {
  createCategory,
  renameCategory,
  deleteCategory,
  countRowsUsing,
}

export function useCategoryManager(): UseCategoryManagerResult {
  return CATEGORY_MANAGER
}

/**
 * Live count of income/expense rows referencing `id`, for the delete
 * confirmation dialog (Story 30.4b).
 *
 * ⚠️ Added by code review 30.4a. `useCategoryManager().countRowsUsing` reads
 * `getState()` imperatively and subscribes to nothing, so a count rendered from
 * it freezes at whatever render produced it — it will not move when a pull
 * arrives, when another tab edits a row, or when the user edits behind the
 * modal. Confirming a destructive action against a stale number is precisely
 * the failure the count exists to prevent.
 */
export function useCategoryRowCount(id: string | null | undefined): number {
  const incomeSources = useIncomeStore((state) => state.incomeSources)
  const expenses = useExpenseStore((state) => state.expenses)
  return useMemo(() => {
    if (!id) {
      return 0
    }
    const income = incomeSources.filter((row) => row.categoryId === id).length
    const expense = expenses.filter((row) => row.categoryId === id).length
    return income + expense
  }, [id, incomeSources, expenses])
}
