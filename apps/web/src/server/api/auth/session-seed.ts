/**
 * Server session seed resolver (story UX-1).
 *
 * Resolves the current session for the SSR first paint so `routes/__root.tsx`'s
 * loader can hand the auth strip + premium gates their resolved state without a
 * client round-trip.
 *
 * Implemented as a `createServerFn` so the framework extracts the handler into
 * the server bundle and hands the client only an RPC stub: the server-only code
 * it pulls in — `getCurrentUserSession` (reads the signed session cookie +
 * validates its HMAC via Buffer) and the framework server entry `getRequest` /
 * `setResponseHeader` — never reaches the client bundle (AC-5), which the plain
 * dynamic-import form cannot guarantee (TanStack Start's import-protection plugin
 * forbids `@tanstack/react-start/server` anywhere in a route's client-reachable
 * graph). The root route caches this with `staleTime: Infinity`, so during SSR it
 * runs in-process and its result hydrates to the client; it is not re-invoked (no
 * RPC) on ordinary client-side navigations.
 *
 * Return contract:
 *   - authenticated session  → the resolved authenticated seed.
 *   - no / invalid session   → the authoritative signed-out seed (fail-closed).
 *   - resolver ERRORED       → `null` (UNVERIFIED, not "signed out"). A null seed
 *     makes the consumers fall back to their own client check, which sets the
 *     `error` signal `ThemeProvider` relies on to avoid destroying a paid user's
 *     persisted dark preference on a transient blip — and lets a genuinely paid
 *     user self-heal instead of being shown the free tier for the whole session.
 *     Collapsing errors into a signed-out `error:null` seed would defeat both
 *     (code review 2026-07-14).
 */

import { createServerFn } from '@tanstack/react-start'
import type { SessionSeed } from '../../../context/session-seed'

export const getSessionSeed = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionSeed | null> => {
    try {
      // Dynamically imported inside the extracted server handler so neither the
      // framework server entry nor the session resolver leaks into the client.
      const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
      const { getCurrentUserSession } = await import('./paddle')

      const result = await getCurrentUserSession(getRequest())

      if (!result.success) {
        // Resolver errored — unverified, not authoritative. Return null so the
        // client re-checks (and can express the error) rather than asserting a
        // wrong signed-out / no-access state.
        console.error('getSessionSeed: session resolution failed:', result.error)
        return null
      }

      if (result.data) {
        const session = result.data
        // The document now carries the user's email + tier (review D1). Never let a
        // shared cache serve it to another user; anon/free pages stay cacheable
        // because this header is only set when a session is present.
        setResponseHeader('cache-control', 'private, no-store')
        return {
          isAuthenticated: true,
          userId: session.userId,
          email: session.email,
          subscriptionStatus: session.subscriptionStatus,
        }
      }

      // Authoritative signed-out: no / invalid session cookie. Resolved, fail-closed.
      return {
        isAuthenticated: false,
        userId: null,
        email: null,
        subscriptionStatus: null,
      }
    } catch (error) {
      // Unexpected throw (e.g. import/runtime failure) — unverified; the client
      // will re-check and self-heal. Log for observability so "why am I seeing
      // the free tier" reports are diagnosable.
      console.error('getSessionSeed: unexpected error resolving session:', error)
      return null
    }
  }
)
