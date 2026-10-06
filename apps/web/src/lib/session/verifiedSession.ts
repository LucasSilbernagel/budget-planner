/**
 * The last DEFINITIVE client answer to "who is this session?" (story 99.1, FR160).
 *
 * ## Why it exists
 *
 * Until 99.1 the header read the tier two ways. `AuthIndicator` asks
 * `/api/auth/me` on mount and on every navigation; `GlobalNav` read the SSR seed
 * once. So any document whose seed was signed-out or `null` under a premium
 * session cookie showed "Premium" in the account row and the FREE nav until a
 * reload. Triggers (story 99.1 Debug Log): a service-worker-cached signed-out
 * document served to the first signed-in navigation when the network takes over
 * 3 s (MEASURED on the prod build with the delay FORCED), and a tab left open
 * from before sign-in (shown in an integration test only).
 *
 * The indicator already holds the verified answer, refreshed per navigation. It
 * writes it here; the readers read it: the nav (99.1), and since story 101.2
 * `usePremiumAccess` (every premium gate) and the Overview/Settings premium
 * sections. Each keeps its own fail direction when nothing is held. No second
 * request anywhere. Readers use `useVerifiedSession()` only, never
 * `getVerifiedSession()` in render: the hook gives React zustand's server
 * snapshot (`undefined`) while hydrating, so SSR and the first client frame
 * agree (101.2 AC 6).
 *
 * ## Contract
 *
 * - `undefined` = no definitive answer yet. Readers then use the SSR seed, so
 *   SSR and the first client render are identical (no hydration mismatch).
 * - Only a DEFINITIVE answer is written: an HTTP 200 with a parseable body that
 *   is `{ user: null }` or a user with an email (decision D2, the same rule as
 *   `SyncProvider`). A 503, a network error or a malformed body writes nothing:
 *   unknown is not an answer. The store keeps what it held: `undefined` (the
 *   nav then uses the seed) or the last DEFINITIVE answer. So after a premium
 *   answer, a later 503 keeps the premium nav while the strip shows "Sign in"
 *   (the strip collapses every unknown to signed-out). Pinned in
 *   `nav-account-row.test.tsx`; whether unknown should instead clear the store
 *   is open (99.1 review, decision for Lucas).
 * - ⚠️ Written ONLY from an effect (client-only). This is a module singleton: on
 *   the server one instance would serve every request, so a server-side write
 *   would leak one user's tier into another's render. `auth-indicator.ssr.dom.test.tsx`
 *   pins that a server render leaves it `undefined`.
 * - ⚠️ Imports nothing but `zustand` and a TYPE: a store that reaches a domain
 *   store can close an import cycle that deadlocks concurrent imports.
 */

import { create } from 'zustand'

import type { SessionSeed } from '../../context/session-seed'

const useVerifiedSessionStore = create<{ seed: SessionSeed | undefined }>(() => ({
  seed: undefined,
}))

/** Record a definitive `/api/auth/me` answer. Call from an effect only. */
export function setVerifiedSession(seed: SessionSeed): void {
  useVerifiedSessionStore.setState({ seed })
}

/** The last definitive answer, or `undefined` before the first one. */
export function useVerifiedSession(): SessionSeed | undefined {
  return useVerifiedSessionStore((state) => state.seed)
}

/** Non-reactive read, for tests. */
export function getVerifiedSession(): SessionSeed | undefined {
  return useVerifiedSessionStore.getState().seed
}

/** Module state leaks across tests in one file: reset it in `afterEach`. */
export function resetVerifiedSessionForTests(): void {
  useVerifiedSessionStore.setState({ seed: undefined })
}
