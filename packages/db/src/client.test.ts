import { describe, expect, it } from 'vitest'
import { buildDbSsl, isEuSovereignDbHost, isRelaxedDbEnv } from './client'

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
