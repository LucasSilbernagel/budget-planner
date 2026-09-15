/**
 * TanStack Start global configuration (Story 5.8 — AC-14; extended by sec-1)
 *
 * Registers a global request middleware that applies the baseline + hardening
 * security response headers to EVERY server response (SSR pages, server routes,
 * and server functions). This is the real, executed replacement for the headers
 * that were stranded in the removed `tanstack.config.ts`.
 *
 * It also mints the per-request CSP nonce and runs the downstream render inside
 * that nonce's AsyncLocalStorage context, so `getRouter()` reads back the SAME
 * nonce (`router.options.ssr.nonce`) that this middleware writes into the
 * `Content-Security-Policy` header. The framework stamps the nonce on its inline
 * runtime scripts (hydration stream barrier, scroll restoration), which a strict
 * `script-src` would otherwise block.
 *
 * The request/env reads (dev mode, forwarded scheme) live here — the header
 * logic in `server/middleware/security-headers.ts` stays framework-free and
 * unit-testable. TLS terminates at the Rapids/Knative edge, so the app container
 * speaks plain HTTP; `x-forwarded-proto` is the only trustworthy signal of the
 * real client scheme (see `server/node-adapter.mjs`).
 */

import { getSiteUrl } from '@budget-planner/config'
import { createMiddleware, createStart } from '@tanstack/react-start'
import { generateCspNonce, runWithCspNonce } from './server/csp-nonce'
import {
  applyHeadersToNextResult,
  isCanonicalHttpsRequest,
  isConfirmedHttps,
} from './server/middleware/security-headers'

/**
 * The configured public origin, read once. `getSiteUrl()` throws in production
 * when `SITE_URL` is missing/not https; that must not turn every page into a 500,
 * so a failure here degrades to "no canonical origin" and HSTS falls back to the
 * forwarded-proto signal alone.
 */
function canonicalSiteUrl(): string | undefined {
  try {
    return getSiteUrl()
  } catch {
    return undefined
  }
}

const securityHeadersMiddleware = createMiddleware({ type: 'request' }).server(
  ({ next, request }) => {
    const isDev = process.env['NODE_ENV'] === 'development'
    // Confirmed HTTPS when the edge proxy reports it (case-insensitive, first hop
    // of a possibly comma-joined value) — see `isConfirmedHttps`. The custom
    // domain's ingress path does NOT send that header (story 5-6 finding F2: the
    // live `www` host served 0/3 responses with HSTS while the `*.danubedata.run`
    // host served 3/3), so a request whose host IS our configured https origin
    // also counts as confirmed — see `isCanonicalHttpsRequest` for why a
    // client-controlled Host header cannot widen this.
    const isHttps =
      isConfirmedHttps(request.headers.get('x-forwarded-proto')) ||
      isCanonicalHttpsRequest(
        request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
        canonicalSiteUrl()
      )

    // Mint one nonce and make it available to the render (via AsyncLocalStorage →
    // getRouter → router.options.ssr.nonce) AND to the CSP header below, so both
    // carry the identical value for this request.
    const nonce = generateCspNonce()
    return runWithCspNonce(nonce, () => applyHeadersToNextResult(next, { isDev, isHttps, nonce }))
  }
)

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
}))
