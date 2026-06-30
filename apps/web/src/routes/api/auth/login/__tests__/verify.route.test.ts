/**
 * Magic-link VERIFY route tests (Story 5-16, Task 3 — AC-2, AC-3; review-hardened)
 *
 * The token is consumed ONLY on the POST. The GET is a read-only confirmation
 * interstitial (peek, no consume) that plants a double-submit CSRF cookie — so
 * email link-scanners can't burn the token and a cross-site POST can't sign a
 * victim in. The POST is rate-limited, CSRF-checked, then mints the signed
 * session with the exact Paddle-callback cookie semantics.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/auth/magic-link', () => ({
  peekMagicLink: vi.fn(),
  verifyMagicLink: vi.fn(),
}))

import { peekMagicLink, verifyMagicLink } from '@/server/api/auth/magic-link'
import { verifySession } from '@/server/api/auth/session'
import { GET, POST, _resetVerifyRateLimiter } from '../verify'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const getVerify = (token?: string) => {
  const url = new URL('https://app.test/api/auth/login/verify')
  if (token !== undefined) url.searchParams.set('token', token)
  return GET({ request: new Request(url) })
}

const postVerify = (
  fields: Record<string, string>,
  cookie?: string,
  extraHeaders: Record<string, string> = {}
) => {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    ...extraHeaders,
  }
  if (cookie) headers.cookie = cookie
  return POST({
    request: new Request('https://app.test/api/auth/login/verify', {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields),
    }),
  })
}

const cookieValue = (setCookie: string | null, name: string): string | null => {
  if (!setCookie) return null
  const m = setCookie.match(new RegExp(`${name}=([^;]*)`))
  return m ? m[1] : null
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetVerifyRateLimiter()
})

describe('GET /api/auth/login/verify (read-only interstitial)', () => {
  it('renders a confirm page (no session, no consume) showing the target email and a CSRF cookie', async () => {
    asMock(peekMagicLink).mockResolvedValueOnce({ email: 'user@example.com' })

    const res = await getVerify('good-token')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')

    const body = await res.text()
    // Shows which account it will sign into, and posts back to consume.
    expect(body).toContain('user@example.com')
    expect(body).toContain('method="POST"')
    expect(body).toContain('name="token"')
    expect(body).toContain('name="csrf"')

    // Plants the double-submit CSRF cookie; mints NO session on the GET.
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toMatch(/^ml_csrf=/)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).not.toContain('session=')

    // The token is NOT consumed by the GET.
    expect(verifyMagicLink).not.toHaveBeenCalled()
  })

  it('escapes the email to prevent HTML injection on the confirm page', async () => {
    asMock(peekMagicLink).mockResolvedValueOnce({ email: 'a<script>@x.com' })
    const body = await (await getVerify('t')).text()
    expect(body).not.toContain('<script>')
    expect(body).toContain('&lt;script&gt;')
  })

  it('renders a generic invalid page (no CSRF cookie) for an unknown/expired token', async () => {
    asMock(peekMagicLink).mockResolvedValueOnce(null)
    const res = await getVerify('bad')
    expect(res.status).toBe(200)
    expect(await res.text()).toMatch(/invalid or has expired/i)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('renders the generic invalid page when peek throws (fail-closed)', async () => {
    asMock(peekMagicLink).mockRejectedValueOnce(new Error('db down'))
    const res = await getVerify('boom')
    expect(res.status).toBe(200)
    expect(await res.text()).toMatch(/invalid or has expired/i)
  })
})

describe('POST /api/auth/login/verify (consume + sign in)', () => {
  it('full round-trip: GET issues CSRF, POST consumes and mints a valid signed session', async () => {
    asMock(peekMagicLink).mockResolvedValueOnce({ email: 'user@example.com' })
    const getRes = await getVerify('good-token')
    const csrf = cookieValue(getRes.headers.get('Set-Cookie'), 'ml_csrf')
    expect(csrf).toBeTruthy()
    // The form field carries the same CSRF value the cookie does.
    expect(await getRes.text()).toContain(`value="${csrf}"`)

    asMock(verifyMagicLink).mockResolvedValueOnce({
      userId: '11111111-1111-1111-1111-111111111111',
      paddleId: 'pad_1',
      email: 'user@example.com',
    })
    const res = await postVerify({ token: 'good-token', csrf: csrf as string }, `ml_csrf=${csrf}`)

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/')
    const setCookies = res.headers.getSetCookie()
    const session = setCookies.find((c) => c.startsWith('session='))
    expect(session).toMatch(/HttpOnly/)
    expect(session).toMatch(/SameSite=Lax/)
    expect(session).toMatch(/Max-Age=604800/)
    expect(session).not.toContain('Secure') // not production in tests
    // CSRF cookie is cleared.
    expect(setCookies.some((c) => c.startsWith('ml_csrf=') && c.includes('Max-Age=0'))).toBe(true)

    // The minted session is genuine and revocation-eligible (carries iat, AC-3).
    const raw = decodeURIComponent((session as string).split(';')[0].replace('session=', ''))
    const payload = verifySession(raw)
    expect(payload).toMatchObject({
      userId: '11111111-1111-1111-1111-111111111111',
      paddleId: 'pad_1',
      email: 'user@example.com',
    })
    expect(typeof payload?.iat).toBe('number')
  })

  it('rejects a CSRF mismatch generically and does NOT consume the token (login-CSRF defense)', async () => {
    const res = await postVerify({ token: 't', csrf: 'attacker-value' }, 'ml_csrf=victim-value')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/login?error=invalid_or_expired')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(verifyMagicLink).not.toHaveBeenCalled()
  })

  it('rejects when the CSRF cookie is missing entirely', async () => {
    const res = await postVerify({ token: 't', csrf: 'x' })
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/login?error=invalid_or_expired')
    expect(verifyMagicLink).not.toHaveBeenCalled()
  })

  it('redirects generically with no session for an invalid/expired/consumed token', async () => {
    asMock(verifyMagicLink).mockResolvedValueOnce(null)
    const res = await postVerify({ token: 'bad', csrf: 'm' }, 'ml_csrf=m')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/login?error=invalid_or_expired')
    expect(res.headers.getSetCookie().some((c) => c.startsWith('session='))).toBe(false)
  })

  it('fails closed (generic redirect, no session) when verification throws', async () => {
    asMock(verifyMagicLink).mockRejectedValueOnce(new Error('db down'))
    const res = await postVerify({ token: 'x', csrf: 'm' }, 'ml_csrf=m')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/login?error=invalid_or_expired')
  })

  it('rate-limits the consume endpoint per IP', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.9' }
    let last: Response | undefined
    for (let i = 0; i < 11; i++) {
      last = await postVerify({ token: 't', csrf: 'm' }, 'ml_csrf=m', ip)
    }
    expect(last?.status).toBe(429)
  })
})
