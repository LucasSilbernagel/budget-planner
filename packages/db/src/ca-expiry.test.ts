/**
 * Tests for the CA-expiry early warning (Story 4.16 follow-up, 2026-09-08).
 *
 * ⚠️ These originally minted a certificate per scenario with OpenSSL's
 * `-not_before`/`-not_after`, to place each window relative to today. Those
 * flags are **OpenSSL 3.5+**; GitHub's ubuntu-latest runners ship 3.0.x, so
 * every one of those tests passed locally and failed in CI with a bare
 * `req: Use -help for summary.` The lesson generalises past this file: a test
 * that shells out to a system tool is pinned to the OLDEST toolchain it must
 * run on, not the newest one available while writing it.
 *
 * The rewrite needs no version-specific flags, because it moves the CLOCK
 * instead of the certificate. `assessCaExpiry` takes `now` as a parameter
 * precisely so it can be examined at any point in a certificate's life — one
 * long-lived certificate plus a chosen `now` covers every case, and `-days` has
 * been supported forever.
 *
 * The certificate is still minted at runtime rather than checked in: a fixture
 * with a fixed expiry is itself a thing that expires, and a test whose whole
 * subject is expiry must not rot the way the certificate it guards would.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assessCaExpiry, formatCaExpiry } from './ca-expiry'

const MS_PER_DAY = 86_400_000
const workdir = mkdtempSync(join(tmpdir(), 'ca-expiry-'))
afterAll(() => rmSync(workdir, { recursive: true, force: true }))

let pem: string
/** A second, short-lived cert (10 days) for the multi-cert-chain case. */
let shortPem: string
/** The certificate's own notAfter — every `now` below is derived from it. */
let notAfter: Date

const mintCert = (name: string, days: number): string => {
  const key = join(workdir, `${name}.key`)
  const crt = join(workdir, `${name}.crt`)
  execFileSync('openssl', ['ecparam', '-genkey', '-name', 'prime256v1', '-out', key])
  // Only `-days` and `-subj`: both ancient, both present on every runner.
  execFileSync('openssl', [
    'req',
    '-new',
    '-x509',
    '-key',
    key,
    '-out',
    crt,
    '-days',
    String(days),
    '-subj',
    `/CN=${name}`,
  ])
  return readFileSync(crt, 'utf8')
}

beforeAll(() => {
  pem = mintCert('test-ca', 3650)
  shortPem = mintCert('leaf', 10)
  const parsed = assessCaExpiry(pem, new Date(), 21)
  if (!parsed.notAfter) throw new Error('fixture certificate did not parse')
  notAfter = new Date(parsed.notAfter)
})

/** A clock positioned `days` before the certificate expires (negative = after). */
const daysBeforeExpiry = (days: number): Date => new Date(notAfter.getTime() - days * MS_PER_DAY)

describe('assessCaExpiry', () => {
  it('reports ok for a certificate comfortably in date', () => {
    const result = assessCaExpiry(pem, daysBeforeExpiry(365), 21)
    expect(result.status).toBe('ok')
    expect(result.daysRemaining).toBeGreaterThan(21)
  })

  it('warns inside the threshold, while the certificate is still VALID', () => {
    // The whole point: this fires while everything still works, which is the
    // only time the warning is useful.
    const result = assessCaExpiry(pem, daysBeforeExpiry(5), 21)
    expect(result.status).toBe('warn')
    expect(result.daysRemaining).toBeLessThanOrEqual(21)
    expect(result.daysRemaining).toBeGreaterThan(0)
  })

  it('reports expired once the window has passed', () => {
    const result = assessCaExpiry(pem, daysBeforeExpiry(-2), 21)
    expect(result.status).toBe('expired')
    expect(result.daysRemaining).toBeLessThan(0)
  })

  it('treats the exact boundary as expired rather than as one last valid day', () => {
    expect(assessCaExpiry(pem, notAfter, 21).status).toBe('expired')
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
    const truncated = `${pem.split('\n').slice(0, 3).join('\n')}\n-----END CERTIFICATE-----\n`
    expect(assessCaExpiry(truncated, new Date(), 21).status).toBe('invalid')
  })

  it('reports on the SOONEST-expiring cert when handed a multi-cert chain', () => {
    // Operator pastes leaf + CA into DATABASE_CA_CERT. The long-lived CA is
    // block #1; checking only #1 (the old behaviour) would miss the 10-day leaf.
    const chain = `${pem}${shortPem}`
    const result = assessCaExpiry(chain, new Date(), 21)
    expect(result.status).toBe('warn')
    expect(result.daysRemaining).toBeLessThanOrEqual(10)
  })

  it('is invalid if ANY block of a chain fails to parse', () => {
    expect(
      assessCaExpiry(
        `${pem}\n-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----`,
        new Date(),
        21
      ).status
    ).toBe('invalid')
  })

  it('is driven by the threshold it is given, not a hardcoded one', () => {
    const now = daysBeforeExpiry(30)
    expect(assessCaExpiry(pem, now, 21).status).toBe('ok')
    expect(assessCaExpiry(pem, now, 45).status).toBe('warn')
  })
})

describe('formatCaExpiry', () => {
  it('names the date and the day count so the message is actionable alone', () => {
    const text = formatCaExpiry(assessCaExpiry(pem, daysBeforeExpiry(5), 21))
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(text).toContain('DATABASE_CA_CERT')
  })

  it('tells the reader how to fix it, not merely that it is broken', () => {
    // A warning that does not carry the remedy sends whoever reads it hunting
    // through three runbooks at exactly the wrong moment.
    const text = formatCaExpiry(assessCaExpiry(pem, daysBeforeExpiry(5), 21))
    expect(text).toMatch(/openssl s_client/)
    expect(text).toMatch(/public DNS/i)
  })

  it('carries the remedy on the missing-certificate path too', () => {
    const text = formatCaExpiry(assessCaExpiry(undefined, new Date(), 21))
    expect(text).toMatch(/openssl s_client/)
  })
})
