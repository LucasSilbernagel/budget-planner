import type { CategoryKind } from '@budget-planner/db/schema'
import { useMemo } from 'react'
import {
	type ClientCategory,
	MAX_CATEGORY_NAME_LENGTH,
	useCategoryStore,
} from '../stores/categoryStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useIncomeStore } from '../stores/incomeStore'

/**
 * The cascade uses the domain stores' update actions, not a bulk setState, so each row enqueues a
 * sync update; otherwise another device would push the stale categoryId back.
 */

export type CategoryValidationError = {
	reason: 'empty' | 'too-long' | 'duplicate' | 'not-found'
	message: string
}

export type UseCategoryManagerResult = {
	createCategory: (
		name: string,
		kind: CategoryKind
	) => { ok: true; category: ClientCategory } | { ok: false; error: CategoryValidationError }
	renameCategory: (
		id: string,
		name: string
	) => { ok: true } | { ok: false; error: CategoryValidationError }
	deleteCategory: (id: string) => { affectedRowCount: number }
	/** A snapshot; use `useCategoryRowCount` for a live count. */
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
	// Both sync gates and the varchar(255) column enforce this; without it the row could never sync.
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

// Not profile-scoped: `deleteCategory` un-assigns from every local row, so count the same set.
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
	// Already tombstoned: re-cascading would touch rows again and push a second delete.
	if (!existing || existing.isDeleted) {
		return { affectedRowCount: 0 }
	}

	const affectedIncome = useIncomeStore
		.getState()
		.incomeSources.filter((row) => row.categoryId === id)
	const affectedExpenses = useExpenseStore
		.getState()
		.expenses.filter((row) => row.categoryId === id)

	// Clear references first so no row is ever observable pointing at a tombstoned category.
	for (const row of affectedIncome) {
		useIncomeStore.getState().updateIncomeSource(row.id, { categoryId: null })
	}
	for (const row of affectedExpenses) {
		useExpenseStore.getState().updateExpense(row.id, { categoryId: null })
	}

	useCategoryStore.getState().deleteCategory(id)

	return { affectedRowCount: affectedIncome.length + affectedExpenses.length }
}

const CATEGORY_MANAGER: UseCategoryManagerResult = {
	createCategory,
	renameCategory,
	deleteCategory,
	countRowsUsing,
}

export function useCategoryManager(): UseCategoryManagerResult {
	return CATEGORY_MANAGER
}

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
