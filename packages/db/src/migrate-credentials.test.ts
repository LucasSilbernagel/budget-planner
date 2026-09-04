import { describe, expect, it } from 'vitest'
import { buildMigrationCredentials } from './migrate-credentials'

// Story 5.17 — AC-4. `drizzle-kit migrate` connects through drizzle.config.ts,
// which historically passed `{ url }` alone: no CA, no sovereignty check. The
// preflight validated the target and the migration that followed did not. These
// cases pin the parity.

const CA = 'CA-PEM'
const PROD = 'postgresql://bp_migrator:s3cret@budget-planner-prod-rw:5432/pgdb'

describe('buildMigrationCredentials', () => {
  it('decomposes the URL so an ssl option can be carried at all', () => {
    // drizzle-kit's postgres config accepts EITHER { url } OR the decomposed
    // form with `ssl` — never both. Passing a bare url is what silently dropped
    // TLS verification, so the decomposed shape is the fix, not a style choice.
    expect(buildMigrationCredentials('production', PROD, CA)).toEqual({
      host: 'budget-planner-prod-rw',
      port: 5432,
      user: 'bp_migrator',
      password: 's3cret',
      database: 'pgdb',
      ssl: { rejectUnauthorized: true, ca: CA },
    })
  })

  it('refuses a host the application pool would refuse', () => {
    const us = 'postgresql://u:p@abc.supabase.co:5432/db'
    expect(() => buildMigrationCredentials('production', us, CA)).toThrow(
      /danubedata|sovereign|EU/i
    )
    // Unset and unknown NODE_ENV are production-grade, not development.
    expect(() => buildMigrationCredentials(undefined, us, CA)).toThrow()
    expect(() => buildMigrationCredentials('staging', us, CA)).toThrow()
  })

  it('rejects a lookalike of the internal host', () => {
    const spoof = 'postgresql://u:p@budget-planner-prod-rw.attacker.com:5432/pgdb'
    expect(() => buildMigrationCredentials('production', spoof, CA)).toThrow()
  })

  it('still enforces TLS when no CA is configured', () => {
    const result = buildMigrationCredentials('production', PROD, undefined)
    expect(result.ssl).toEqual({ rejectUnauthorized: true })
  })

  it('disables TLS only for an explicitly relaxed environment', () => {
    const local = 'postgresql://u:p@localhost:5432/budget-planner-dev'
    expect(buildMigrationCredentials('development', local, undefined).ssl).toBe(false)
    expect(() => buildMigrationCredentials('production', local, undefined)).toThrow()
  })

  it('refuses a missing or unparseable URL rather than connecting to nothing', () => {
    expect(() => buildMigrationCredentials('production', undefined, CA)).toThrow(/DATABASE_URL/)
    expect(() => buildMigrationCredentials('production', '', CA)).toThrow(/DATABASE_URL/)
    expect(() => buildMigrationCredentials('production', 'not-a-url', CA)).toThrow(/DATABASE_URL/)
  })

  it('percent-decodes credentials and defaults the port', () => {
    const encoded = 'postgresql://bp%40user:p%40ss%2Fword@budget-planner-prod-rw/pgdb'
    const result = buildMigrationCredentials('production', encoded, CA)
    expect(result.user).toBe('bp@user')
    expect(result.password).toBe('p@ss/word')
    expect(result.port).toBe(5432)
  })
})
