import crypto from 'node:crypto'
import { db } from '@budget-planner/db'
import { loginTokens } from '@budget-planner/db/src/schema'
import { and, eq, gt, isNull } from 'drizzle-orm'

export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000

const LOGIN_TOKEN_BYTES = 32

export function generateRawToken(): string {
	return crypto.randomBytes(LOGIN_TOKEN_BYTES).toString('base64url')
}

// No salt needed: the input already has 256 bits of uniform entropy.
export function hashToken(rawToken: string): string {
	return crypto.createHash('sha256').update(rawToken).digest('hex')
}

export async function createLoginToken(userId: string): Promise<string> {
	const rawToken = generateRawToken()
	await db.insert(loginTokens).values({
		userId,
		tokenHash: hashToken(rawToken),
		expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
	})
	return rawToken
}

export async function peekLoginToken(rawToken: string): Promise<string | null> {
	if (!rawToken) {
		return null
	}

	const tokenHash = hashToken(rawToken)
	const rows = await db
		.select({ userId: loginTokens.userId })
		.from(loginTokens)
		.where(
			and(
				eq(loginTokens.tokenHash, tokenHash),
				isNull(loginTokens.consumedAt),
				gt(loginTokens.expiresAt, new Date())
			)
		)
		.limit(1)

	return rows[0]?.userId ?? null
}

// The single conditional UPDATE is the concurrency control: of two racing opens, exactly one wins.
export async function consumeLoginToken(rawToken: string): Promise<string | null> {
	if (!rawToken) {
		return null
	}

	const tokenHash = hashToken(rawToken)
	const consumed = await db
		.update(loginTokens)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(loginTokens.tokenHash, tokenHash),
				isNull(loginTokens.consumedAt),
				gt(loginTokens.expiresAt, new Date())
			)
		)
		.returning({ userId: loginTokens.userId })

	return consumed[0]?.userId ?? null
}
