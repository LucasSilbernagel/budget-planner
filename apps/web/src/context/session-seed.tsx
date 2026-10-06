/**
 * Session seed context (story UX-1).
 *
 * Carries the session that `routes/__root.tsx`'s loader resolves ONCE, server-side,
 * so the components that render account-specific state — the {@link AuthIndicator}
 * strip and every {@link usePremiumAccess} consumer (the premium feature gates)
 * — can paint their resolved state on the very first frame
 * instead of a neutral placeholder that flips to real content after a client-side
 * round-trip.
 *
 * Consume this ONLY as an INITIAL value (a `useState` initializer), never
 * reactively. The seed is authoritative for the first paint; afterwards each
 * consumer owns its own state (the auth strip refetches `/api/auth/me` per
 * navigation for client-side sign-out freshness — see AuthIndicator). Reading it
 * once as an initializer means a later provider value can never clobber a
 * consumer's already-resolved client state.
 *
 * Since stories 99.1 and 101.2, `GlobalNav`, `usePremiumAccess` and the
 * Overview/Settings premium sections ALSO follow the indicator's last DEFINITIVE
 * `/api/auth/me` answer (`lib/session/verifiedSession.ts`) after the first
 * paint. That is a second input, not a reactive read of this seed: the seed is
 * still read once and still decides the first paint (and every frame until an
 * answer arrives).
 *
 * A `null` seed means "no usable server seed", in two cases:
 *   - the session resolver could not verify the session (see `getSessionSeed`,
 *     which returns `null` on error rather than asserting a wrong signed-out
 *     state); or
 *   - the component is rendered outside the provider (e.g. unit tests).
 * Either way the consumer falls back to its pre-UX-1 behaviour: a loading state
 * that resolves via its own client check (which also restores the `error` signal).
 * Note the root loader is a server function cached with `staleTime: Infinity`, so
 * on ordinary client-side navigations it is not re-run and the seed stays the
 * resolved SSR value — it does not flip to `null` mid-session.
 */

import { type ReactNode, createContext, useContext } from 'react'

/** Subscription status shape shared with the server session + premium hook. */
export type SeedSubscriptionStatus = 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime' | null

export interface SessionSeed {
  /** Whether the request carried a valid authenticated session. */
  isAuthenticated: boolean
  /** The signed-in user's id, or null when signed out. */
  userId: string | null
  /** The signed-in user's email, or null when signed out. */
  email: string | null
  /** The resolved subscription status, or null when signed out / unknown. */
  subscriptionStatus: SeedSubscriptionStatus
}

/**
 * The authoritative signed-out seed: what the server resolves for a request with
 * no (or an invalid) session cookie, and what `/api/auth/me`'s `{ user: null }`
 * maps to. One definition, so the SSR seed, the client re-check and the tests
 * that model a signed-out visitor cannot drift apart (story 82.3 review P2).
 */
export const SIGNED_OUT_SEED: Readonly<SessionSeed> = Object.freeze({
  isAuthenticated: false,
  userId: null,
  email: null,
  subscriptionStatus: null,
})

const SessionSeedContext = createContext<SessionSeed | null>(null)

export function SessionSeedProvider({
  seed,
  children,
}: {
  seed: SessionSeed | null
  children: ReactNode
}) {
  return <SessionSeedContext.Provider value={seed}>{children}</SessionSeedContext.Provider>
}

/**
 * The SSR-resolved session, or `null` when no server seed is available. Read this
 * ONLY as an initial value (see the module doc): later changes must not override
 * a consumer's already-resolved client state.
 */
export function useSessionSeed(): SessionSeed | null {
  return useContext(SessionSeedContext)
}
