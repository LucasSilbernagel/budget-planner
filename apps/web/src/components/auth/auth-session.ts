import { hasPremiumFeatures } from '@/lib/premium/access-statuses'
import {
	type SeedSubscriptionStatus,
	type SessionSeed,
	SIGNED_OUT_SEED,
} from '../../context/session-seed'

type CurrentUser = {
	userId: string
	email: string
	subscriptionStatus: string
}

export type AuthState =
	| { status: 'loading' }
	| { status: 'unauthenticated' }
	| { status: 'authenticated'; user: CurrentUser }

/** An authenticated seed without a usable email is treated as signed-out: the render derefs it. */
export function seedToAuthState(seed: SessionSeed | null): AuthState {
	if (!seed) {
		return { status: 'loading' }
	}
	if (seed.isAuthenticated && seed.email) {
		return {
			status: 'authenticated',
			user: {
				userId: seed.userId ?? '',
				email: seed.email,
				subscriptionStatus: seed.subscriptionStatus ?? 'free',
			},
		}
	}
	return { status: 'unauthenticated' }
}

export function isPremium(subscriptionStatus: string): boolean {
	return hasPremiumFeatures(subscriptionStatus)
}

/**
 * `definitive` only for a 200 whose body parses as `{ user: null }` or a user with an
 * email. Every other answer displays as signed-out but isn't shared with the nav.
 */
type MeAnswer = { definitive: true; user: CurrentUser | null } | { definitive: false }

export async function fetchCurrentUser(): Promise<MeAnswer> {
	const response = await fetch('/api/auth/me')
	if (!response.ok) {
		return { definitive: false }
	}
	const data = (await response.json()) as { user?: CurrentUser | null } | null
	const user = data?.user
	if (user === null) {
		return { definitive: true, user: null }
	}
	// The render derefs `user.email` at the app root, above any error boundary, so a
	// contract drift that dropped it would white-screen every route.
	if (!user || typeof user.email !== 'string' || user.email.length === 0) {
		return { definitive: false }
	}
	return { definitive: true, user }
}

export function answerToSeed(user: CurrentUser | null): SessionSeed {
	if (!user) {
		return SIGNED_OUT_SEED
	}
	return {
		isAuthenticated: true,
		userId: user.userId,
		email: user.email,
		subscriptionStatus: user.subscriptionStatus as SeedSubscriptionStatus,
	}
}
