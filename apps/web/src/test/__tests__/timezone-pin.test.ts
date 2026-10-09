// PGlite's session TimeZone and JS local time must match CI and production (UTC).

import { describe, expect, it } from 'vitest'

describe('web Vitest runs in UTC', () => {
	it('has a UTC process zone', () => {
		expect(process.env.TZ).toBe('UTC')
		expect(new Date('2026-07-01T12:00:00Z').getTimezoneOffset()).toBe(0)
	})
})
