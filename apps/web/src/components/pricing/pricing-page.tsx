import type React from 'react'
import { PRICING_PAGE } from '../../content/legal'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../lib/premium/benefits'
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
 * Theme-aware since story 31-1 (UX-DR35), which closed the light-only drift
 * across the whole commercial/legal set at once. It is styled with the semantic
 * tokens from `styles/global.css` (`.surface`, `.surface-sunken`, `.text-heading`,
 * …) rather than hand-rolled `dark:` pairs. Note this page composes its OWN
 * shell rather than importing `LegalPageLayout` — it matches its sibling pages
 * by using the same tokens, not by sharing their layout component.
 *
 * Raw `dark:` variants remain on exactly three things, all of which lack a
 * token: the plan-card ring (`dark:border-blue-400 dark:ring-blue-400`), the
 * outlined CTA's fill/border/text, and the green check glyph. The badge and the
 * SOLID CTA deliberately carry NO `dark:` variant at all — each holds one fill
 * across both themes, for the reasons given at their call sites.
 *
 * An earlier version of this note claimed the page was deliberately light and
 * named this story as the gap; that is now stale and has been rewritten. (Its
 * replacement then miscounted which elements carry `dark:` variants and claimed
 * a `LegalPageLayout` this file never imported — both corrected in the 31-1 code
 * review, which is why the inventory above is spelled out rather than gestured
 * at.) A version before THAT claimed the page was light because
 * "dark mode is a Premium in-app toggle that this page's free-tier audience does
 * not have"; that was false — story 25-3 made dark mode FREE, and this file's own
 * `FREE_FEATURES` lists it. Do not act on the retired rationale.
 */
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
              features={PREMIUM_FEATURE_LIST}
              ctaLabel="Get Premium"
              ctaHref="/login"
              ctaPrimary
              recommended
            />
          </section>

          {/* Constrained + balanced so the disclaimer doesn't orphan its last
              few words across the full max-w-4xl container at desktop widths
              (UX-DR29); `.text-balance` is defined in styles/global.css. This is a
              short summary of the same Merchant-of-Record + EUR disclosures that
              the pricing.md billing prose below states in full — not a duplicate
              of it, so the two need not be kept word-for-word in sync. */}
          <p className="mx-auto max-w-2xl text-balance text-center text-sm text-muted">
            The annual plan cancels anytime; the lifetime license is a one-time purchase. Billed
            securely by Paddle, our Merchant of Record. Prices shown in EUR; Paddle charges the
            equivalent in your local currency at checkout.
          </p>

          {/* Full details, billing, and legal — the authoritative copy, rendered
              from the same `pricing.md` source the content tests guard. */}
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
  'Dark mode',
  'Private local storage — your data never leaves your device',
]

/**
 * This surface's copy for the canonical Premium benefit set.
 *
 * ⚠️ The set itself — which benefits, in what order — lives in
 * `lib/premium/benefits.ts`. Keying off `PremiumBenefitId` means dropping a
 * benefit or inventing one here is a **compile error**, which is the whole point:
 * before story 33.2 this file pinned the set to "exactly these three
 * (SCP 2026-07-18)" while Epic 30 had already shipped two further capabilities
 * that no surface listed. **That pin is AMENDED by FR56 / story 33.2** — the set
 * is now five, adding the financial summary report (FR53) and custom categories
 * with their breakdown (FR54). Cross-surface parity is asserted centrally in
 * `components/premium/__tests__/benefit-set-parity.test.tsx`.
 *
 * The SCP's other rules are NOT amended and still bind here:
 *   - The forecasting line states only what ships (story 30-2): you build a
 *     what-if scenario, save it to a searchable list, and reload it back into the
 *     builder. It must NOT claim a side-by-side comparison of two saved
 *     forecasts — no such view exists.
 *   - EU storage is stated on the sync line ONLY and, for saved forecasts, in
 *     `features.md`. Repeating it on further bullets reads as padding (brand-1
 *     review finding) — which is why neither new line mentions it. They also must
 *     not: the report never leaves the browser, and categories do not sync at all.
 *   - No "Dark mode" (free since 25-3) and no "No ads" (universal since 25-1).
 *
 * The two lines added in 33.2 are bounded by what the code actually does:
 *   - The report is `window.print()`, so the PDF comes from the user's own browser
 *     dialog — the app generates no file. It covers budget, current net worth and
 *     savings; retirement and forward projections are excluded by design (story
 *     30-3 narrowed FR53, whose own wording still says "retirement outlook").
 *   - Categories apply to income and expenses only, and **never sync**
 *     (`lib/sync/syncBridge.ts` pins `categoryId: null`).
 */
export const PREMIUM_FEATURES: Record<PremiumBenefitId, string> = {
  sync: 'Multi-device sync, securely stored in the EU',
  forecasting: 'Advanced forecasting — save, search, and reload what-if scenarios',
  profiles: 'Custom profiles (e.g. personal vs. household)',
  report:
    'Financial summary report — save your budget, net worth and savings as a PDF from your browser',
  categories: 'Custom income and expense categories, with a breakdown of what each one totals',
}

/** The Premium bullets in canonical order — the order IS `PREMIUM_BENEFIT_IDS`. */
const PREMIUM_FEATURE_LIST: readonly string[] = PREMIUM_BENEFIT_IDS.map(
  (id) => PREMIUM_FEATURES[id]
)

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
      className={`relative flex flex-col rounded-2xl border surface p-6 shadow-md ${
        recommended
          ? // A 500-weight accent reads hot on a gray-800 card, so the ring drops
            // to the 400 weight in dark (`global.css:102-110`). Light is unchanged.
            'border-blue-500 ring-1 ring-blue-500 dark:border-blue-400 dark:ring-blue-400'
          : 'border-default'
      }`}
    >
      {recommended && (
        // Deliberately NOT tokenised: this pill straddles the card edge at
        // `-top-3`, so it sits half on the card and half on the page canvas. A
        // solid blue-600 with white text is the one fill that reads against both
        // surfaces in both themes.
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
      <a
        href={ctaHref}
        // `dark:focus-visible:ring-offset-gray-800` is load-bearing: Tailwind's
        // `--tw-ring-offset-color` defaults to WHITE with no global override, so
        // on a `.surface` (gray-800) card a focused CTA would otherwise paint a
        // white band between the button and its ring. gray-800 matches the CARD
        // these sit on; `NotFoundPage.tsx:55` and `components/profiles/profiles-page.tsx:85` use
        // gray-900 because those buttons sit on the page canvas instead.
        className={`mt-6 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 ${
          ctaPrimary
            ? // Deliberately keeps the blue-600 fill in BOTH themes. The shipped
              // convention (`contact-form.tsx:309`) drops to blue-500 on dark, but
              // white on blue-500 measures 3.68:1 — below WCAG AA's 4.5:1 for
              // normal text — while blue-600 measures 5.17:1. Measured at 320px in
              // a real browser during story 31-1; AC-7 outranks the convention.
              'bg-blue-600 text-white hover:bg-blue-700'
            : // gray-700, NOT the gray-800 that `reports/FinancialSummaryReport.tsx:230`
              // uses for its outline button: that one sits on the page canvas, this one
              // sits ON a `.surface` (gray-800) card, where gray-800 would make it vanish.
              'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
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
