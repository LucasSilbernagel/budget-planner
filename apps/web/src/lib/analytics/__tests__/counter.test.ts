import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAnalyticsScripts, COUNTERDEV_SCRIPT_SRC } from '../counter'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('buildAnalyticsScripts', () => {
	it('returns the counter.dev script entry when the site id is configured', () => {
		vi.stubEnv('VITE_COUNTERDEV_ID', 'site-test-123')
		expect(buildAnalyticsScripts()).toEqual([
			{ src: COUNTERDEV_SCRIPT_SRC, 'data-id': 'site-test-123', defer: true },
		])
	})

	it('trims a surrounding-whitespace site id', () => {
		vi.stubEnv('VITE_COUNTERDEV_ID', '  site-test-123  ')
		expect(buildAnalyticsScripts()).toEqual([
			{ src: COUNTERDEV_SCRIPT_SRC, 'data-id': 'site-test-123', defer: true },
		])
	})

	it('returns [] when the site id is unset', () => {
		vi.stubEnv('VITE_COUNTERDEV_ID', '')
		expect(buildAnalyticsScripts()).toEqual([])
	})

	it('returns [] when the site id is whitespace-only', () => {
		vi.stubEnv('VITE_COUNTERDEV_ID', '   ')
		expect(buildAnalyticsScripts()).toEqual([])
	})
})
