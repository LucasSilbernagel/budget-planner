/**
 * Security headers tests (Story 5.8 — AC-14; extended by story sec-1)
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NO_FLASH_THEME_SCRIPT } from '../../../lib/theme/no-flash-theme-script'
import {
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  STRICT_TRANSPORT_SECURITY,
  applyHeadersToNextResult,
  applySecurityHeaders,
  buildContentSecurityPolicy,
  isConfirmedHttps,
} from '../security-headers'

const TEST_NONCE = 'dGVzdC1ub25jZS0xMjM='

/** Parse a CSP header string into a directive-name → source-list map. */
function parseCsp(csp: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const part of csp.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const spaceIdx = trimmed.indexOf(' ')
    if (spaceIdx === -1) {
      map[trimmed] = ''
    } else {
      map[trimmed.slice(0, spaceIdx)] = trimmed.slice(spaceIdx + 1)
    }
  }
  return map
}

const baseOpts = { isDev: false, isHttps: true, nonce: TEST_NONCE }

describe('applySecurityHeaders', () => {
  it('sets the baseline legacy security headers on a response', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, baseOpts)

    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-XSS-Protection')).toBe('1; mode=block')
  })

  it('does NOT set permissive CORS outside development', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, baseOpts)
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('sets dev-only permissive CORS in development', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, { isDev: true, isHttps: false, nonce: TEST_NONCE })
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*')
    // Security headers are still present in dev.
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('Content-Security-Policy')).toBe(buildContentSecurityPolicy(TEST_NONCE))
  })

  describe('Content-Security-Policy (sec-1 AC-1)', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, baseOpts)
    const csp = headers.get('Content-Security-Policy')

    it('is present on every response and injects the request nonce', () => {
      expect(csp).toBe(buildContentSecurityPolicy(TEST_NONCE))
      expect(csp).toBeTruthy()
    })

    it('locks the baseline: default-src self, object-src none, frame-ancestors none, base-uri/form-action self', () => {
      const d = parseCsp(csp ?? '')
      expect(d['default-src']).toBe(`'self'`)
      expect(d['object-src']).toBe(`'none'`)
      expect(d['frame-ancestors']).toBe(`'none'`)
      expect(d['base-uri']).toBe(`'self'`)
      expect(d['form-action']).toBe(`'self'`)
      // worker-src MUST be explicit 'self': it falls back to child-src (set for
      // Paddle frames, no 'self'), not default-src, so the same-origin PWA
      // service worker would otherwise be blocked (story 7-1).
      expect(d['worker-src']).toBe(`'self'`)
      expect(d['manifest-src']).toBe(`'self'`)
    })

    it('allows exactly the real script origins (self, nonce, theme hash, Paddle, counter.dev) and no unsafe-inline for scripts', () => {
      const d = parseCsp(csp ?? '')
      expect(d['script-src']).toContain(`'self'`)
      expect(d['script-src']).toContain(`'nonce-${TEST_NONCE}'`)
      expect(d['script-src']).toContain('https://cdn.paddle.com')
      expect(d['script-src']).toContain('https://cdn.counter.dev')
      expect(d['script-src']).not.toContain('ethicalads')
      expect(d['script-src']).not.toContain(`'unsafe-inline'`)
    })

    it('allows unsafe-inline for STYLES only (React/Recharts attribute styles)', () => {
      const d = parseCsp(csp ?? '')
      expect(d['style-src']).toBe(`'self' 'unsafe-inline'`)
    })

    it('allows the real connect / frame / img / font origins', () => {
      const d = parseCsp(csp ?? '')
      expect(d['connect-src']).toBe(
        `'self' https://submit-form.com https://counter.dev https://*.paddle.com`
      )
      expect(d['frame-src']).toBe('https://*.paddle.com')
      expect(d['img-src']).toBe(`'self' data:`)
      expect(d['font-src']).toBe(`'self' data:`)
      // Story 25-1 removed all advertising — no ad-network origin survives anywhere.
      expect(csp ?? '').not.toContain('ethicalads')
    })

    // AC-5: the sha256 pinned in the CSP must always match the exact script the
    // route renders. Recompute independently from the shared source of truth so a
    // future edit to NO_FLASH_THEME_SCRIPT that forgets to update the policy fails
    // loudly here (a drifted hash = blocked theme bootstrap = flash). The theme
    // script is authorized by this HASH, not the nonce, so __root.tsx stays untouched.
    it('pins the sha256 of the EXACT inline theme script in script-src (AC-5, drift guard)', () => {
      const expectedHash = `sha256-${createHash('sha256')
        .update(NO_FLASH_THEME_SCRIPT, 'utf8')
        .digest('base64')}`
      const d = parseCsp(csp ?? '')
      expect(d['script-src']).toContain(`'${expectedHash}'`)
    })
  })

  describe('buildContentSecurityPolicy (per-request nonce)', () => {
    it('injects the exact nonce it is given', () => {
      const csp = buildContentSecurityPolicy('AAAABBBBCCCCDDDD')
      expect(csp).toContain(`'nonce-AAAABBBBCCCCDDDD'`)
    })

    it('produces a different script-src for a different nonce', () => {
      expect(buildContentSecurityPolicy('AAAA')).not.toBe(buildContentSecurityPolicy('BBBB'))
    })

    it('accepts a real generated base64 nonce (with padding)', () => {
      expect(() => buildContentSecurityPolicy('dGVzdC1ub25jZS0xMjM=')).not.toThrow()
    })

    it('rejects a non-base64 nonce (CSP-injection guard)', () => {
      // A `'` would break out of the 'nonce-…' token and inject directives.
      expect(() => buildContentSecurityPolicy(`x' ; script-src *`)).toThrow(/base64/)
      expect(() => buildContentSecurityPolicy('')).toThrow(/base64/)
    })
  })

  describe('isConfirmedHttps (sec-1, HSTS scheme gate)', () => {
    it('is true only for a forwarded proto of https, case-insensitively', () => {
      expect(isConfirmedHttps('https')).toBe(true)
      expect(isConfirmedHttps('HTTPS')).toBe(true)
      expect(isConfirmedHttps('Https')).toBe(true)
    })

    it('takes the first hop of a comma-joined value', () => {
      expect(isConfirmedHttps('https, http')).toBe(true)
      expect(isConfirmedHttps('http, https')).toBe(false)
    })

    it('is false for http, absent, or empty', () => {
      expect(isConfirmedHttps('http')).toBe(false)
      expect(isConfirmedHttps(null)).toBe(false)
      expect(isConfirmedHttps(undefined)).toBe(false)
      expect(isConfirmedHttps('')).toBe(false)
    })
  })

  describe('Strict-Transport-Security (sec-1 AC-3, gated on confirmed HTTPS)', () => {
    it('is present over confirmed HTTPS in production, without preload', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, { isDev: false, isHttps: true, nonce: TEST_NONCE })
      expect(headers.get('Strict-Transport-Security')).toBe(STRICT_TRANSPORT_SECURITY)
      expect(STRICT_TRANSPORT_SECURITY).toBe('max-age=31536000; includeSubDomains')
      // preload intentionally omitted (Lucas's decision — near-irreversible commitment).
      expect(headers.get('Strict-Transport-Security')).not.toContain('preload')
    })

    it('is ABSENT when the scheme is not confirmed HTTPS (plain HTTP)', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, { isDev: false, isHttps: false, nonce: TEST_NONCE })
      expect(headers.get('Strict-Transport-Security')).toBeNull()
    })

    it('is ABSENT in development even if the scheme reports HTTPS', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, { isDev: true, isHttps: true, nonce: TEST_NONCE })
      expect(headers.get('Strict-Transport-Security')).toBeNull()
    })
  })

  describe('Referrer-Policy and Permissions-Policy (sec-1 AC-4)', () => {
    it('sets a strict Referrer-Policy on every response', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, { isDev: false, isHttps: false, nonce: TEST_NONCE })
      expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
      expect(REFERRER_POLICY).toBe('strict-origin-when-cross-origin')
    })

    it('denies unused browser features via Permissions-Policy', () => {
      const headers = new Headers()
      applySecurityHeaders(headers, { isDev: false, isHttps: false, nonce: TEST_NONCE })
      expect(headers.get('Permissions-Policy')).toBe(PERMISSIONS_POLICY)
      expect(PERMISSIONS_POLICY).toContain('camera=()')
      expect(PERMISSIONS_POLICY).toContain('microphone=()')
      expect(PERMISSIONS_POLICY).toContain('geolocation=()')
      expect(PERMISSIONS_POLICY).toContain('payment=()')
    })
  })
})

describe('applyHeadersToNextResult (middleware path)', () => {
  it('applies the security headers to the response produced by next()', async () => {
    const result = await applyHeadersToNextResult(async () => ({ response: new Response('ok') }), {
      isDev: false,
      isHttps: true,
      nonce: TEST_NONCE,
    })
    expect(result.response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(result.response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(result.response.headers.get('X-XSS-Protection')).toBe('1; mode=block')
    expect(result.response.headers.get('Content-Security-Policy')).toBe(
      buildContentSecurityPolicy(TEST_NONCE)
    )
    expect(result.response.headers.get('Strict-Transport-Security')).toBe(STRICT_TRANSPORT_SECURITY)
    expect(result.response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    // Body/result identity is preserved.
    expect(await result.response.text()).toBe('ok')
  })

  it('passes through extra result fields and honors dev CORS (and suppresses HSTS in dev)', async () => {
    const result = await applyHeadersToNextResult(
      async () => ({ response: new Response(null), pathname: '/x' }),
      { isDev: true, isHttps: true, nonce: TEST_NONCE }
    )
    expect(result.response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(result.response.headers.get('Strict-Transport-Security')).toBeNull()
    expect(result.pathname).toBe('/x')
  })
})
