import { describe, expect, it } from 'vitest'
// @ts-expect-error — pwa.config.mjs is plain ESM at the app root with no types.
import { pwaRuntimeCaching } from '../../../../pwa.config.mjs'
import { APP_SHELL_CACHE_NAME } from '../app-shell-cache'

/**
 * One cache name (story 101.1, AC 8, D1).
 *
 * The service worker writes documents into the cache its runtime route names
 * (`pwa.config.mjs`); sign-out and account deletion delete the cache the
 * client constant names. If the two drift, the purge deletes a cache that does
 * not exist and every signed-in document stays behind, with nothing failing.
 * So this test IMPORTS both sides; it never restates the string.
 */
describe('app-shell cache name parity', () => {
  it('the client purges the cache the service worker writes to', () => {
    expect(pwaRuntimeCaching).toHaveLength(1)
    expect(pwaRuntimeCaching[0].options.cacheName).toBe(APP_SHELL_CACHE_NAME)
  })
})
