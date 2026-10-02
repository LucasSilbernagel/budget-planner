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
import { getPaddleConfig } from '@budget-planner/config'
import { NO_FLASH_PLANNER_SCRIPT } from '../../lib/nav/no-flash-planner-visibility-script'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../../lib/overview/no-flash-account-notice-script'

/**
 * sha256 of the exact inline no-flash planner-visibility script rendered at
 * `routes/__root.tsx` (story 35.2). Derived from the imported constant — the
 * single source of truth — so it cannot drift out of sync with the script it
 * authorizes (a drifted hash = blocked bootstrap = the Retirement entry flashes
 * in before React removes it). Pinned by a test.
 *
 * The bootstraps are authorized in the CSP by HASH (not the per-request nonce)
 * so `routes/__root.tsx` stays untouched and the drift guards keep working.
 * TanStack Start's OWN inline scripts (stream barrier, scroll restoration) are
 * authorized by the per-request nonce instead — their content is dynamic and
 * cannot be hashed. Hash- and nonce-sources coexist in `script-src`; an inline
 * script is allowed if it matches EITHER, while an injected XSS script matches
 * neither.
 *
 * ⚠️ There used to be a THEME_SCRIPT_CSP_HASH here as well, the first of these
 * (story sec-1, AC-5). Story 61.1 deleted the theme bootstrap, so its hash went
 * with it — `script-src` now carries TWO static hashes, not three. A hash left
 * behind for a script that no longer ships is not a test failure; it is a silent
 * stale allowance, which is why `__tests__/security-headers.test.ts` asserts its
 * ABSENCE rather than merely not asserting its presence.
 */
export const PLANNER_SCRIPT_CSP_HASH = `sha256-${createHash('sha256')
  .update(NO_FLASH_PLANNER_SCRIPT, 'utf8')
  .digest('base64')}`

/**
 * sha256 of the exact inline no-flash account-notice script rendered at
 * `routes/__root.tsx` (story 55.1, AC-4). Same discipline as the two hashes
 * above: derived from the imported constant so it cannot drift out of sync with
 * the script it authorizes (a drifted hash = blocked bootstrap = the dismissed
 * "No account needed" box flashes in before React removes it). Pinned by a test.
 *
 * ⚠️ This is the SECOND static hash, and it belongs in `script-src` ONLY. Do not
 * "help" by adding a `script-src-elem` directive: none is emitted today, that
 * directive OVERRIDES `script-src` for every script element, and the
 * "closes the DIRECTIVE SET" test in `__tests__/security-headers.test.ts`
 * exists to fail its introduction (story 39.2).
 */
export const ACCOUNT_NOTICE_SCRIPT_CSP_HASH = `sha256-${createHash('sha256')
  .update(NO_FLASH_ACCOUNT_NOTICE_SCRIPT, 'utf8')
  .digest('base64')}`

/** Which Paddle environment the CSP authorizes stylesheets for (story 89.1). */
export type PaddleCspEnvironment = 'sandbox' | 'production'

/**
 * Paddle.js's stylesheet hosts for `style-src-elem` and the legacy `style-src` fallback (story 89.1, D2).
 *
 * Paddle.js loads `<cdn>/paddle/v2/assets/css/paddle.css` when checkout opens, from
 * `https://cdn.paddle.com` in production and `https://sandbox-cdn.paddle.com` in
 * sandbox (read from paddle.js's own source; the sandbox URL was also MEASURED
 * blocked by the old policy). The sandbox host is granted ONLY to a deployment
 * configured for sandbox, so production never authorizes it.
 */
export function paddleStyleHosts(paddleEnvironment: PaddleCspEnvironment): string[] {
  return paddleEnvironment === 'sandbox'
    ? ['https://cdn.paddle.com', 'https://sandbox-cdn.paddle.com']
    : ['https://cdn.paddle.com']
}

/**
 * The Paddle environment the CSP should authorize, from the app's EXISTING Paddle
 * config (story 89.1). Mirrors `/api/paddle/checkout-config`, the only place that
 * hands the browser an environment: it refuses checkout unless `PADDLE_ENVIRONMENT`
 * is explicitly set, then serves `getPaddleConfig().environment`. So:
 *
 * - unset or empty `PADDLE_ENVIRONMENT` → 'production' (the schema's `sandbox`
 *   DEFAULT must not widen the policy: no checkout can open there anyway);
 * - otherwise the configured value, with 'sandbox' only when it IS sandbox;
 * - a config that fails to load → 'production' (narrower, and a CSP must never
 *   turn every page into a 500).
 *
 * Pure (the resolver is injected) so both branches are unit-pinned.
 */
export function paddleEnvironmentForCsp(
  explicitEnvironment: string | undefined,
  resolveConfiguredEnvironment: () => string
): PaddleCspEnvironment {
  if (!explicitEnvironment) return 'production'
  try {
    return resolveConfiguredEnvironment() === 'sandbox' ? 'sandbox' : 'production'
  } catch {
    return 'production'
  }
}

/**
 * The Paddle environment for THIS process's CSP: `paddleEnvironmentForCsp` fed the
 * real `PADDLE_ENVIRONMENT` and the real `getPaddleConfig()` (89.1 review). It is
 * the whole `start.ts` wiring, kept here so a unit test drives it against the real
 * config schema (whose unset default is `sandbox`) instead of a stub resolver.
 * Read per request; `getConfig()` caches a successful parse.
 */
export function paddleEnvironmentFromProcessEnv(): PaddleCspEnvironment {
  return paddleEnvironmentForCsp(
    process.env['PADDLE_ENVIRONMENT'],
    () => getPaddleConfig().environment
  )
}

/**
 * Build the app's Content-Security-Policy for one request, injecting that
 * request's script nonce. Built from the app's ACTUAL external sub-resource
 * graph (story sec-1 Dev Notes §CSP source-of-truth) — every allowed origin
 * traces to a real loader; nothing else is permitted:
 *
 * - `script-src`   'self' + the per-request `'nonce-…'` (TanStack Start's inline
 *                  runtime scripts) + the two inline bootstraps (by hash) +
 *                  Paddle.js CDN (`cdn.paddle.com`) and counter.dev analytics
 *                  (`cdn.counter.dev`). No `'unsafe-inline'`.
 * - `style-src`    split into two CSP3 sub-directives (story 89.1, D2 (c′)), with a
 *                  legacy fallback (89.1 review, Lucas 2026-10-02):
 *   - `style-src` 'self' 'unsafe-inline' + Paddle's stylesheet CDN (see
 *                  `paddleStyleHosts`). A FALLBACK ONLY: CSP3 §6.8.3 "Get fetch
 *                  directive fallback list" gives « style-src-elem, style-src,
 *                  default-src » and « style-src-attr, style-src, default-src », and
 *                  §6.8.4 "Should fetch directive execute" lets `style-src` run only
 *                  when the more specific directive is ABSENT. Both are present here,
 *                  so a CSP3 browser never consults this value for an element, a
 *                  stylesheet or an attribute (W3C CSP3 WD 2026-09-16). It is what a
 *                  browser WITHOUT the sub-directives enforces (MDN BCD 8.1.4: Firefox
 *                  < 108, Chrome < 75, Safari < 15.4 for both; and Safari 15.4-26.1
 *                  parse `style-src-elem` but IGNORE it, WebKit bug 276931, so they use
 *                  this for <style>/stylesheets). There it keeps the pre-89.1
 *                  looseness, so Paddle's overlay keeps its inline positioning and
 *                  checkout keeps working, and (89.1 review, Lucas) it also lists the
 *                  Paddle CDN so those browsers load `paddle.css` too.
 *   - `style-src-elem` 'self' + Paddle's stylesheet CDN (see `paddleStyleHosts`).
 *                  Governs <style> elements and stylesheet loads. NO `'unsafe-inline'`:
 *                  an injected <style> (selector-based CSS exfiltration) is refused.
 *                  DEV ONLY (`isDev`, 89.1 review, Lucas 2026-10-02 option (a)): +
 *                  `'unsafe-inline'`, for Vite's error-overlay <style> and HMR-injected
 *                  <style> (`vite/dist/client/client.mjs`). Not a nonce: Vite reads the
 *                  `csp-nonce` meta's `.nonce` property, but TanStack writes the nonce
 *                  into its `content`, so Vite stamps none (MEASURED: a dev nonce left
 *                  3 violations, `89-1-evidence/review/devcheck-nonce.log`). A
 *                  production policy NEVER carries it (pinned, both environments).
 *   - `style-src-attr` 'unsafe-inline'. Governs inline `style="…"` attributes.
 *   MEASURED on the production build (story 89.1, `89-1-evidence/violations.md`):
 *   the app's own code needs NO inline style at all (0 violations across every
 *   route, light/dark, free/paid, seeded/empty, Recharts, tooltips, dialogs: React
 *   applies `style` props through the CSSOM, which CSP does not govern, and no
 *   server-rendered `style=` ships). The ONLY consumer is Paddle.js's checkout
 *   overlay on /pricing: it positions the overlay iframe with an inline style
 *   attribute (blocked, the iframe collapses to a static 300×150 and checkout is
 *   unusable, measured), and loads `paddle.css` from its CDN (blocked by the old
 *   `'self' 'unsafe-inline'`, measured). Its inline <style> (loader keyframes) is
 *   deliberately refused; the overlay works without it (measured).
 *   ⚠️ A policy is per DOCUMENT: a client-side navigation into /pricing keeps the
 *   policy of the page it started on, so this cannot be scoped to /pricing.
 * - `connect-src`  same-origin `/api/*`, Formspark contact POST
 *                  (`submit-form.com`), counter.dev beacon (the script posts to
 *                  the `t.counter.dev` subdomain, not the apex, hence
 *                  `*.counter.dev`), Paddle checkout.
 * - `frame-src`/`child-src`  Paddle checkout overlay.
 * - `worker-src`   'self' — the PWA service worker (`sw.js`, story 7-1) is
 *                  same-origin. This MUST be explicit: `worker-src` falls back to
 *                  `child-src` (not `default-src`), and `child-src` is set for
 *                  Paddle frames and does NOT include 'self', so without this
 *                  the service worker registration is blocked.
 * - `manifest-src` 'self' — the self-hosted `/manifest.webmanifest` (story 7-1).
 * - `img-src`      app/data-URI images.
 * - `font-src`     self-hosted / data-URI fonts.
 * - `frame-ancestors 'none'`  modern clickjacking defense (kept alongside the
 *                  legacy `X-Frame-Options: DENY` for old UAs). Governs US being
 *                  framed; it does NOT affect us framing Paddle (that's `frame-src`).
 * - `base-uri`/`form-action`/`object-src`  lock the base tag, form posts, and plugins.
 *
 * The server's own Paddle Billing REST calls (`api.paddle.com` /
 * `sandbox-api.paddle.com` — the webhook handler, the customer/subscription
 * APIs) need no `connect-src` entry; those never originate from the browser.
 * `https://*.paddle.com` IS listed in `connect-src` below anyway — since
 * story 5-3's Task 2a, `Paddle.PricePreview()` (`lib/paddle/checkout.ts`) is
 * a genuine BROWSER call to Paddle's API for localized pricing, alongside the
 * pre-existing `frame-src`/`child-src` entries for the checkout overlay.
 * (`cdn.paddle.com`, for the Paddle.js checkout script itself, is separately
 * allow-listed in `script-src`.)
 */
export function buildContentSecurityPolicy(
  nonce: string,
  paddleEnvironment: PaddleCspEnvironment,
  isDev: boolean
): string {
  // Defensive: the nonce is interpolated raw into the header, so a value
  // containing `'` or `;` could break out of the `'nonce-…'` source expression
  // and inject/override directives. Today the only caller passes a base64 nonce
  // from `generateCspNonce()` (can't contain those), but this exported function
  // guards its own contract so a future/refactored caller can't create a hole.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) {
    throw new Error('buildContentSecurityPolicy: nonce must be a non-empty base64 token')
  }
  const paddleHosts = paddleStyleHosts(paddleEnvironment).join(' ')
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' '${PLANNER_SCRIPT_CSP_HASH}' '${ACCOUNT_NOTICE_SCRIPT_CSP_HASH}' https://cdn.paddle.com https://cdn.counter.dev`,
    `style-src 'self' 'unsafe-inline' ${paddleHosts}`,
    `style-src-elem 'self'${isDev ? ` 'unsafe-inline'` : ''} ${paddleHosts}`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://submit-form.com https://counter.dev https://*.counter.dev https://*.paddle.com`,
    'frame-src https://*.paddle.com',
    'child-src https://*.paddle.com',
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
 * permission for card entry. Paddle billing went live under story 5-3; a real
 * checkout (annual + lifetime) was confirmed working end-to-end under this
 * policy in both sandbox and production. Apple/Google Pay specifically (which
 * CAN use the Payment Request API) have not been separately verified — see the
 * verification runbook's wallet-check step. If a wallet method ever breaks,
 * relax to `payment=(self "https://checkout.paddle.com")`.
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

/**
 * Whether the request arrived on the app's own canonical **https** origin, judged
 * by comparing the request's host against `SITE_URL`.
 *
 * ## Why this exists (story 5-6, finding F2)
 *
 * `isConfirmedHttps` alone was not enough in production. The Rapids-assigned
 * `*.danubedata.run` hostname emits HSTS; the custom domain
 * `www.longhandbudget.com` did **not** — measured 3/3 on the live deployment —
 * because the custom-domain ingress path reaches the container without
 * `x-forwarded-proto: https`. The result was that the domain real users visit was
 * the one domain with no TLS-strip protection.
 *
 * ## Why a Host comparison is safe here
 *
 * A `Host` header is client-controlled, so it can never *widen* anything. It is
 * only ever compared for equality against the operator-configured `SITE_URL`
 * origin, which is itself required to be `https://` in production
 * (`getSiteUrl()` fails closed). So the only header value that unlocks HSTS is
 * the one naming an origin we already assert is https — a client sending
 * `Host: evil.example` gets no HSTS, and a client sending our own canonical host
 * gains nothing it could not get by simply requesting that host over TLS.
 *
 * Port handling: a bare host and an explicit `:443` are the same https origin; any
 * other explicit port is a different origin and does not match.
 *
 * @param requestHost - The request's host (`x-forwarded-host`, else `Host`).
 * @param siteUrl - The configured public origin (`getSiteUrl()`); may be absent or
 *   unparseable in dev/test, which yields `false` rather than a throw.
 */
export function isCanonicalHttpsRequest(
  requestHost: string | null | undefined,
  siteUrl: string | null | undefined
): boolean {
  if (!requestHost || !siteUrl) return false

  let canonical: URL
  try {
    canonical = new URL(siteUrl)
  } catch {
    return false
  }
  if (canonical.protocol !== 'https:') return false

  // `URL.host` keeps a non-default port and drops a default one, so normalizing
  // the request host through the same rule makes `:443` and bare hosts compare
  // equal while `:8080` stays distinct.
  const normalizedRequestHost = requestHost.trim().toLowerCase()
  if (!normalizedRequestHost) return false

  let requested: URL
  try {
    requested = new URL(`https://${normalizedRequestHost}`)
  } catch {
    return false
  }

  return requested.host === canonical.host
}

/** Options controlling the conditional/per-request headers. */
export interface SecurityHeaderOptions {
  /**
   * Development mode. When true, sets a permissive dev-only CORS header to ease
   * local cross-origin tooling, suppresses HSTS (dev is plain HTTP), and adds
   * `'unsafe-inline'` to `style-src-elem` for Vite's dev <style> elements (89.1 review).
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
  /**
   * The Paddle environment whose stylesheet CDN `style-src-elem` authorizes (story
   * 89.1). Resolve it with `paddleEnvironmentForCsp`; required, so no caller can
   * silently default to the wider sandbox grant.
   */
  paddleEnvironment: PaddleCspEnvironment
}

/**
 * Apply the baseline + hardening security headers to a response's `Headers`.
 *
 * @param headers - The response headers to mutate in place.
 * @param options - `isDev` (dev-only CORS, no HSTS, dev inline <style>), `isHttps` (HSTS gate), the
 *   per-request `nonce` (CSP `script-src`), and `paddleEnvironment` (the Paddle
 *   stylesheet host in `style-src-elem`).
 */
export function applySecurityHeaders(headers: Headers, options: SecurityHeaderOptions): void {
  const { isDev, isHttps, nonce, paddleEnvironment } = options

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
  headers.set(
    'Content-Security-Policy',
    buildContentSecurityPolicy(nonce, paddleEnvironment, isDev)
  )
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
