/** The persist keys are the `-v1` names: that suffix is part of the key, not the version. */

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
    // Present and null, not absent: the sync payload and the picker distinguish them.
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
    // The factory default and the migration must agree on the persisted shape.
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
 * migrate runs on ANY version mismatch (a newer payload too), and a throwing migrate leaves the
 * store empty.
 */
describe('persist migrate — resilience to hostile payloads', () => {
  it('survives a null row instead of wiping the whole income list', async () => {
    localStorage.setItem(
      INCOME_KEY,
      JSON.stringify({ state: { incomeSources: [legacyIncomeRow, null] }, version: 1 })
    )

    await useIncomeStore.persist.rehydrate()

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
    expect(rows[0]?.categoryId).toBe('cat-1')
  })
})
