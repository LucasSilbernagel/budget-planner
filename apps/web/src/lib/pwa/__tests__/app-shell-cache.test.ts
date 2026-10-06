/**
 * purgeAppShellCache (story 101.1, AC 6).
 *
 * The purge runs on the way out of the app (sign-out, account deletion), so
 * its contract is "delete `app-shell` if you can, and never stop the user
 * leaving": it resolves, within a fixed bound, whatever Cache Storage does.
 * `lib/**` runs in the node environment, which has no `caches`, so every case
 * stubs it explicitly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_SHELL_CACHE_NAME,
  APP_SHELL_PURGE_TIMEOUT_MS,
  purgeAppShellCache,
} from '../app-shell-cache'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  // The throwing-getter case defines a property rather than stubbing it.
  Reflect.deleteProperty(globalThis, 'caches')
})

function stubCaches(remove: (name: string) => Promise<boolean>) {
  const del = vi.fn(remove)
  vi.stubGlobal('caches', { delete: del })
  return del
}

describe('purgeAppShellCache', () => {
  it("deletes the 'app-shell' cache and no other", async () => {
    const del = stubCaches(async () => true)

    await purgeAppShellCache()

    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('app-shell')
    expect(APP_SHELL_CACHE_NAME).toBe('app-shell')
  })

  it('resolves when there is no Cache Storage API at all', async () => {
    expect(typeof (globalThis as { caches?: unknown }).caches).toBe('undefined')
    await expect(purgeAppShellCache()).resolves.toBeUndefined()
  })

  it('resolves when reading `caches` throws (opaque origin)', async () => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    await expect(purgeAppShellCache()).resolves.toBeUndefined()
  })

  it('resolves when the delete rejects', async () => {
    stubCaches(() => Promise.reject(new Error('quota')))
    await expect(purgeAppShellCache()).resolves.toBeUndefined()
  })

  it('resolves after the bound, not before, when the delete never settles', async () => {
    vi.useFakeTimers()
    stubCaches(() => new Promise<boolean>(() => {}))
    let settled = false
    void purgeAppShellCache().then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(APP_SHELL_PURGE_TIMEOUT_MS - 1)
    expect(settled, 'resolved before the bound').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled, 'still pending at the bound').toBe(true)
  })

  it('leaves no timer behind when the delete wins the race', async () => {
    vi.useFakeTimers()
    stubCaches(async () => true)

    await purgeAppShellCache()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds the wait at 2 s by default (D3)', () => {
    expect(APP_SHELL_PURGE_TIMEOUT_MS).toBe(2_000)
  })
})
