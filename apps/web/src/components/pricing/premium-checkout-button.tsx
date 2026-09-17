/**
 * Premium checkout CTA (Story 5-3, Task 2a).
 *
 * Replaces the Premium plan card's former static `<a href="/login">` CTA with
 * a monthly/annual/lifetime toggle + a real Paddle Billing checkout entry
 * point. (Story 5-20 added monthly; annual remains the default selection, as
 * it is the anchor plan the pricing page recommends.)
 *
 * NOT auth-gated — an EARLIER version of this file required being signed in
 * before opening checkout, which is backwards: magic-link login only
 * re-authenticates an EXISTING account (`requestMagicLink` silently no-ops for
 * an unknown email — by design, so the endpoint never reveals whether an
 * account exists), and account creation happens ONLY at the Paddle webhook, on
 * a COMPLETED checkout. Gating checkout behind sign-in made it impossible for
 * a brand-new customer to ever reach checkout — the one thing that creates
 * their account in the first place. `useSessionSeed()` is used ONLY to
 * pre-fill the email field as a convenience when already signed in (e.g. an
 * existing customer buying Lifetime after Annual); it is never a requirement.
 *
 * Config (`clientToken`, all three price IDs) comes from `/api/paddle/checkout-config`
 * — never hardcoded, so sandbox and production behave identically here; only
 * the env vars behind that endpoint differ (AC-3). Once that config is
 * configured, Paddle.js is initialized and `Paddle.PricePreview()` fetches a
 * country-localized price breakdown (subtotal / tax / total) for the toggle
 * labels and the caption below them — no country is passed, so Paddle
 * auto-detects from the visitor's IP; the static "€5.99/€39/€99" fallback
 * labels are shown until that resolves (or if it fails).
 */

import { useEffect, useRef, useState } from 'react'
import { type SessionSeed, useSessionSeed } from '../../context/session-seed'
import {
  type LocalizedPriceBreakdown,
  getLocalizedPlanPrices,
  getPaddleInstance,
  openPaddleCheckout,
} from '../../lib/paddle/checkout'

type Plan = 'monthly' | 'annual' | 'lifetime'
type Status = 'idle' | 'loading' | 'error'

interface CheckoutConfig {
  isConfigured: boolean
  environment: 'sandbox' | 'production'
  clientToken: string | null
  /**
   * Story 5-20. `null` means the monthly plan is not purchasable in this build.
   *
   * ⚠️ It cannot be null in PRODUCTION — `assertPaddleProductionConfig()` throws
   * without it (settled at code review: `pricing.md` states the €5.99 price on
   * the legal pricing page, so it must be chargeable). Null is reachable in
   * dev/sandbox, where the plan renders DISABLED — visible, labelled with its
   * static price, and unselectable — rather than removed. Keeping the row lets
   * a developer see at a glance that the plan exists but their env lacks the id,
   * which a silently absent option would hide.
   */
  monthlyPriceId: string | null
  annualPriceId: string | null
  lifetimePriceId: string | null
}

// Static fallback shown until Paddle.PricePreview() resolves (or if it never
// does). Deliberately worded so it never collides with the card's own "€39" /
// "€99 once" copy just above this toggle (`pricing-page.tsx`'s `PlanCard`) —
// an overlapping substring there made an early draft's `getByText(/€99 once/)`
// regression test ambiguous between the two.
const FALLBACK_LABEL: Record<Plan, string> = {
  monthly: '€5.99/mo',
  annual: '€39/yr',
  lifetime: '€99',
}

/**
 * A signed-in account that already holds `active`, `past_due`, or `lifetime`
 * has an open Paddle subscription (or a permanent grant) and nothing to buy
 * here — offering checkout anyway risks a real duplicate charge (there is no
 * in-app cancel-or-swap flow yet), so the CTA is replaced with a status
 * message instead of rendering the toggle at all.
 *
 * `canceled` is deliberately NOT included: that subscription has actually
 * ended, so checkout is the correct, intended way for them to resubscribe —
 * blocking it would turn the guard into a regression for a real customer.
 */
function AlreadyPremiumNotice({ status }: { status: 'active' | 'past_due' | 'lifetime' }) {
  if (status === 'lifetime') {
    return (
      <p className="mt-6 text-sm text-body">
        You already have lifetime Premium access — there&apos;s nothing more to buy.
      </p>
    )
  }
  if (status === 'past_due') {
    return (
      <p className="mt-6 text-sm text-body">
        Your Premium subscription has a payment issue. Buying a new plan won&apos;t fix this and
        would charge you again — please update your payment details with Paddle instead.
      </p>
    )
  }
  return <p className="mt-6 text-sm text-body">You already have an active Premium subscription.</p>
}

const ALREADY_PREMIUM_STATUSES = ['active', 'past_due', 'lifetime'] as const

/**
 * Resolve the session client-side when the SSR seed is `null` (Story 5-19, AC-5).
 *
 * A `null` seed does NOT mean "signed out" — `getSessionSeed` returns an
 * authoritative signed-out seed for that, and `null` ONLY when it could not
 * verify the session at all. The previous guard read `seed?.subscriptionStatus`
 * directly, so an unverified seed belonging to an `active` or `lifetime`
 * subscriber fell straight through to a live "Get Premium" button — a guard
 * against a real duplicate charge that defaulted to offering the purchase.
 *
 * So instead of guessing in either direction, ask: `/api/auth/me` is the same
 * client check `AuthIndicator` uses. `undefined` = still resolving (offer
 * nothing yet), `null` = resolved and not entitled.
 */
function useResolvedStatusWhenUnverified(seedIsNull: boolean) {
  const [status, setStatus] = useState<string | null | undefined>(seedIsNull ? undefined : null)

  useEffect(() => {
    if (!seedIsNull) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/auth/me')
        const body = (await res.json()) as { user?: { subscriptionStatus?: string } | null }
        if (!cancelled) setStatus(body?.user?.subscriptionStatus ?? null)
      } catch {
        // Still unverified. Resolve to "not entitled" so a brand-new customer
        // is never permanently locked out of buying by a failed probe — the
        // SERVER guard in `/api/paddle/checkout-config` is the authoritative
        // one, and it refuses an entitled session regardless of what the
        // client believes.
        if (!cancelled) setStatus(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [seedIsNull])

  return status
}

export function PremiumCheckoutButton() {
  const seed = useSessionSeed()
  const resolvedStatus = useResolvedStatusWhenUnverified(seed === null)

  const status = seed ? seed.subscriptionStatus ?? null : resolvedStatus

  // Unverified and still resolving — show nothing rather than a live checkout.
  if (status === undefined) {
    return <p className="mt-6 text-sm text-body">Checking your account…</p>
  }

  if ((ALREADY_PREMIUM_STATUSES as readonly string[]).includes(status ?? '')) {
    return <AlreadyPremiumNotice status={status as 'active' | 'past_due' | 'lifetime'} />
  }

  return <PremiumCheckoutForm seed={seed} />
}

/**
 * The actual toggle + checkout CTA, split out from {@link PremiumCheckoutButton}
 * so its hooks stay unconditional — the already-Premium short-circuit above
 * must not sit between hook calls (Rules of Hooks).
 */
function PremiumCheckoutForm({ seed }: { seed: SessionSeed | null }) {
  const [plan, setPlan] = useState<Plan>('annual')
  const [config, setConfig] = useState<CheckoutConfig | null>(null)
  const [localizedPrice, setLocalizedPrice] = useState<
    Record<Plan, LocalizedPriceBreakdown | null>
  >({
    monthly: null,
    annual: null,
    lifetime: null,
  })
  const [status, setStatus] = useState<Status>('idle')

  // Fetched once on mount so an unconfigured environment (no live Paddle
  // credentials yet) can be reflected in the CTA before the user ever clicks,
  // rather than only failing after an attempted checkout.
  //
  // The body is drained even on a non-OK response: an unread body keeps the
  // request open in the browser indefinitely (it never reaches "finished"),
  // which in an unconfigured environment (the endpoint deliberately 500s)
  // left `/pricing` never network-idle.
  useEffect(() => {
    let cancelled = false
    fetch('/api/paddle/checkout-config')
      .then(async (response) => {
        if (response.ok) return (await response.json()) as CheckoutConfig
        await response.text()
        return null
      })
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

  // Once config resolves to a configured Paddle Billing environment, fetch
  // real localized totals so the toggle shows what checkout will actually
  // charge — independent of sign-in state, since this is display-only.
  useEffect(() => {
    if (
      !config?.isConfigured ||
      !config.clientToken ||
      !config.annualPriceId ||
      !config.lifetimePriceId
    ) {
      return
    }
    let cancelled = false
    getPaddleInstance({ environment: config.environment, clientToken: config.clientToken })
      .then((paddle) => {
        if (!paddle || cancelled) return undefined
        return getLocalizedPlanPrices(paddle, {
          // Only a CONFIGURED monthly id is previewed — `getLocalizedPlanPrices`
          // would otherwise send Paddle an undefined line item and fail the whole
          // call, taking annual's and lifetime's real totals down with it.
          monthlyPriceId: config.monthlyPriceId ?? undefined,
          annualPriceId: config.annualPriceId as string,
          lifetimePriceId: config.lifetimePriceId as string,
        })
      })
      .then((prices) => {
        if (prices && !cancelled) {
          setLocalizedPrice({
            monthly: prices.monthly,
            annual: prices.annual,
            lifetime: prices.lifetime,
          })
        }
      })
      .catch(() => {
        // Silent: the static fallback label already covers this.
      })
    return () => {
      cancelled = true
    }
  }, [config])

  const handleCheckout = async () => {
    // A lookup, not a nested ternary: a two-branch conditional cannot express
    // three plans, and nesting one is how a fourth plan later gets silently
    // mis-routed to the wrong price.
    const priceIdForPlan: Record<Plan, string | null | undefined> = {
      monthly: config?.monthlyPriceId,
      annual: config?.annualPriceId,
      lifetime: config?.lifetimePriceId,
    }
    const priceId = priceIdForPlan[plan]
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
      openPaddleCheckout(paddle, priceId, {
        customerEmail: seed?.email ?? undefined,
        successUrl: `${window.location.origin}/welcome`,
      })
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  // A plan whose price ID isn't configured (a partially-configured build) is
  // disabled up front, not just at click-time — selecting it used to always
  // render, then only surface the generic error AFTER a click.
  const planOptions: ReadonlyArray<{ id: Plan; label: string; disabled: boolean }> = [
    {
      id: 'monthly',
      label: `Monthly · ${localizedPrice.monthly?.total ?? FALLBACK_LABEL.monthly}`,
      disabled: !config?.monthlyPriceId,
    },
    {
      id: 'annual',
      label: `Annual · ${localizedPrice.annual?.total ?? FALLBACK_LABEL.annual}`,
      disabled: !config?.annualPriceId,
    },
    {
      id: 'lifetime',
      label: `Lifetime · ${localizedPrice.lifetime?.total ?? FALLBACK_LABEL.lifetime}`,
      disabled: !config?.lifetimePriceId,
    },
  ]
  const enabledPlanIds = planOptions.filter((o) => !o.disabled).map((o) => o.id)
  const radioRefs = useRef<Partial<Record<Plan, HTMLButtonElement | null>>>({})

  // If the SELECTED plan is disabled (its price ID isn't configured), roving
  // tabIndex has nowhere to go — `plan` defaults to `'annual'`, so a build
  // missing only `PADDLE_ANNUAL_PRICE_ID` would otherwise leave the entire
  // `radiogroup` keyboard-unreachable (no radio ever carries `tabIndex={0}`).
  // Move the selection to the first enabled option instead.
  // `planOptions`/`enabledPlanIds` are plain arrays recomputed fresh every
  // render from `config`/`localizedPrice` — depending on `config`/`plan`
  // (the two things that can actually flip `disabled`) already covers every
  // case that needs a correction.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above; only config/plan can flip `disabled`
  useEffect(() => {
    const selected = planOptions.find((o) => o.id === plan)
    if (selected?.disabled && enabledPlanIds.length > 0 && enabledPlanIds[0]) {
      setPlan(enabledPlanIds[0])
    }
  }, [config, plan])

  /**
   * Roving-tabIndex ARIA radiogroup: arrow keys move BOTH focus and selection
   * between the enabled options (Home/End jump to the first/last), skipping
   * any plan whose price ID isn't configured. Three options since story 5-20,
   * and this has never assumed a fixed count — it walks `enabledPlanIds`.
   */
  const handleRadioKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentId: Plan) => {
    if (enabledPlanIds.length === 0) return
    const currentIndex = enabledPlanIds.indexOf(currentId)
    let nextIndex: number | undefined
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % enabledPlanIds.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + enabledPlanIds.length) % enabledPlanIds.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = enabledPlanIds.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const nextId = enabledPlanIds[nextIndex]
    if (nextId) {
      setPlan(nextId)
      radioRefs.current[nextId]?.focus()
    }
  }

  // The SELECTED plan's breakdown — shown only once a real PricePreview total
  // has resolved for it (the static fallback labels aren't final prices, so
  // there's nothing to break down yet). Paddle's total can differ noticeably
  // from the €39/€99 reference price (e.g. a 13%-HST Canadian province turns
  // €39 into €44.07): spelling out subtotal + tax = total is what turns "why
  // is this different" into a visible, self-explaining fact rather than a
  // one-line reassurance to take on faith.
  const selectedBreakdown = localizedPrice[plan]

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Premium plan"
        className="flex rounded-lg border border-gray-300 dark:border-gray-600 p-1 text-sm"
      >
        {planOptions.map(({ id, label, disabled }) => (
          <button
            key={id}
            ref={(el) => {
              radioRefs.current[id] = el
            }}
            type="button"
            role="radio"
            aria-checked={plan === id}
            disabled={disabled}
            // Roving tabIndex: only the selected option is Tab-reachable; arrow
            // keys move both focus and selection between the enabled options.
            tabIndex={plan === id ? 0 : -1}
            onClick={() => setPlan(id)}
            onKeyDown={(event) => handleRadioKeyDown(event, id)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
              plan === id
                ? 'bg-blue-600 text-white'
                : 'text-body hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {selectedBreakdown && (
        <p className="text-xs text-muted">
          {selectedBreakdown.subtotal} + {selectedBreakdown.tax} tax = {selectedBreakdown.total}
        </p>
      )}

      <button
        type="button"
        onClick={handleCheckout}
        disabled={status === 'loading'}
        aria-busy={status === 'loading'}
        className="inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'loading' ? 'Opening checkout…' : 'Get Premium'}
      </button>

      {status === 'error' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Checkout isn&apos;t available right now. Please try again shortly.
        </p>
      )}
    </div>
  )
}
