import { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAppDbCredentials,
  buildDbSsl,
  closeDb,
  decodeUrlField,
  isEuSovereignDbHost,
  isInClusterDbHost,
  isRelaxedDbEnv,
  redactDbUrl,
  testDbConnection,
} from './client'

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
    expect(isRelaxedDbEnv('Production')).toBe(false)
  })
})

describe('isEuSovereignDbHost (anchored EU allowlist)', () => {
  it('accepts the DanubeData apex and its subdomains', () => {
    expect(isEuSovereignDbHost('danubedata.ro')).toBe(true)
    expect(isEuSovereignDbHost('pg-01.fra.danubedata.ro')).toBe(true)
    expect(isEuSovereignDbHost('PG-01.FRA.DANUBEDATA.RO')).toBe(true)
  })

  it('accepts the public endpoint exposed by `danube db dns enable`', () => {
    // Port 5445, not 5432: the host check ignores it, but the connection string must carry it.
    expect(
      isEuSovereignDbHost('postgresql-budget-planner-prod.budgetplanner795.danubedata.ro')
    ).toBe(true)
  })

  it('accepts the absolute-FQDN (trailing-dot) form', () => {
    expect(isEuSovereignDbHost('pg-01.fra.danubedata.ro.')).toBe(true)
    expect(isEuSovereignDbHost('danubedata.ro.')).toBe(true)
  })

  it('rejects danubedata.com — a domain this provider does not use', () => {
    // `.danubedata.com` is not DanubeData's domain; allowlisting a domain a third party may own
    // is the hole this guard closes.
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

// Migration-only: a strict subset that refuses the public endpoint.
describe('isInClusterDbHost (migration-only, excludes the public endpoint)', () => {
  it('accepts both in-cluster writer forms', () => {
    expect(isInClusterDbHost('budget-planner-prod-rw')).toBe(true)
    expect(isInClusterDbHost('budget-planner-prod-rw.budgetplanner795.svc.cluster.local')).toBe(
      true
    )
  })

  it('is case-insensitive and accepts the absolute-FQDN form', () => {
    expect(isInClusterDbHost('BUDGET-PLANNER-PROD-RW')).toBe(true)
    expect(isInClusterDbHost('budget-planner-prod-rw.budgetplanner795.svc.cluster.local.')).toBe(
      true
    )
  })

  // The public endpoint is EU-sovereign, so `isEuSovereignDbHost` admits it; this must not.
  it('rejects the public endpoint that the sovereignty check admits', () => {
    const publicHost = 'postgresql-budget-planner-prod.budgetplanner795.danubedata.ro'
    expect(isEuSovereignDbHost(publicHost)).toBe(true)
    expect(isInClusterDbHost(publicHost)).toBe(false)
  })

  it('rejects any other danubedata.ro host', () => {
    expect(isInClusterDbHost('danubedata.ro')).toBe(false)
    expect(isInClusterDbHost('pg-01.fra.danubedata.ro')).toBe(false)
  })

  // Exact match, never a suffix: a `.svc.cluster.local` suffix rule would admit every service
  // in every namespace of any cluster.
  it('rejects lookalikes and other in-cluster services', () => {
    expect(isInClusterDbHost('budget-planner-prod-rw.attacker.com')).toBe(false)
    expect(isInClusterDbHost('budget-planner-prod-ro')).toBe(false)
    expect(isInClusterDbHost('evil.budgetplanner795.svc.cluster.local')).toBe(false)
    expect(isInClusterDbHost('budget-planner-prod-rw.other-ns.svc.cluster.local')).toBe(false)
    expect(isInClusterDbHost('localhost')).toBe(false)
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

// Bare in-cluster hostnames are allowed by exact match only.

describe('isEuSovereignDbHost (internal-DNS exact allowlist)', () => {
  it('accepts the verified internal writer endpoint in both resolvable forms', () => {
    // Pods resolve the short name; DATABASE_URL carries the FQDN. Both must be allowed.
    expect(isEuSovereignDbHost('budget-planner-prod-rw')).toBe(true)
    expect(isEuSovereignDbHost('budget-planner-prod-rw.budgetplanner795.svc.cluster.local')).toBe(
      true
    )
  })

  it('rejects another namespace and any other cluster service', () => {
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

// A `?sslmode=` on the URL must not override the explicit `ssl` and drop the CA.
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
      password: 's3cr@t',
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

describe('testDbConnection (diagnosability, 2026-09-10)', () => {
  const originalUrl = process.env['DATABASE_URL']
  const originalEnv = process.env['NODE_ENV']

  afterEach(async () => {
    // biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
    if (originalUrl === undefined) delete process.env['DATABASE_URL']
    else process.env['DATABASE_URL'] = originalUrl
    process.env['NODE_ENV'] = originalEnv
    vi.restoreAllMocks()
    await closeDb()
  })

  it('logs a structured, safe summary of the failure server-side', async () => {
    // Missing DATABASE_URL makes getPool() throw synchronously, reaching the catch without a database.
    // biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
    delete process.env['DATABASE_URL']
    process.env['NODE_ENV'] = 'production'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await testDbConnection()

    expect(result).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    const [, detail] = spy.mock.calls[0] as [string, Record<string, unknown>]
    expect(detail).toMatchObject({ name: 'Error' })
    expect(String(detail.message)).toMatch(/DATABASE_URL is not configured/)
  })

  it('redacts a connection string embedded in the failure message', async () => {
    // Some pg/node errors embed the full URL, credentials included.
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
    expect(logged).not.toContain('s3cr3tpw')
    expect(logged).not.toContain('bp_app:')
    expect(logged).toContain('postgresql://[redacted]@budget-planner-prod-rw')
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
