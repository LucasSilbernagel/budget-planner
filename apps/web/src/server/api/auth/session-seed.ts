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
 *     `error` signal the premium consumers rely on to distinguish "unverified"
 *     from "not entitled" on a transient blip — and lets a genuinely paid user
 *     self-heal instead of being shown the free tier for the whole session.
 *     (This used to cite `ThemeProvider` and a "persisted dark preference" as the
 *     beneficiary. Story 61.1 deleted both; the theme has not been tier-dependent
 *     since story 25-3, so that example was already stale before it became
 *     impossible.)
 *     Collapsing errors into a signed-out `error:null` seed would defeat both
 *     (code review 2026-07-14).
 */

import { createServerFn } from '@tanstack/react-start'
import type { SessionSeed } from '../../../context/session-seed'

export const getSessionSeed = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionSeed | null> => {
    // ⚠️ DEV-ONLY TEST SEAM (story 58.1, D2 — guarded by AC-9 and by
    // `session-seed-dev-seam.guard.test.ts`, which explains it in full).
    //
    // Playwright cannot otherwise render an entitled session at all: it boots
    // `pnpm dev` with no database and no auth fixture, so every "paid" geometry
    // assertion would measure the FREE nav while passing. `GlobalNav`'s paid
    // branch reads nothing but this seed, so overriding it here — and only here
    // — makes that measurement real.
    //
    // `import.meta.env.DEV` is a BUILD-TIME literal, so a production build
    // resolves this to `false && …` and drops the branch and its string
    // entirely: the override is absent from the bundle, not merely unreachable.
    // It is written first so a production runtime never even reads the variable.
    // Do not rewrite it as a NODE_ENV comparison — that is a runtime string, and
    // the branch would survive into production.
    //
    // This grants a seed only: never a signed cookie, never a DB user, never an
    // authenticated server-side request. It is not a way to sign in.
    if (import.meta.env.DEV && process.env['E2E_SESSION_SEED']) {
      // ⚠️ The try/catch lives INSIDE the gate, not around it, and that placement
      // is load-bearing. With the gate outside, `import.meta.env.DEV` → `false`
      // eliminates only the `if` body; the surrounding `try`/`catch` is not dead
      // code, so its message string survives into the production bundle. The
      // branch was still unreachable, but a bare literal is indistinguishable
      // from a real leak to the CI grep that guards this (AC-9) — and a guard
      // that cannot tell those apart is no guard. Everything that names the
      // variable now sits inside the eliminated block.
      //
      // Shape-checked as well as parsed: a malformed value would otherwise throw
      // straight out of the ROOT loader and break every route on the dev server
      // with a SyntaxError naming nothing. A bad value now logs and falls through
      // to `null`, which consumers already treat as "unverified".
      try {
        const parsed: unknown = JSON.parse(process.env['E2E_SESSION_SEED'])
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as SessionSeed).isAuthenticated === 'boolean'
        ) {
          return parsed as SessionSeed
        }
        console.error('Dev session override is not a valid seed object; ignoring it')
      } catch (error) {
        console.error('Dev session override is not valid JSON; ignoring it:', error)
      }
      return null
    }

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
