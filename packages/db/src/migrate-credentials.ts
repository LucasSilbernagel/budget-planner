/**
 * Migration connection credentials (Story 5.17 AC-4; hardened by Story 5.18 AC-4).
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
 * ⚠️ 2026-09-15, Story 5.18: the hostname-check waiver is GONE. It existed only
 * because 5.17's migration ran over the public `.danubedata.ro` endpoint, which
 * is a TCP passthrough absent from the in-cluster-only certificate — so
 * `verify-full` could not succeed there. Migrations now run INSIDE the cluster,
 * where the host we dial is the name on the certificate, so full verification
 * works with nothing given up. `migrate-tls.ts` and
 * `DATABASE_TLS_ALLOW_HOSTNAME_MISMATCH` were deleted rather than left switched
 * off: a downgrade that outlives the path it was granted for is how a
 * time-boxed exception becomes permanent.
 *
 * This runs at drizzle-kit startup, so it THROWS rather than returning an error
 * shape: a refusal must stop the migration, not be swallowed by a config file.
 */

import {
  buildDbSsl,
  decodeUrlField,
  isEuSovereignDbHost,
  isInClusterDbHost,
  isRelaxedDbEnv,
} from './client'

/** The pg SSL option for a migrating connection. Identical to the app pool's. */
export type MigrationDbSsl = ReturnType<typeof buildDbSsl>

export interface MigrationCredentials {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: MigrationDbSsl
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
  if (!isRelaxedDbEnv(nodeEnv)) {
    if (!isEuSovereignDbHost(host)) {
      throw new Error(
        `Refusing to migrate: "${host}" is not a DanubeData (Germany - EU) host, required for CLOUD Act immunity (NFR1, NFR2). Expected the internal writer name or a *.danubedata.ro host.`
      )
    }

    // Story 5.18, AC-1/AC-4. Stricter than the pool's rule on purpose: the
    // migration must run from INSIDE the cluster, over internal DNS, so there is
    // no public path to the production database at any point in a release. A
    // `.danubedata.ro` URL here means someone reopened the DNS window the ADR-001
    // exception retired — which is exactly the regression worth failing on, and
    // it is enforced in code rather than left to the pipeline to remember.
    if (!isInClusterDbHost(host)) {
      throw new Error(
        `Refusing to migrate over the public endpoint "${host}". Migrations run in-cluster only, over internal DNS (ADR-001; the time-boxed public-DNS exception was retired by Story 5.18). Expected budget-planner-prod-rw[.budgetplanner795.svc.cluster.local].`
      )
    }
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
    // verify-full, with no override available: `buildDbSsl` is the SAME function
    // the application pool uses, and nothing here can weaken what it returns.
    ssl: buildDbSsl(nodeEnv, caCert),
  }
}
