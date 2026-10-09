/**
 * Missing createdAt sorts FIRST (unlike sortByDisplayOrder): the bootstrap default profile has none and is the oldest.
 * Imports nothing: profileStore imports this, and any store import here recreates an import-cycle deadlock.
 */

export type CreationOrdered = {
	id?: string
	createdAt?: string
}

const FIRST = Number.NEGATIVE_INFINITY

function createdKey(row: CreationOrdered | null | undefined): number {
	const raw = row?.createdAt
	if (typeof raw !== 'string') {
		return FIRST
	}
	const ms = Date.parse(raw)
	return Number.isFinite(ms) ? ms : FIRST
}

function idKey(row: CreationOrdered | null | undefined): string {
	const value = row?.id
	return typeof value === 'string' ? value : ''
}

/** Compared, never subtracted: -Infinity - -Infinity is NaN. Plain </> on id so every device breaks ties identically. */
export function sortProfilesOldestFirst<T extends CreationOrdered>(
	rows: readonly T[] | null | undefined
): T[] {
	if (!Array.isArray(rows)) {
		return []
	}
	return [...rows].sort((a, b) => {
		const createdA = createdKey(a)
		const createdB = createdKey(b)
		if (createdA !== createdB) {
			return createdA < createdB ? -1 : 1
		}
		const idA = idKey(a)
		const idB = idKey(b)
		if (idA === idB) {
			return 0
		}
		return idA < idB ? -1 : 1
	})
}
