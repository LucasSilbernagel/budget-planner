/**
 * Migration connection credentials (Story 5.17, AC-4).
 *
 * `drizzle-kit migrate` does not go through `getPool()`. It builds its own
 * connection from `drizzle.config.ts`, which passed `dbCredentials: { url }`
 * and nothing else — so the connection that actually applied the schema did so
 * with **no CA verification and no sovereignty check**, while the preflight
 * running moments earlier had both. The guard was enforceable only on the
 * connection that could not change anything.
 *
 * drizzle-kit's postgres config accepts EITHER `{ url }` OR the decomposed form
 * carrying `ssl` — never both — so closing the gap means decomposing the URL
 * here and handing back the same TLS posture and host policy the application
 * itself uses (`isEuSovereignDbHost` / `buildDbSsl` from `./client`).
 *
 * This runs at drizzle-kit startup, so it THROWS rather than returning an error
 * shape: a refusal must stop the migration, not be swallowed by a config file.
 */

import { buildDbSsl, isEuSovereignDbHost, isRelaxedDbEnv } from './client'

export interface MigrationCredentials {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: ReturnType<typeof buildDbSsl>
}

export function buildMigrationCredentials(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
  caCert: string | undefined
): MigrationCredentials {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not configured. Migrations require DanubeData PostgreSQL in Germany (EU) for CLOUD Act immunity (NFR1, NFR2).'
    )
  }

  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL is not a parseable URL. Refusing to migrate.')
  }

  const host = url.hostname.toLowerCase()

  // The same fail-closed rule as the application pool and the migrate preflight:
  // only an explicit development/test NODE_ENV may point at a non-DanubeData host.
  if (!isRelaxedDbEnv(nodeEnv) && !isEuSovereignDbHost(host)) {
    throw new Error(
      `Refusing to migrate: "${host}" is not a DanubeData (Germany - EU) host, required for CLOUD Act immunity (NFR1, NFR2). Expected the internal writer name or a *.danubedata.ro host.`
    )
  }

  return {
    host,
    // `URL.port` is '' when the URL omits it; Postgres' default is 5432.
    port: url.port ? Number(url.port) : 5432,
    // Credentials arrive percent-encoded in a URL and must be decoded before
    // they are handed to the driver as discrete fields.
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    ssl: buildDbSsl(nodeEnv, caCert),
  }
}
