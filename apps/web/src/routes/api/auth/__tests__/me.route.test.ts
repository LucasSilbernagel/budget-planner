/**
 * GET /api/auth/me (Story 70.1, AC-4).
 *
 * The Settings plan label ("Annual Plan") is rendered from this response, so
 * the route must pass `billingInterval` through. The session resolver is mocked
 * here; that it READS the column from the database is proven end to end in
 * `routes/api/webhooks/__tests__/paddle-webhook.db.test.ts` (Story 70.1 block).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(),
}))

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { GET } from '../me'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const req = () => new Request('https://app.test/api/auth/me')

function session(billingInterval: 'month' | 'year' | null) {
  return {
    userId: 'u1',
    email: 'user@example.com',
    paddleId: 'ctm_1',
    subscriptionStatus: 'active',
    currency: 'EUR',
    billingInterval,
    isAuthenticated: true,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/auth/me', () => {
  it.each(['month', 'year', null] as const)(
    'returns billingInterval=%s so Settings can name the plan',
    async (billingInterval) => {
      asMock(getCurrentUserSession).mockResolvedValue({
        success: true,
        data: session(billingInterval),
      })

      const body = (await (await GET({ request: req() })).json()) as {
        user: { billingInterval?: unknown }
      }

      // `toHaveProperty` with the value, so a DROPPED key (undefined) fails for
      // `null` too — a bare `toBe(null)` on `body.user.billingInterval` would not.
      expect(body.user).toHaveProperty('billingInterval', billingInterval)
    }
  )

  it('returns {user:null} for an unauthenticated request (unchanged)', async () => {
    asMock(getCurrentUserSession).mockResolvedValue({ success: true, data: null })
    const res = await GET({ request: req() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: null })
  })
})
