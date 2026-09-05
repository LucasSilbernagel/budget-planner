/**
 * TLS policy for the MIGRATION connection only (Story 5.17, option (e), 2026-09-04).
 *
 * ⚠️ THIS MODULE CONTAINS A DELIBERATE, NARROWLY SCOPED TLS DOWNGRADE.
 * ⚠️ IT IS FOR THE WINDOWED MIGRATION PATH. DO NOT IMPORT IT FROM APPLICATION CODE.
 *
 * Why it exists: DanubeData issues the database certificate for IN-CLUSTER names
 * only. The SANs are `budget-planner-prod-rw[.budgetplanner795[.svc[.cluster.local]]]`
 * plus the `-r`/`-ro` variants — the public hostname that `danube db dns enable`
 * exposes (`postgresql-budget-planner-prod.budgetplanner795.danubedata.ro`) is a TCP
 * passthrough with no certificate of its own. So `verify-full` TLS cannot succeed
 * over the public endpoint at all, and the initial migration has to run over it
 * because Rapids offers no run-to-completion primitive to migrate from inside the
 * cluster (ADR-001 time-boxed exception).
 *
 * What is given up, precisely: the assurance that the peer's certificate names the
 * host we dialled. What is KEPT: chain validation against the cluster's private CA
 * (`rejectUnauthorized: true` + `ca`). Since that CA signs only this cluster's
 * certificates, a peer presenting a valid cert is still provably that cluster's
 * PostgreSQL. The residual exposure is another host inside the same cluster
 * impersonating the writer — which requires already being inside the cluster.
 *
 * This is `verify-ca`, not `sslmode=require` and emphatically not "TLS off".
 *
 * When this goes away: the ADR-001 exception's exit criteria — an in-cluster
 * migration runner, where the hostname matches the certificate and full
 * verification works with no downgrade at all (Story 5.6).
 */

import { buildDbSsl } from './client'

/** The pg SSL option, plus the hostname-check override this module may attach. */
export type MigrationDbSsl =
  | false
  | {
      rejectUnauthorized: true
      ca?: string
      checkServerIdentity?: (host: string, cert: unknown) => Error | undefined
    }

/**
 * Build the migration connection's SSL option.
 *
 * @param allowHostnameMismatch Opt-in, and opt-in only. Defaults off everywhere;
 * the deploy workflow sets it for the two steps that run inside the DNS window.
 */
export function buildMigrationDbSsl(
  nodeEnv: string | undefined,
  caCert: string | undefined,
  allowHostnameMismatch: boolean
): MigrationDbSsl {
  const ssl = buildDbSsl(nodeEnv, caCert)

  // Relaxed environments (development/test) have no TLS to downgrade.
  if (ssl === false) {
    return false
  }

  if (!allowHostnameMismatch) {
    return ssl
  }

  // Fail closed on the one combination that would leave nothing verified. Waiving
  // the hostname check is only defensible because a PRIVATE CA still proves which
  // cluster answered; without that CA this would degrade to trusting any peer.
  if (!caCert) {
    throw new Error(
      'Refusing to waive the TLS hostname check without DATABASE_CA_CERT. The waiver is only safe because the cluster CA still validates the peer; with no CA, nothing would be verified.'
    )
  }

  return {
    ...ssl,
    // Returning undefined means "identity accepted". Deliberately a total no-op
    // rather than a partial check, which would imply a guarantee not being made.
    checkServerIdentity: () => undefined,
  }
}

/**
 * Read the opt-in from the environment.
 *
 * Anything other than the exact string `true` is off, so a stray or empty value
 * cannot quietly weaken the connection.
 */
export function hostnameMismatchAllowedFromEnv(env: NodeJS.ProcessEnv): boolean {
  return env['DATABASE_TLS_ALLOW_HOSTNAME_MISMATCH'] === 'true'
}
