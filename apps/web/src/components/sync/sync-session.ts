import { hasPaidAccess } from '@/lib/premium/access-statuses'

export type SessionUser = {
	userId: string
	subscriptionStatus: string
}

export function isPaidSyncSession(user: SessionUser | null): user is SessionUser {
	return user !== null && hasPaidAccess(user.subscriptionStatus)
}

// `has_session` is a non-HttpOnly presence marker: the real session cookie is never
// visible to document.cookie. It is not trusted; /api/auth/me decides.
export function hasProbableSession(cookieString: string): boolean {
	return /(?:^|;\s*)has_session=/.test(cookieString)
}
