import { describe, expect, it } from 'vitest'
import type { SessionSeed } from '../../../context/session-seed'
import { seedToStatus } from '../../../hooks/usePremiumAccess'
import { isEntitledSeed } from '../entitlement'

function seed(overrides: Partial<SessionSeed> = {}): SessionSeed {
	return {
		isAuthenticated: true,
		userId: 'u1',
		email: 'u1@example.test',
		subscriptionStatus: 'active',
		...overrides,
	}
}

describe('isEntitledSeed', () => {
	it('is true for an authenticated active subscription', () => {
		expect(isEntitledSeed(seed({ subscriptionStatus: 'active' }))).toBe(true)
	})

	it('is true for an authenticated lifetime purchase', () => {
		expect(isEntitledSeed(seed({ subscriptionStatus: 'lifetime' }))).toBe(true)
	})

	it('is false for a null seed — unverified is never entitled', () => {
		expect(isEntitledSeed(null)).toBe(false)
	})

	it.each(['free', 'past_due', 'canceled', null] as const)(
		'is false for an authenticated session with status %s',
		(subscriptionStatus) => {
			expect(isEntitledSeed(seed({ subscriptionStatus }))).toBe(false)
		}
	)

	it.each(['active', 'lifetime'] as const)(
		'is false when not authenticated, even with status %s',
		(subscriptionStatus) => {
			expect(isEntitledSeed(seed({ isAuthenticated: false, subscriptionStatus }))).toBe(false)
		}
	)

	it('matches seedToStatus.hasAccess for every status/auth combination, and for a null seed', () => {
		// Calls the real `seedToStatus`: an inline re-implementation here could never fail.
		const statuses = ['free', 'active', 'past_due', 'canceled', 'lifetime', null] as const
		for (const subscriptionStatus of statuses) {
			for (const isAuthenticated of [true, false]) {
				const s = seed({ isAuthenticated, subscriptionStatus })
				expect(isEntitledSeed(s), `${subscriptionStatus}/${isAuthenticated}`).toBe(
					seedToStatus(s).hasAccess
				)
			}
		}

		expect(isEntitledSeed(null)).toBe(seedToStatus(null).hasAccess)
	})
})
