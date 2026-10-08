import type { CategoryKind } from '@budget-planner/db'
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { registerProfileScopedCollection } from '../lib/profile-cascade'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { generateUUID } from '../lib/uuid'
import { useProfileStore } from './profileStore'

/**
 * Deletion is soft (isDeleted tombstone) so a delta pull can surface it. The store validates its
 * own writes: a row the wire would reject could never sync, and the failure is swallowed.
 */
export interface ClientCategory {
	id: string
	userId: number
	/**
	 * Unlike sibling stores, categories are profile-tagged: the DB unique index is per
	 * (user, profile, kind, name).
	 */
	profileId: string | null
	name: string
	kind: CategoryKind
	isDeleted: boolean
	createdAt: string
	updatedAt: string
}

export interface ClientNewCategory {
	userId?: number
	profileId?: string | null
	name: string
	kind: CategoryKind
}

interface CategoryState {
	categories: ClientCategory[]
	/** Returns null when the name fails the store's invariants. */
	addCategory: (category: ClientNewCategory) => ClientCategory | null
	renameCategory: (id: string, name: string) => void
	deleteCategory: (id: string) => void
	getCategoryById: (id: string) => ClientCategory | undefined
	/** Live (non-tombstoned) categories only. */
	getCategoriesByKind: (kind: CategoryKind) => ClientCategory[]
	isDuplicateName: (name: string, kind: CategoryKind, excludeId?: string) => boolean
	reset: () => void
}

/** Mirrors varchar(255) and both sync schemas; a longer name would exist locally and never sync. */
export const MAX_CATEGORY_NAME_LENGTH = 255

export const isValidCategoryName = (name: string): boolean => {
	const trimmed = name.trim()
	return trimmed.length > 0 && trimmed.length <= MAX_CATEGORY_NAME_LENGTH
}

const toClientCategory = (newCategory: ClientNewCategory): ClientCategory => ({
	...newCategory,
	userId: newCategory.userId ?? 0,
	profileId: newCategory.profileId ?? useProfileStore.getState().activeProfileId ?? null,
	id: generateUUID(),
	isDeleted: false,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
})

/** Case-insensitive on the trimmed form, matching the DB's unique index on lower(name). */
const normalizeName = (name: string): string => name.trim().toLocaleLowerCase()

const sameProfile = (a: string | null | undefined, b: string | null | undefined): boolean =>
	(a ?? null) === (b ?? null)

export const useCategoryStore = create<CategoryState>()(
	persist(
		(set, get) => ({
			categories: [],

			addCategory: (newCategory) => {
				const name = newCategory.name.trim()
				if (!isValidCategoryName(name)) {
					return null
				}
				const category = toClientCategory({ ...newCategory, name })
				if (get().isDuplicateName(name, category.kind)) {
					return null
				}
				set((state) => ({ categories: [...state.categories, category] }))
				syncEntityCreate('category', category)
				return category
			},

			renameCategory: (id, name) => {
				const previous = get().categories.find((category) => category.id === id)
				// Tombstoned rows stay in local state; an update to one is a server conflict that stays queued
				// forever, pinning sync at FAILED.
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
				syncEntityUpdate('category', updated, previous)
			},

			deleteCategory: (id) => {
				const existing = get().categories.find((category) => category.id === id)
				// Same tombstone guard as renameCategory; a double-click on Delete reaches it.
				if (!existing || existing.isDeleted) {
					return
				}
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
						// Profile-scoped to match the DB's unique index.
						sameProfile(category.profileId, activeProfileId) &&
						normalizeName(category.name) === candidate
				)
			},

			reset: () => set({ categories: [] }),
		}),
		{
			name: 'budget-planner-categories-v1',
			skipHydration: true,
			version: 1,
			partialize: (state) => ({
				categories: state.categories,
			}),
		}
	)
)

export const useCategories = () => useCategoryStore((state) => state.categories)

/**
 * Filters tombstones. Filtered in useMemo, not the selector, so the array identity is stable
 * (a fresh array per read re-renders on v4 and loops on v5).
 */
export const useLiveCategories = (): ClientCategory[] => {
	const categories = useCategoryStore((state) => state.categories)
	return useMemo(() => categories.filter((category) => !category.isDeleted), [categories])
}

// Stores register themselves: the cascade importing them would create an import cycle.
registerProfileScopedCollection(useCategoryStore, 'categories')
