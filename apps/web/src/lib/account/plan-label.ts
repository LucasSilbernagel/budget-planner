import type { BillingInterval, SubscriptionStatus } from '@budget-planner/db/src/schema'

/**
 * The plan name the Settings Account section shows (Story 70.1, FR111).
 *
 * Computed at render from TWO facts the server stores separately:
 * `subscriptionStatus` (entitlement — every premium gate reads it) and
 * `billingInterval` (what was bought, recorded from Paddle's `billing_cycle`).
 * Keeping them apart is deliberate: splitting `active` into per-plan statuses
 * would de-entitle every subscriber at every gate that string-compares the enum.
 *
 * Label table (D-LABEL, approved by Lucas 2026-09-25):
 *   lifetime              → Lifetime Plan (the status alone identifies it)
 *   active + year/month   → Annual Plan / Monthly Plan
 *   active + null         → Active — a row that predates the column, or a
 *                           cadence this product does not sell. Degrades to the
 *                           pre-70.1 text; never a blank and never a guess.
 *   past_due              → the plan name + "· payment overdue" (still entitled),
 *                           or "Payment overdue" when the interval is unknown
 *   canceled              → Cancelled (not a plan, even if an interval is stored)
 *   free                  → Free
 *
 * ⚠️ Never render the raw enum: CSS `capitalize` turned `past_due` into
 * "Past_due", which is what this replaced.
 */
export function planLabel(
  status: SubscriptionStatus,
  billingInterval: BillingInterval | null | undefined
): string {
  const planName =
    billingInterval === 'year' ? 'Annual Plan' : billingInterval === 'month' ? 'Monthly Plan' : null

  switch (status) {
    case 'lifetime':
      return 'Lifetime Plan'
    case 'active':
      return planName ?? 'Active'
    case 'past_due':
      return planName ? `${planName} · payment overdue` : 'Payment overdue'
    case 'canceled':
      return 'Cancelled'
    case 'free':
      return 'Free'
    default: {
      // Two guards, for two different failures (Story 70.1 review):
      //  - compile time: a sixth status added to the enum fails `tsc` here;
      //  - run time: the `/api/auth/me` payload is an unvalidated cast, so a
      //    value outside the enum (a newer server during a rolling deploy) still
      //    arrives. It gets a neutral label — never the raw enum, never blank.
      const unhandled: never = status
      void unhandled
      return 'Unknown plan'
    }
  }
}
