// Moves the clock, not the cert: OpenSSL's `-not_before`/`-not_after` need 3.5+ and CI has 3.0.
// The cert is minted at runtime so a fixture can't itself expire.

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
let shortPem: string
let notAfter: Date

const mintCert = (name: string, days: number): string => {
  const key = join(workdir, `${name}.key`)
  const crt = join(workdir, `${name}.crt`)
  execFileSync('openssl', ['ecparam', '-genkey', '-name', 'prime256v1', '-out', key])
  // Only `-days` and `-subj`: present on every OpenSSL version.
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

const daysBeforeExpiry = (days: number): Date => new Date(notAfter.getTime() - days * MS_PER_DAY)

describe('assessCaExpiry', () => {
  it('reports ok for a certificate comfortably in date', () => {
    const result = assessCaExpiry(pem, daysBeforeExpiry(365), 21)
    expect(result.status).toBe('ok')
    expect(result.daysRemaining).toBeGreaterThan(21)
  })

  it('warns inside the threshold, while the certificate is still VALID', () => {
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
    for (const value of [undefined, '', '   ']) {
      expect(assessCaExpiry(value, new Date(), 21).status).toBe('invalid')
    }
  })

  it('treats an unparseable certificate as invalid', () => {
    expect(assessCaExpiry('not a certificate', new Date(), 21).status).toBe('invalid')
    const truncated = `${pem.split('\n').slice(0, 3).join('\n')}\n-----END CERTIFICATE-----\n`
    expect(assessCaExpiry(truncated, new Date(), 21).status).toBe('invalid')
  })

  it('reports on the SOONEST-expiring cert when handed a multi-cert chain', () => {
    // Leaf + CA: the long-lived CA is block #1, so checking only #1 would miss the 10-day leaf.
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
    const text = formatCaExpiry(assessCaExpiry(pem, daysBeforeExpiry(5), 21))
    expect(text).toMatch(/openssl s_client/)
    expect(text).toMatch(/public DNS/i)
  })

  it('carries the remedy on the missing-certificate path too', () => {
    const text = formatCaExpiry(assessCaExpiry(undefined, new Date(), 21))
    expect(text).toMatch(/openssl s_client/)
  })
})
