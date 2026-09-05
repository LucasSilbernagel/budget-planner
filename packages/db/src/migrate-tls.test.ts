import { describe, expect, it } from 'vitest'
import { buildDbSsl } from './client'
import { buildMigrationDbSsl } from './migrate-tls'

// Story 5.17 — option (e), 2026-09-04. DanubeData issues the database certificate
// for IN-CLUSTER names only (SANs: budget-planner-prod-rw[.budgetplanner795[.svc
// [.cluster.local]]] and the -r/-ro variants). The public endpoint exposed by
// `danube db dns enable` is a TCP passthrough with no certificate of its own, so
// full verify-full TLS can never succeed over it.
//
// These cases pin the narrow downgrade that makes the windowed migration possible
// — and, more importantly, pin what it must NOT give up.

const CA = 'CA-PEM'

describe('buildMigrationDbSsl', () => {
  it('is identical to the app policy when the downgrade is not requested', () => {
    expect(buildMigrationDbSsl('production', CA, false)).toEqual(buildDbSsl('production', CA))
    expect(buildMigrationDbSsl('production', CA, false)).not.toHaveProperty('checkServerIdentity')
  })

  it('keeps chain validation and the CA when the hostname check is waived', () => {
    const ssl = buildMigrationDbSsl('production', CA, true)
    if (ssl === false) throw new Error('expected TLS to remain enabled')
    // The downgrade is verify-ca, NOT "no TLS". Both of these must survive.
    expect(ssl.rejectUnauthorized).toBe(true)
    expect(ssl.ca).toBe(CA)
    expect(typeof ssl.checkServerIdentity).toBe('function')
    // The override must be a genuine no-op, not a partial check that misleads.
    expect(ssl.checkServerIdentity?.('any.host', {} as never)).toBeUndefined()
  })

  it('REFUSES to waive the hostname check when no CA is configured', () => {
    // Without a private CA, skipping the hostname check leaves nothing meaningful
    // being verified — that combination must be impossible to configure.
    expect(() => buildMigrationDbSsl('production', undefined, true)).toThrow(/CA/i)
    expect(() => buildMigrationDbSsl(undefined, undefined, true)).toThrow(/CA/i)
  })

  it('does not resurrect TLS in a relaxed environment', () => {
    expect(buildMigrationDbSsl('development', undefined, true)).toBe(false)
    expect(buildMigrationDbSsl('test', CA, true)).toBe(false)
  })

  it('leaves the application policy untouched', () => {
    // The app connects in-cluster, where the hostname matches the certificate. It
    // must never acquire this override, whatever the migration does.
    expect(buildDbSsl('production', CA)).not.toHaveProperty('checkServerIdentity')
  })
})
