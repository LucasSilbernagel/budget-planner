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

  it('mocks the counter.dev analytics script asset (Story 10-1)', async () => {
    const res = await fetch('https://cdn.counter.dev/script.js')
    expect(res.status).toBe(204)
  })

  it('mocks the counter.dev /track + /trackpage beacons (Story 10-1)', async () => {
    const track = await fetch('https://counter.dev/track')
    expect(track.status).toBe(204)
    const trackpage = await fetch('https://counter.dev/trackpage', { method: 'POST' })
    expect(trackpage.status).toBe(204)
  })
})
