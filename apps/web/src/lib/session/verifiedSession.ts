/**
 * Only definitive /api/auth/me answers are written; an unknown (503, network error) keeps the last one.
 * Written only from effects: on the server this singleton would leak one user's tier into another's render.
 */

import { create } from 'zustand'

import type { SessionSeed } from '../../context/session-seed'

const useVerifiedSessionStore = create<{ seed: SessionSeed | undefined }>(() => ({
  seed: undefined,
}))

/** Call from an effect only. */
export function setVerifiedSession(seed: SessionSeed): void {
  useVerifiedSessionStore.setState({ seed })
}

export function useVerifiedSession(): SessionSeed | undefined {
  return useVerifiedSessionStore((state) => state.seed)
}

export function getVerifiedSession(): SessionSeed | undefined {
  return useVerifiedSessionStore.getState().seed
}

export function resetVerifiedSessionForTests(): void {
  useVerifiedSessionStore.setState({ seed: undefined })
}
