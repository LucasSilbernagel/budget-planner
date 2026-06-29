/**
 * Logout route tests (Story 5.8 review patch)
 *
 * The session cookie must be cleared UNCONDITIONALLY — even when server-side
 * revocation (the DB write in logoutUser) fails — so a transient DB error can
 * never leave the user logged in on both the client and server.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/auth/paddle', () => ({
  logoutUser: vi.fn(),
}))

import { logoutUser } from '@/server/api/auth/paddle'
import { POST } from '../logout'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const req = () => new Request('https://app.test/api/auth/logout', { method: 'POST' })
const CLEAR = 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

beforeEach(() => vi.clearAllMocks())

describe('POST /api/auth/logout', () => {
  it('clears the cookie and returns 200 on successful revocation', async () => {
    asMock(logoutUser).mockResolvedValue({ success: true })
    const res = await POST({ request: req() })
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBe(CLEAR)
  })

  it('STILL clears the cookie (defense-in-depth) even when revocation fails', async () => {
    asMock(logoutUser).mockResolvedValue({ success: false, error: 'db down' })
    const res = await POST({ request: req() })
    expect(res.status).toBe(500)
    expect(res.headers.get('Set-Cookie')).toBe(CLEAR)
  })
})
