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

import { createMiddleware, createStart } from '@tanstack/react-start'
import { generateCspNonce, runWithCspNonce } from './server/csp-nonce'
import { applyHeadersToNextResult, isConfirmedHttps } from './server/middleware/security-headers'

const securityHeadersMiddleware = createMiddleware({ type: 'request' }).server(
  ({ next, request }) => {
    const isDev = process.env['NODE_ENV'] === 'development'
    // Confirmed HTTPS only when the edge proxy reports it (case-insensitive,
    // first hop of a possibly comma-joined value) — see `isConfirmedHttps`.
    const isHttps = isConfirmedHttps(request.headers.get('x-forwarded-proto'))

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
