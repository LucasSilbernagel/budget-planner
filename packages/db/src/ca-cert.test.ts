/**
 * Tests for `normalizeCaCert` — turning the single-line-safe encodings the
 * Rapids container UI forces on `DATABASE_CA_CERT` back into a real PEM block.
 *
 * The function only keys off the `-----BEGIN` marker, so these fixtures are
 * shaped like a PEM without being a valid certificate — the parsing that cares
 * about validity happens downstream (`buildDbSsl`, `assessCaExpiry`) and is
 * covered there.
 */

import { describe, expect, it } from 'vitest'
import { normalizeCaCert } from './ca-cert'

const PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIB1zCCAX2gAwIBAgIUABCDEF0123456789abcdefGHIJKLMNowCgYIKoZIzj0E',
  'AwIwEjEQMA4GA1UEAwwHdGVzdC1jYTAeFw0yNjAxMDEwMDAwMDBaFw0zNjAxMDEw',
  'MDAwMDBaMBIxEDAOBgNVBAMMB3Rlc3QtY2E=',
  '-----END CERTIFICATE-----',
].join('\n')

describe('normalizeCaCert', () => {
  it('returns undefined for unset or blank input', () => {
    expect(normalizeCaCert(undefined)).toBeUndefined()
    expect(normalizeCaCert('')).toBeUndefined()
    expect(normalizeCaCert('   \n  ')).toBeUndefined()
  })

  it('passes a genuine multi-line PEM through unchanged', () => {
    expect(normalizeCaCert(PEM)).toBe(PEM)
  })

  it('trims surrounding whitespace from a multi-line PEM', () => {
    expect(normalizeCaCert(`\n  ${PEM}\n\n`)).toBe(PEM)
  })

  it('rebuilds a PEM from literal \\n escapes on one line', () => {
    const escaped = PEM.replace(/\n/g, '\\n')
    expect(escaped).not.toContain('\n')
    expect(normalizeCaCert(escaped)).toBe(PEM)
  })

  it('rebuilds a PEM from literal \\r\\n escapes on one line', () => {
    const escaped = PEM.replace(/\n/g, '\\r\\n')
    expect(normalizeCaCert(escaped)).toBe(PEM)
  })

  it('decodes a base64-encoded PEM (base64 -w0)', () => {
    const b64 = Buffer.from(PEM, 'utf8').toString('base64')
    expect(b64).not.toContain('\n')
    expect(normalizeCaCert(b64)).toBe(PEM)
  })

  it('decodes base64 that was line-wrapped before being pasted on one line', () => {
    const wrapped = Buffer.from(PEM, 'utf8')
      .toString('base64')
      .replace(/(.{16})/g, '$1\n')
    expect(normalizeCaCert(wrapped)).toBe(PEM)
  })

  it('is idempotent', () => {
    const once = normalizeCaCert(Buffer.from(PEM, 'utf8').toString('base64'))
    expect(normalizeCaCert(once)).toBe(once)
  })

  it('hands back the original value when it is neither PEM nor base64-of-PEM', () => {
    expect(normalizeCaCert('not-a-cert')).toBe('not-a-cert')
  })

  it('reconstructs a PEM whose newlines the single-line field collapsed to spaces', () => {
    // The most direct paste error: a raw PEM dropped into the Rapids one-line
    // input. It still contains `-----BEGIN`, so the old fast-path returned it
    // verbatim and every consumer failed with an opaque "PEM routines" error.
    const collapsed = PEM.replace(/\n/g, ' ')
    expect(collapsed).not.toContain('\n')
    expect(normalizeCaCert(collapsed)).toBe(PEM)
  })

  it('reconstructs a PEM whose markers were jammed against the body', () => {
    const jammed = PEM.replace(/\n/g, '')
    expect(normalizeCaCert(jammed)).toBe(PEM)
  })

  it('preserves and re-wraps every block of a multi-cert chain', () => {
    const chain = `${PEM}\n${PEM}`
    expect(normalizeCaCert(chain.replace(/\n/g, ' '))).toBe(`${PEM}\n${PEM}`)
  })
})
