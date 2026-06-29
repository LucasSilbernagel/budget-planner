/**
 * Security headers tests (Story 5.8 — AC-14)
 */

import { describe, expect, it } from 'vitest'
import { applyHeadersToNextResult, applySecurityHeaders } from '../security-headers'

describe('applySecurityHeaders', () => {
  it('sets the baseline security headers on a response', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, false)

    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-XSS-Protection')).toBe('1; mode=block')
  })

  it('does NOT set permissive CORS outside development', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, false)
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('sets dev-only permissive CORS in development', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, true)
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*')
    // Security headers are still present in dev.
    expect(headers.get('X-Frame-Options')).toBe('DENY')
  })
})

describe('applyHeadersToNextResult (middleware path)', () => {
  it('applies the security headers to the response produced by next()', async () => {
    const result = await applyHeadersToNextResult(
      async () => ({ response: new Response('ok') }),
      false
    )
    expect(result.response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(result.response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(result.response.headers.get('X-XSS-Protection')).toBe('1; mode=block')
    expect(result.response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    // Body/result identity is preserved.
    expect(await result.response.text()).toBe('ok')
  })

  it('passes through extra result fields and honors dev CORS', async () => {
    const result = await applyHeadersToNextResult(
      async () => ({ response: new Response(null), pathname: '/x' }),
      true
    )
    expect(result.response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(result.pathname).toBe('/x')
  })
})
