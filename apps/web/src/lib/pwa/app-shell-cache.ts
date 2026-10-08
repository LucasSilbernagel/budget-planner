/**
 * Cached documents carry the SSR session seed (incl. email), so the cache is purged whenever a session ends.
 * Name restated, not imported from pwa.config.mjs, to keep Workbox out of the client bundle; a parity test guards drift.
 */

export const APP_SHELL_CACHE_NAME = 'app-shell'

/** Bound so a browser that never settles the delete cannot strand the user. */
export const APP_SHELL_PURGE_TIMEOUT_MS = 2_000

/** Never rejects: a failed purge must not stop the user leaving. */
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
  } finally {
    clearTimeout(timer)
  }
}
