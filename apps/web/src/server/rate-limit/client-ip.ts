/**
 * Best-effort client-IP derivation for pre-auth rate limiting.
 *
 * SECURITY: every candidate header here is client-supplied, so this is
 * defense-in-depth ONLY — real access control is the signed session +
 * DB-authoritative subscription, never this.
 *
 * `x-forwarded-for` is the ONLY source. Story sec-3 deleted an `x-real-ip`
 * fallback that was returned after nothing but a length check; see
 * `clientIpForRateLimit` for why that fallback could only ever be reached by an
 * attacker.
 *
 * Extracted from `routes/api/auth/paddle/callback.ts` (Story 5-3): the shared
 * helper outlived the Paddle OAuth callback it was born in and is depended on by
 * the magic-link login routes (`routes/api/auth/login/{request,verify}.ts`), so
 * it lives in a neutral module now.
 */

import { logger } from '@/lib/logger'
import { createIntervalGate, passIfDue } from './interval-gate'

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
 * How often one instance may log the "no trustworthy client IP" condition.
 *
 * The condition is attacker-triggerable (just omit the header), so an ungated
 * log is a log-amplification vector. Gating it lets the level be `info`, which
 * is what makes it visible in production at all — see `interval-gate.ts`.
 */
const NO_CLIENT_IP_LOG_INTERVAL_MS = 15 * 60 * 1000

const noClientIpLogGate = createIntervalGate()

/** Test seam: reset the log gate so cases cannot leak state into each other. */
export function __resetNoClientIpLogGateForTests(): void {
  noClientIpLogGate.lastPassedAt = 0
}

/**
 * Best-effort client IP for pre-auth rate limiting.
 *
 * We read the hop `trustedProxyHops()` positions in from the RIGHT (default 0 =
 * rightmost, the value our upstream proxy appends). Indexing from the right means
 * a client PREPENDING forged entries cannot shift which hop we read — the
 * forgeries land further left and are ignored. An implausibly long value (not an
 * IP) is rejected so it can't become a giant rate-limit key / oversized index
 * entry.
 *
 * ⚠️ There is deliberately NO `x-real-ip` fallback (Story sec-3). The reasoning:
 * IF the edge appends to `x-forwarded-for` — the common proxy behaviour — then
 * any request reaching us through it arrives with a usable XFF hop and returns
 * above, so a fallback below is reachable ONLY when XFF is absent, which is
 * precisely the case where `x-real-ip` is whatever the caller typed. Its only
 * reachable use would then be the abusive one: forge it for a fresh window, or
 * set it to a victim's address to burn theirs.
 *
 * ⚠️ THAT PREMISE IS NOT VERIFIED FOR THIS DEPLOYMENT, and it would be
 * dishonest to state it as fact here: nothing in `DEPLOY-RAPIDS.md` or
 * `DEPLOY_RUNBOOK.md` records what the Rapids edge sends (0 hits for
 * `x-real-ip` / `x-forwarded` / `hop`). If the edge is nginx-style
 * (`X-Real-IP` set, XFF not), or `RATE_LIMIT_TRUSTED_PROXY_HOPS` is configured
 * at or above the real hop count, then EVERY request now yields `null` and IP
 * limiting is off: `request.ts` keeps only its per-email key (which an attacker
 * rotating addresses defeats) and `verify.ts` has no second key at all. The
 * log below is the signal for exactly that, and it is the reason this decision
 * is revisitable rather than settled.
 *
 * Returns null when no trustworthy proxy IP is present so the caller SKIPS
 * limiting rather than collapsing every header-less request into one shared
 * bucket (which would globally lock out logins).
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

  // No trustworthy hop: the caller still applies any other key (e.g. email) and
  // skips IP limiting. Logged at `info` because the whole point is to answer,
  // from production, a question no document in this repo records — whether the
  // Rapids edge sends X-Forwarded-For at all. `debug` would be dropped in
  // production (`lib/logger.ts:157`) and tell us nothing. Gated so a flood of
  // header-less requests cannot turn this into log amplification.
  if (passIfDue(noClientIpLogGate, NO_CLIENT_IP_LOG_INTERVAL_MS, Date.now())) {
    logger.info('[RateLimit] no trustworthy client IP; IP limiting skipped', {
      // The diagnostic that settles the topology question: a steady
      // `no-usable-xff` means the edge does not append XFF.
      // Three distinct states, because conflating them would blunt the very
      // diagnostic this log exists to provide: an edge that sets an EMPTY XFF
      // must not read as "the edge does not send XFF".
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
