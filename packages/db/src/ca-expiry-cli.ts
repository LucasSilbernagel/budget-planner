// Exits non-zero when expiring, expired or missing: a warning that doesn't fail a job goes unread.
// No network I/O, so it is safe to run on every deploy.

import process from 'node:process'
import { normalizeCaCert } from './ca-cert'
import { assessCaExpiry, formatCaExpiry } from './ca-expiry'

const DEFAULT_WARN_DAYS = 21

function main(): number {
  const raw = process.env['CA_EXPIRY_WARN_DAYS']
  // Strict: `Number.parseInt('21days', 10)` is 21, the silent guess the error promises not to make.
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
