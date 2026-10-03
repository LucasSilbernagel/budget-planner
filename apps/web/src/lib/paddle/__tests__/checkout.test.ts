/**
 * `getPaddleInstance` caching (Story 5-3 review follow-up).
 *
 * NFR8: `@paddle/paddle-js` is mocked — no real CDN load in tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPaddleInstance,
  preemptPaddleRetainSnippet,
  resetPaddleInstanceForTests,
} from '../checkout'

const initializePaddle = vi.fn()

vi.mock('@paddle/paddle-js', () => ({
  initializePaddle: (...args: unknown[]) => initializePaddle(...args),
}))

const CONFIG = { environment: 'sandbox' as const, clientToken: 'test_client_token' }

beforeEach(() => {
  initializePaddle.mockReset()
  resetPaddleInstanceForTests()
})

describe('getPaddleInstance', () => {
  it('caches the resolved instance across calls', async () => {
    const paddleInstance = { Checkout: {}, PricePreview: vi.fn() }
    initializePaddle.mockResolvedValue(paddleInstance)

    const first = await getPaddleInstance(CONFIG)
    const second = await getPaddleInstance(CONFIG)

    expect(first).toBe(paddleInstance)
    expect(second).toBe(paddleInstance)
    expect(initializePaddle).toHaveBeenCalledTimes(1)
  })

  it('does NOT permanently poison future calls after a rejection (un-caches on failure)', async () => {
    initializePaddle.mockRejectedValueOnce(new Error('cdn.paddle.com hiccup'))

    await expect(getPaddleInstance(CONFIG)).rejects.toThrow('cdn.paddle.com hiccup')

    // A momentary failure must not poison every LATER checkout attempt.
    const paddleInstance = { Checkout: {}, PricePreview: vi.fn() }
    initializePaddle.mockResolvedValueOnce(paddleInstance)
    const retried = await getPaddleInstance(CONFIG)

    expect(retried).toBe(paddleInstance)
    expect(initializePaddle).toHaveBeenCalledTimes(2)
  })

  it('does NOT permanently poison future calls when initializePaddle RESOLVES undefined (its real failure signal)', async () => {
    // `initializePaddle` signals a bad token / CDN load failure by RESOLVING
    // `undefined`, not by rejecting — a `.catch`-only fix never sees this,
    // the far more common real-world failure shape than an outright throw.
    initializePaddle.mockResolvedValueOnce(undefined)

    const first = await getPaddleInstance(CONFIG)
    expect(first).toBeUndefined()

    const paddleInstance = { Checkout: {}, PricePreview: vi.fn() }
    initializePaddle.mockResolvedValueOnce(paddleInstance)
    const retried = await getPaddleInstance(CONFIG)

    expect(retried).toBe(paddleInstance)
    expect(initializePaddle).toHaveBeenCalledTimes(2)
  })
})

// Story sec-4, D1 (AC-5): Paddle.js's `initPwSnippet()` skips ProfitWell only when
// `window.profitwell?.isLoaded` is already truthy at `Paddle.Initialize()` time.
describe('getPaddleInstance: the window.profitwell stub (sec-4 D1)', () => {
  type Host = { profitwell?: unknown }
  let host: Host

  beforeEach(() => {
    host = {}
    vi.stubGlobal('window', host)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is installed BEFORE initializePaddle runs (Paddle.Initialize reads it)', async () => {
    let seenAtInit: unknown = 'initializePaddle never ran'
    initializePaddle.mockImplementation(async () => {
      seenAtInit = host.profitwell
      return { Checkout: {} }
    })

    await getPaddleInstance(CONFIG)

    expect(typeof seenAtInit).toBe('function')
    expect((seenAtInit as { isLoaded?: unknown }).isLoaded).toBe(true)
  })

  it('is a callable no-op (Paddle.js calls window.profitwell(...) from updatePwCustomer / Retain)', async () => {
    initializePaddle.mockResolvedValue({ Checkout: {} })
    await getPaddleInstance(CONFIG)

    const stub = host.profitwell as (...args: unknown[]) => unknown
    expect(stub('start', { auth_token: 'x' })).toBeUndefined()
    expect(stub('cq_get_customer_email')).toBeUndefined()
    // A no-op: it grows no queue (the real snippet's queue is `window.profitwell.q`).
    expect((stub as unknown as { q?: unknown }).q).toBeUndefined()
  })

  it('leaves an EXISTING window.profitwell alone', async () => {
    const existing = Object.assign(() => {}, { isLoaded: false, marker: 'site-owned' })
    host.profitwell = existing
    let seenAtInit: unknown
    initializePaddle.mockImplementation(async () => {
      seenAtInit = host.profitwell
      return { Checkout: {} }
    })

    await getPaddleInstance(CONFIG)

    expect(seenAtInit).toBe(existing)
    expect(host.profitwell).toBe(existing)
    expect((host.profitwell as { isLoaded: boolean }).isLoaded).toBe(false)
  })

  // Paddle's guard is `window.profitwell?.isLoaded`: `null?.isLoaded` is `undefined`, so a
  // `null` left in place would let the script load (sec-4 review).
  it('treats a null window.profitwell as absent and replaces it', async () => {
    host.profitwell = null
    let seenAtInit: unknown
    initializePaddle.mockImplementation(async () => {
      seenAtInit = host.profitwell
      return { Checkout: {} }
    })

    await getPaddleInstance(CONFIG)

    expect(typeof seenAtInit).toBe('function')
    expect((seenAtInit as { isLoaded?: unknown }).isLoaded).toBe(true)
  })

  it('preemptPaddleRetainSnippet is a no-op without a window (SSR)', () => {
    vi.unstubAllGlobals()
    expect(typeof window).toBe('undefined')
    expect(() => preemptPaddleRetainSnippet()).not.toThrow()
  })
})
