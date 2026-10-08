import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'
import { useProfileStore } from '../../stores/profileStore'
import {
	resolveCategoryLabel,
	resolveCategoryName,
	UNNAMED_LABEL,
	useCategoriesForActiveProfile,
	useCategoryNameMap,
} from '../useCategoryLabels'

function category(overrides: Partial<ClientCategory> & { id: string }): ClientCategory {
	return {
		userId: 0,
		profileId: null,
		name: 'Groceries',
		kind: 'expense',
		isDeleted: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	}
}

beforeEach(() => {
	useCategoryStore.setState({ categories: [] })
})

afterEach(() => {
	// This afterEach runs before testing-library's auto-cleanup, so hooks are still mounted and
	// subscribed; `act` avoids the warning.
	act(() => {
		useCategoryStore.setState({ categories: [] })
	})
})

describe('useCategoryNameMap', () => {
	it('maps live categories from id to name', () => {
		useCategoryStore.setState({
			categories: [
				category({ id: 'cat-1', name: 'Groceries' }),
				category({ id: 'cat-2', name: 'Rent' }),
			],
		})

		const { result } = renderHook(() => useCategoryNameMap())

		expect(result.current.get('cat-1')).toBe('Groceries')
		expect(result.current.get('cat-2')).toBe('Rent')
		expect(result.current.size).toBe(2)
	})

	it('EXCLUDES tombstoned categories, so a soft-deleted id is a deliberate miss', () => {
		useCategoryStore.setState({
			categories: [category({ id: 'cat-1', name: 'Groceries', isDeleted: true })],
		})

		const { result } = renderHook(() => useCategoryNameMap())

		expect(result.current.has('cat-1')).toBe(false)
		expect(result.current.size).toBe(0)
	})

	it('re-derives when a category is renamed, so consumers cannot render a stale name', () => {
		useCategoryStore.setState({ categories: [category({ id: 'cat-1', name: 'Groceries' })] })
		const { result } = renderHook(() => useCategoryNameMap())
		expect(result.current.get('cat-1')).toBe('Groceries')

		act(() => {
			useCategoryStore.getState().renameCategory('cat-1', 'Food')
		})

		expect(result.current.get('cat-1')).toBe('Food')
	})
})

describe('resolveCategoryLabel — the grouping key for the overview pies', () => {
	it('returns the category name when the reference resolves', () => {
		const names = new Map([['cat-1', 'Groceries']])
		expect(resolveCategoryLabel('cat-1', 'Tesco run', names)).toBe('Groceries')
	})

	it('returns the row name when the row is uncategorized (Decision 10)', () => {
		expect(resolveCategoryLabel(null, 'Netflix', new Map())).toBe('Netflix')
	})

	it('CAUSE 1 (pull pagination): an id this device has not received yet falls back', () => {
		useCategoryStore.setState({ categories: [category({ id: 'cat-other', name: 'Rent' })] })
		const { result } = renderHook(() => useCategoryNameMap())

		expect(resolveCategoryLabel('cat-not-yet-pulled', 'Tesco run', result.current)).toBe(
			'Tesco run'
		)
	})

	it('CAUSE 2 (deleted on another device): a removed category falls back', () => {
		// `applyServerChanges` removes a tombstoned row outright, leaving the local row dangling.
		useCategoryStore.setState({ categories: [category({ id: 'cat-1', name: 'Groceries' })] })
		const { result, rerender } = renderHook(() => useCategoryNameMap())
		expect(resolveCategoryLabel('cat-1', 'Tesco run', result.current)).toBe('Groceries')

		act(() => {
			useCategoryStore.setState({ categories: [] })
		})
		rerender()

		expect(resolveCategoryLabel('cat-1', 'Tesco run', result.current)).toBe('Tesco run')
	})

	it('CAUSE 3 (soft-deleted locally): a tombstoned category falls back', () => {
		useCategoryStore.setState({
			categories: [category({ id: 'cat-1', name: 'Groceries', isDeleted: true })],
		})
		const { result } = renderHook(() => useCategoryNameMap())

		expect(resolveCategoryLabel('cat-1', 'Tesco run', result.current)).toBe('Tesco run')
	})

	it('never yields an empty label, which would render a blank slice and lose its colour', () => {
		// `addCategory` rejects blank names, but rehydrated or pulled rows go in unvalidated.
		useCategoryStore.setState({ categories: [category({ id: 'cat-1', name: '   ' })] })
		const { result } = renderHook(() => useCategoryNameMap())

		expect(resolveCategoryLabel('cat-1', 'Tesco run', result.current)).toBe('Tesco run')
	})
})

describe('resolveCategoryName — the table cell', () => {
	it('returns the name when it resolves and null when it does not', () => {
		const names = new Map([['cat-1', 'Groceries']])
		expect(resolveCategoryName('cat-1', names)).toBe('Groceries')
		expect(resolveCategoryName('cat-missing', names)).toBeNull()
		expect(resolveCategoryName(null, names)).toBeNull()
	})

	it('treats a whitespace-only name as uncategorized rather than rendering a blank pill', () => {
		expect(resolveCategoryName('cat-1', new Map([['cat-1', '   ']]))).toBeNull()
	})
})

describe('useCategoriesForActiveProfile (code review 30.4b)', () => {
	const PROFILE_A = 'profile-a'
	const PROFILE_B = 'profile-b'

	afterEach(() => {
		act(() => {
			useProfileStore.setState({ activeProfileId: PROFILE_A })
		})
	})

	it('shows only the active profile’s categories', () => {
		act(() => {
			useProfileStore.setState({ activeProfileId: PROFILE_A })
			useCategoryStore.setState({
				categories: [
					category({ id: 'a1', name: 'Groceries', profileId: PROFILE_A }),
					category({ id: 'b1', name: 'Groceries', profileId: PROFILE_B }),
				],
			})
		})

		const { result } = renderHook(() => useCategoriesForActiveProfile())

		expect(result.current.map((c) => c.id)).toEqual(['a1'])
	})

	it('follows a profile switch', () => {
		act(() => {
			useProfileStore.setState({ activeProfileId: PROFILE_A })
			useCategoryStore.setState({
				categories: [
					category({ id: 'a1', name: 'Groceries', profileId: PROFILE_A }),
					category({ id: 'b1', name: 'Rent', profileId: PROFILE_B }),
				],
			})
		})
		const { result } = renderHook(() => useCategoriesForActiveProfile())
		expect(result.current.map((c) => c.id)).toEqual(['a1'])

		act(() => {
			useProfileStore.setState({ activeProfileId: PROFILE_B })
		})

		expect(result.current.map((c) => c.id)).toEqual(['b1'])
	})

	it('treats a NULL profileId as unscoped and shows it under every profile', () => {
		// `activeProfileId` is essentially never null, so a strict `===` would hide every null-profile category.
		act(() => {
			useProfileStore.setState({ activeProfileId: PROFILE_A })
			useCategoryStore.setState({
				categories: [category({ id: 'legacy', name: 'Groceries', profileId: null })],
			})
		})

		const { result } = renderHook(() => useCategoriesForActiveProfile())

		expect(result.current.map((c) => c.id)).toEqual(['legacy'])
	})

	it('excludes tombstones, like every other read', () => {
		act(() => {
			useProfileStore.setState({ activeProfileId: PROFILE_A })
			useCategoryStore.setState({
				categories: [category({ id: 'a1', name: 'Gone', profileId: PROFILE_A, isDeleted: true })],
			})
		})

		const { result } = renderHook(() => useCategoriesForActiveProfile())

		expect(result.current).toHaveLength(0)
	})
})

describe('resolveCategoryLabel — the fallback is guarded too (code review 30.4b)', () => {
	it('falls back to a visible label when the row’s OWN name is blank', () => {
		expect(resolveCategoryLabel(null, '   ', new Map())).toBe(UNNAMED_LABEL)
		expect(resolveCategoryLabel('missing', '', new Map())).toBe(UNNAMED_LABEL)
		expect(UNNAMED_LABEL.trim().length).toBeGreaterThan(0)
	})

	it('still prefers a real own-name over the placeholder', () => {
		expect(resolveCategoryLabel(null, '  Netflix  ', new Map())).toBe('Netflix')
	})
})
