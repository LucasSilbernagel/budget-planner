import { describe, expect, it } from 'vitest'
import { assessSmokePreconditions } from './db-smoke'

// Story 4.17 — AC-5. The live `SELECT 1` needs the provisioned instance, but the
// decision of whether a smoke run is even permitted is pure, so it is tested here.
// The point of these cases is that a smoke check must never report success after
// connecting over an unverified or non-sovereign path.

describe('assessSmokePreconditions', () => {
  const CA = 'CA-PEM'
  const PROD_URL = 'postgresql://u:p@budget-planner-prod-rw:5432/budget-planner'

  it('permits the production internal writer over CA-validated TLS', () => {
    const result = assessSmokePreconditions('production', PROD_URL, CA)
    expect(result.ok).toBe(true)
    expect(result.ok && result.host).toBe('budget-planner-prod-rw')
    expect(result.ok && result.ssl).toEqual({ rejectUnauthorized: true, ca: CA })
  })

  it('refuses when DATABASE_URL is absent rather than reporting a vacuous pass', () => {
    expect(assessSmokePreconditions('production', undefined, CA).ok).toBe(false)
    expect(assessSmokePreconditions('production', '', CA).ok).toBe(false)
  })

  it('refuses an unparseable DATABASE_URL', () => {
    expect(assessSmokePreconditions('production', 'not-a-url', CA).ok).toBe(false)
  })

  it('refuses a non-sovereign host under a production-grade NODE_ENV', () => {
    const us = 'postgresql://u:p@abc.supabase.co:5432/db'
    expect(assessSmokePreconditions('production', us, CA).ok).toBe(false)
    // Unset NODE_ENV is production-grade, not development.
    expect(assessSmokePreconditions(undefined, us, CA).ok).toBe(false)
    expect(assessSmokePreconditions('staging', us, CA).ok).toBe(false)
  })

  it('still enforces TLS when no CA is configured', () => {
    const result = assessSmokePreconditions('production', PROD_URL, undefined)
    expect(result.ok).toBe(true)
    expect(result.ok && result.ssl).toEqual({ rejectUnauthorized: true })
  })

  it('allows a local database only under an explicitly relaxed NODE_ENV', () => {
    const local = 'postgresql://u:p@localhost:5432/budget-planner-dev'
    expect(assessSmokePreconditions('development', local, undefined).ok).toBe(true)
    expect(assessSmokePreconditions('production', local, undefined).ok).toBe(false)
  })
})
