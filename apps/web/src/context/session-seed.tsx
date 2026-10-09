/**
 * Read the seed only as a useState initializer, never reactively: a later provider value must not
 * clobber a consumer's already-resolved client state.
 */

import { createContext, type ReactNode, useContext } from 'react'

export type SeedSubscriptionStatus = 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null

export type SessionSeed = {
	isAuthenticated: boolean
	userId: string | null
	email: string | null
	subscriptionStatus: SeedSubscriptionStatus
}

export const SIGNED_OUT_SEED: Readonly<SessionSeed> = Object.freeze({
	isAuthenticated: false,
	userId: null,
	email: null,
	subscriptionStatus: null,
})

const SessionSeedContext = createContext<SessionSeed | null>(null)

export function SessionSeedProvider({
	seed,
	children,
}: {
	seed: SessionSeed | null
	children: ReactNode
}) {
	return <SessionSeedContext.Provider value={seed}>{children}</SessionSeedContext.Provider>
}

export function useSessionSeed(): SessionSeed | null {
	return useContext(SessionSeedContext)
}
