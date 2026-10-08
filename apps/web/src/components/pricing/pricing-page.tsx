import type React from 'react'
import { PRICING_PAGE } from '../../content/legal'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../lib/premium/benefits'
import { MarkdownRenderer } from '../docs/markdown-renderer'
import { PremiumCheckoutButton } from './premium-checkout-button'

export function PricingPageView(): React.ReactElement {
  return (
    <div className="min-h-screen surface-sunken p-4 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <a href="/" className="text-sm text-accent hover:underline">
            ← Back to app
          </a>
          <h1 className="mt-2 text-3xl font-bold text-heading">{PRICING_PAGE.title}</h1>
          <p className="mt-2 text-body">{PRICING_PAGE.description}</p>
        </header>

        <main className="space-y-8">
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
              // Also stated in the legal pricing copy; tests re-derive it from the prices.
              priceNote="or €5.99 / month (annual saves 46%) · €99 once — lifetime license"
              tagline="Everything in Free, plus:"
              features={PREMIUM_FEATURE_LIST}
              ctaLabel="Get Premium"
              ctaPrimary
              ctaElement={<PremiumCheckoutButton />}
              recommended
            />
          </section>

          <p className="mx-auto max-w-2xl text-balance text-center text-sm text-muted">
            The monthly and annual plans cancel anytime; the lifetime license is a one-time
            purchase. Billed securely by Paddle, our Merchant of Record. Prices shown in EUR; Paddle
            charges the equivalent in your local currency at checkout.
          </p>

          <section className="rounded-lg surface p-6 shadow-md">
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
  'Income-vs-expense and balances breakdown charts',
  'Retirement modelling',
  'Private local storage — your data never leaves your device',
]

// Claim only what ships: no side-by-side forecast comparison, and categories never sync,
// so the EU-storage line stays on sync only.
export const PREMIUM_FEATURES: Record<PremiumBenefitId, string> = {
  sync: 'Multi-device sync, securely stored in the EU',
  forecasting: 'Advanced forecasting — save, search, and reload what-if scenarios',
  profiles: 'Custom profiles (e.g. personal vs. household)',
  report:
    'Financial summary report — save your budget, net worth and savings as a PDF from your browser',
  categories: 'Custom income and expense categories, with a breakdown of what each one totals',
}

const PREMIUM_FEATURE_LIST: readonly string[] = PREMIUM_BENEFIT_IDS.map(
  (id) => PREMIUM_FEATURES[id]
)

type PlanCardCta =
  | { ctaHref: string; ctaElement?: undefined }
  | { ctaHref?: undefined; ctaElement: React.ReactNode }

type PlanCardProps = {
  name: string
  price: string
  priceSuffix: string
  priceNote?: string
  tagline: string
  features: readonly string[]
  ctaLabel: string
  ctaPrimary: boolean
  recommended?: boolean
} & PlanCardCta

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
  ctaElement,
  recommended = false,
}: PlanCardProps): React.ReactElement {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border surface p-6 shadow-md ${
        recommended
          ? // A 500-weight ring reads hot on a gray-800 card, so dark drops to 400.
            'border-blue-500 ring-1 ring-blue-500 dark:border-blue-400 dark:ring-blue-400'
          : 'border-default'
      }`}
    >
      {recommended && (
        // Not tokenised: the pill straddles card and canvas; blue-600 reads on both in both themes.
        <span className="absolute -top-3 left-6 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-semibold text-white">
          Recommended
        </span>
      )}
      <h2 className="text-lg font-semibold text-heading">{name}</h2>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-heading">{price}</span>
        <span className="text-sm text-muted">{priceSuffix}</span>
      </div>
      <p className="mt-1 min-h-[1.25rem] text-sm text-muted">{priceNote ?? ''}</p>
      <p className="mt-3 text-sm font-medium text-label">{tagline}</p>
      <ul className="mt-4 flex-1 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-body">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {ctaElement ?? (
        <a
          href={ctaHref}
          // The ring offset defaults to white: without this a focused CTA shows a white band on the dark card.
          className={`mt-6 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 ${
            ctaPrimary
              ? // blue-600 in both themes: white on blue-500 is 3.68:1, below WCAG AA.
                'bg-blue-600 text-white hover:bg-blue-700'
              : // gray-700, not gray-800: this sits on a gray-800 card and would vanish.
                'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
          }`}
        >
          {ctaLabel}
        </a>
      )}
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
