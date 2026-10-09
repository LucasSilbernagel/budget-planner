import { describe, expect, it } from 'vitest'
import { resolveCategoryLabel, resolveCategoryName, UNNAMED_LABEL } from '../useCategoryLabels'

const NAMES = new Map([
	['cat-1', 'Groceries'],
	['cat-blank', '   '],
])

describe('resolveCategoryLabel, the grouping key for the overview pies', () => {
	it.each([
		['a resolved category', 'cat-1', 'Tesco run', 'Groceries'],
		['an uncategorized row', null, 'Netflix', 'Netflix'],
		['an id this device does not hold', 'cat-missing', 'Tesco run', 'Tesco run'],
		// Rehydrated or pulled categories skip `addCategory`'s blank-name check.
		['a whitespace-only category name', 'cat-blank', 'Tesco run', 'Tesco run'],
		['a padded own name', null, '  Netflix  ', 'Netflix'],
		['a blank own name with no category', null, '   ', UNNAMED_LABEL],
		['a blank own name with a dangling category', 'cat-missing', '', UNNAMED_LABEL],
	])('%s', (_label, categoryId, ownName, expected) => {
		expect(resolveCategoryLabel(categoryId, ownName, NAMES)).toBe(expected)
	})

	it('never uses a blank placeholder', () => {
		expect(UNNAMED_LABEL.trim().length).toBeGreaterThan(0)
	})
})

describe('resolveCategoryName, the table cell', () => {
	it.each([
		['a resolved category', 'cat-1', 'Groceries'],
		['a dangling id', 'cat-missing', null],
		['an uncategorized row', null, null],
		['a whitespace-only category name', 'cat-blank', null],
	])('%s', (_label, categoryId, expected) => {
		expect(resolveCategoryName(categoryId, NAMES)).toBe(expected)
	})
})
