import { useContext } from 'react'
import { type SessionSeed, SessionSeedContext } from '../context/session-seed'

/**
 * Read the seed only as a useState initializer, never reactively: a later provider value must not
 * clobber a consumer's already-resolved client state.
 */
export function useSessionSeed(): SessionSeed | null {
	return useContext(SessionSeedContext)
}
