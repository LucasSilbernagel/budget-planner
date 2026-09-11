/**
 * Premium checkout CTA (Story 5-3, Task 2a).
 *
 * Replaces the Premium plan card's former static `<a href="/login">` CTA with
 * an annual/lifetime toggle + a real Paddle Billing checkout entry point.
 *
 * Auth gate: Paddle needs a signed-in buyer so the webhook can key
 * `data.customer_id` to the right `users` row (5.16 magic-link session,
 * `useSessionSeed()` — the SSR-resolved seed, so this renders the right branch
 * on the very first frame, no signed-in/signed-out flash). A signed-out click
 * goes to `/login?returnTo=/pricing` (cosmetic only — see `routes/login.tsx`;
 * the magic-link verify redirect is deliberately hardcoded to `/` as an
 * anti-open-redirect measure, so this does not thread a real post-login
 * redirect through the email round trip). A plain `<a>`, not `<Link>`, matches
 * this file's sibling CTA (`PlanCard`'s Free-plan link) and needs no router
 * context in tests — `validateSearch` in `routes/login.tsx` parses the query
 * string from any navigation, `<Link>` or not.
 *
 * Config (`clientToken`, both price IDs) comes from `/api/paddle/checkout-config`
 * — never hardcoded, so sandbox and production behave identically here; only
 * the env vars behind that endpoint differ (AC-3).
 */

import { useEffect, useState } from 'react'
import { useSessionSeed } from '../../context/session-seed'
import { getPaddleInstance, openPaddleCheckout } from '../../lib/paddle/checkout'

type Plan = 'annual' | 'lifetime'
type Status = 'idle' | 'loading' | 'error'

interface CheckoutConfig {
  isConfigured: boolean
  environment: 'sandbox' | 'production'
  clientToken: string | null
  annualPriceId: string | null
  lifetimePriceId: string | null
}

// Labels deliberately avoid the card's own "€39" / "€99 once" copy just above
// this toggle (`pricing-page.tsx`'s `PlanCard`) — an overlapping substring
// there made an early draft's `getByText(/€99 once/)` regression-test query
// ambiguous between the two.
const PLAN_OPTIONS: ReadonlyArray<{ id: Plan; label: string }> = [
  { id: 'annual', label: 'Annual · €39/yr' },
  { id: 'lifetime', label: 'Lifetime · €99' },
]

export function PremiumCheckoutButton() {
  const seed = useSessionSeed()
  const isAuthenticated = seed?.isAuthenticated ?? false

  const [plan, setPlan] = useState<Plan>('annual')
  const [config, setConfig] = useState<CheckoutConfig | null>(null)
  const [status, setStatus] = useState<Status>('idle')

  // Fetched once on mount so an unconfigured environment (no live Paddle
  // credentials yet) can be reflected in the CTA before the user ever clicks,
  // rather than only failing after an attempted checkout.
  useEffect(() => {
    let cancelled = false
    fetch('/api/paddle/checkout-config')
      .then((response) => (response.ok ? (response.json() as Promise<CheckoutConfig>) : null))
      .then((data) => {
        if (!cancelled) {
          setConfig(data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCheckout = async () => {
    const priceId = plan === 'annual' ? config?.annualPriceId : config?.lifetimePriceId
    if (!config?.isConfigured || !config.clientToken || !priceId) {
      setStatus('error')
      return
    }

    setStatus('loading')
    try {
      const paddle = await getPaddleInstance({
        environment: config.environment,
        clientToken: config.clientToken,
      })
      if (!paddle) {
        throw new Error('Paddle.js failed to initialize')
      }
      openPaddleCheckout(paddle, priceId, seed?.email ?? undefined)
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Premium plan"
        className="flex rounded-lg border border-gray-300 dark:border-gray-600 p-1 text-sm"
      >
        {PLAN_OPTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={plan === id}
            onClick={() => setPlan(id)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              plan === id
                ? 'bg-blue-600 text-white'
                : 'text-body hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isAuthenticated ? (
        <button
          type="button"
          onClick={handleCheckout}
          disabled={status === 'loading'}
          aria-busy={status === 'loading'}
          className="inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'loading' ? 'Opening checkout…' : 'Get Premium'}
        </button>
      ) : (
        <a
          href="/login?returnTo=/pricing"
          className="inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 bg-blue-600 text-white hover:bg-blue-700"
        >
          Get Premium
        </a>
      )}

      {status === 'error' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Checkout isn&apos;t available right now. Please try again shortly.
        </p>
      )}
    </div>
  )
}
