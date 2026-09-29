import type { SubscriptionStatus } from '@budget-planner/db/src/schema'

/**
 * Which subscription statuses grant what — defined ONCE (Story 78.3, FR127).
 *
 * Two different questions, answered for every status in one table:
 *
 *  - **paid access** — the account holds a live paid entitlement: an open
 *    subscription (including one in its dunning window) or a permanent lifetime
 *    grant. It may sync, it cannot buy again (duplicate charge), deleting it
 *    forfeits something, the retention purge must never touch it, and a webhook
 *    must not re-key it to another Paddle customer.
 *  - **premium features** — the Premium surfaces are unlocked. `past_due` is
 *    deliberately EXCLUDED (Story 4-18): a customer whose charge failed keeps
 *    sync and their data, but the feature gates fail closed until they pay.
 *
 * Before this module the paid-access set was hand-copied six times and the
 * premium-features rule was written inline fifteen times; `lifetime` went
 * missing from copies twice (30.4a server sync, 34.1a client sync) while the
 * others had it. `src/test/__tests__/paid-status-set.guard.test.ts` fails if a
 * new inline copy appears.
 *
 * ⚠️ "Entitled" already means BOTH in this codebase, so it is not used here:
 * `server/retention/status-classes.ts` `ENTITLED_STATUSES` / `isEntitledStatus`
 * = paid access (derived from this table); `lib/premium/entitlement.ts`
 * `isEntitledSeed` = premium features.
 *
 * ⚠️ CLIENT-SAFE BY CONSTRUCTION: the only import is `import type` (erased). A
 * value import from `@budget-planner/db` or `drizzle-orm` here would ship
 * server code into every client chunk that asks these questions. Pinned by
 * `__tests__/access-statuses.test.ts`.
 */
export const STATUS_ACCESS = {
  free: { paidAccess: false, premiumFeatures: false },
  active: { paidAccess: true, premiumFeatures: true },
  past_due: { paidAccess: true, premiumFeatures: false },
  canceled: { paidAccess: false, premiumFeatures: false },
  lifetime: { paidAccess: true, premiumFeatures: true },
} as const satisfies Record<SubscriptionStatus, { paidAccess: boolean; premiumFeatures: boolean }>

type StatusAccess = typeof STATUS_ACCESS

/** `'active' | 'past_due' | 'lifetime'` — computed from the table, never restated. */
export type PaidAccessStatus = {
  [S in SubscriptionStatus]: StatusAccess[S]['paidAccess'] extends true ? S : never
}[SubscriptionStatus]

/** `'active' | 'lifetime'` — computed from the table, never restated. */
export type PremiumFeatureStatus = {
  [S in SubscriptionStatus]: StatusAccess[S]['premiumFeatures'] extends true ? S : never
}[SubscriptionStatus]

const ALL_STATUSES = Object.keys(STATUS_ACCESS) as SubscriptionStatus[]

// Frozen: one array object is shared by the sync gates, checkout, the account
// notice AND the retention purge (`status-classes.ts` `ENTITLED_STATUSES`), so a
// stray `.push()` anywhere must throw rather than widen all of them at once.
export const PAID_ACCESS_STATUSES = Object.freeze(
  ALL_STATUSES.filter((status) => STATUS_ACCESS[status].paidAccess)
) as readonly PaidAccessStatus[]

export const PREMIUM_FEATURE_STATUSES = Object.freeze(
  ALL_STATUSES.filter((status) => STATUS_ACCESS[status].premiumFeatures)
) as readonly PremiumFeatureStatus[]

/**
 * Whether `status` holds live paid access. Accepts any value — a session read
 * from JSON or an older server may carry anything — and answers `false` for
 * everything that is not one of the statuses, prototype keys included (it is a
 * membership test, never a lookup on an arbitrary key).
 */
export function hasPaidAccess(status: unknown): status is PaidAccessStatus {
  return (PAID_ACCESS_STATUSES as readonly unknown[]).includes(status)
}

/** Whether `status` unlocks the Premium features. Same input contract as {@link hasPaidAccess}. */
export function hasPremiumFeatures(status: unknown): status is PremiumFeatureStatus {
  return (PREMIUM_FEATURE_STATUSES as readonly unknown[]).includes(status)
}
