/**
 * Logout route tests (Story 5.8 review patch)
 *
 * The session cookie must be cleared UNCONDITIONALLY — even when server-side
 * revocation (the DB write in logoutUser) fails — so a transient DB error can
 * never leave the user logged in on both the client and server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/auth/paddle', () => ({
  logoutUser: vi.fn(),
}))

import { logoutUser } from '@/server/api/auth/paddle'
import { buildClearSessionCookies } from '@/server/api/auth/session-cookies'
import { POST } from '../logout'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const req = () => new Request('https://app.test/api/auth/logout', { method: 'POST' })
const [CLEAR, CLEAR_HAS_SESSION] = buildClearSessionCookies(false)

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/auth/logout', () => {
  it('clears the cookie and returns 200 on successful revocation', async () => {
    asMock(logoutUser).mockResolvedValue({ success: true })
    const res = await POST({ request: req() })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual([CLEAR, CLEAR_HAS_SESSION])
  })

  it('STILL clears the cookie (defense-in-depth) even when revocation fails', async () => {
    asMock(logoutUser).mockResolvedValue({ success: false, error: 'db down' })
    const res = await POST({ request: req() })
    expect(res.status).toBe(500)
    expect(res.headers.getSetCookie()).toEqual([CLEAR, CLEAR_HAS_SESSION])
  })

  it('also clears has_session (Story 53.1) — leaving it behind would tell SyncProvider a signed-out browser still has a session', async () => {
    asMock(logoutUser).mockResolvedValue({ success: true })
    const res = await POST({ request: req() })
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c) => c.startsWith('has_session=') && c.includes('Max-Age=0'))).toBe(
      true
    )
    expect(setCookies.some((c) => c.startsWith('has_session=') && c.includes('HttpOnly'))).toBe(
      false
    )
  })

  it('adds Secure to BOTH cleared cookies in production (Story 53.1 review — this was missing entirely pre-review)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    asMock(logoutUser).mockResolvedValue({ success: true })
    const res = await POST({ request: req() })
    const setCookies = res.headers.getSetCookie()
    expect(setCookies).toEqual([
      'session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
      'has_session=; Path=/; SameSite=Lax; Secure; Max-Age=0',
    ])
  })
})
