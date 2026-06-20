/**
 * Database Client
 * 
 * Drizzle ORM client for Scaleway PostgreSQL.
 * All database operations MUST use Scaleway EU region (Paris/Amsterdam) for CLOUD Act immunity.
 * 
 * Architecture: Drizzle ORM with pg driver
 * Data Sovereignty: Zero US data residency (NFR1, NFR2)
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getConfig } from '@budget-planner/config'

// Import all schema tables
import * as schema from './schema'

// Database connection pool singleton
let pool: Pool | null = null

/**
 * Get database connection pool
 * Creates pool on first call, reuses thereafter
 */
function getPool(): Pool {
  if (!pool) {
    const config = getConfig()
    
    if (!config.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not configured. ' +
        'All database operations require Scaleway PostgreSQL in EU region (NFR1, NFR2).'
      )
    }
    
    // Validate URL is Scaleway (EU region)
    const url = new URL(config.DATABASE_URL)
    const host = url.hostname.toLowerCase()
    
    // Allow localhost for development, require scaleway for production
    if (config.NODE_ENV === 'production' && !host.includes('scaleway')) {
      throw new Error(
        'Production DATABASE_URL must use Scaleway hosting (EU region) for CLOUD Act immunity. ' +
        `Detected host: ${host}`
      )
    }
    
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      // SSL required for production
      ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
    })
  }
  
  return pool
}

/**
 * Get Drizzle database instance
 * All database operations should use this instance
 */
export function getDb() {
  const pool = getPool()
  return drizzle(pool, { schema })
}

/**
 * Database instance (pre-configured)
 * Import this directly for most use cases
 */
export const db = getDb()

/**
 * Close database connection pool
 * Useful for testing and graceful shutdown
 */
export async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
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
