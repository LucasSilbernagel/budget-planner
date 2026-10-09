import { calculateTotalMonthlyNormalized } from '@budget-planner/core/finance/normalization'
import type { Frequency } from '@budget-planner/db/schema'
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { backfillSortOrder, nextSortOrder, sortByDisplayOrder } from '../lib/ordering'
import { registerProfileScopedCollection } from '../lib/profile-cascade'
import { scopeToActiveProfile } from '../lib/profile-scope'
import { countUnreadableRows, toNormalizableItems } from '../lib/readable-rows'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { generateUUID, withUuidIds } from '../lib/uuid'
import { EXPENSES_STORAGE_KEY } from './overview-data-storage-keys'
import { useProfileStore } from './profileStore'

type ClientExpense = {
	id: string
	// Null/absent means unscoped (visible under every profile). Not on the input type: an edit must
	// never re-home a row.
	profileId?: string | null
	userId: number | string
	name: string
	amount: number
	frequency: Frequency
	categoryId: string | null
	// An order, not an index: deletes leave gaps on purpose.
	sortOrder?: number
	/**
	 * Optional with no migration backfill; always read as `=== true` since localStorage is
	 * user-editable and a persisted "false" string is truthy.
	 */
	endsBeforeRetirement?: boolean
	createdAt: string
	updatedAt: string
}

type ClientNewExpense = {
	userId?: number
	name: string
	amount: number
	frequency: Frequency
	categoryId?: string | null
	endsBeforeRetirement?: boolean
}

type ExpenseState = {
	expenses: ClientExpense[]
	addExpense: (expense: ClientNewExpense) => void
	updateExpense: (id: string, updates: Partial<ClientNewExpense>) => void
	deleteExpense: (id: string) => void
	getExpenseById: (id: string) => ClientExpense | undefined
	getExpensesByFrequency: (frequency: Frequency) => ClientExpense[]
	/** Monthly-normalized cents; denormalize for display. */
	getTotalExpenses: () => number
	getUnreadableExpenseCount: () => number
}

const toClientExpense = (newExpense: ClientNewExpense): ClientExpense => ({
	...newExpense,
	// Explicit null so the sync payload never carries undefined.
	categoryId: newExpense.categoryId ?? null,
	endsBeforeRetirement: newExpense.endsBeforeRetirement ?? false,
	userId: newExpense.userId ?? 0,
	id: generateUUID(),
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
})

/**
 * Selector hooks must call these with the state rows, never the equivalent store METHOD: methods
 * close over get() and read live state during hydration, causing a mismatch. Must return a number.
 */
function totalExpenseFrom(rows: readonly ClientExpense[]): number {
	return calculateTotalMonthlyNormalized(toNormalizableItems(rows))
}

function expensesByFrequencyFrom(
	rows: readonly ClientExpense[],
	frequency: Frequency
): ClientExpense[] {
	return rows.filter((row) => row.frequency === frequency)
}

function unreadableExpenseCountFrom(rows: readonly ClientExpense[]): number {
	return countUnreadableRows(rows)
}
export const useExpenseStore = create<ExpenseState>()(
	persist(
		(set, get) => ({
			expenses: [],

			addExpense: (newExpense) => {
				const expense = {
					...toClientExpense(newExpense),
					sortOrder: nextSortOrder(get().expenses),
					profileId: useProfileStore.getState().activeProfileId ?? null,
				} satisfies ClientExpense
				set((state) => ({
					expenses: sortByDisplayOrder([...state.expenses, expense]),
				}))
				syncEntityCreate('expense', expense)
			},

			updateExpense: (id, updates) => {
				const previous = get().expenses.find((expense) => expense.id === id)
				if (!previous) {
					return
				}
				const updated = { ...previous, ...updates, updatedAt: new Date().toISOString() }
				set((state) => ({
					expenses: sortByDisplayOrder(
						state.expenses.map((expense) => (expense.id === id ? updated : expense))
					),
				}))
				syncEntityUpdate('expense', updated, previous)
			},

			deleteExpense: (id) => {
				const existing = get().expenses.find((expense) => expense.id === id)
				set((state) => ({
					expenses: state.expenses.filter((expense) => expense.id !== id),
				}))
				if (existing) {
					syncEntityDelete('expense', existing)
				}
			},

			getExpenseById: (id) => {
				return get().expenses.find((expense) => expense.id === id)
			},

			getExpensesByFrequency: (frequency) => {
				return expensesByFrequencyFrom(get().expenses, frequency)
			},

			getTotalExpenses: () => {
				return totalExpenseFrom(get().expenses)
			},

			getUnreadableExpenseCount: () => {
				return unreadableExpenseCountFrom(get().expenses)
			},
		}),
		{
			name: EXPENSES_STORAGE_KEY,
			skipHydration: true,
			// migrate runs on ANY version mismatch, including a downgrade, so every step must be idempotent.
			// The `-v1` in the storage key is part of the key, not this version.
			version: 3,
			migrate: (persisted) => {
				const state = persisted as { expenses?: unknown }
				// Sanitize before dereferencing rows: a throwing migrate fails rehydration and silently empties the list.
				const raw = Array.isArray(state?.expenses) ? state.expenses : []
				const rows = raw.filter(
					(row): row is ClientExpense => typeof row === 'object' && row !== null
				)
				return {
					// Backfill runs last so the id tiebreaker sees the final uuids, not the legacy ids.
					expenses: backfillSortOrder(
						withUuidIds(rows).map((row) => ({
							...row,
							categoryId: row.categoryId ?? null,
						}))
					),
				}
			},
			partialize: (state) => ({
				expenses: state.expenses,
			}),
		}
	)
)

/**
 * Holds every profile's rows: each hook deriving from them must scope to the active profile.
 * Store methods are deliberately unscoped (sync seeding, purge operate on every row).
 */
export const useExpenses = (): ClientExpense[] => {
	const rows = useExpenseStore((state) => state.expenses)
	const activeProfileId = useProfileStore((state) => state.activeProfileId)
	return useMemo(() => scopeToActiveProfile(rows, activeProfileId), [rows, activeProfileId])
}

export const useTotalExpenses = () => {
	const activeProfileId = useProfileStore((state) => state.activeProfileId)
	return useExpenseStore((state) =>
		totalExpenseFrom(scopeToActiveProfile(state.expenses, activeProfileId))
	)
}

// Stores register themselves: the cascade importing them would create an import cycle.
registerProfileScopedCollection(useExpenseStore, 'expenses')
