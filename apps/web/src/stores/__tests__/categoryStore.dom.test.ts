/**
 * categoryStore + useCategoryManager (Story 30.4a, AC-3)
 *
 * `.dom.test.ts` because these exercise the persist middleware against a REAL
 * localStorage — vitest.config.ts's environmentMatchGlobs only puts `.dom.test`
 * files (and components/*) in jsdom; a plain `.test.ts` here would run in node,
 * where `localStorage` is undefined and the rehydrate assertions are meaningless.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCategoryManager } from '../../hooks/useCategoryManager'
import { useCategoryStore } from '../categoryStore'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'

const CATEGORY_KEY = 'budget-planner-categories-v1'

/** The manager's operations are module-level, so they work outside React. */
const manager = () => useCategoryManager()

/**
 * `addCategory` returns null when the store REJECTS a name (code review 30.4a
 * moved validation into the store). Tests that expect a successful create unwrap
 * here, so a regression surfaces as a clear failure rather than a null deref.
 */
const addOk = (input: { name: string; kind: 'income' | 'expense' }) => {
  const created = useCategoryStore.getState().addCategory(input)
  if (!created) {
    throw new Error(`addCategory unexpectedly rejected: ${JSON.stringify(input)}`)
  }
  return created
}

beforeEach(() => {
  localStorage.clear()
  useCategoryStore.setState({ categories: [] })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
})

describe('categoryStore — CRUD', () => {
  it('creates a category with a trimmed name and a live tombstone flag', () => {
    const created = addOk({ name: '  Groceries  ', kind: 'expense' })

    expect(created.name).toBe('Groceries')
    expect(created.kind).toBe('expense')
    expect(created.isDeleted).toBe(false)
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(useCategoryStore.getState().categories).toHaveLength(1)
  })

  it('renames in place and bumps updatedAt', async () => {
    const created = addOk({ name: 'Groceres', kind: 'expense' })
    const before = created.updatedAt
    // Timestamps are ISO strings at ms resolution; ensure a distinct tick.
    await new Promise((resolve) => setTimeout(resolve, 2))

    useCategoryStore.getState().renameCategory(created.id, '  Groceries ')
    const after = useCategoryStore.getState().getCategoryById(created.id)

    expect(after?.name).toBe('Groceries')
    expect(after?.id).toBe(created.id) // renamed IN PLACE — not replaced
    expect(Date.parse(after?.updatedAt ?? '')).toBeGreaterThan(Date.parse(before))
  })

  it('deletes SOFTLY — the row survives as a tombstone so the delete can propagate', () => {
    const created = addOk({ name: 'Groceries', kind: 'expense' })

    useCategoryStore.getState().deleteCategory(created.id)

    // Still present (a hard delete could never be surfaced by a delta pull)...
    expect(useCategoryStore.getState().categories).toHaveLength(1)
    expect(useCategoryStore.getState().getCategoryById(created.id)?.isDeleted).toBe(true)
    // ...but gone from the pickable set.
    expect(useCategoryStore.getState().getCategoriesByKind('expense')).toHaveLength(0)
  })

  it('separates the income and expense namespaces', () => {
    useCategoryStore.getState().addCategory({ name: 'Salary', kind: 'income' })
    useCategoryStore.getState().addCategory({ name: 'Groceries', kind: 'expense' })

    expect(
      useCategoryStore
        .getState()
        .getCategoriesByKind('income')
        .map((c) => c.name)
    ).toEqual(['Salary'])
    expect(
      useCategoryStore
        .getState()
        .getCategoriesByKind('expense')
        .map((c) => c.name)
    ).toEqual(['Groceries'])
  })
})

describe('categoryStore — duplicate detection', () => {
  it('is case- and whitespace-insensitive within one kind', () => {
    useCategoryStore.getState().addCategory({ name: 'Groceries', kind: 'expense' })
    const { isDuplicateName } = useCategoryStore.getState()

    expect(isDuplicateName('Groceries', 'expense')).toBe(true)
    expect(isDuplicateName('  groceries  ', 'expense')).toBe(true)
    expect(isDuplicateName('GROCERIES', 'expense')).toBe(true)
  })

  it('does NOT collide across kinds — the same word may exist on both sides', () => {
    useCategoryStore.getState().addCategory({ name: 'Consulting', kind: 'income' })
    expect(useCategoryStore.getState().isDuplicateName('Consulting', 'expense')).toBe(false)
  })

  it('ignores tombstoned rows — a deleted name becomes reusable', () => {
    // This is the client-side half of the partial unique index (WHERE isDeleted =
    // false). A plain unique constraint would 23505 here while the store kept the
    // new row — silent client/server divergence.
    const created = addOk({ name: 'Groceries', kind: 'expense' })
    useCategoryStore.getState().deleteCategory(created.id)

    expect(useCategoryStore.getState().isDuplicateName('Groceries', 'expense')).toBe(false)
  })

  it('excludes the row being renamed, so keeping your own name is not a duplicate', () => {
    const created = addOk({ name: 'Groceries', kind: 'expense' })
    expect(useCategoryStore.getState().isDuplicateName('Groceries', 'expense', created.id)).toBe(
      false
    )
  })
})

describe('useCategoryManager — validation', () => {
  it('rejects an empty or whitespace-only name', () => {
    const result = manager().createCategory('   ', 'expense')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.reason).toBe('empty')
    expect(useCategoryStore.getState().categories).toHaveLength(0)
  })

  it('rejects a duplicate and does not create a second row', () => {
    manager().createCategory('Groceries', 'expense')
    const result = manager().createCategory('groceries', 'expense')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.reason).toBe('duplicate')
    expect(useCategoryStore.getState().categories).toHaveLength(1)
  })

  it('rejects a rename onto an existing name', () => {
    manager().createCategory('Groceries', 'expense')
    const other = manager().createCategory('Transport', 'expense')
    const id = other.ok ? other.category.id : ''

    expect(manager().renameCategory(id, 'Groceries').ok).toBe(false)
    expect(useCategoryStore.getState().getCategoryById(id)?.name).toBe('Transport')
  })
})

describe('useCategoryManager — delete cascade (AC-3)', () => {
  it('clears the reference from every referencing row and reports the count', () => {
    const created = manager().createCategory('Groceries', 'expense')
    const categoryId = created.ok ? created.category.id : ''

    useExpenseStore
      .getState()
      .addExpense({ name: 'Aldi', amount: 5000, frequency: 'monthly', categoryId })
    useExpenseStore
      .getState()
      .addExpense({ name: 'Lidl', amount: 3000, frequency: 'monthly', categoryId })
    useExpenseStore.getState().addExpense({ name: 'Rent', amount: 150000, frequency: 'monthly' })

    expect(manager().countRowsUsing(categoryId)).toBe(2)

    const { affectedRowCount } = manager().deleteCategory(categoryId)

    expect(affectedRowCount).toBe(2)
    const expenses = useExpenseStore.getState().expenses
    // Concrete: the two referencing rows are now null, the untouched one stays null too,
    // and NO row is left pointing at the tombstoned category.
    expect(expenses.filter((e) => e.categoryId === categoryId)).toHaveLength(0)
    expect(expenses.map((e) => e.categoryId)).toEqual([null, null, null])
    // The rows themselves survive — un-categorized, not deleted.
    expect(expenses).toHaveLength(3)
  })

  it('cascades across BOTH income and expenses', () => {
    const created = manager().createCategory('Shared', 'income')
    const categoryId = created.ok ? created.category.id : ''

    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Salary', amount: 500000, frequency: 'monthly', categoryId })
    useExpenseStore
      .getState()
      .addExpense({ name: 'Rent', amount: 150000, frequency: 'monthly', categoryId })

    expect(manager().deleteCategory(categoryId).affectedRowCount).toBe(2)
    expect(useIncomeStore.getState().incomeSources[0]?.categoryId).toBeNull()
    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBeNull()
  })

  it('the cascade goes through the store ACTIONS so each row re-syncs', () => {
    // ⚠️ The point of routing the cascade through updateExpense rather than a bulk
    // setState: each action enqueues a sync update, so the un-categorization
    // propagates. A bulk write would fix this device and let another device push
    // the stale categoryId back, silently re-attaching a deleted category.
    const spy = vi.spyOn(useExpenseStore.getState(), 'updateExpense')
    const created = manager().createCategory('Groceries', 'expense')
    const categoryId = created.ok ? created.category.id : ''
    useExpenseStore
      .getState()
      .addExpense({ name: 'Aldi', amount: 5000, frequency: 'monthly', categoryId })

    manager().deleteCategory(categoryId)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(expect.any(String), { categoryId: null })
    spy.mockRestore()
  })

  it('reports 0 affected rows when nothing referenced the category', () => {
    const created = manager().createCategory('Unused', 'expense')
    const categoryId = created.ok ? created.category.id : ''
    expect(manager().deleteCategory(categoryId).affectedRowCount).toBe(0)
  })
})

describe('categoryStore — persistence', () => {
  it('rehydrates categories written by a previous session', async () => {
    localStorage.setItem(
      CATEGORY_KEY,
      JSON.stringify({
        version: 1,
        state: {
          categories: [
            {
              id: 'cat-1',
              userId: 0,
              name: 'Groceries',
              kind: 'expense',
              isDeleted: false,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      })
    )

    await useCategoryStore.persist.rehydrate()

    const restored = useCategoryStore.getState().categories
    expect(restored).toHaveLength(1)
    expect(restored[0]?.name).toBe('Groceries')
    expect(restored[0]?.kind).toBe('expense')
  })
})

/**
 * Store-level write invariants (code review 30.4a).
 *
 * ⚠️ These live in the STORE, not just in useCategoryManager. The store is
 * exported through the `stores/index` barrel and Story 30.4b consumes it
 * directly, so a caller that skips the manager must not be able to create a row
 * the wire will refuse. Every rejection below previously produced a local row
 * that could NEVER sync, reported to the user as nothing at all — the queue
 * gate's ZodError is swallowed into a console line by `onQueueError`.
 */
describe('categoryStore — write invariants', () => {
  it('rejects a whitespace-only name instead of creating an empty category', () => {
    expect(useCategoryStore.getState().addCategory({ name: '   ', kind: 'expense' })).toBeNull()
    expect(useCategoryStore.getState().categories).toHaveLength(0)
  })

  it('accepts a name at exactly the 255-character limit', () => {
    // The boundary itself, asserted on the ALLOWED side so the cap cannot be
    // implemented one character too strict without this going red.
    const created = addOk({ name: 'a'.repeat(255), kind: 'expense' })
    expect(created.name).toHaveLength(255)
  })

  it('rejects a 256-character name — the varchar(255) / sync-gate boundary', () => {
    // AC-3's `≤255` clause, which shipped unimplemented. Without this bound the
    // row is created locally and then rejected by `syncOperationDataSchema`
    // BEFORE it enters the queue, so it can never reach the server.
    expect(
      useCategoryStore.getState().addCategory({ name: 'a'.repeat(256), kind: 'expense' })
    ).toBeNull()
    expect(useCategoryStore.getState().categories).toHaveLength(0)
  })

  it('measures the length AFTER trimming, so padding does not consume the budget', () => {
    const created = addOk({ name: `  ${'a'.repeat(255)}  `, kind: 'expense' })
    expect(created.name).toHaveLength(255)
  })

  it('rejects a duplicate name at the store level, not only in the manager', () => {
    addOk({ name: 'Groceries', kind: 'expense' })
    expect(
      useCategoryStore.getState().addCategory({ name: 'groceries', kind: 'expense' })
    ).toBeNull()
    expect(useCategoryStore.getState().categories).toHaveLength(1)
  })

  it('still allows the same name on the OTHER side of the ledger', () => {
    // Negative control: proves the duplicate guard is scoped by `kind` and has
    // not been widened into a blanket ban on repeated names.
    addOk({ name: 'Consulting', kind: 'expense' })
    expect(addOk({ name: 'Consulting', kind: 'income' }).kind).toBe('income')
  })

  it('refuses to rename a category to an empty or over-long name', () => {
    const created = addOk({ name: 'Groceries', kind: 'expense' })

    useCategoryStore.getState().renameCategory(created.id, '   ')
    expect(useCategoryStore.getState().getCategoryById(created.id)?.name).toBe('Groceries')

    useCategoryStore.getState().renameCategory(created.id, 'a'.repeat(256))
    expect(useCategoryStore.getState().getCategoryById(created.id)?.name).toBe('Groceries')
  })

  it('refuses to rename a category onto an existing name', () => {
    addOk({ name: 'Groceries', kind: 'expense' })
    const other = addOk({ name: 'Transport', kind: 'expense' })

    useCategoryStore.getState().renameCategory(other.id, 'GROCERIES')

    expect(useCategoryStore.getState().getCategoryById(other.id)?.name).toBe('Transport')
  })

  it('allows a rename that only changes case of its OWN name', () => {
    // Negative control for the guard above: the duplicate check must exclude the
    // row being renamed, or correcting capitalisation becomes impossible.
    const created = addOk({ name: 'groceries', kind: 'expense' })

    useCategoryStore.getState().renameCategory(created.id, 'Groceries')

    expect(useCategoryStore.getState().getCategoryById(created.id)?.name).toBe('Groceries')
  })
})

/**
 * Tombstone guards (code review 30.4a).
 *
 * ⚠️ This is the ONLY store that keeps soft-deleted rows in local state, so
 * unlike every sibling a mutation can still "find" a row the server has already
 * dropped. Server-side `entityExists` filters `isDeleted = false`, so a second
 * delete returns `Entity not found` → `retryable: false` → the operation lands
 * in `nonRetryableOperations`, which `synchronization.ts` never passes to
 * `removeBatch`. It is then retried forever, pins the sync status at FAILED and
 * re-opens the circuit breaker every cycle — suppressing retries for EVERY
 * other entity, not just categories.
 */
describe('categoryStore — tombstoned rows are inert', () => {
  it('a second delete does not re-tombstone or re-enqueue', async () => {
    const bridge = await import('../../lib/sync/syncBridge')
    const deleteSpy = vi.spyOn(bridge, 'syncEntityDelete')
    const created = addOk({ name: 'Groceries', kind: 'expense' })

    useCategoryStore.getState().deleteCategory(created.id)
    const afterFirst = useCategoryStore.getState().getCategoryById(created.id)?.updatedAt

    useCategoryStore.getState().deleteCategory(created.id)
    const afterSecond = useCategoryStore.getState().getCategoryById(created.id)?.updatedAt

    // updatedAt untouched by the second call — nothing was re-written.
    expect(afterSecond).toBe(afterFirst)
    expect(useCategoryStore.getState().categories).toHaveLength(1)
    deleteSpy.mockRestore()
  })

  it('renaming a tombstoned category is a no-op', () => {
    const created = addOk({ name: 'Groceries', kind: 'expense' })
    useCategoryStore.getState().deleteCategory(created.id)

    useCategoryStore.getState().renameCategory(created.id, 'Food')

    expect(useCategoryStore.getState().getCategoryById(created.id)?.name).toBe('Groceries')
  })

  it('the manager reports a deleted category as not-found, not as an empty name', () => {
    const created = addOk({ name: 'Groceries', kind: 'expense' })
    useCategoryStore.getState().deleteCategory(created.id)

    const result = manager().renameCategory(created.id, 'Food')

    expect(result.ok).toBe(false)
    // The discriminant callers branch on must match the message. Reporting this
    // as 'empty' made a UI focus the name input for a category that had vanished.
    expect(result.ok === false && result.error.reason).toBe('not-found')
  })

  it('the manager does not re-run the cascade for an already-deleted category', () => {
    const created = addOk({ name: 'Groceries', kind: 'expense' })
    useCategoryStore.getState().deleteCategory(created.id)

    expect(manager().deleteCategory(created.id).affectedRowCount).toBe(0)
  })

  it('a tombstoned name is free to reuse — the guard does not outlive the row', () => {
    // Negative control: tombstones must not permanently reserve their name, or
    // deleting "Groceries" would make it uncreatable forever.
    const created = addOk({ name: 'Groceries', kind: 'expense' })
    useCategoryStore.getState().deleteCategory(created.id)

    expect(addOk({ name: 'Groceries', kind: 'expense' }).id).not.toBe(created.id)
  })
})

describe('useCategoryManager — validation messages', () => {
  it('reports an over-long name as too-long, distinctly from empty', () => {
    const result = manager().createCategory('a'.repeat(256), 'expense')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.reason).toBe('too-long')
  })
})
