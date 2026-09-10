/**
 * CA-expiry check runner (Story 4.16 follow-up, 2026-09-08).
 *
 *   DATABASE_CA_CERT="$(cat ca.pem)" pnpm --filter @budget-planner/db db:ca-expiry
 *
 * Exit codes: 0 valid and outside the warning window, 1 expiring soon / expired
 * / missing. Non-zero is deliberate — a warning that does not fail a job is a
 * warning nobody reads.
 *
 * Threshold is `CA_EXPIRY_WARN_DAYS` (default 21): long enough to cover a
 * holiday or a busy fortnight, short enough not to nag for a whole quarter.
 *
 * Does NO network I/O and needs no database, which is what makes it safe to run
 * on every deploy and on a schedule without opening the database's public DNS.
 */

import process from 'node:process'
import { normalizeCaCert } from './ca-cert'
import { assessCaExpiry, formatCaExpiry } from './ca-expiry'

const DEFAULT_WARN_DAYS = 21

function main(): number {
  const raw = process.env['CA_EXPIRY_WARN_DAYS']
  // Strict: `Number.parseInt('21days', 10)` is 21, which is exactly the silent
  // guess the error message below promises not to make. Require a pure integer.
  const parsed = raw === undefined ? DEFAULT_WARN_DAYS : Number(raw.trim())
  if (raw !== undefined && (raw.trim() === '' || !Number.isInteger(parsed) || parsed < 0)) {
    console.error(
      `[ca-expiry] CA_EXPIRY_WARN_DAYS must be a non-negative integer; got "${raw}". Refusing to guess.`
    )
    return 1
  }

  const result = assessCaExpiry(
    normalizeCaCert(process.env['DATABASE_CA_CERT']),
    new Date(),
    parsed
  )
  const message = formatCaExpiry(result)

  if (result.status === 'ok') {
    console.log(`[ca-expiry] ${message}`)
    return 0
  }
  console.error(`[ca-expiry] ${message}`)
  return 1
}

process.exit(main())
