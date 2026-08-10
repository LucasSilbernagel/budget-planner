/**
 * incomeStore / expenseStore persist v1 → v2 (Story 30.4a, AC-4)
 *
 * Adding `categoryId` bumped both stores to persist version 2 with a `migrate`
 * that backfills `categoryId: null`. These prove the backfill runs AND that
 * nothing else is disturbed — the v0→v1 uuid conversion must still happen, and
 * every pre-existing field must survive untouched.
 *
 * `.dom.test.ts` for a real localStorage: vitest.config.ts's
 * environmentMatchGlobs only routes `.dom.test` files (and components/*) to
 * jsdom, and `persist.rehydrate()` is meaningless without storage.
 *
 * ⚠️ The persist KEYS below are deliberately the `-v1` names. That suffix is
 * part of the storage key, NOT the numeric version — renaming it would orphan
 * every existing row rather than migrate it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'

const INCOME_KEY = 'budget-planner-income-v1'
const EXPENSE_KEY = 'budget-planner-expenses-v1'

const legacyIncomeRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 0,
  name: 'Salary',
  amount: 500000,
  frequency: 'monthly',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const legacyExpenseRow = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userId: 0,
  name: 'Rent',
  amount: 150000,
  frequency: 'monthly',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

beforeEach(() => {
  localStorage.clear()
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
})

describe('incomeStore v1 → v2', () => {
  it('backfills categoryId: null on a v1 payload', async () => {
    localStorage.setItem(
      INCOME_KEY,
      JSON.stringify({ version: 1, state: { incomeSources: [legacyIncomeRow] } })
    )

    await useIncomeStore.persist.rehydrate()

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    // The key must be PRESENT and null — not merely absent/undefined, which is
    // what the sync payload and the picker both distinguish.
    expect(rows[0]).toHaveProperty('categoryId')
    expect(rows[0]?.categoryId).toBeNull()
  })

  it('preserves every pre-existing field through the migration', async () => {
    localStorage.setItem(
      INCOME_KEY,
      JSON.stringify({ version: 1, state: { incomeSources: [legacyIncomeRow] } })
    )

    await useIncomeStore.persist.rehydrate()

    const row = useIncomeStore.getState().incomeSources[0]
    expect(row?.id).toBe(legacyIncomeRow.id)
    expect(row?.name).toBe('Salary')
    expect(row?.amount).toBe(500000)
    expect(row?.frequency).toBe('monthly')
    expect(row?.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(row?.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('does NOT clobber a categoryId already present in a v2 payload', async () => {
    const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    localStorage.setItem(
      INCOME_KEY,
      JSON.stringify({
        version: 2,
        state: { incomeSources: [{ ...legacyIncomeRow, categoryId }] },
      })
    )

    await useIncomeStore.persist.rehydrate()

    // migrate() only runs BELOW the declared version, so a v2 payload passes
    // through untouched. If this ever fails, the migration is running on current
    // data and would erase real category assignments.
    expect(useIncomeStore.getState().incomeSources[0]?.categoryId).toBe(categoryId)
  })

  it('still converts legacy negative-integer ids (the v0 → v1 step survives)', async () => {
    localStorage.setItem(
      INCOME_KEY,
      JSON.stringify({
        version: 0,
        state: { incomeSources: [{ ...legacyIncomeRow, id: -3 }] },
      })
    )

    await useIncomeStore.persist.rehydrate()

    const row = useIncomeStore.getState().incomeSources[0]
    expect(typeof row?.id).toBe('string')
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/i)
    // ...and the v2 step still applied on the same pass.
    expect(row?.categoryId).toBeNull()
  })

  it('tolerates an empty or absent collection', async () => {
    localStorage.setItem(INCOME_KEY, JSON.stringify({ version: 1, state: {} }))
    await useIncomeStore.persist.rehydrate()
    expect(useIncomeStore.getState().incomeSources).toEqual([])
  })
})

describe('expenseStore v1 → v2', () => {
  it('backfills categoryId: null on a v1 payload', async () => {
    localStorage.setItem(
      EXPENSE_KEY,
      JSON.stringify({ version: 1, state: { expenses: [legacyExpenseRow] } })
    )

    await useExpenseStore.persist.rehydrate()

    const rows = useExpenseStore.getState().expenses
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveProperty('categoryId')
    expect(rows[0]?.categoryId).toBeNull()
    expect(rows[0]?.name).toBe('Rent')
    expect(rows[0]?.amount).toBe(150000)
  })

  it('does NOT clobber a categoryId already present in a v2 payload', async () => {
    const categoryId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    localStorage.setItem(
      EXPENSE_KEY,
      JSON.stringify({ version: 2, state: { expenses: [{ ...legacyExpenseRow, categoryId }] } })
    )

    await useExpenseStore.persist.rehydrate()

    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBe(categoryId)
  })
})

describe('newly created rows are explicitly uncategorized', () => {
  it('a row added without a category carries null, not undefined', () => {
    // The factory default and the migration must agree, or the persisted shape
    // differs depending on whether a row predates the feature.
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Freelance', amount: 100000, frequency: 'monthly' })

    const row = useIncomeStore.getState().incomeSources[0]
    expect(row).toHaveProperty('categoryId')
    expect(row?.categoryId).toBeNull()
  })

  it('a row added WITH a category keeps it', () => {
    const categoryId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    useExpenseStore
      .getState()
      .addExpense({ name: 'Aldi', amount: 5000, frequency: 'monthly', categoryId })

    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBe(categoryId)
  })
})

/**
 * Migration resilience (code review 30.4a).
 *
 * ⚠️ `migrate` runs on ANY version MISMATCH, not only an upgrade — zustand 4.5.7
 * gates on `version !== options.version`, so a payload written by a NEWER build
 * is put through the same function. The shipped comments claimed the opposite,
 * and the only "v2 is untouched" test exercised `2 === 2`, i.e. the path where
 * migrate is never called at all: true by construction.
 *
 * ⚠️ A throwing `migrate` does not degrade gracefully — rehydration fails and
 * the store keeps its empty default, so the user's entire list silently
 * disappears. The persisted array is untrusted JSON; the `as ClientExpense[]`
 * cast asserts a shape nobody verified.
 */
describe('persist migrate — resilience to hostile payloads', () => {
  it('survives a null row instead of wiping the whole income list', async () => {
    localStorage.setItem(
      INCOME_KEY,
      JSON.stringify({ state: { incomeSources: [legacyIncomeRow, null] }, version: 1 })
    )

    await useIncomeStore.persist.rehydrate()

    // Before the filter, `row.categoryId` on the null entry threw a TypeError,
    // migrate rejected, and rehydration left the store empty — every income row
    // gone with no error surfaced anywhere.
    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Salary')
    expect(rows[0]?.categoryId).toBeNull()
  })

  it('survives a null row instead of wiping the whole expense list', async () => {
    localStorage.setItem(
      EXPENSE_KEY,
      JSON.stringify({ state: { expenses: [null, legacyExpenseRow] }, version: 1 })
    )

    await useExpenseStore.persist.rehydrate()

    const rows = useExpenseStore.getState().expenses
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Rent')
    expect(rows[0]?.categoryId).toBeNull()
  })

  it('handles a payload from a NEWER version (a downgrade) without throwing', async () => {
    // The real behaviour the comments denied: version 3 !== version 2, so
    // migrate IS invoked. Both steps are idempotent, so the row must come
    // through intact rather than being mangled or dropped.
    localStorage.setItem(
      INCOME_KEY,
      JSON.stringify({
        state: { incomeSources: [{ ...legacyIncomeRow, categoryId: 'cat-1' }] },
        version: 3,
      })
    )

    await useIncomeStore.persist.rehydrate()

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(1)
    // An existing categoryId must NOT be clobbered back to null by the backfill.
    expect(rows[0]?.categoryId).toBe('cat-1')
  })
})
