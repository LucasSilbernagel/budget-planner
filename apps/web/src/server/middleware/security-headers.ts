/**
 * Security response headers (Story 5.8 — AC group D / AC-14)
 *
 * Pure header-application logic, deliberately free of any TanStack Start import
 * so it is trivially unit-testable. The Start global request middleware that
 * invokes it is wired in `src/start.ts`.
 *
 * These headers previously lived in the dead `tanstack.config.ts`
 * `server.middleware` block, which used a non-existent `@tanstack/start/config`
 * API and never executed (removed by Story 5-10). This restores them as real,
 * executed response headers.
 */

/**
 * Apply the baseline security headers to a response's `Headers`.
 *
 * @param headers - The response headers to mutate in place.
 * @param isDev - When true, also sets a permissive dev-only CORS header to ease
 *   local cross-origin tooling. Never enabled outside development.
 */
export function applySecurityHeaders(headers: Headers, isDev: boolean): void {
  // Prevent MIME-type sniffing.
  headers.set('X-Content-Type-Options', 'nosniff')
  // Disallow framing (clickjacking protection).
  headers.set('X-Frame-Options', 'DENY')
  // Legacy XSS filter signal (kept to match the original security baseline).
  headers.set('X-XSS-Protection', '1; mode=block')

  if (isDev) {
    headers.set('Access-Control-Allow-Origin', '*')
  }
}

/**
 * The request-middleware body: run the downstream chain, then apply the security
 * headers to the produced response. Generic over the framework's result shape
 * (anything with a `response: Response`) so it stays decoupled from — and
 * directly unit-testable without — the TanStack Start runtime. `src/start.ts`
 * wires this into a real `createMiddleware({ type: 'request' })`.
 */
export async function applyHeadersToNextResult<R extends { response: Response }>(
  next: () => R | Promise<R>,
  isDev: boolean
): Promise<R> {
  const result = await next()
  applySecurityHeaders(result.response.headers, isDev)
  return result
}
