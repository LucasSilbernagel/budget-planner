/** Every header here is client-supplied: defence in depth only, never access control. */

import { logger } from '@/lib/logger'
import { createIntervalGate, passIfDue } from './interval-gate'

/**
 * Default 0 reads the rightmost XFF hop, appended by our proxy and so not forgeable by
 * prepending. Raise only if the edge appends N hops of its own.
 */
function trustedProxyHops(): number {
  const raw = Number.parseInt(process.env['RATE_LIMIT_TRUSTED_PROXY_HOPS'] ?? '', 10)
  return Number.isInteger(raw) && raw >= 0 ? raw : 0
}

const MAX_IP_LENGTH = 64

/** The condition is attacker-triggerable, so the `info` log is gated against amplification. */
const NO_CLIENT_IP_LOG_INTERVAL_MS = 15 * 60 * 1000

const noClientIpLogGate = createIntervalGate()

export function __resetNoClientIpLogGateForTests(): void {
  noClientIpLogGate.lastPassedAt = 0
}

/**
 * No x-real-ip fallback: it would only be reached when XFF is absent, i.e. when it is caller-typed.
 * Returns null so the caller skips IP limiting rather than sharing one global bucket.
 */
export function clientIpForRateLimit(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  const hops = xff
    ? xff
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean)
    : []

  if (hops.length > 0) {
    const idx = hops.length - 1 - trustedProxyHops()
    const clientHop = idx >= 0 ? hops[idx] : undefined
    if (clientHop && clientHop.length <= MAX_IP_LENGTH) {
      return clientHop
    }
  }

  // `info`, not `debug` (dropped in production): this log shows whether the edge
  // sends XFF at all.
  if (passIfDue(noClientIpLogGate, NO_CLIENT_IP_LOG_INTERVAL_MS, Date.now())) {
    logger.info('[RateLimit] no trustworthy client IP; IP limiting skipped', {
      // Distinct states: an edge sending an EMPTY XFF must not read as no XFF.
      reason:
        hops.length > 0
          ? 'xff-present-no-trusted-hop'
          : xff === null
            ? 'no-xff-header'
            : 'xff-header-empty',
      hopCount: hops.length,
      trustedProxyHops: trustedProxyHops(),
    })
  }
  return null
}
