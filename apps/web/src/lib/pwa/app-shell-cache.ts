/**
 * The service worker's page cache, as the page sees it (story 101.1, FR167).
 *
 * The production service worker keeps every same-origin document it serves in
 * one Cache Storage cache, `app-shell` (`apps/web/pwa.config.mjs`, the
 * `NetworkFirst` runtime route), so the app opens offline (FR22). Those
 * documents carry the SSR session seed of the session that loaded them,
 * including a signed-in user's email. On a shared machine, the next person
 * would be served them offline. So the cache is deleted whenever a session
 * ends on purpose: sign-out (`lib/account/sign-out.ts`) and account deletion
 * (`components/settings/account-section.tsx`).
 *
 * The name is restated here, not imported from `pwa.config.mjs`, so client
 * code does not drag the manifest and Workbox options into the bundle (D1).
 * `__tests__/app-shell-cache.parity.test.ts` IMPORTS both and fails if they
 * differ.
 *
 * What a purge does NOT remove:
 * - the `workbox-expiration` IndexedDB index of `app-shell` URLs and
 *   timestamps (URLs and times only, no document bodies; accepted, D6);
 * - what another open tab has already rendered. A document load there
 *   renders the signed-out page (D5, out of scope).
 */

export const APP_SHELL_CACHE_NAME = 'app-shell'

/**
 * The longest a purge may hold up leaving (D3). Deleting a small cache is
 * expected to be fast (REASONED, not measured); the bound exists so a browser
 * that never settles the call cannot strand the user on the page.
 */
export const APP_SHELL_PURGE_TIMEOUT_MS = 2_000

/**
 * Delete the `app-shell` cache, waiting at most `timeoutMs`.
 *
 * Never rejects: it runs on the way out of the app, and a failed purge must
 * not stop the user leaving. Covers a missing Cache Storage API (insecure
 * context, older browser), a `caches` getter that throws (opaque origin), a
 * rejecting delete and a delete that never settles.
 */
export async function purgeAppShellCache(
  timeoutMs: number = APP_SHELL_PURGE_TIMEOUT_MS
): Promise<void> {
  let storage: CacheStorage | undefined
  try {
    storage = typeof caches === 'undefined' ? undefined : caches
  } catch {
    return
  }
  if (!storage) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      storage.delete(APP_SHELL_CACHE_NAME),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } catch {
    // A failed purge must never stop the user leaving.
  } finally {
    clearTimeout(timer)
  }
}
