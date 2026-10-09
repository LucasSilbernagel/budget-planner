import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Only the exported map is read, but the import graph still reaches `usePremiumAccess`.
vi.mock('../../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => ({
		status: {
			hasAccess: false,
			subscriptionStatus: null,
			isLoading: false,
			error: null,
			isAuthenticated: false,
		},
	}),
}))

import { PREMIUM_BENEFIT_IDS } from '../../../lib/premium/benefits'
import { OVERVIEW_BENEFITS } from '../../HomePage'
import { PREMIUM_NAV_ROUTES } from '../GlobalNav'

// Sets, not sequences: the nav and the benefit map order the routes differently on purpose.
describe('the nav and the Overview agree on the four premium routes', () => {
	/** Selected as HomePage renders them (anything not 'none'/'prompt' is a link), not by `=== 'route'`. */
	const overviewRoutes = PREMIUM_BENEFIT_IDS.flatMap((id) => {
		const benefit = OVERVIEW_BENEFITS[id]
		if (benefit.activation === 'none' || benefit.activation === 'prompt') return []
		return [benefit.href]
	})

	it('names the same four routes on both surfaces', () => {
		expect([...PREMIUM_NAV_ROUTES].sort()).toEqual([...overviewRoutes].sort())
	})

	it('carries exactly four, so neither list can quietly grow or shrink alone', () => {
		// The count catches both lists gaining the same wrong entry.
		expect(PREMIUM_NAV_ROUTES).toHaveLength(4)
		expect(overviewRoutes).toHaveLength(4)
	})

	it('every premium route has a real route file behind it', () => {
		// Both lists are hand-written, so the same rename on both sides still agrees: check them
		// against the file-based routes.
		const routesDir = resolve(__dirname, '../../../routes')
		for (const route of PREMIUM_NAV_ROUTES) {
			const file = resolve(routesDir, `${route.replace(/^\//, '')}.tsx`)
			expect(existsSync(file), `${route} has no route file at ${file}`).toBe(true)
		}
	})

	it('excludes Multi-device sync from the nav, which has no route to give it', () => {
		// `sync` has no page, so it can never be a nav destination.
		expect(OVERVIEW_BENEFITS.sync.activation).toBe('prompt')
		expect(PREMIUM_NAV_ROUTES).not.toContain('/sync')
	})
})
