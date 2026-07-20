/**
 * Per-request Content-Security-Policy nonce (story sec-1).
 *
 * TanStack Start emits its own inline runtime scripts on every SSR document —
 * the streaming hydration barrier (`$_TSR`) and scroll restoration — and the
 * hydration barrier embeds per-request router state, so it is NOT statically
 * hashable. A strict `script-src` therefore MUST authorize those via a
 * per-request nonce (the framework stamps every inline script it renders, and
 * emits a `<meta property="csp-nonce">` the client reads back, when
 * `router.options.ssr.nonce` is set).
 *
 * The same nonce value has to appear in two places produced during one request:
 *   1. the rendered HTML (via `getRouter()` → `router.options.ssr.nonce`), and
 *   2. the `Content-Security-Policy` response header (set in `start.ts`).
 * We bridge them with an `AsyncLocalStorage`: the request middleware generates
 * the nonce, runs the downstream render inside `runWithCspNonce`, and the render
 * reads it back — same async context, same value, no cross-request leakage.
 *
 * SERVER ONLY, and it must STAY server-only: it imports `node:` builtins. It is
 * imported exclusively by `start.ts` (the Start server config, never bundled for
 * the client). The isomorphic `getRouter()` (also bundled for the browser) must
 * NOT import this module — a static import drags `node:async_hooks` into the
 * client bundle and crashes hydration (the `import.meta.env.SSR` guard elides the
 * call, not the import). Instead, this module registers a getter on `globalThis`
 * at load, and `getRouter()` reads THAT behind an `import.meta.env.SSR` guard.
 * `start.ts` is evaluated at server startup, so the getter is registered long
 * before any request calls `getRouter()`.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { CSP_NONCE_GLOBAL_KEY } from './csp-nonce-key'

const nonceStorage = new AsyncLocalStorage<string>()

// Register the server-side nonce getter so `getRouter()` can reach the active
// request's nonce without a static import of this (node-only) module.
;(globalThis as Record<string, unknown>)[CSP_NONCE_GLOBAL_KEY] = (): string | undefined =>
  nonceStorage.getStore()

/** A fresh base64 nonce (128 bits of entropy) for one request's inline scripts. */
export function generateCspNonce(): string {
  return randomBytes(16).toString('base64')
}

/**
 * Run `fn` (the SSR render) with `nonce` in scope. The store propagates across
 * awaits inside `fn`, so the whole render tree — including the `getRouter()`
 * call — reads back the same nonce via the registered global getter.
 */
export function runWithCspNonce<T>(nonce: string, fn: () => T): T {
  return nonceStorage.run(nonce, fn)
}
