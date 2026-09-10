import { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAppDbCredentials,
  buildDbSsl,
  closeDb,
  decodeUrlField,
  isEuSovereignDbHost,
  isRelaxedDbEnv,
  redactDbUrl,
  testDbConnection,
} from './client'

// Story 5.8 — AC group A: database connection & data sovereignty hardening.

describe('isRelaxedDbEnv (NODE_ENV fail-closed)', () => {
  it('relaxes only for explicit development/test', () => {
    expect(isRelaxedDbEnv('development')).toBe(true)
    expect(isRelaxedDbEnv('test')).toBe(true)
  })

  it('fails closed for production, staging, preview, unset, and unknown', () => {
    expect(isRelaxedDbEnv('production')).toBe(false)
    expect(isRelaxedDbEnv('staging')).toBe(false)
    expect(isRelaxedDbEnv('preview')).toBe(false)
    expect(isRelaxedDbEnv(undefined)).toBe(false)
    expect(isRelaxedDbEnv('')).toBe(false)
    expect(isRelaxedDbEnv('Production')).toBe(false) // case-sensitive on purpose
  })
})

describe('isEuSovereignDbHost (anchored EU allowlist)', () => {
  it('accepts the DanubeData apex and its subdomains', () => {
    expect(isEuSovereignDbHost('danubedata.ro')).toBe(true)
    expect(isEuSovereignDbHost('pg-01.fra.danubedata.ro')).toBe(true)
    expect(isEuSovereignDbHost('PG-01.FRA.DANUBEDATA.RO')).toBe(true)
  })

  it('accepts the public endpoint exposed by `danube db dns enable`', () => {
    // Confirmed 2026-09-03 against the live instance. Note the port is 5445, not
    // 5432 — the host check does not see it, but the connection string must.
    expect(
      isEuSovereignDbHost('postgresql-budget-planner-prod.budgetplanner795.danubedata.ro')
    ).toBe(true)
  })

  it('accepts the absolute-FQDN (trailing-dot) form', () => {
    expect(isEuSovereignDbHost('pg-01.fra.danubedata.ro.')).toBe(true)
    expect(isEuSovereignDbHost('danubedata.ro.')).toBe(true)
  })

  it('rejects danubedata.com — a domain this provider does not use', () => {
    // The allowlist pinned `.danubedata.com` from the architecture docs until
    // 2026-09-03; no real DanubeData host has ever matched it. Allowlisting a
    // domain a third party may own is the exact hole this guard exists to close.
    expect(isEuSovereignDbHost('danubedata.com')).toBe(false)
    expect(isEuSovereignDbHost('pg-01.fra.danubedata.com')).toBe(false)
  })

  it('rejects a spoofed suffix (anchored, not substring)', () => {
    expect(isEuSovereignDbHost('evil.danubedata.ro.attacker.com')).toBe(false)
    expect(isEuSovereignDbHost('notdanubedata.ro')).toBe(false)
    expect(isEuSovereignDbHost('danubedata.ro.evil.io')).toBe(false)
  })

  it('rejects removed US-reachable infra (ElephantSQL, Supabase)', () => {
    expect(isEuSovereignDbHost('db.elephantsql.com')).toBe(false)
    expect(isEuSovereignDbHost('xyz.db.elephantsql.com')).toBe(false)
    expect(isEuSovereignDbHost('abc.supabase.co')).toBe(false)
  })

  it('rejects localhost (only relaxed envs skip the host check)', () => {
    expect(isEuSovereignDbHost('localhost')).toBe(false)
  })
})

describe('buildDbSsl (production CA support)', () => {
  it('disables SSL in relaxed environments', () => {
    expect(buildDbSsl('development', undefined)).toBe(false)
    expect(buildDbSsl('test', 'some-ca')).toBe(false)
  })

  it('enforces TLS verification without a CA when none configured', () => {
    expect(buildDbSsl('production', undefined)).toEqual({ rejectUnauthorized: true })
    expect(buildDbSsl(undefined, undefined)).toEqual({ rejectUnauthorized: true })
  })

  it('supplies the managed-provider CA when configured', () => {
    expect(buildDbSsl('production', 'CA-PEM-CONTENTS')).toEqual({
      rejectUnauthorized: true,
      ca: 'CA-PEM-CONTENTS',
    })
  })
})

// Story 4.17 — AC-2: the production database is reached over DanubeData internal
// DNS, a BARE hostname with no `.danubedata.ro` suffix. It is allowed by EXACT
// match only, so the anchoring that protects the suffix list is not weakened.

describe('isEuSovereignDbHost (internal-DNS exact allowlist)', () => {
  it('accepts the verified internal writer endpoint in both resolvable forms', () => {
    // Kubernetes in-cluster DNS. A pod in the same namespace resolves the short
    // name via its search domain; the CLI and dashboard report the FQDN, which is
    // what actually lands in DATABASE_URL. Both must be allowed or the pasted
    // value is rejected at getPool().
    expect(isEuSovereignDbHost('budget-planner-prod-rw')).toBe(true)
    expect(isEuSovereignDbHost('budget-planner-prod-rw.budgetplanner795.svc.cluster.local')).toBe(
      true
    )
  })

  it('rejects another namespace and any other cluster service', () => {
    // Exact match, not a `.svc.cluster.local` suffix rule: a suffix would admit
    // every service in every namespace of any cluster.
    expect(isEuSovereignDbHost('budget-planner-prod-rw.someone-else.svc.cluster.local')).toBe(false)
    expect(isEuSovereignDbHost('postgres.default.svc.cluster.local')).toBe(false)
    expect(
      isEuSovereignDbHost('budget-planner-prod-rw.budgetplanner795.svc.cluster.local.attacker.com')
    ).toBe(false)
  })

  it('accepts it case-insensitively and in absolute-FQDN form', () => {
    expect(isEuSovereignDbHost('BUDGET-PLANNER-PROD-RW')).toBe(true)
    expect(isEuSovereignDbHost('budget-planner-prod-rw.')).toBe(true)
  })

  it('rejects a lookalike built by extending the internal name', () => {
    // The whole point of exact match: none of these are the internal service.
    expect(isEuSovereignDbHost('budget-planner-prod-rw.attacker.com')).toBe(false)
    expect(isEuSovereignDbHost('budget-planner-prod-rw.evil.io')).toBe(false)
    expect(isEuSovereignDbHost('evil-budget-planner-prod-rw')).toBe(false)
    expect(isEuSovereignDbHost('budget-planner-prod-rw-evil')).toBe(false)
  })

  it('does not allowlist the read-only endpoint (writes must fail loudly, not silently)', () => {
    expect(isEuSovereignDbHost('budget-planner-prod-ro')).toBe(false)
  })

  it('does not turn every bare hostname into a sovereign host', () => {
    expect(isEuSovereignDbHost('postgres')).toBe(false)
    expect(isEuSovereignDbHost('db')).toBe(false)
    expect(isEuSovereignDbHost('budget-planner-dev-rw')).toBe(false)
  })
})

// Production incident, 2026-09-09: `/api/ready` failed in ~25ms (a fast TLS
// rejection, not the 2s readiness timeout) with DATABASE_CA_CERT set correctly
// and never consulted. `getPool()` passed `connectionString` alongside an
// explicit `ssl` option, so a `?sslmode=` on the URL silently won and dropped
// the CA — the exact defect fixed in migrate-preflight-cli.ts the day before,
// never propagated to the pool the LIVE APP actually uses.
describe('buildAppDbCredentials (the 2026-09-09 production incident)', () => {
  const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'

  it.each(['require', 'verify-full', 'disable', 'no-verify'])(
    'drops ?sslmode=%s and keeps the CA-bearing ssl option',
    (mode) => {
      const creds = buildAppDbCredentials(
        'production',
        `postgresql://bp_app:p@budget-planner-prod-rw:5432/pgdb?sslmode=${mode}`,
        CA
      )
      expect(creds.ssl).toMatchObject({ rejectUnauthorized: true, ca: CA })
      expect(JSON.stringify(creds)).not.toContain('sslmode')
    }
  )

  it('decomposes the internal-DNS URL into discrete pg.Pool fields', () => {
    const creds = buildAppDbCredentials(
      'production',
      'postgresql://bp_app:s3cr%40t@budget-planner-prod-rw:5432/pgdb',
      CA
    )
    expect(creds).toMatchObject({
      host: 'budget-planner-prod-rw',
      port: 5432,
      user: 'bp_app',
      password: 's3cr@t', // percent-decoded
      database: 'pgdb',
    })
  })

  it('still fails closed on a non-sovereign host', () => {
    expect(() =>
      buildAppDbCredentials('production', 'postgresql://u:p@evil.example:5432/pgdb', CA)
    ).toThrow(/DanubeData/)
  })

  it('relaxes SSL in development without needing a CA', () => {
    const creds = buildAppDbCredentials(
      'development',
      'postgresql://u:p@localhost:5432/pgdb',
      undefined
    )
    expect(creds.ssl).toBe(false)
  })
})

// Production incident, 2026-09-10: `/api/ready` returned 503 for hours with
// NO trace of why anywhere -- not the HTTP response (by design, story 5-5
// AC-1), not the container's stdout logs either, because `testDbConnection`
// swallowed the pg/node error into a bare `false`. A real, confirmed defect
// (getPool's connectionString/ssl conflict) got fixed and deployed and the
// symptom persisted -- undiagnosable, because nothing recorded which of many
// possible causes it actually was.
describe('testDbConnection (diagnosability, 2026-09-10)', () => {
  const originalUrl = process.env['DATABASE_URL']
  const originalEnv = process.env['NODE_ENV']

  afterEach(async () => {
    // biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
    if (originalUrl === undefined) delete process.env['DATABASE_URL']
    else process.env['DATABASE_URL'] = originalUrl
    process.env['NODE_ENV'] = originalEnv
    vi.restoreAllMocks()
    await closeDb() // reset the memoized pool so the next test rebuilds it
  })

  it('logs a structured, safe summary of the failure server-side', async () => {
    // Missing DATABASE_URL makes getPool() throw SYNCHRONOUSLY -- a real,
    // dependency-free way to reach testDbConnection's catch block without a
    // database or mocking `pg`.
    // biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
    delete process.env['DATABASE_URL']
    process.env['NODE_ENV'] = 'production'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await testDbConnection()

    expect(result).toBe(false) // contract preserved: never throws to the caller
    expect(spy).toHaveBeenCalledTimes(1)
    const [, detail] = spy.mock.calls[0] as [string, Record<string, unknown>]
    expect(detail).toMatchObject({ name: 'Error' })
    expect(String(detail.message)).toMatch(/DATABASE_URL is not configured/)
  })

  it('redacts a connection string embedded in the failure message', async () => {
    // A driver-level error whose `.message` carries the full URL, user:pass and
    // all -- some pg/node errors do this. `getPool()` succeeds (valid EU host),
    // then the connect attempt rejects with the leaky error.
    process.env['DATABASE_URL'] = 'postgresql://bp_app:s3cr3tpw@budget-planner-prod-rw:5432/pgdb'
    process.env['NODE_ENV'] = 'production'
    const leak = new Error(
      'connection to postgresql://bp_app:s3cr3tpw@budget-planner-prod-rw:5432/pgdb refused'
    )
    vi.spyOn(Pool.prototype, 'connect').mockRejectedValue(leak)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await testDbConnection()

    expect(result).toBe(false)
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).not.toContain('s3cr3tpw') // the password never reaches the log
    expect(logged).not.toContain('bp_app:') // nor the user:pass@ shape
    expect(logged).toContain('postgresql://[redacted]@budget-planner-prod-rw') // logged, scrubbed
  })

  it('unwraps an AggregateError so the log is actually diagnostic', async () => {
    process.env['DATABASE_URL'] = 'postgresql://bp_app:s3cr3tpw@budget-planner-prod-rw:5432/pgdb'
    process.env['NODE_ENV'] = 'production'
    const agg = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('connect ECONNREFUSED [fe80::1]:5432'), { code: 'ECONNREFUSED' }),
      ],
      ''
    )
    vi.spyOn(Pool.prototype, 'connect').mockRejectedValue(agg)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await testDbConnection()

    const [, detail] = spy.mock.calls[0] as [string, Record<string, unknown>]
    expect(detail['causes']).toEqual([
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.1:5432' },
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED [fe80::1]:5432' },
    ])
  })
})

describe('redactDbUrl', () => {
  it('strips userinfo and password query values, leaves clean text alone', () => {
    expect(redactDbUrl('fail at postgresql://u:p@host:5432/db now')).toBe(
      'fail at postgresql://[redacted]@host:5432/db now'
    )
    expect(redactDbUrl('dsn host=h password=hunter2 dbname=d')).toBe(
      'dsn host=h password=[redacted] dbname=d'
    )
    expect(redactDbUrl('connect ECONNREFUSED 10.0.0.1:5432')).toBe(
      'connect ECONNREFUSED 10.0.0.1:5432'
    )
  })
})

describe('decodeUrlField', () => {
  it('decodes valid percent-encoding and names the field on a bad sequence', () => {
    expect(decodeUrlField('s3cr%40t', 'password')).toBe('s3cr@t')
    expect(() => decodeUrlField('100%off', 'password')).toThrow(
      /password is not valid percent-encoding/
    )
  })
})
