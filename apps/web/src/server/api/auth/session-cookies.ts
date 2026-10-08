// Shared by both cookies; matches the signed-session TTL.
export const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60

export function isProductionEnv(): boolean {
	return process.env['NODE_ENV'] === 'production'
}

function secureFlag(isProduction: boolean): string {
	return isProduction ? '; Secure' : ''
}

export function buildSessionCookie(token: string, isProduction: boolean): string {
	return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secureFlag(
		isProduction
	)}; Max-Age=${SESSION_COOKIE_MAX_AGE}`
}

// Non-HttpOnly and carries no secret: only presence matters, so client code can tell "probably signed in".
export function buildHasSessionCookie(isProduction: boolean): string {
	return `has_session=1; Path=/; SameSite=Lax${secureFlag(
		isProduction
	)}; Max-Age=${SESSION_COOKIE_MAX_AGE}`
}

export function buildClearSessionCookies(
	isProduction: boolean
): [session: string, hasSession: string] {
	const flag = secureFlag(isProduction)
	return [
		`session=; Path=/; HttpOnly; SameSite=Lax${flag}; Max-Age=0`,
		`has_session=; Path=/; SameSite=Lax${flag}; Max-Age=0`,
	]
}
