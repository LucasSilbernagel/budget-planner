// Vitest 1.6 threads ignore `test.env.TZ` for the zone; the config sets `process.env.TZ` instead.

import { describe, expect, it } from 'vitest'

describe('db Vitest runs in UTC (story 92.1)', () => {
	it('has a UTC process zone', () => {
		expect(process.env.TZ).toBe('UTC')
		expect(new Date('2026-07-01T12:00:00Z').getTimezoneOffset()).toBe(0)
	})
})
