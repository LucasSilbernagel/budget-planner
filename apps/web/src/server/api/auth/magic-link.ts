import { db } from '@budget-planner/db/client'
import { users } from '@budget-planner/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { sendMagicLinkEmail } from '@/server/email/mailer'
import { isValidEmail, normalizeEmail } from './email'
import { consumeLoginToken, createLoginToken, peekLoginToken } from './login-token'

export { isValidEmail, normalizeEmail }

export type VerifiedLoginUser = {
	userId: string
	paddleId: string
	email: string
}

// The target is the fixed verify route; only the opaque token is user-influenced, so no open redirect.
export function buildVerifyLink(baseUrl: string, rawToken: string): string {
	const url = new URL('/api/auth/login/verify', baseUrl)
	url.searchParams.set('token', rawToken)
	return url.toString()
}

// Server-side logging only: never reaches the response, so anti-enumeration holds.
export type MagicLinkOutcome =
	| { branch: 'invalid-shape' }
	| { branch: 'no-such-user' }
	| {
			branch: 'sent'
			userId: string
			messageRef?: string
	  }

export type MagicLinkStage = 'lookup' | 'token' | 'send'

// Still thrown so the route's rejection handler stays the single failure sink.
export class MagicLinkStageError extends Error {
	readonly stage: MagicLinkStage

	constructor(stage: MagicLinkStage, cause: unknown) {
		super(`Magic-link request failed at stage '${stage}'`, { cause })
		this.name = 'MagicLinkStageError'
		this.stage = stage
	}
}

async function atStage<T>(stage: MagicLinkStage, run: () => Promise<T>): Promise<T> {
	try {
		return await run()
	} catch (error) {
		throw new MagicLinkStageError(stage, error)
	}
}

// The logger's email scrubber redacts the whole email-shaped id, so log only the part before `@`.
export function toMessageRef(messageId: string | undefined): string | undefined {
	if (!messageId) return undefined
	const ref = messageId.replace(/^</, '').replace(/>$/, '').split('@')[0]?.trim()
	return ref ? ref : undefined
}

// Callers must respond identically either way, so this never reveals whether an account exists.
export async function requestMagicLink(
	rawEmail: string,
	baseUrl: string
): Promise<MagicLinkOutcome> {
	const email = normalizeEmail(rawEmail)
	if (!isValidEmail(email)) {
		return { branch: 'invalid-shape' }
	}

	// `lower()` only helps ASCII rows predating normalized storage; non-ASCII case folds can still miss.
	const matches = await atStage('lookup', () =>
		db
			.select()
			.from(users)
			.where(and(sql`lower(${users.email}) = ${email}`, eq(users.isDeleted, false)))
			.limit(1)
	)

	const user = matches[0]
	if (!user) {
		return { branch: 'no-such-user' }
	}

	const rawToken = await atStage('token', () => createLoginToken(user.id))
	const messageId = await atStage('send', () =>
		sendMagicLinkEmail(user.email, buildVerifyLink(baseUrl, rawToken))
	)
	const messageRef = toMessageRef(messageId)
	return { branch: 'sent', userId: user.id, ...(messageRef ? { messageRef } : {}) }
}

// Read-only, so the user can confirm the target account (login CSRF) before the consuming POST.
export async function peekMagicLink(rawToken: string): Promise<{ email: string } | null> {
	const userId = await peekLoginToken(rawToken)
	if (!userId) {
		return null
	}

	const matches = await db
		.select()
		.from(users)
		.where(and(eq(users.id, userId), eq(users.isDeleted, false)))
		.limit(1)

	const user = matches[0]
	return user ? { email: user.email } : null
}

export async function verifyMagicLink(rawToken: string): Promise<VerifiedLoginUser | null> {
	const userId = await consumeLoginToken(rawToken)
	if (!userId) {
		return null
	}

	const matches = await db
		.select()
		.from(users)
		.where(and(eq(users.id, userId), eq(users.isDeleted, false)))
		.limit(1)

	const user = matches[0]
	if (!user) {
		return null
	}

	return { userId: user.id, paddleId: user.paddleId, email: user.email }
}
