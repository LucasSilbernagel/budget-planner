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

      // `toHaveProperty` fails on a dropped key; `toBe(null)` would not.
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
