/**
 * Never import() a `server/` module here: in the production bundle it pulls in `pg` and fails with
 * `Buffer is not defined`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
	type SeedSubscriptionStatus,
	type SessionSeed,
	SIGNED_OUT_SEED,
	useSessionSeed,
} from '../context/session-seed'
import { hasPremiumFeatures, STATUS_ACCESS } from '../lib/premium/access-statuses'
import { useVerifiedSession } from '../lib/session/verifiedSession'

export type PremiumAccessStatus = {
	hasAccess: boolean
	subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null
	isLoading: boolean
	error: string | null
	isAuthenticated: boolean
}

export type PremiumAccessCheckResult = {
	hasAccess: boolean
	subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null
	isAuthenticated: boolean
}

const defaultStatus: PremiumAccessStatus = {
	hasAccess: false,
	subscriptionStatus: null,
	isLoading: true,
	error: null,
	isAuthenticated: false,
}

/** The same rule as `isEntitledSeed`; exported so entitlement.test can assert parity against it. */
export function seedToStatus(seed: SessionSeed | null): PremiumAccessStatus {
	if (!seed) {
		return defaultStatus
	}
	return {
		// Gated on authentication too, so a malformed seed can never grant premium.
		hasAccess: seed.isAuthenticated && hasPremiumFeatures(seed.subscriptionStatus),
		subscriptionStatus: seed.isAuthenticated ? (seed.subscriptionStatus ?? 'free') : null,
		isLoading: false,
		error: null,
		isAuthenticated: seed.isAuthenticated,
	}
}

export function usePremiumAccess(): {
	status: PremiumAccessStatus
	checkAccess: () => Promise<PremiumAccessCheckResult>
	refresh: () => Promise<void>
} {
	// The seed is read once, as an initializer. The verified answer comes only via useVerifiedSession:
	// during hydration that reads the server snapshot, so SSR and the first frame stay the seed's.
	const seed = useSessionSeed()
	const verified = useVerifiedSession()
	const [status, setStatus] = useState<PremiumAccessStatus>(() =>
		seedToStatus(verified === undefined ? seed : knownStatusSeed(verified))
	)
	const verifiedRef = useRef(verified)

	useEffect(() => {
		verifiedRef.current = verified
		if (verified !== undefined) {
			setStatus(seedToStatus(knownStatusSeed(verified)))
		}
	}, [verified])

	const checkAccess = useCallback(async (): Promise<PremiumAccessCheckResult> => {
		const verifiedStatus = (): PremiumAccessCheckResult | null => {
			const held = verifiedRef.current
			if (held === undefined) {
				return null
			}
			const heldStatus = seedToStatus(knownStatusSeed(held))
			setStatus(heldStatus)
			return {
				hasAccess: heldStatus.hasAccess,
				subscriptionStatus: heldStatus.subscriptionStatus,
				isAuthenticated: heldStatus.isAuthenticated,
			}
		}
		try {
			setStatus((prev) => ({ ...prev, isLoading: true, error: null }))

			const seedFromServer = await fetchSessionSeed()

			if (seedFromServer.ok) {
				const newStatus = seedToStatus(seedFromServer.seed)
				setStatus(newStatus)
				return {
					hasAccess: newStatus.hasAccess,
					subscriptionStatus: newStatus.subscriptionStatus,
					isAuthenticated: newStatus.isAuthenticated,
				}
			}
			console.error('Premium access check failed:', seedFromServer.error)
			// A failed check is unknown, and unknown keeps the last definitive answer.
			const held = verifiedStatus()
			if (held) {
				return held
			}
			const fallbackStatus: PremiumAccessStatus = {
				hasAccess: false,
				subscriptionStatus: 'free',
				isLoading: false,
				error: seedFromServer.error,
				isAuthenticated: false,
			}
			setStatus(fallbackStatus)
			return {
				hasAccess: false,
				subscriptionStatus: 'free',
				isAuthenticated: false,
			}
		} catch (error) {
			const held = verifiedStatus()
			if (held) {
				return held
			}
			const errorMessage = error instanceof Error ? error.message : 'Failed to check premium access'
			const errorStatus: PremiumAccessStatus = {
				hasAccess: false,
				subscriptionStatus: null,
				isLoading: false,
				error: errorMessage,
				isAuthenticated: false,
			}
			setStatus(errorStatus)
			return {
				hasAccess: false,
				subscriptionStatus: null,
				isAuthenticated: false,
			}
		}
	}, [])

	const refresh = useCallback(async (): Promise<void> => {
		await checkAccess()
	}, [checkAccess])

	// Check on mount only with no seed and no held answer; otherwise it would reintroduce the flash.
	useEffect(() => {
		if (seed || verifiedRef.current !== undefined) {
			return
		}
		checkAccess()
	}, [checkAccess, seed])

	return { status, checkAccess, refresh }
}

/** An own-key test, so a prototype key is not a status. */
const isKnownStatus = (value: unknown): value is Exclude<SeedSubscriptionStatus, null> =>
	typeof value === 'string' && Object.keys(STATUS_ACCESS).includes(value)

function knownStatusSeed(seed: SessionSeed): SessionSeed {
	return isKnownStatus(seed.subscriptionStatus) ? seed : { ...seed, subscriptionStatus: null }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/**
 * `{ user: null }` is an authoritative signed-out answer; a non-OK status, non-JSON body or a user
 * without an id is "could not determine". A network failure rejects.
 */
async function fetchSessionSeed(): Promise<
	{ ok: true; seed: SessionSeed } | { ok: false; error: string }
> {
	const response = await fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
	if (!response.ok) {
		return { ok: false, error: `Failed to check premium access (HTTP ${response.status})` }
	}
	let body: unknown
	try {
		body = await response.json()
	} catch {
		return { ok: false, error: 'Failed to check premium access (unreadable response)' }
	}
	if (!isRecord(body) || !('user' in body)) {
		return { ok: false, error: 'Failed to check premium access (unexpected response)' }
	}
	const { user } = body
	if (user === null) {
		return { ok: true, seed: { ...SIGNED_OUT_SEED } }
	}
	if (!isRecord(user) || typeof user['userId'] !== 'string' || user['userId'] === '') {
		return { ok: false, error: 'Failed to check premium access (unexpected response)' }
	}
	const status = user['subscriptionStatus']
	return {
		ok: true,
		seed: {
			isAuthenticated: true,
			userId: user['userId'],
			email: typeof user['email'] === 'string' ? user['email'] : null,
			subscriptionStatus: isKnownStatus(status) ? status : null,
		},
	}
}
