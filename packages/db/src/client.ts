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

    // Validate URL is DanubeData (Germany - EU region)
    const url = new URL(databaseUrl)
    const host = url.hostname.toLowerCase()
    const nodeEnv = process.env['NODE_ENV'] || 'development'

    // Allow localhost for development
    // Production must use DanubeData (Germany) for EU data sovereignty
    if (nodeEnv === 'production') {
      // DanubeData uses various hostnames, check for known patterns
      const isDanubeData =
        host.includes('.db.elephantsql.com') ||
        host.includes('.danubedata.com') ||
        host.includes('.supabase.co') // DanubeData also uses Supabase infra

      if (!isDanubeData) {
        throw new Error(
          `Production DATABASE_URL must use DanubeData (Germany - EU) hosting for CLOUD Act immunity. Detected host: ${host}. Expected: *.db.elephantsql.com, *.danubedata.com, or *.supabase.co`
        )
      }
    }

    pool = new Pool({
      connectionString: databaseUrl,
      // SSL required for production
      ssl: nodeEnv === 'production' ? { rejectUnauthorized: true } : false,
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
