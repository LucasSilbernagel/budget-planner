import type { SessionSeed } from '../../context/session-seed'
import { hasPremiumFeatures } from './access-statuses'

/**
 * Fail-closed: null or unauthenticated seeds never qualify. Fail-open callers invert the answer,
 * never this predicate. seedToStatus duplicates the rule; entitlement.test asserts parity.
 */
export function isEntitledSeed(seed: SessionSeed | null): boolean {
  return seed?.isAuthenticated === true && hasPremiumFeatures(seed.subscriptionStatus)
}
