import { describe, expect, it } from 'vitest'
// @ts-expect-error — pwa.config.mjs is plain ESM at the app root with no types.
import { pwaRuntimeCaching } from '../../../../pwa.config.mjs'
import { APP_SHELL_CACHE_NAME } from '../app-shell-cache'

describe('app-shell cache name parity', () => {
	it('the client purges the cache the service worker writes to', () => {
		expect(pwaRuntimeCaching).toHaveLength(1)
		expect(pwaRuntimeCaching[0].options.cacheName).toBe(APP_SHELL_CACHE_NAME)
	})
})
