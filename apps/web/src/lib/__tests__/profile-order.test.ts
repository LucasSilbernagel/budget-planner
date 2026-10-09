import { describe, expect, it } from 'vitest'
import { sortProfilesOldestFirst } from '../profile-order'

describe('sortProfilesOldestFirst', () => {
	const ids = (rows: { id?: string }[]) => rows.map((r) => r.id)

	it('orders by createdAt ascending', () => {
		const rows = [
			{ id: 'c', createdAt: '2026-03-01T00:00:00.000Z' },
			{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
			{ id: 'b', createdAt: '2026-02-01T00:00:00.000Z' },
		]
		expect(ids(sortProfilesOldestFirst(rows))).toEqual(['a', 'b', 'c'])
	})

	it('breaks an equal createdAt by id, lexicographically', () => {
		const at = '2026-01-01T00:00:00.000Z'
		const rows = [
			{ id: 'b', createdAt: at },
			{ id: 'B', createdAt: at },
			{ id: 'a', createdAt: at },
		]
		// Plain `<`: uppercase sorts before lowercase (code units), unlike localeCompare.
		expect(ids(sortProfilesOldestFirst(rows))).toEqual(['B', 'a', 'b'])
	})

	it('puts a row with no or unparseable createdAt FIRST (the bootstrap placeholder)', () => {
		const rows = [
			{ id: 'newer', createdAt: '2026-02-01T00:00:00.000Z' },
			{ id: 'placeholder' },
			{ id: 'garbage', createdAt: 'not a date' },
			{ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' },
		]
		expect(ids(sortProfilesOldestFirst(rows))).toEqual(['garbage', 'placeholder', 'older', 'newer'])
	})

	it('is non-mutating', () => {
		const rows = [
			{ id: 'b', createdAt: '2026-02-01T00:00:00.000Z' },
			{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
		]
		const copy = [...rows]
		sortProfilesOldestFirst(rows)
		expect(rows).toEqual(copy)
	})

	it('returns [] for a non-array', () => {
		expect(sortProfilesOldestFirst(null)).toEqual([])
		expect(sortProfilesOldestFirst(undefined)).toEqual([])
	})
})
