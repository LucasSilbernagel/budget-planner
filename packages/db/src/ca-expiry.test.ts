/**
 * Tests for the CA-expiry early warning (Story 4.16 follow-up, 2026-09-08).
 *
 * Certificates are generated in-process rather than checked in as fixtures: a
 * fixture with a fixed expiry date is itself a thing that expires, and a test
 * whose whole subject is expiry must not rot the way the certificate it guards
 * would.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assessCaExpiry, formatCaExpiry } from './ca-expiry'

const workdir = mkdtempSync(join(tmpdir(), 'ca-expiry-'))
afterAll(() => rmSync(workdir, { recursive: true, force: true }))

/**
 * Mint a self-signed certificate whose validity window is offset from now, so a
 * test can ask for "expires in 5 days" or "expired 2 days ago" directly.
 *
 * `-days` cannot express the past, so an already-expired certificate is made by
 * back-dating the whole window with `-not_before`/`-not_after` (OpenSSL 3.5).
 */
function mintCert(startOffsetDays: number, endOffsetDays: number): string {
  const stamp = (offset: number): string => {
    const d = new Date(Date.now() + offset * 86_400_000)
    return `${d.toISOString().slice(0, 19).replace(/[-:T]/g, '')}Z`
  }
  const key = join(workdir, `k${startOffsetDays}_${endOffsetDays}.pem`)
  const crt = join(workdir, `c${startOffsetDays}_${endOffsetDays}.pem`)
  execFileSync('openssl', ['ecparam', '-genkey', '-name', 'prime256v1', '-out', key])
  execFileSync('openssl', [
    'req',
    '-new',
    '-x509',
    '-key',
    key,
    '-out',
    crt,
    '-subj',
    '/CN=test-ca',
    '-not_before',
    stamp(startOffsetDays),
    '-not_after',
    stamp(endOffsetDays),
  ])
  return execFileSync('cat', [crt]).toString()
}

describe('assessCaExpiry', () => {
  it('reports ok for a certificate comfortably in date', () => {
    const result = assessCaExpiry(mintCert(-1, 90), new Date(), 21)
    expect(result.status).toBe('ok')
    expect(result.daysRemaining).toBeGreaterThan(21)
  })

  it('warns inside the threshold, while the certificate is still VALID', () => {
    // The whole point: this fires while everything still works, which is the
    // only time the warning is useful.
    const result = assessCaExpiry(mintCert(-1, 5), new Date(), 21)
    expect(result.status).toBe('warn')
    expect(result.daysRemaining).toBeLessThanOrEqual(21)
    expect(result.daysRemaining).toBeGreaterThan(0)
  })

  it('reports expired once the window has passed', () => {
    const result = assessCaExpiry(mintCert(-10, -2), new Date(), 21)
    expect(result.status).toBe('expired')
    expect(result.daysRemaining).toBeLessThan(0)
  })

  it('treats a missing certificate as invalid, never as ok', () => {
    // Fail closed: an unset secret must not read as a healthy certificate.
    for (const value of [undefined, '', '   ']) {
      expect(assessCaExpiry(value, new Date(), 21).status).toBe('invalid')
    }
  })

  it('treats an unparseable certificate as invalid', () => {
    expect(assessCaExpiry('not a certificate', new Date(), 21).status).toBe('invalid')
    // Truncated PEM: the delimiters are right, the body is not. This is the
    // realistic paste error — a copy that missed the last line.
    const truncated = `${mintCert(-1, 90)
      .split('\n')
      .slice(0, 3)
      .join('\n')}\n-----END CERTIFICATE-----\n`
    expect(assessCaExpiry(truncated, new Date(), 21).status).toBe('invalid')
  })

  it('is driven by the threshold it is given, not a hardcoded one', () => {
    const pem = mintCert(-1, 30)
    expect(assessCaExpiry(pem, new Date(), 21).status).toBe('ok')
    expect(assessCaExpiry(pem, new Date(), 45).status).toBe('warn')
  })
})

describe('formatCaExpiry', () => {
  it('names the date and the day count so the message is actionable alone', () => {
    const result = assessCaExpiry(mintCert(-1, 5), new Date(), 21)
    const text = formatCaExpiry(result)
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(text).toContain('DATABASE_CA_CERT')
  })

  it('tells the reader how to fix it, not merely that it is broken', () => {
    // A warning that does not carry the remedy sends whoever reads it hunting
    // through three runbooks at exactly the wrong moment.
    const text = formatCaExpiry(assessCaExpiry(mintCert(-1, 5), new Date(), 21))
    expect(text).toMatch(/openssl s_client/)
    expect(text).toMatch(/public DNS/i)
  })
})
