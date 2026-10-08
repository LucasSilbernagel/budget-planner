/** A null or absent `profileId` is unscoped and visible under every profile. */

import { describe, expect, it } from 'vitest'
import { isInActiveProfile, scopeToActiveProfile } from '../profile-scope'

describe('isInActiveProfile', () => {
	it('keeps a row stamped with the active profile', () => {
		expect(isInActiveProfile('p-b', 'p-b')).toBe(true)
	})

	it('EXCLUDES a row stamped with a different profile', () => {
		expect(isInActiveProfile('p-a', 'p-b')).toBe(false)
	})

	it('keeps an explicitly unscoped (null) row under any profile', () => {
		expect(isInActiveProfile(null, 'p-b')).toBe(true)
	})

	it('keeps a legacy row with NO profileId key (undefined) under any profile', () => {
		expect(isInActiveProfile(undefined, 'p-b')).toBe(true)
	})

	it('keeps every row when there is no active profile, rather than hiding everything', () => {
		expect(isInActiveProfile('p-a', null)).toBe(true)
	})
})

describe('scopeToActiveProfile', () => {
	const rows = [
		{ id: 'a', profileId: 'p-a' },
		{ id: 'b', profileId: 'p-b' },
		{ id: 'legacy' },
		{ id: 'null', profileId: null },
	]

	it('returns only the active profile rows plus unscoped rows, in their original order', () => {
		expect(scopeToActiveProfile(rows, 'p-b').map((row) => row.id)).toEqual(['b', 'legacy', 'null'])
	})

	it('returns every row when the active profile is null', () => {
		expect(scopeToActiveProfile(rows, null).map((row) => row.id)).toEqual([
			'a',
			'b',
			'legacy',
			'null',
		])
	})
})
