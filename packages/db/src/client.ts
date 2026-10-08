// Server-only. Production must be DanubeData (EU) for CLOUD Act immunity.

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { normalizeCaCert } from './ca-cert'
import * as schema from './schema'

let pool: Pool | null = null

// Memoized so the lazy `db` Proxy doesn't rebuild it on every property access.
let dbInstance: ReturnType<typeof createDb> | null = null

if (typeof window !== 'undefined') {
  throw new Error(
    '@budget-planner/db is a SERVER-ONLY package. ' +
      'Do not import in browser code. Use server functions/API endpoints instead.'
  )
}

/** `.danubedata.com` is not DanubeData's domain and must never be allowlisted. */
const EU_DB_HOST_SUFFIXES = ['.danubedata.ro'] as const

// Matched exactly, never as a suffix: a bare name has nothing to anchor on, and a
// `.svc.cluster.local` suffix would admit any service in any cluster. Writer endpoint only.
const EU_DB_INTERNAL_HOSTS = [
  // Pods resolve the short form; `danube db ls` reports the FQDN, which ends up in DATABASE_URL.
  'budget-planner-prod-rw',
  'budget-planner-prod-rw.budgetplanner795.svc.cluster.local',
] as const

/** Unset or unknown NODE_ENV fails closed as production-grade. */
export function isRelaxedDbEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test'
}

// Exact host or dot-anchored suffix: a substring match would admit
// `evil.danubedata.ro.attacker.com`.
export function isEuSovereignDbHost(host: string): boolean {
  // A trailing dot is a valid absolute-FQDN form.
  const h = host.toLowerCase().replace(/\.$/, '')
  if ((EU_DB_INTERNAL_HOSTS as readonly string[]).includes(h)) {
    return true
  }
  return EU_DB_HOST_SUFFIXES.some((suffix) => h === suffix.slice(1) || h.endsWith(suffix))
}

// Strict subset excluding the public endpoint, for migrations only. Not applied to the app
// pool, so operator tooling can still reach a public endpoint by hand.
export function isInClusterDbHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return (EU_DB_INTERNAL_HOSTS as readonly string[]).includes(h)
}

export function buildDbSsl(
  nodeEnv: string | undefined,
  caCert: string | undefined
): false | { rejectUnauthorized: true; ca?: string } {
  if (isRelaxedDbEnv(nodeEnv)) {
    return false
  }
  return caCert ? { rejectUnauthorized: true, ca: caCert } : { rejectUnauthorized: true }
}

export interface AppDbCredentials {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: ReturnType<typeof buildDbSsl>
}

// Never pass `connectionString` with an explicit `ssl`: pg parses `?sslmode=` into its own
// ssl config, which wins and silently drops the CA.
export function redactDbUrl(value: string): string {
  return value
    .replace(/\/\/[^/@\s]*@/g, '//[redacted]@')
    .replace(/(\b(?:password|pwd)=)[^\s&]*/gi, '$1[redacted]')
}

/** `decodeURIComponent` throws on a literal `%`; name the offending field instead. */
export function decodeUrlField(raw: string, field: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    throw new Error(
      `DATABASE_URL ${field} is not valid percent-encoding. Percent-encode literal "%" as "%25".`
    )
  }
}

export function buildAppDbCredentials(
  nodeEnv: string | undefined,
  databaseUrl: string,
  caCert: string | undefined
): AppDbCredentials {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL is not a parseable URL.')
  }
  const host = url.hostname.toLowerCase()

  if (!isRelaxedDbEnv(nodeEnv) && !isEuSovereignDbHost(host)) {
    throw new Error(
      `Production DATABASE_URL must use DanubeData (Germany - EU) hosting for CLOUD Act immunity (NFR1, NFR2). Detected host: ${host}. Expected an EU DanubeData host (e.g. *.danubedata.ro).`
    )
  }

  return {
    host,
    port: url.port === '' ? 5432 : Number(url.port),
    user: decodeUrlField(url.username, 'username'),
    password: decodeUrlField(url.password, 'password'),
    database: decodeUrlField(url.pathname.replace(/^\//, ''), 'database'),
    ssl: buildDbSsl(nodeEnv, caCert),
  }
}

// createdAt/updatedAt are `timestamp without time zone`: DB-side `now()` uses the session zone
// while the app writes UTC, so every connection pins UTC (drizzle-kit via PGOPTIONS).
export const DB_SESSION_OPTIONS = '-c TimeZone=UTC'

function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env['DATABASE_URL']

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is not configured. ' +
          'All database operations require DanubeData PostgreSQL in Germany (EU) for CLOUD Act immunity (NFR1, NFR2).'
      )
    }

    pool = new Pool({
      ...buildAppDbCredentials(
        process.env['NODE_ENV'],
        databaseUrl,
        normalizeCaCert(process.env['DATABASE_CA_CERT'])
      ),
      options: DB_SESSION_OPTIONS,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    })
  }

  return pool
}

function createDb() {
  return drizzle(getPool(), { schema })
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = createDb()
  }
  return dbInstance
}

// Lazy so importing the package without DATABASE_URL doesn't crash; connects on first use.
type Db = ReturnType<typeof getDb>

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = getDb()
    const value = Reflect.get(instance as object, prop)
    // Bind to the real instance so `this` is never the Proxy (which would re-enter this trap).
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(instance)
      : value
  },
})

export async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
  dbInstance = null
}

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
  } catch (error) {
    // Server log only, with URL userinfo scrubbed. A dual-stack refusal is an AggregateError with
    // empty fields of its own, so unwrap `.errors`.
    const err = error as {
      name?: string
      code?: string
      message?: string
      errors?: Array<{ code?: string; message?: string }>
    }
    console.error('[db] connectivity check failed:', {
      name: err?.name,
      code: err?.code,
      message: err?.message ? redactDbUrl(err.message) : err?.message,
      ...(Array.isArray(err?.errors)
        ? {
            causes: err.errors.map((e) => ({
              code: e?.code,
              message: e?.message ? redactDbUrl(e.message) : e?.message,
            })),
          }
        : {}),
    })
    return false
  }
}

export * from './schema'
