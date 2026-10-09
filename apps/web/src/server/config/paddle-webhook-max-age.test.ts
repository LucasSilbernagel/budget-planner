/**
 * Any value that is not a positive integer must fall back to the default:
 * a throw inside getConfig() 500s every route.
 */

import { getPaddleConfig, resetConfig } from '@budget-planner/config/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
	vi.unstubAllEnvs()
	resetConfig()
})

describe('PADDLE_WEBHOOK_MAX_AGE_SECONDS', () => {
	it.each(['', ' ', 'abc', '0', '-1', '1.5', 'NaN'])(
		'falls back to the 300s default instead of crashing config load for %j',
		(value) => {
			vi.stubEnv('PADDLE_WEBHOOK_MAX_AGE_SECONDS', value)
			resetConfig()

			expect(() => getPaddleConfig()).not.toThrow()
			expect(getPaddleConfig().webhookMaxAgeSeconds).toBe(300)
		}
	)

	it('falls back to the 300s default when unset entirely', () => {
		resetConfig()

		expect(getPaddleConfig().webhookMaxAgeSeconds).toBe(300)
	})

	it('still honors an explicit configured value', () => {
		vi.stubEnv('PADDLE_WEBHOOK_MAX_AGE_SECONDS', '600')
		resetConfig()

		expect(getPaddleConfig().webhookMaxAgeSeconds).toBe(600)
	})
})
