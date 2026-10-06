/**
 * The app-shell route's caching BEHAVIOUR, run on the real Workbox strategy
 * (story 101.1, AC 3, FR167).
 *
 * The production service worker serves every same-origin document through one
 * `NetworkFirst` route (`pwa.config.mjs`). Before 101.1 it had
 * `networkTimeoutSeconds: 3`: a network slower than 3 s got the CACHED
 * document instead, which could belong to another session (99.1 evidence
 * `c1-run.txt`). The rule now: the cache is used ONLY when the network request
 * FAILS (offline). These cases run `workbox-strategies@7.4.1`'s `NetworkFirst`
 * built from the route options this app ships, so putting the timeout back in
 * `pwa.config.mjs` turns the slow-network case RED.
 *
 * How the strategy is built: the way `workbox-build` turns the options into
 * code (`runtime-caching-converter.js`): every plain option (`cacheName`,
 * `networkTimeoutSeconds`, ...) passes straight through, and
 * `cacheableResponse` becomes a `CacheableResponsePlugin`. `expiration`
 * (`ExpirationPlugin`) is LEFT OUT: it needs IndexedDB, and it only trims old
 * entries, which none of these cases is about.
 *
 * Shims (Node has no service-worker globals): `self`, a Map-backed
 * `caches`, `ExtendableEvent`/`FetchEvent` classes (Workbox's dev-mode
 * asserts check the event's class) and a stubbed `fetch`. The requests are
 * not `mode: 'navigate'` (undici refuses that mode); Workbox treats a
 * navigation differently only for navigation preload, which this app does
 * not enable. These shims are a model of the browser, not the browser: the
 * real-browser witness is F8 (`e2e/pwa-offline.prod.spec.ts`) and the story's
 * prod-build evidence.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error — pwa.config.mjs is plain ESM at the app root with no types.
import { pwaRuntimeCaching } from '../../../../pwa.config.mjs'

type StrategyLike = {
  handleAll(options: { request: Request; event: Event }): [Promise<Response>, Promise<void>]
}

const URL_UNDER_TEST = 'http://localhost/income'
const store = new Map<string, Map<string, Response>>()

function cacheFor(name: string) {
  let entries = store.get(name)
  if (!entries) {
    entries = new Map()
    store.set(name, entries)
  }
  const key = (req: Request | string) => (typeof req === 'string' ? req : req.url)
  const rows = entries
  return {
    async put(req: Request | string, res: Response) {
      rows.set(key(req), res.clone())
    },
    async match(req: Request | string) {
      return rows.get(key(req))?.clone()
    },
    async delete(req: Request | string) {
      return rows.delete(key(req))
    },
    async keys() {
      return [...rows.keys()].map((u) => new Request(u))
    },
  }
}

const fakeCaches = {
  async open(name: string) {
    return cacheFor(name)
  },
  async has(name: string) {
    return store.has(name)
  },
  async delete(name: string) {
    return store.delete(name)
  },
  async keys() {
    return [...store.keys()]
  },
  async match(req: Request | string, options?: { cacheName?: string }) {
    const names = options?.cacheName ? [options.cacheName] : [...store.keys()]
    for (const name of names) {
      if (!store.has(name)) continue
      const hit = await cacheFor(name).match(req)
      if (hit) return hit
    }
    return undefined
  },
}

class ExtendableEventShim extends Event {
  readonly pending: Promise<unknown>[] = []
  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise)
  }
}
class FetchEventShim extends ExtendableEventShim {}

let strategy: StrategyLike

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>
  g.self = globalThis
  g.__WB_DISABLE_DEV_LOGS = true
  g.ExtendableEvent = ExtendableEventShim
  g.FetchEvent = FetchEventShim
  g.caches = fakeCaches
  // Workbox's dev-mode log messages shorten URLs against `location.origin`.
  g.location = new URL('http://localhost/')
  // Imported only now: Workbox reads `self` at module evaluation.
  const { NetworkFirst } = await import('workbox-strategies')
  const { CacheableResponsePlugin } = await import('workbox-cacheable-response')
  expect(pwaRuntimeCaching).toHaveLength(1)
  expect(pwaRuntimeCaching[0].handler).toBe('NetworkFirst')
  // The model below translates ONLY these options. Any other one `workbox-build`
  // accepts (`plugins`, `precacheFallback`, `broadcastUpdate`, `backgroundSync`,
  // `rangeRequests`) becomes a plugin in the real service worker, and the spread
  // below would silently drop it (or pass it to the constructor, which ignores
  // it), so this test would vouch for a route it never ran. Model it here first.
  const modelled = [
    'cacheName',
    'networkTimeoutSeconds',
    'fetchOptions',
    'matchOptions',
    'expiration',
    'cacheableResponse',
  ]
  expect(
    Object.keys(pwaRuntimeCaching[0].options).filter((key) => !modelled.includes(key)),
    'route option(s) this model does not translate'
  ).toEqual([])
  const { expiration: _ignored, cacheableResponse, ...plain } = pwaRuntimeCaching[0].options
  strategy = new NetworkFirst({
    ...plain,
    plugins: [new CacheableResponsePlugin(cacheableResponse)],
  }) as unknown as StrategyLike
})

afterAll(() => {
  for (const name of [
    'self',
    '__WB_DISABLE_DEV_LOGS',
    'ExtendableEvent',
    'FetchEvent',
    'caches',
    'location',
  ]) {
    Reflect.deleteProperty(globalThis, name)
  }
})

const originalFetch = globalThis.fetch

beforeEach(async () => {
  store.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = originalFetch
})

async function seedCachedDocument(body: string) {
  const cache = await fakeCaches.open(pwaRuntimeCaching[0].options.cacheName)
  await cache.put(new Request(URL_UNDER_TEST), new Response(body, { status: 200 }))
}

function run() {
  const [response, done] = strategy.handleAll({
    request: new Request(URL_UNDER_TEST),
    event: new FetchEventShim('fetch'),
  })
  // `done` rejects too when `response` does; the assertion is on `response`.
  done.catch(() => {})
  return response
}

describe('app-shell route: the cache answers only when the network fails', () => {
  it('a SLOW network (6 s) still gets the server document, not the cached one', async () => {
    await seedCachedDocument('cached document from another session')
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response('fresh server document', { status: 200 })), 6_000)
        })
    ) as typeof fetch

    const start = Date.now()
    const response = run()
    let settledAfterMs = -1
    void response.then(() => {
      settledAfterMs = Date.now() - start
    })
    await vi.advanceTimersByTimeAsync(6_000)

    expect(await (await response).text()).toBe('fresh server document')
    expect(settledAfterMs, 'answered before the network did').toBeGreaterThanOrEqual(6_000)
  })

  it('a FAILED network (offline) gets the cached document', async () => {
    // Positive control for the shims: the cache path works at all.
    await seedCachedDocument('cached document')
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch

    const response = run()
    await vi.advanceTimersByTimeAsync(0)

    expect(await (await response).text()).toBe('cached document')
  })

  it('a failed network with nothing cached rejects with no-response', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch

    const response = run()
    const settled = expect(response).rejects.toMatchObject({ name: 'no-response' })
    await vi.advanceTimersByTimeAsync(0)
    await settled
  })
})
