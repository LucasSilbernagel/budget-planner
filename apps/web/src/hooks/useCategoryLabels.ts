import { useMemo } from 'react'
import { type ClientCategory, useCategoryStore, useLiveCategories } from '../stores/categoryStore'
import { useProfileStore } from '../stores/profileStore'

/**
 * A dangling categoryId is normal (pull pagination, remote deletion, local tombstones), not
 * corruption: such a row presents as uncategorized.
 */

/**
 * Tombstones are excluded so a soft-deleted category resolves as uncategorized. Built in useMemo,
 * not the selector: a fresh Map per read breaks zustand 5 equality.
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
 * A null profileId is unscoped and shown under every profile; a strict `===` would hide those
 * categories, since activeProfileId is essentially never null.
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

/** `??` passes '' through, so an empty label would yield a blank `type:` key and slice; never return ''. */
export function resolveCategoryLabel(
	categoryId: string | null | undefined,
	ownName: string,
	names: ReadonlyMap<string, string>
): string {
	const resolved = categoryId ? names.get(categoryId)?.trim() : undefined
	if (resolved && resolved.length > 0) {
		return resolved
	}
	const own = ownName.trim()
	return own.length > 0 ? own : UNNAMED_LABEL
}

export const UNNAMED_LABEL = 'Unnamed'

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
