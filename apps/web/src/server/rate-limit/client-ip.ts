/**
 * Best-effort client-IP derivation for pre-auth rate limiting.
 *
 * SECURITY: `x-forwarded-for` is client-supplied, so this is defense-in-depth
 * ONLY — real access control is the signed session + DB-authoritative
 * subscription, never this.
 *
 * Extracted from `routes/api/auth/paddle/callback.ts` (Story 5-3): the shared
 * helper outlived the Paddle OAuth callback it was born in and is depended on by
 * the magic-link login routes (`routes/api/auth/login/{request,verify}.ts`), so
 * it lives in a neutral module now. Behaviour is byte-for-byte the pre-move
 * version (Stories 5-8 / SEC-2).
 */

import { logger } from '@/lib/logger'

/**
 * Number of trusted proxy hops the platform edge appends to the RIGHT of
 * X-Forwarded-For.
 *
 * DEFAULT 0 = trust the rightmost hop — the entry our immediately-upstream proxy
 * appends, which under this app's single-append-proxy topology is the real peer
 * IP. Because the proxy appends AFTER any client-supplied entries, a client that
 * prepends forged hops cannot control the rightmost value. Set
 * `RATE_LIMIT_TRUSTED_PROXY_HOPS` to N>0 only if the edge is known to append N of
 * its OWN hops on the right (e.g. a Knative internal chain), so the real client
 * IP is read N entries in from the right. The exact count is platform-specific —
 * confirm against Rapids before overriding (pairs with 5-2).
 */
export function trustedProxyHops(): number {
  const raw = Number.parseInt(process.env['RATE_LIMIT_TRUSTED_PROXY_HOPS'] ?? '', 10)
  return Number.isInteger(raw) && raw >= 0 ? raw : 0
}

/** Max plausible length of an IP literal (IPv6 + zone-id headroom). */
export const MAX_IP_LENGTH = 64

/**
 * Best-effort client IP for pre-auth rate limiting.
 *
 * We read the hop `trustedProxyHops()` positions in from the RIGHT (default 0 =
 * rightmost, the value our upstream proxy appends). Indexing from the right means
 * a client PREPENDING forged entries cannot shift which hop we read — the
 * forgeries land further left and are ignored. An implausibly long value (not an
 * IP) is rejected so it can't become a giant rate-limit key / oversized index
 * entry. When no trustworthy hop can be derived we fall through (→ x-real-ip,
 * else null) rather than trust a forgeable value.
 *
 * Returns null when no trustworthy proxy IP is present so the caller SKIPS
 * limiting rather than collapsing every header-less request into one shared
 * bucket (which would globally lock out logins).
 */
export function clientIpForRateLimit(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean)
    const idx = hops.length - 1 - trustedProxyHops()
    const clientHop = idx >= 0 ? hops[idx] : undefined
    if (clientHop && clientHop.length <= MAX_IP_LENGTH) {
      return clientHop
    }
    if (hops.length > 0) {
      // XFF present but yielded no trustworthy hop (too short for the configured
      // trusted-hop count, or an implausibly long value). Observe rather than
      // silently disabling limiting; debug level so a flood of forged headers
      // can't itself become a log-amplification vector. Falls through so the
      // caller still applies any other key (e.g. email) and skips IP limiting.
      logger.debug('[RateLimit] x-forwarded-for present but no trusted client hop', {
        hopCount: hops.length,
      })
    }
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  return realIp && realIp.length <= MAX_IP_LENGTH ? realIp : null
}
