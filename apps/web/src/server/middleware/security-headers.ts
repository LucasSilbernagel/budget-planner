/**
 * Security response headers (Story 5.8 — AC group D / AC-14; extended by sec-1)
 *
 * Pure header-application logic, deliberately free of any TanStack Start import
 * so it is trivially unit-testable. The Start global request middleware that
 * invokes it is wired in `src/start.ts`, which also generates the per-request
 * CSP nonce and derives the forwarded scheme.
 *
 * These headers previously lived in the dead `tanstack.config.ts`
 * `server.middleware` block, which used a non-existent `@tanstack/start/config`
 * API and never executed (removed by Story 5-10). This restores them as real,
 * executed response headers.
 *
 * Story sec-1 adds the four headers the posture review flagged as missing:
 * Content-Security-Policy (the primary XSS defense-in-depth for the plaintext
 * `localStorage` financial data), Strict-Transport-Security (TLS-strip
 * protection, gated on confirmed HTTPS), Referrer-Policy, and Permissions-Policy.
 */

import { createHash } from 'node:crypto'
import { NO_FLASH_THEME_SCRIPT } from '../../lib/theme/no-flash-theme-script'

/**
 * sha256 of the exact inline no-flash theme script rendered at
 * `routes/__root.tsx` (a static, self-authored bootstrap). Derived from the
 * imported constant — the single source of truth — so it can never silently
 * drift out of sync with the script it authorizes (a drifted hash = blocked
 * bootstrap = theme flash). Pinned by a test (story sec-1, AC-5).
 *
 * The theme script is authorized in the CSP by this HASH (not the per-request
 * nonce) so `routes/__root.tsx` stays untouched and the drift guard keeps
 * working. TanStack Start's OWN inline scripts (stream barrier, scroll
 * restoration) are authorized by the per-request nonce instead — their content
 * is dynamic and cannot be hashed. Hash- and nonce-sources coexist in
 * `script-src`; an inline script is allowed if it matches EITHER, while an
 * injected XSS script matches neither.
 */
export const THEME_SCRIPT_CSP_HASH = `sha256-${createHash('sha256')
  .update(NO_FLASH_THEME_SCRIPT, 'utf8')
  .digest('base64')}`

/**
 * Build the app's Content-Security-Policy for one request, injecting that
 * request's script nonce. Built from the app's ACTUAL external sub-resource
 * graph (story sec-1 Dev Notes §CSP source-of-truth) — every allowed origin
 * traces to a real loader; nothing else is permitted:
 *
 * - `script-src`   'self' + the per-request `'nonce-…'` (TanStack Start's inline
 *                  runtime scripts) + the inline theme script (by hash) + Paddle.js
 *                  CDN (`cdn.paddle.com`), counter.dev analytics (`cdn.counter.dev`),
 *                  EthicalAds (`media.ethicalads.io`). No `'unsafe-inline'`.
 * - `style-src`    'self' 'unsafe-inline' — React inline `style=` attributes and
 *                  Recharts-injected attribute styles are NOT coverable by a hash
 *                  or nonce (those apply to <style>/<script> elements, not element
 *                  style attributes), so `'unsafe-inline'` is accepted for STYLES
 *                  ONLY. Scripts stay strict.
 * - `connect-src`  same-origin `/api/*`, Formspark contact POST
 *                  (`submit-form.com`), counter.dev beacon, EthicalAds
 *                  impressions, Paddle checkout.
 * - `frame-src`/`child-src`  Paddle checkout overlay + EthicalAds iframes.
 * - `worker-src`   'self' — the PWA service worker (`sw.js`, story 7-1) is
 *                  same-origin. This MUST be explicit: `worker-src` falls back to
 *                  `child-src` (not `default-src`), and `child-src` is set for
 *                  Paddle/ad frames and does NOT include 'self', so without this
 *                  the service worker registration is blocked.
 * - `manifest-src` 'self' — the self-hosted `/manifest.webmanifest` (story 7-1).
 * - `img-src`      app/data-URI images + ad images.
 * - `font-src`     self-hosted / data-URI fonts.
 * - `frame-ancestors 'none'`  modern clickjacking defense (kept alongside the
 *                  legacy `X-Frame-Options: DENY` for old UAs). Governs US being
 *                  framed; it does NOT affect us framing Paddle (that's `frame-src`).
 * - `base-uri`/`form-action`/`object-src`  lock the base tag, form posts, and plugins.
 *
 * Server-side-only Paddle hosts (`api.paddle.com`, `vendors.paddle.com`) are
 * called from server routes, never the browser — intentionally NOT listed.
 */
export function buildContentSecurityPolicy(nonce: string): string {
  // Defensive: the nonce is interpolated raw into the header, so a value
  // containing `'` or `;` could break out of the `'nonce-…'` source expression
  // and inject/override directives. Today the only caller passes a base64 nonce
  // from `generateCspNonce()` (can't contain those), but this exported function
  // guards its own contract so a future/refactored caller can't create a hole.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) {
    throw new Error('buildContentSecurityPolicy: nonce must be a non-empty base64 token')
  }
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' '${THEME_SCRIPT_CSP_HASH}' https://cdn.paddle.com https://cdn.counter.dev https://media.ethicalads.io`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https://*.ethicalads.io`,
    `font-src 'self' data:`,
    `connect-src 'self' https://submit-form.com https://counter.dev https://*.ethicalads.io https://*.paddle.com`,
    'frame-src https://*.paddle.com https://*.ethicalads.io',
    'child-src https://*.paddle.com https://*.ethicalads.io',
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
  ].join('; ')
}

/**
 * Deny-by-default Permissions-Policy for browser features the app does not use.
 *
 * `payment=()` disables the Payment Request API. Paddle Checkout renders in its
 * own `*.paddle.com` iframe and does not need the top document's Payment Request
 * permission for card entry. NOTE (story sec-1): Paddle billing is not yet live
 * (stub — story 5-3); when it is, verify a real checkout (esp. Apple/Google Pay,
 * which CAN use the Payment Request API) still works under `payment=()` before
 * production. If it breaks, relax to `payment=(self "https://checkout.paddle.com")`.
 */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=()'

/** Referrer-Policy: send only the origin cross-site; don't leak app URLs/paths. */
export const REFERRER_POLICY = 'strict-origin-when-cross-origin'

/**
 * Strict-Transport-Security value. One year, subdomains included. `preload` is
 * intentionally OMITTED (Lucas's decision, story sec-1): submitting to the HSTS
 * preload list is a near-irreversible HTTPS-only commitment for the domain and
 * all subdomains. Add `preload` + submit to hstspreload.org only once that is a
 * deliberate, permanent choice.
 */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains'

/**
 * Whether the request reached the app over confirmed HTTPS, derived from the
 * edge's `x-forwarded-proto`. Takes the first hop of a possibly comma-joined
 * value (mirrors `node-adapter.mjs`'s `firstForwardedValue`) and compares
 * **case-insensitively** — URI schemes are case-insensitive (RFC 3986), so a
 * proxy emitting `HTTPS`/`Https` must not silently disable HSTS. Pure +
 * framework-free so it is unit-tested directly (the parsing `start.ts` does
 * inline would otherwise be untested).
 */
export function isConfirmedHttps(forwardedProto: string | null | undefined): boolean {
  return forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https'
}

/** Options controlling the conditional/per-request headers. */
export interface SecurityHeaderOptions {
  /**
   * Development mode. When true, sets a permissive dev-only CORS header to ease
   * local cross-origin tooling, and suppresses HSTS (dev is plain HTTP).
   */
  isDev: boolean
  /**
   * Whether the request reached the app over confirmed HTTPS (derived from
   * `x-forwarded-proto === 'https'` at the Rapids/Knative TLS edge; the
   * container itself speaks plain HTTP). HSTS is emitted ONLY when this is true
   * — never assert HSTS over a connection we can't confirm is TLS.
   */
  isHttps: boolean
  /**
   * The per-request CSP nonce — the SAME value stamped on TanStack Start's
   * inline scripts via `router.options.ssr.nonce` (see `server/csp-nonce.ts`).
   * Injected into the CSP `script-src` so those scripts are authorized.
   */
  nonce: string
}

/**
 * Apply the baseline + hardening security headers to a response's `Headers`.
 *
 * @param headers - The response headers to mutate in place.
 * @param options - `isDev` (dev-only CORS + no HSTS), `isHttps` (HSTS gate), and
 *   the per-request `nonce` (CSP `script-src`).
 */
export function applySecurityHeaders(headers: Headers, options: SecurityHeaderOptions): void {
  const { isDev, isHttps, nonce } = options

  // Prevent MIME-type sniffing.
  headers.set('X-Content-Type-Options', 'nosniff')
  // Disallow framing (clickjacking protection). Legacy signal kept alongside the
  // CSP `frame-ancestors 'none'` below for user agents that ignore CSP.
  headers.set('X-Frame-Options', 'DENY')
  // Legacy XSS filter signal (kept to match the original security baseline).
  headers.set('X-XSS-Protection', '1; mode=block')

  // Primary XSS defense-in-depth: a strict CSP built from the app's real
  // sub-resource graph, with this request's nonce authorizing the framework's
  // inline scripts. Enforced per-document, so the SSR HTML response carrying
  // this header governs all of that document's sub-resource loads.
  headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce))
  headers.set('Referrer-Policy', REFERRER_POLICY)
  headers.set('Permissions-Policy', PERMISSIONS_POLICY)

  // HSTS only over confirmed HTTPS and never in dev — asserting it over a
  // connection we can't confirm is TLS can lock users out (story sec-1 Dev Notes).
  if (isHttps && !isDev) {
    headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY)
  }

  if (isDev) {
    headers.set('Access-Control-Allow-Origin', '*')
  }
}

/**
 * The request-middleware body: run the downstream chain, then apply the security
 * headers to the produced response. Generic over the framework's result shape
 * (anything with a `response: Response`) so it stays decoupled from — and
 * directly unit-testable without — the TanStack Start runtime. `src/start.ts`
 * wires this into a real `createMiddleware({ type: 'request' })` and supplies
 * `isHttps` + the per-request `nonce`.
 */
export async function applyHeadersToNextResult<R extends { response: Response }>(
  next: () => R | Promise<R>,
  options: SecurityHeaderOptions
): Promise<R> {
  const result = await next()
  applySecurityHeaders(result.response.headers, options)
  return result
}
