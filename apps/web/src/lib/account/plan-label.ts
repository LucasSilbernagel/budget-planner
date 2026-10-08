import type { BillingInterval, SubscriptionStatus } from '@budget-planner/db/src/schema'

/**
 * Status and billing interval stay separate: splitting `active` per plan would de-entitle every
 * gate that compares the enum.
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
      // `never` fails tsc on a new status; at runtime the unvalidated payload can still carry one.
      const unhandled: never = status
      void unhandled
      return 'Unknown plan'
    }
  }
}
