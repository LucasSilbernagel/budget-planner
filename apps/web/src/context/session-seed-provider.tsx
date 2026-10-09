import type { ReactNode } from 'react'
import { type SessionSeed, SessionSeedContext } from './session-seed'

export function SessionSeedProvider({
	seed,
	children,
}: {
	seed: SessionSeed | null
	children: ReactNode
}) {
	return <SessionSeedContext.Provider value={seed}>{children}</SessionSeedContext.Provider>
}
