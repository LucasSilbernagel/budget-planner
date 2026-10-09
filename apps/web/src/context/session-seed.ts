import { createContext } from 'react'

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

export const SessionSeedContext = createContext<SessionSeed | null>(null)
