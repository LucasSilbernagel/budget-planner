/**
 * Database Client
 *
 * Drizzle ORM client for DanubeData PostgreSQL.
 * All database operations MUST use DanubeData (Germany - EU) for CLOUD Act immunity.
 *
 * Architecture: Drizzle ORM with pg driver
 * Data Sovereignty: Zero US data residency (NFR1, NFR2)
 *
 * NOTE: This package is SERVER-ONLY. Do not import in browser code.
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// Database connection pool singleton
let pool: Pool | null = null

// Drizzle instance singleton — memoized over the pool so we don't rebuild it
// (and re-wrap the pool) on every property access through the lazy `db` Proxy.
let dbInstance: ReturnType<typeof createDb> | null = null

/**
 * Browser guard - this package is server-only
 * Prevents accidental browser imports which would cause errors
 */
if (typeof window !== 'undefined') {
  throw new Error(
    '@budget-planner/db is a SERVER-ONLY package. ' +
      'Do not import in browser code. Use server functions/API endpoints instead.'
  )
}

/**
 * EU/DanubeData host suffixes permitted for the production database.
 *
 * EU-only data sovereignty (NFR1, NFR2): the production database MUST be
 * DanubeData (Germany, EU) for full CLOUD Act immunity. US-reachable infra
 * (ElephantSQL, Supabase) is intentionally NOT permitted.
 */
const EU_DB_HOST_SUFFIXES = ['.danubedata.com'] as const

/**
 * Internal-DNS hostnames permitted for the production database (Story 4.17, AC-2).
 *
 * DanubeData managed PostgreSQL is reachable ONLY from inside the DanubeData
 * network: both endpoints shown in the dashboard are internal, the
 * "writer"/"reader" pair being the CloudNativePG rw/ro split rather than a
 * public-vs-private split. There is no public endpoint to point at instead, and
 * ADR-001 forbids external paths ("no external connections, no SSH tunnels in
 * production"), so the suffix list above cannot cover the production host.
 *
 * These are matched EXACTLY — never as a suffix, never as a substring. A bare
 * name has no dots to anchor against, so `endsWith` on it would admit
 * `budget-planner-prod-rw.attacker.com`. Exact match is what keeps this
 * addition from widening the allowlist.
 *
 * Only the WRITER endpoint is listed: the app and the migration both write, so
 * an accidental `-ro` URL should fail rather than half-work. If a read replica
 * is ever wired up deliberately, add its name here with its own test.
 *
 * CONFIRMED 2026-09-03 against the provisioned instance (database `pgdb`,
 * Falkenstein DE): the dashboard reports this exact writer name. If it is ever
 * re-provisioned under a different name, update this constant and its test in
 * `client.test.ts` — those two places are the whole change.
 */
const EU_DB_INTERNAL_HOSTS = ['budget-planner-prod-rw'] as const

/**
 * True only for the explicit local environments that may relax SSL + host
 * validation. Everything else — production, staging, preview, an unset or
 * unknown NODE_ENV — is treated as production-grade and fails closed.
 */
export function isRelaxedDbEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test'
}

/**
 * Anchored EU-sovereignty host check.
 *
 * Substring matching is unsafe — `host.includes('.danubedata.com')` would let
 * `evil.danubedata.com.attacker.com` through — so we require an exact host or a
 * dot-anchored suffix. Internal-DNS names (which have no suffix to anchor on)
 * are admitted by exact match only.
 */
export function isEuSovereignDbHost(host: string): boolean {
  // Strip a single trailing dot: `pg-01.fra.danubedata.com.` is a valid
  // absolute-FQDN form and must match the same as the dotless host.
  const h = host.toLowerCase().replace(/\.$/, '')
  if ((EU_DB_INTERNAL_HOSTS as readonly string[]).includes(h)) {
    return true
  }
  return EU_DB_HOST_SUFFIXES.some((suffix) => h === suffix.slice(1) || h.endsWith(suffix))
}

/**
 * Resolve the pg SSL option for a given environment.
 *
 * - Relaxed (development/test): SSL disabled for local Postgres.
 * - Otherwise: TLS verification is enforced (`rejectUnauthorized: true`). When a
 *   managed-provider CA is configured (`DATABASE_CA_CERT`) it is supplied so
 *   verification succeeds against providers not in the system trust store.
 */
export function buildDbSsl(
  nodeEnv: string | undefined,
  caCert: string | undefined
): false | { rejectUnauthorized: true; ca?: string } {
  if (isRelaxedDbEnv(nodeEnv)) {
    return false
  }
  return caCert ? { rejectUnauthorized: true, ca: caCert } : { rejectUnauthorized: true }
}

/**
 * Get database connection pool
 * Creates pool on first call, reuses thereafter
 */
function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env['DATABASE_URL']

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is not configured. ' +
          'All database operations require DanubeData PostgreSQL in Germany (EU) for CLOUD Act immunity (NFR1, NFR2).'
      )
    }

    const url = new URL(databaseUrl)
    const host = url.hostname.toLowerCase()
    const nodeEnv = process.env['NODE_ENV']

    // Fail closed: only an explicit development/test NODE_ENV relaxes SSL + host
    // validation. Any other value (production, staging, preview, unset/unknown)
    // must use a DanubeData EU host for data sovereignty (NFR1, NFR2).
    if (!isRelaxedDbEnv(nodeEnv) && !isEuSovereignDbHost(host)) {
      throw new Error(
        `Production DATABASE_URL must use DanubeData (Germany - EU) hosting for CLOUD Act immunity (NFR1, NFR2). Detected host: ${host}. Expected an EU DanubeData host (e.g. *.danubedata.com).`
      )
    }

    pool = new Pool({
      connectionString: databaseUrl,
      // SSL enforced (with optional managed-provider CA) outside local dev/test
      ssl: buildDbSsl(nodeEnv, process.env['DATABASE_CA_CERT']),
      // Connection pooling tuned for development (AC-4); pg defaults to max 10
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    })
  }

  return pool
}

/**
 * Build a fresh Drizzle instance over the pool.
 * Internal — callers should use the memoized `getDb()` / `db`.
 */
function createDb() {
  return drizzle(getPool(), { schema })
}

/**
 * Get Drizzle database instance (memoized)
 * All database operations should use this instance
 */
export function getDb() {
  if (!dbInstance) {
    dbInstance = createDb()
  }
  return dbInstance
}

/**
 * Database instance (pre-configured)
 * Import this directly for most use cases.
 *
 * Lazily initialized: the underlying pool/Drizzle instance is created on first
 * property access, not at module load. This keeps `import '@budget-planner/db'`
 * side-effect free so environments without DATABASE_URL (CI unit/e2e, SSR boot
 * of pages that never query) don't crash on import. Connecting is deferred to
 * the first real database operation (NFR8).
 */
type Db = ReturnType<typeof getDb>

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = getDb()
    const value = Reflect.get(instance as object, prop)
    // Bind methods to the real instance so `this` is never the Proxy (which
    // would otherwise re-enter this trap and break getter / private-field access).
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(instance)
      : value
  },
})

/**
 * Close database connection pool
 * Useful for testing and graceful shutdown
 */
export async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
  dbInstance = null
}

/**
 * Test database connection
 * Verifies connection to Scaleway PostgreSQL
 */
export async function testDbConnection(): Promise<boolean> {
  try {
    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('SELECT 1')
      return true
    } finally {
      client.release()
    }
  } catch {
    return false
  }
}

// Re-export schema for convenience
export * from './schema'
