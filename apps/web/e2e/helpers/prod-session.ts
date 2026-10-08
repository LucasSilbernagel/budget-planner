import crypto from 'node:crypto'
import type { BrowserContext } from '@playwright/test'

// Validly signed, so the DB-less server's user lookup fails into the no-seed path and
// the browser asks /api/auth/me. A bad signature would give a signed-out seed instead.

// `userId` must be a UUID. Only `session` is set, not `has_session`, so sync never mounts.

export const PROD_E2E_SESSION_SECRET = 'e2e-prod-only-session-secret-0123456789abcdef0123456789'

export const PROD_E2E_USER_ID = '11111111-1111-4111-8111-111111111111'

export function signProdSession(userId: string = PROD_E2E_USER_ID): string {
	const payload = Buffer.from(
		JSON.stringify({ userId, paddleId: 'ctm_e2e', email: 'e2e-prod@example.test', iat: Date.now() })
	).toString('base64url')
	const signature = crypto
		.createHmac('sha256', PROD_E2E_SESSION_SECRET)
		.update(payload)
		.digest('hex')
	return `${payload}.${signature}`
}

export async function addProdSessionCookie(
	context: BrowserContext,
	baseURL: string
): Promise<void> {
	await context.addCookies([
		{ name: 'session', value: signProdSession(), url: baseURL, httpOnly: true, sameSite: 'Lax' },
	])
}
