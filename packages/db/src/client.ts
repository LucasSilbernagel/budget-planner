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
import { normalizeCaCert } from './ca-cert'
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
 *
 * ⚠️ CORRECTED 2026-09-03. This list held `.danubedata.com` from the architecture
 * documents until the first real endpoint was inspected. DanubeData's actual
 * domain is **`danubedata.ro`** — `danube db ls` reports
 * `postgresql-budget-planner-prod.budgetplanner795.danubedata.ro:5445`, and the
 * container registry is `cr.danubedata.ro/<ns>`. No real DanubeData host has ever
 * matched `.danubedata.com`; nothing had connected, so nothing exposed it.
 *
 * `.danubedata.com` was REMOVED rather than kept alongside: a domain this provider
 * does not own may belong to someone else, and allowlisting it would admit a wholly
 * foreign host — the precise failure this guard exists to prevent.
 */
const EU_DB_HOST_SUFFIXES = ['.danubedata.ro'] as const

/**
 * Internal-DNS hostnames permitted for the production database (Story 4.17, AC-2).
 *
 * DanubeData managed PostgreSQL is reachable over Kubernetes in-cluster DNS as
 * provisioned: the two endpoints shown in the dashboard are the CloudNativePG
 * rw/ro split, not a public-vs-private split. A public endpoint can be exposed
 * (`danube db dns enable`, which yields a `.danubedata.ro` host covered by the
 * suffix list above), but ADR-001 forbids that as a standing configuration — so
 * the in-cluster names below are what the application actually connects on.
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
 * CONFIRMED 2026-09-03 against the provisioned instance (`budget-planner-prod`,
 * database `pgdb`, Falkenstein DE). `danube db ls` reports the endpoint as
 * `budget-planner-prod-rw.budgetplanner795.svc.cluster.local:5432` — Kubernetes
 * in-cluster DNS, reachable only from inside that cluster and namespace.
 *
 * Listed as EXACT names rather than a `.svc.cluster.local` suffix rule on
 * purpose: a suffix would admit every service in every namespace of any cluster,
 * which is not a sovereignty guarantee at all.
 *
 * If the instance is ever re-provisioned, update this constant and its test in
 * `client.test.ts` — those two places are the whole change.
 */
const EU_DB_INTERNAL_HOSTS = [
  // Short form: resolvable from a pod in the same namespace via its DNS search
  // domain. The FQDN is what `danube db ls` reports and what therefore ends up
  // pasted into DATABASE_URL, so both forms have to be admitted.
  'budget-planner-prod-rw',
  'budget-planner-prod-rw.budgetplanner795.svc.cluster.local',
] as const

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
 * Substring matching is unsafe — `host.includes('.danubedata.ro')` would let
 * `evil.danubedata.ro.attacker.com` through — so we require an exact host or a
 * dot-anchored suffix. Internal-DNS names (which have no suffix to anchor on)
 * are admitted by exact match only.
 */
export function isEuSovereignDbHost(host: string): boolean {
  // Strip a single trailing dot: `pg-01.fra.danubedata.ro.` is a valid
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
export interface AppDbCredentials {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: ReturnType<typeof buildDbSsl>
}

/**
 * Decompose `DATABASE_URL` into the discrete fields `pg.Pool` accepts.
 *
 * ⚠️⚠️ NEVER pass `connectionString` to `Pool` alongside an explicit `ssl`
 * option. `pg-connection-string` parses a `?sslmode=` query parameter into ITS
 * OWN ssl config, and that parsed value wins over `ssl` — silently discarding
 * the CA and re-enabling full certificate-chain verification against the
 * system trust store. Reproduced live in production on 2026-09-09: the app
 * pool failed `/api/ready` in ~25ms (a fast TLS rejection, not the 2s readiness
 * timeout) after `DATABASE_URL` picked up a `?sslmode=` parameter, with
 * `DATABASE_CA_CERT` set correctly and never consulted.
 *
 * This is the exact defect `migrate-preflight-cli.ts` was fixed for on
 * 2026-09-08 (`buildMigrationCredentials`) — that fix was never propagated to
 * the pool the LIVE APP actually uses, which is the more consequential of the
 * two. Decomposition here closes that gap: no query parameter on the URL can
 * reach the driver's TLS decision, because no query parameter reaches the
 * driver at all.
 */
/**
 * Redact the userinfo (and any `password=` query value) from a string that may
 * contain a connection URL, so it is safe to put in a log line. Exported for the
 * migration builder and for tests.
 */
export function redactDbUrl(value: string): string {
  return value
    .replace(/\/\/[^/@\s]*@/g, '//[redacted]@')
    .replace(/(\b(?:password|pwd)=)[^\s&]*/gi, '$1[redacted]')
}

/**
 * `decodeURIComponent` throws a raw `URIError` on a literal `%` or a bad `%xx`
 * sequence (a generated password can contain one). Wrap it so the failure names
 * the offending field instead of surfacing an opaque decode error.
 */
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

  // Fail closed: only an explicit development/test NODE_ENV relaxes SSL + host
  // validation. Any other value (production, staging, preview, unset/unknown)
  // must use a DanubeData EU host for data sovereignty (NFR1, NFR2).
  if (!isRelaxedDbEnv(nodeEnv) && !isEuSovereignDbHost(host)) {
    throw new Error(
      `Production DATABASE_URL must use DanubeData (Germany - EU) hosting for CLOUD Act immunity (NFR1, NFR2). Detected host: ${host}. Expected an EU DanubeData host (e.g. *.danubedata.ro).`
    )
  }

  return {
    host,
    // `URL.port` is '' when the URL omits it; Postgres' default is 5432.
    port: url.port === '' ? 5432 : Number(url.port),
    // Credentials arrive percent-encoded in a URL and must be decoded before
    // they are handed to the driver as discrete fields.
    user: decodeUrlField(url.username, 'username'),
    password: decodeUrlField(url.password, 'password'),
    database: decodeUrlField(url.pathname.replace(/^\//, ''), 'database'),
    ssl: buildDbSsl(nodeEnv, caCert),
  }
}

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
  } catch (error) {
    // Server-side ONLY -- this never reaches an HTTP response. `/api/ready`
    // still returns a bare `{ status }` with no error detail (story 5-5 AC-1);
    // this line exists purely for the container's own log stream.
    //
    // Before this, a DB outage was genuinely undiagnosable in production: this
    // function swallowed the error into a bare `false`, and every caller did
    // the same, so nothing -- not even server logs -- ever recorded WHY.
    // Confirmed live 2026-09-10: `/api/ready` read 503 for hours with no trace
    // of the cause anywhere, including AFTER a real, confirmed defect
    // (getPool's connectionString/ssl conflict, fixed the same day) was
    // deployed and the symptom persisted -- there was no way to tell whether
    // that fix was the whole story or the wrong tree entirely.
    //
    // Deliberately narrow: name/code/message only, never the Error object
    // itself or DATABASE_URL. Standard pg/node connection errors (ECONNREFUSED,
    // ENOTFOUND, a self-signed-certificate rejection, 28P01 invalid_password)
    // do not embed the password in these fields, but `message` is scrubbed of
    // any connection-URL userinfo before logging so a future error type that
    // carries more cannot leak a credential into the log stream.
    //
    // A dual-stack connection failure (Node `autoSelectFamily`: a host resolving
    // to both A and AAAA, both refused) arrives as an `AggregateError` whose own
    // `message`/`code` are empty and whose real causes sit in `.errors` — unwrap
    // those so the log is actually diagnostic.
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

// Re-export schema for convenience
export * from './schema'
