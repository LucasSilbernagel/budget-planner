/**
 * Early warning for `DATABASE_CA_CERT` expiry (Story 4.16 follow-up, 2026-09-08).
 *
 * The DanubeData PostgreSQL instance presents a **self-signed** chain issued by
 * a per-cluster CA, measured 2026-09-08 with a **90-day** validity window (CA
 * and server certificate share one window, both expiring 2026-12-04).
 * CloudNativePG renews its own certificates; what does NOT renew is the copy
 * pinned in the `DATABASE_CA_CERT` secret. When that copy lapses, the
 * application's pool — which enforces `rejectUnauthorized: true` — stops
 * connecting to its database, with no code change and no deploy to blame.
 *
 * This module converts that from a silent outage on a calendar date into a loud
 * failure weeks earlier. It deliberately does **no** network I/O and needs no
 * database: it reads the certificate the deployment has already been given and
 * asks only when it expires. That is what makes it safe to run on every deploy
 * and on a schedule, without opening the database's public DNS.
 *
 * It does not renew anything. Renewal is a manual fetch (see `formatCaExpiry`),
 * and the honest framing is that this buys warning, not automation.
 */

import { X509Certificate } from 'node:crypto'

export type CaExpiryStatus = 'ok' | 'warn' | 'expired' | 'invalid'

export interface CaExpiryResult {
  status: CaExpiryStatus
  /** Whole days until expiry; negative once expired. Absent when unparseable. */
  daysRemaining?: number
  /** `notAfter`, ISO-8601. Absent when unparseable. */
  notAfter?: string
  subject?: string
}

const MS_PER_DAY = 86_400_000

/**
 * Classify a PEM certificate against a warning threshold.
 *
 * `now` and `warnWithinDays` are parameters rather than ambient values so the
 * behaviour is testable at any point in a certificate's life — a check about
 * time that reads the clock internally can only ever be tested at one instant.
 *
 * Absent or unparseable input is `invalid`, never `ok`: an unset secret and a
 * healthy certificate must not produce the same verdict.
 */
export function assessCaExpiry(
  pem: string | undefined,
  now: Date,
  warnWithinDays: number
): CaExpiryResult {
  if (!pem || pem.trim() === '') {
    return { status: 'invalid' }
  }

  // `new X509Certificate(pem)` parses only the FIRST block. If an operator pastes
  // a full chain (leaf + intermediate + CA) into DATABASE_CA_CERT, checking only
  // block #1 would report on the auto-renewing CloudNativePG leaf while the
  // pinned CA quietly lapses — the exact outage this module exists to prevent.
  // Assess every certificate and report on the one that expires SOONEST.
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
  const pemBlocks = blocks && blocks.length > 0 ? blocks : [pem]

  let cert: X509Certificate | undefined
  let notAfter: Date | undefined
  for (const block of pemBlocks) {
    let parsed: X509Certificate
    try {
      parsed = new X509Certificate(block)
    } catch {
      return { status: 'invalid' }
    }
    const blockNotAfter = new Date(parsed.validTo)
    if (Number.isNaN(blockNotAfter.getTime())) {
      return { status: 'invalid' }
    }
    if (!notAfter || blockNotAfter.getTime() < notAfter.getTime()) {
      cert = parsed
      notAfter = blockNotAfter
    }
  }

  if (!cert || !notAfter) {
    return { status: 'invalid' }
  }

  // Truncated toward zero: "0 days remaining" means it lapses within the day,
  // which should read as urgent rather than as one more day of headroom.
  const daysRemaining = Math.trunc((notAfter.getTime() - now.getTime()) / MS_PER_DAY)
  const base = {
    daysRemaining,
    notAfter: notAfter.toISOString(),
    subject: cert.subject,
  }

  if (notAfter.getTime() <= now.getTime()) {
    return { status: 'expired', ...base }
  }
  if (daysRemaining <= warnWithinDays) {
    return { status: 'warn', ...base }
  }
  return { status: 'ok', ...base }
}

/**
 * Render a result as the message a human will actually act on.
 *
 * Carries the remedy inline. A warning that says only "expires soon" sends
 * whoever reads it hunting through runbooks at precisely the wrong moment, and
 * this one may fire months after anyone last thought about certificates.
 */
export function formatCaExpiry(result: CaExpiryResult): string {
  const remedy = [
    'To renew:',
    '  1. DanubeData console → database budget-planner-prod → turn public DNS ON.',
    '  2. openssl s_client -4 -starttls postgres -showcerts \\',
    '       -connect postgresql-budget-planner-prod.budgetplanner795.danubedata.ro:<port>',
    '     (read <port> from `danube db ls`; it changes on re-provisioning)',
    '  3. Take the SECOND certificate in the chain — the self-signed one whose',
    '     subject equals its issuer — and store it as the DATABASE_CA_CERT secret',
    '     in GitHub and as the container env var in Rapids. Rapids env inputs are',
    '     single-line: base64-encode the PEM first (`base64 -w0 ca.pem`) and paste',
    '     that; normalizeCaCert() decodes it back at read time.',
    '  4. Turn public DNS back OFF.',
    'Background: .github/DEPLOY_RUNBOOK.md and docs/production-database-runbook.md.',
  ].join('\n')

  if (result.status === 'invalid') {
    return [
      'DATABASE_CA_CERT is missing or is not a parseable PEM certificate.',
      'The application pool enforces TLS verification, so it cannot reach the',
      'database without this. Checked without any network access, so this is a',
      'configuration problem, not a connectivity one.',
      '',
      remedy,
    ].join('\n')
  }

  const day = (result.notAfter ?? '').slice(0, 10)
  if (result.status === 'expired') {
    return [
      `DATABASE_CA_CERT EXPIRED on ${day} (${Math.abs(result.daysRemaining ?? 0)} days ago).`,
      'The application cannot establish a verified TLS connection to the database.',
      '',
      remedy,
    ].join('\n')
  }
  if (result.status === 'warn') {
    return [
      `DATABASE_CA_CERT expires on ${day} — ${result.daysRemaining} days away.`,
      'Everything still works right now. Renew before that date to avoid an outage',
      'that will look like a database failure rather than a certificate one.',
      '',
      remedy,
    ].join('\n')
  }
  return `DATABASE_CA_CERT is valid until ${day} (${result.daysRemaining} days).`
}
