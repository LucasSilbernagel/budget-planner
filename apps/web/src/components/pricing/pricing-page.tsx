import type React from 'react'
import { PRICING_PAGE } from '../../content/legal'
import { MarkdownRenderer } from '../docs/markdown-renderer'

/**
 * Public pricing page (`/pricing`) — UX review #5.
 *
 * Replaces the previous wall of left-aligned prose (which had NO call to action)
 * with a scannable two-plan comparison and clear CTAs, then keeps the
 * authoritative billing/legal prose below it. The prose still comes from the
 * `pricing.md` source that `legal-content.test.ts` guards for the Paddle
 * Merchant-of-Record + EUR-pricing disclosures, so nothing required is lost.
 *
 * The upgrade CTA points at `/login`, matching the app's shipped convention (the
 * account/subscription flow lives there, and `PremiumPrompt` defaults there);
 * the free CTA returns to the app, which needs no account. The dashboard's
 * `PremiumFeatureGate` (Forecasting / Custom Profiles) already routes users here,
 * so this page is the funnel's conversion surface.
 *
 * Styled light, consistent with its sibling commercial/legal pages (Terms,
 * Privacy, Refund) which share the light `LegalPageLayout`; dark mode is a
 * Premium in-app toggle that this page's free-tier audience does not have.
 */
export function PricingPageView(): React.ReactElement {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <a href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to app
          </a>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">{PRICING_PAGE.title}</h1>
          <p className="mt-2 text-gray-600">{PRICING_PAGE.description}</p>
        </header>

        <main className="space-y-8">
          {/* Plan comparison — stacks to one column at mobile widths so the page
              never overflows horizontally at 320px (e2e/responsive-320). */}
          <section aria-label="Plan comparison" className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <PlanCard
              name="Free"
              price="€0"
              priceSuffix="forever"
              tagline="No account required."
              features={FREE_FEATURES}
              ctaLabel="Start for free"
              ctaHref="/"
              ctaPrimary={false}
            />
            <PlanCard
              name="Premium"
              price="€39"
              priceSuffix="/ year"
              priceNote="or €99 once — lifetime license"
              tagline="Everything in Free, plus:"
              features={PREMIUM_FEATURES}
              ctaLabel="Get Premium"
              ctaHref="/login"
              ctaPrimary
              recommended
            />
          </section>

          <p className="text-center text-sm text-gray-500">
            The annual plan cancels anytime; the lifetime license is a one-time purchase. Billed
            securely by Paddle, our Merchant of Record. Prices shown in EUR; Paddle charges the
            equivalent in your local currency at checkout.
          </p>

          {/* Full details, billing, and legal — the authoritative copy, rendered
              from the same `pricing.md` source the content tests guard. */}
          <section className="rounded-lg bg-white p-6 shadow-md">
            <MarkdownRenderer content={PRICING_PAGE.content} />
          </section>
        </main>
      </div>
    </div>
  )
}

const FREE_FEATURES: readonly string[] = [
  'Track income, expenses, savings goals, and balances',
  'Net income and savings-capacity calculations',
  'Income-vs-expense and net-worth projection charts',
  'Retirement modelling',
  'Dark mode',
  'Private local storage — your data never leaves your device',
]

const PREMIUM_FEATURES: readonly string[] = [
  'Multi-device sync, securely stored in the EU',
  'Custom profiles (e.g. personal vs. household)',
  'Advanced forecasting and saved scenarios',
]

interface PlanCardProps {
  name: string
  /** Headline price, e.g. "€0" or "€39". */
  price: string
  /** Cadence shown next to the price, e.g. "forever" or "/ year". */
  priceSuffix: string
  /** Optional secondary pricing line, e.g. the annual option. */
  priceNote?: string
  /** One-line framing above the feature list. */
  tagline: string
  features: readonly string[]
  ctaLabel: string
  ctaHref: string
  /** Solid (blue) CTA for the recommended plan; outlined otherwise. */
  ctaPrimary: boolean
  /** Highlight this card with a ring and a "Recommended" badge. */
  recommended?: boolean
}

function PlanCard({
  name,
  price,
  priceSuffix,
  priceNote,
  tagline,
  features,
  ctaLabel,
  ctaHref,
  ctaPrimary,
  recommended = false,
}: PlanCardProps): React.ReactElement {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-md ${
        recommended ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'
      }`}
    >
      {recommended && (
        <span className="absolute -top-3 left-6 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-semibold text-white">
          Recommended
        </span>
      )}
      <h2 className="text-lg font-semibold text-gray-900">{name}</h2>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-gray-900">{price}</span>
        <span className="text-sm text-gray-500">{priceSuffix}</span>
      </div>
      <p className="mt-1 min-h-[1.25rem] text-sm text-gray-500">{priceNote ?? ''}</p>
      <p className="mt-3 text-sm font-medium text-gray-700">{tagline}</p>
      <ul className="mt-4 flex-1 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        className={`mt-6 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
          ctaPrimary
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
        }`}
      >
        {ctaLabel}
      </a>
    </div>
  )
}

function CheckIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}
