/**
 * Live database smoke check — preconditions (Story 4.17, AC-5).
 *
 * The smoke itself is a `SELECT 1` over TLS against the provisioned instance
 * (see `db-smoke-cli.ts`). This module holds the part that can be decided and
 * tested without a database: whether a smoke run is permitted at all.
 *
 * It deliberately reuses the application's own policy — `isRelaxedDbEnv`,
 * `isEuSovereignDbHost` and `buildDbSsl` from `./client` — so the smoke can
 * never succeed against a host or a TLS posture that `getPool()` would refuse.
 * A smoke check that connects over an unverified or non-sovereign path and
 * reports "OK" is worse than no smoke check at all.
 */

import { buildDbSsl, isEuSovereignDbHost, isRelaxedDbEnv } from './client'

export type SmokePreconditions =
  | { ok: true; host: string; ssl: ReturnType<typeof buildDbSsl> }
  | { ok: false; reason: string }

/**
 * Decide whether a live smoke run may proceed, and with what connection posture.
 *
 * Returns the resolved host and SSL option on success so the caller connects
 * with exactly what was validated, rather than re-deriving it.
 */
export function assessSmokePreconditions(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
  caCert: string | undefined
): SmokePreconditions {
  if (!databaseUrl) {
    return {
      ok: false,
      reason:
        'DATABASE_URL is not set. Run this against the provisioned instance; a smoke check with nothing to connect to proves nothing.',
    }
  }

  let host: string
  try {
    host = new URL(databaseUrl).hostname.toLowerCase()
  } catch {
    return { ok: false, reason: 'DATABASE_URL is not a parseable URL.' }
  }

  // Same fail-closed rule as the application pool: only an explicit
  // development/test NODE_ENV may point at a non-DanubeData host.
  if (!isRelaxedDbEnv(nodeEnv) && !isEuSovereignDbHost(host)) {
    return {
      ok: false,
      reason: `"${host}" is not a DanubeData EU host (NFR1/NFR2, CLOUD Act immunity). Expected the internal writer name or a *.danubedata.ro host.`,
    }
  }

  return { ok: true, host, ssl: buildDbSsl(nodeEnv, caCert) }
}
