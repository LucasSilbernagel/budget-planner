/**
 * `getPaddleInstance` caching (Story 5-3 review follow-up).
 *
 * NFR8: `@paddle/paddle-js` is mocked — no real CDN load in tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPaddleInstance, resetPaddleInstanceForTests } from '../checkout'

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
