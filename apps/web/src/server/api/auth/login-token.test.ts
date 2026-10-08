import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
	insertValues,
	updateReturning,
	updateWhere,
	updateSet,
	selectLimit,
	dbInsert,
	dbUpdate,
	dbSelect,
} = vi.hoisted(() => {
	const insertValues = vi.fn().mockResolvedValue(undefined)
	const updateReturning = vi.fn()
	const updateWhere = vi.fn(() => ({ returning: updateReturning }))
	const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }))
	const selectLimit = vi.fn()
	const selectWhere = vi.fn(() => ({ limit: selectLimit }))
	const selectFrom = vi.fn(() => ({ where: selectWhere }))
	const dbInsert = vi.fn(() => ({ values: insertValues }))
	const dbUpdate = vi.fn(() => ({ set: updateSet }))
	const dbSelect = vi.fn(() => ({ from: selectFrom }))
	return {
		insertValues,
		updateReturning,
		updateWhere,
		updateSet,
		selectLimit,
		dbInsert,
		dbUpdate,
		dbSelect,
	}
})

vi.mock('@budget-planner/db', () => ({
	db: {
		insert: dbInsert,
		update: dbUpdate,
		select: dbSelect,
	},
}))

import {
	consumeLoginToken,
	createLoginToken,
	generateRawToken,
	hashToken,
	LOGIN_TOKEN_TTL_MS,
	peekLoginToken,
} from './login-token'

beforeEach(() => {
	vi.clearAllMocks()
	insertValues.mockResolvedValue(undefined)
})

describe('generateRawToken', () => {
	it('produces a URL-safe, high-entropy token (no padding, no +/ chars)', () => {
		const token = generateRawToken()
		// base64url of 32 bytes = 43 chars, alphabet [A-Za-z0-9_-], no '=' padding.
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})

	it('never repeats across calls (CSPRNG, not Math.random)', () => {
		const tokens = new Set(Array.from({ length: 100 }, () => generateRawToken()))
		expect(tokens.size).toBe(100)
	})
})

describe('hashToken', () => {
	it('is a deterministic 64-char lowercase hex SHA-256 digest', () => {
		const hash = hashToken('some-raw-token')
		expect(hash).toMatch(/^[0-9a-f]{64}$/)
		expect(hashToken('some-raw-token')).toBe(hash)
	})

	it('differs for different inputs', () => {
		expect(hashToken('a')).not.toBe(hashToken('b'))
	})
})

describe('createLoginToken', () => {
	it('persists ONLY the hash (never the raw token) with a short TTL', async () => {
		const before = Date.now()
		const raw = await createLoginToken('user-abc')
		const after = Date.now()

		expect(dbInsert).toHaveBeenCalledTimes(1)
		const inserted = insertValues.mock.calls[0][0] as {
			userId: string
			tokenHash: string
			expiresAt: Date
			consumedAt?: Date | null
		}

		expect(inserted.userId).toBe('user-abc')
		// Only the hash is stored, so a DB leak cannot be replayed as a login link.
		expect(inserted.tokenHash).toBe(hashToken(raw))
		expect(inserted.tokenHash).not.toBe(raw)
		expect(inserted.consumedAt ?? null).toBeNull()

		const ttl = inserted.expiresAt.getTime()
		expect(ttl).toBeGreaterThanOrEqual(before + LOGIN_TOKEN_TTL_MS)
		expect(ttl).toBeLessThanOrEqual(after + LOGIN_TOKEN_TTL_MS)
		expect(LOGIN_TOKEN_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000)
	})
})

describe('consumeLoginToken (atomic single-use)', () => {
	it('returns the userId when exactly one unconsumed, unexpired row is updated', async () => {
		updateReturning.mockResolvedValueOnce([{ userId: 'user-xyz' }])
		const userId = await consumeLoginToken('raw-token')
		expect(userId).toBe('user-xyz')

		const setArg = updateSet.mock.calls[0][0]
		expect(setArg.consumedAt).toBeInstanceOf(Date)
		expect(updateWhere).toHaveBeenCalledTimes(1)
		expect(updateReturning).toHaveBeenCalledTimes(1)
	})

	it('returns null when no row was updated (expired / already consumed / unknown)', async () => {
		updateReturning.mockResolvedValueOnce([])
		expect(await consumeLoginToken('raw-token')).toBeNull()
	})

	it('returns null for an empty token without touching the database', async () => {
		expect(await consumeLoginToken('')).toBeNull()
		expect(dbUpdate).not.toHaveBeenCalled()
	})
})

describe('peekLoginToken (read-only, no consume)', () => {
	it('returns the userId for a valid unconsumed/unexpired token WITHOUT updating', async () => {
		selectLimit.mockResolvedValueOnce([{ userId: 'user-peek' }])
		const userId = await peekLoginToken('raw-token')
		expect(userId).toBe('user-peek')
		expect(dbSelect).toHaveBeenCalledTimes(1)
		expect(dbUpdate).not.toHaveBeenCalled()
	})

	it('returns null when no matching live token row exists', async () => {
		selectLimit.mockResolvedValueOnce([])
		expect(await peekLoginToken('raw-token')).toBeNull()
	})

	it('returns null for an empty token without querying', async () => {
		expect(await peekLoginToken('')).toBeNull()
		expect(dbSelect).not.toHaveBeenCalled()
	})
})
