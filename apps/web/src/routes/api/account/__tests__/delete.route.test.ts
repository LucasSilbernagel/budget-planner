/**
 * Account deletion route tests (Story 10-5, AC-1/3)
 *
 * The route is the thin HTTP shell over `deleteUserAccount`:
 *  - success → 200, `{ success: true }`, and the session cookie is cleared
 *    (the client-side half of signing out after erasure);
 *  - unauthenticated → 401 (no cookie clear needed — there is no valid session);
 *  - unexpected error → 500 with a non-leaky message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/account', () => ({
  deleteUserAccount: vi.fn(),
}))

import { deleteUserAccount } from '@/server/api/account'
import { buildClearSessionCookies } from '@/server/api/auth/session-cookies'
import { POST } from '../delete'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const req = () => new Request('https://app.test/api/account/delete', { method: 'POST' })
const [CLEAR, CLEAR_HAS_SESSION] = buildClearSessionCookies(false)

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/account/delete', () => {
  it('returns 200 and clears the session cookie on successful erasure', async () => {
    asMock(deleteUserAccount).mockResolvedValue({ success: true })

    const res = await POST({ request: req() })

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual([CLEAR, CLEAR_HAS_SESSION])
    await expect(res.json()).resolves.toEqual({ success: true })
  })

  it('also clears has_session (Story 53.1)', async () => {
    asMock(deleteUserAccount).mockResolvedValue({ success: true })
    const res = await POST({ request: req() })
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c) => c.startsWith('has_session=') && c.includes('Max-Age=0'))).toBe(
      true
    )
  })

  it('adds Secure to both cleared cookies in production (parity with logout.ts, Story 53.1 review)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    asMock(deleteUserAccount).mockResolvedValue({ success: true })
    const res = await POST({ request: req() })
    expect(res.headers.getSetCookie()).toEqual([
      'session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
      'has_session=; Path=/; SameSite=Lax; Secure; Max-Age=0',
    ])
  })

  it('returns 401 when the caller is not authenticated', async () => {
    asMock(deleteUserAccount).mockResolvedValue({ success: false, reason: 'unauthenticated' })

    const res = await POST({ request: req() })

    expect(res.status).toBe(401)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('returns 500 with a non-leaky message on an unexpected error', async () => {
    asMock(deleteUserAccount).mockResolvedValue({
      success: false,
      reason: 'error',
      error: 'internal detail that must not leak',
    })

    const res = await POST({ request: req() })

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'Failed to delete account',
    })
  })
})
