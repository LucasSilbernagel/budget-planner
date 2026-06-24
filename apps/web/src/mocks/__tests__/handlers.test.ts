import { describe, expect, it } from 'vitest'

/**
 * Verifies MSW intercepts all external service calls (AC-3, NFR8).
 * `onUnhandledRequest: 'error'` (vitest.setup.ts) guarantees any un-mocked
 * request would fail the suite, so a passing test proves interception works.
 */
describe('MSW external-service interception', () => {
  it('mocks Paddle API requests', async () => {
    const res = await fetch('https://api.paddle.com/transactions')
    expect(res.ok).toBe(true)
    await expect(res.json()).resolves.toMatchObject({ mocked: true })
  })

  it('mocks Paddle sandbox requests', async () => {
    const res = await fetch('https://sandbox-api.paddle.com/customers')
    await expect(res.json()).resolves.toMatchObject({ mocked: true })
  })

  it('mocks EthicalAds decision requests', async () => {
    const res = await fetch(
      'https://server.ethicalads.io/api/v1/decision/?publisher=budget-planner'
    )
    await expect(res.json()).resolves.toMatchObject({ id: 'msw-mock-ad' })
  })
})
