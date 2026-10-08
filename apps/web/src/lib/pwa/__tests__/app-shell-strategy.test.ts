/**
 * Runs the real Workbox NetworkFirst with the shipped route options: the cache may serve only when the network fails,
 * never on a slow network. ExpirationPlugin is left out (needs IndexedDB, irrelevant here).
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
    return 
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
  // Any other workbox-build option becomes a plugin in the real SW and would be silently dropped here.
  // Model it here first.
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
