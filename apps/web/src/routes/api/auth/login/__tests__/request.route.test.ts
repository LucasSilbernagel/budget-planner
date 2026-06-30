/**
 * Magic-link REQUEST route tests (Story 5-16, Task 2 — AC-1, AC-4)
 *
 * The endpoint must:
 *  - return an IDENTICAL response whether or not the email matches an account
 *    (no enumeration) — including when the underlying send fails;
 *  - rate-limit per IP and per email (anti email-bombing);
 *  - never create an account (delegated to requestMagicLink, mocked here).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/auth/magic-link', () => ({
  requestMagicLink: vi.fn().mockResolvedValue(undefined),
}))

import { requestMagicLink } from '@/server/api/auth/magic-link'
import { POST, _resetLoginRequestRateLimiters } from '../request'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST({
    request: new Request('https://app.test/api/auth/login/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  asMock(requestMagicLink).mockResolvedValue(undefined)
  _resetLoginRequestRateLimiters()
})

describe('POST /api/auth/login/request', () => {
  it('returns the same generic 200 for a known and an unknown email (no enumeration)', async () => {
    const known = await post({ email: 'known@example.com' })
    const unknown = await post({ email: 'ghost@example.com' })

    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await known.clone().json()).toEqual(await unknown.clone().json())
    // Delegated to the orchestration layer with the configured origin.
    expect(requestMagicLink).toHaveBeenCalledWith('known@example.com', 'https://app.test')
  })

  it('still returns the generic 200 when the send throws (failure is not observable)', async () => {
    asMock(requestMagicLink).mockRejectedValueOnce(new Error('mailer down'))
    const res = await post({ email: 'known@example.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  it('400s when the email field is missing or not a string', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ email: 123 })).status).toBe(400)
    expect(requestMagicLink).not.toHaveBeenCalled()
  })

  it('400s on an unparseable body', async () => {
    expect((await post('not json{')).status).toBe(400)
  })

  it('returns the generic 200 for a blank or over-long email without sending or unbounded keys', async () => {
    const blank = await post({ email: '   ' })
    const huge = await post({ email: `${'a'.repeat(300)}@x.com` })
    expect(blank.status).toBe(200)
    expect(huge.status).toBe(200)
    // Neither reaches the orchestration layer (no send, no work).
    expect(requestMagicLink).not.toHaveBeenCalled()
  })

  it('rate-limits per IP (429 after the window max from one IP)', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.5' }
    let last: Response | undefined
    for (let i = 0; i < 6; i++) {
      last = await post({ email: `u${i}@example.com` }, ip)
    }
    expect(last?.status).toBe(429)
  })

  it('rate-limits per email (stops sending for one address) while staying generic 200', async () => {
    // Same email repeatedly from no fixed IP: the per-email limiter throttles
    // sends, but the response stays an identical generic 200 (no enumeration).
    let last: Response | undefined
    for (let i = 0; i < 7; i++) {
      last = await post({ email: 'spammed@example.com' })
    }
    expect(last?.status).toBe(200)
    // Sending stopped after the per-email max (5), so not all 7 reached the sender.
    expect(asMock(requestMagicLink).mock.calls.length).toBeLessThan(7)
  })
})
