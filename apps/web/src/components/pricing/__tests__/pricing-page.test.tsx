/**
 * PricingPageView benefit-list guard (stories 25-1 / 25-3).
 *
 * The `/pricing` route renders its plan cards from hard-coded FREE_FEATURES /
 * PREMIUM_FEATURES arrays (separate from the pricing.md prose below them). These
 * guards pin the canonical split so a future edit can't reintroduce "Dark mode"
 * or "No ads" as a Premium perk on this surface — the exact miss this test closes:
 *   - Premium = exactly the canonical benefit set of `lib/premium/benefits.ts`
 *     (five since story 33.2 / FR56: multi-device sync · advanced forecasting ·
 *     custom profiles · financial summary report · custom categories), never Dark
 *     mode or No ads.
 *   - Dark mode is a FREE feature (story 25-3).
 *
 * Story 33.2 added the COUNT assertion this file was missing. Cross-surface parity
 * (no surface omitting or inventing a benefit) is asserted once, centrally, in
 * `components/premium/__tests__/benefit-set-parity.test.tsx`.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PREMIUM_BENEFIT_IDS } from '../../../lib/premium/benefits'
import { PricingPageView } from '../pricing-page'

// Each plan renders as a card <div> whose first child is an <h2>{name}</h2>.
function card(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name, level: 2 })
  const el = heading.closest('div')
  if (!el) throw new Error(`No card container found for the "${name}" plan`)
  return el
}

describe('PricingPageView benefit lists', () => {
  it('lists exactly the canonical Premium benefit set — no Dark mode, no No ads', () => {
    render(<PricingPageView />)
    const premium = within(card('Premium'))

    // ⚠️ This COUNT is the point of the test and it was missing until story 33.2.
    // Before then the test was named "lists exactly the three canonical Premium
    // benefits" but its body was three `getByText` calls and two negatives — so a
    // fourth, fifth or sixth bullet passed it SILENTLY. The name was a claim about
    // assertions the file did not contain. Derived from PREMIUM_BENEFIT_IDS.length
    // rather than a literal so the next addition to the set cannot re-open the hole.
    expect(premium.getAllByRole('listitem')).toHaveLength(PREMIUM_BENEFIT_IDS.length)

    expect(premium.getByText('Multi-device sync, securely stored in the EU')).toBeInTheDocument()
    expect(
      premium.getByText('Advanced forecasting — save, search, and reload what-if scenarios')
    ).toBeInTheDocument()
    expect(premium.getByText('Custom profiles (e.g. personal vs. household)')).toBeInTheDocument()
    expect(
      premium.getByText(
        'Financial summary report — save your budget, net worth and savings as a PDF from your browser'
      )
    ).toBeInTheDocument()
    expect(
      premium.getByText(
        'Custom income and expense categories, with a breakdown of what each one totals'
      )
    ).toBeInTheDocument()

    // The ungated (25-3) / removed-ads (25-1) benefits must NOT be Premium perks.
    expect(premium.queryByText(/dark mode/i)).not.toBeInTheDocument()
    expect(premium.queryByText(/no ads/i)).not.toBeInTheDocument()
  })

  it('lists Dark mode under the Free plan (story 25-3)', () => {
    render(<PricingPageView />)
    expect(within(card('Free')).getByText('Dark mode')).toBeInTheDocument()
  })
})

describe('PricingPageView pricing (story 25-2)', () => {
  it('shows the Premium card as €39 / year with a €99 lifetime note — no monthly', () => {
    render(<PricingPageView />)
    const premium = within(card('Premium'))

    expect(premium.getByText('€39')).toBeInTheDocument()
    expect(premium.getByText('/ year')).toBeInTheDocument()
    expect(premium.getByText(/€99 once — lifetime license/)).toBeInTheDocument()

    // The dropped monthly model must not resurface on this surface (AC-1).
    expect(premium.queryByText('€10')).not.toBeInTheDocument()
    expect(premium.queryByText(/\/ month/)).not.toBeInTheDocument()
    expect(premium.queryByText(/two months free/)).not.toBeInTheDocument()
  })
})

describe('PricingPageView forecasting honesty (story 20-1, re-homed in 20-4, updated in 30-2)', () => {
  it('states the reload claim exactly once and never overpromises side-by-side', () => {
    render(<PricingPageView />)

    // The Premium card states the honest, shipped benefit…
    expect(
      within(card('Premium')).getByText(
        'Advanced forecasting — save, search, and reload what-if scenarios'
      )
    ).toBeInTheDocument()

    // Story 20-1 also asserted the page never says "reloadable", because at the
    // time saved forecasts genuinely could NOT be reloaded. Story bug-3 shipped
    // reload, so that negative outlived its premise — it was silently forbidding
    // accurate copy. It is inverted here rather than deleted (coverage moves, it
    // does not drop).
    //
    // What this count actually buys, stated precisely: it catches the 2 case —
    // pricing.md re-acquiring the benefit detail story 20-4 de-duped out of it —
    // page-wide, spanning the cards AND the rendered prose, which is the scope
    // the retired negative used to provide. It does NOT independently catch the
    // 0 case: if the card drops "reload", the exact-string getByText above
    // throws first and this line never executes. (An earlier comment claimed it
    // was load-bearing "in BOTH directions" — corrected in the 30-2 review.)
    expect(screen.getAllByText(/reload/i)).toHaveLength(1)

    // Side-by-side remains a REAL overpromise and this negative stays: nothing
    // plots two SAVED forecasts together. The only comparison that ships is
    // baseline-vs-scenario within a single forecast (projection-chart.tsx).
    // Matches the hyphenated spelling too — the spaced-only form this replaces
    // missed "side-by-side", the spelling used everywhere in this repo's own
    // comments (30-2 review).
    expect(screen.queryByText(/side[\s-]by[\s-]side/i)).not.toBeInTheDocument()
  })
})

describe('PricingPageView de-duplication + billing disclaimer (story 20-4)', () => {
  it('states each plan/price once — the Free/Premium feature lists are not repeated in the prose', () => {
    render(<PricingPageView />)

    // The scannable comparison lives in the cards; the prose the page renders below
    // must NOT re-list those same tier features (CONTENT-L). Each appears exactly
    // once — the card — where before de-dup the prose repeated them (→ length 2).
    expect(
      screen.getByText('Track income, expenses, savings goals, and balances')
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Track income, expenses/i)).toHaveLength(1) // Free card only, not prose
    expect(screen.getAllByText(/Everything in Free, plus/i)).toHaveLength(1) // Premium card tagline only
  })

  it('keeps the balanced disclaimer line with its Paddle Merchant-of-Record + EUR disclosure', () => {
    render(<PricingPageView />)

    // The centered disclaimer <p> survives the layout change; its text (unique to
    // the disclaimer, distinct from the prose wording) still carries the MoR + EUR
    // disclosure required by Paddle.
    expect(
      screen.getByText(/Billed\s+securely by Paddle, our Merchant of Record/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Prices shown in EUR/i)).toBeInTheDocument()
  })
})

/**
 * Theming guards (story 31-1, AC-6/AC-7/AC-8).
 *
 * Class-TOKEN membership, never substring. These assert classes only and add no
 * visible text, because this file's `getAllByText(...)` COUNT assertions above
 * are brittle by design and a duplicate label would break them.
 *
 * The page-wide leak sweep is property-paired rather than a flat blocklist:
 * `bg-white` is legitimate on the outlined CTA, which has no semantic token
 * (none exists for buttons) and carries its own `dark:bg-gray-700`. What is a
 * defect is a light-only value with no dark counterpart for the SAME property,
 * so that is what is asserted.
 */
/**
 * Retired light-only values, grouped by the CSS property they set. Kept in step
 * with the flat `RETIRED_LIGHT_ONLY_TOKENS` list the other three subtree sweeps
 * use — the grouping exists only so the pairing check below knows which `dark:`
 * variant would actually counter a given token.
 */
const RETIRED_BY_PROPERTY = {
  bg: ['bg-white', 'bg-gray-50', 'bg-gray-100'],
  text: [
    'text-gray-900',
    'text-gray-800',
    'text-gray-700',
    'text-gray-600',
    'text-gray-500',
    'text-gray-400',
  ],
  border: ['border-gray-200', 'border-gray-300'],
} as const

/**
 * Variant prefixes that still paint a light value. A code review found the first
 * version checked only bare tokens, so a light-only `hover:bg-gray-50` with no
 * `dark:hover:` counterpart passed silently.
 */
const VARIANT_PREFIXES = ['', 'hover:', 'focus:', 'active:'] as const

/**
 * Every light-only value on the subtree that has no `dark:` counterpart for the
 * SAME property and the SAME variant.
 *
 * Property-paired rather than a flat blocklist because `bg-white` is legitimate
 * on the outlined CTA — no semantic token exists for buttons — and it carries
 * its own `dark:bg-gray-700`. Variant-paired because a code review found that
 * matching `dark:bg-` against a `hover:bg-gray-50` leak was both a false negative
 * (no bare token to match) and, in the reverse direction, a false PASS: any
 * `dark:bg-*` anywhere on the element used to excuse any retired bg on it.
 */
function lightOnlyLeaks(root: HTMLElement): string[] {
  const leaks: string[] = []
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const tokens = [...element.classList]
    for (const [property, retired] of Object.entries(RETIRED_BY_PROPERTY)) {
      for (const variant of VARIANT_PREFIXES) {
        const hit = retired.find((token) => tokens.includes(`${variant}${token}`))
        if (!hit) continue
        const counter = `dark:${variant}${property}-`
        if (!tokens.some((token) => token.startsWith(counter))) {
          leaks.push(`${variant}${hit} on <${element.tagName.toLowerCase()}> (want ${counter}*)`)
        }
      }
    }
  }
  return leaks
}

describe('PricingPageView theming', () => {
  it('uses the semantic tokens for the page shell, disclaimer and prose card', () => {
    const { container } = render(<PricingPageView />)
    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing page root')

    expect([...root.classList]).toContain('surface-sunken')

    const backLink = root.querySelector('a[href="/"]')
    if (!(backLink instanceof HTMLElement)) throw new Error('missing back link')
    expect([...backLink.classList]).toContain('text-accent')

    const heading = root.querySelector('h1')
    if (!heading) throw new Error('missing h1')
    expect([...heading.classList]).toContain('text-heading')

    const disclaimer = screen.getByText(/Prices shown in EUR/i)
    expect([...disclaimer.classList]).toContain('text-muted')
    // The balanced-wrap utility (UX-DR29) composes with the colour token.
    expect([...disclaimer.classList]).toContain('text-balance')

    // Anchored structurally, not by text: "Merchant of Record" appears in BOTH
    // the disclaimer <p> and the rendered prose, so a text query is ambiguous.
    const proseCard = container.querySelector('article.prose')?.closest('section')
    if (!proseCard) throw new Error('missing prose card')
    expect([...proseCard.classList]).toContain('surface')
    expect([...proseCard.classList]).not.toContain('bg-white')
  })

  it('keeps the recommended plan visually ranked in BOTH themes', () => {
    render(<PricingPageView />)

    const premium = [...card('Premium').classList]
    expect(premium).toContain('surface')
    expect(premium).not.toContain('bg-white')
    // Light ranking is unchanged; dark drops to the 400 weight because a
    // 500-weight accent on a gray-800 card reads hot (`global.css:102-110`).
    expect(premium).toContain('border-blue-500')
    expect(premium).toContain('ring-1')
    expect(premium).toContain('ring-blue-500')
    expect(premium).toContain('dark:border-blue-400')
    expect(premium).toContain('dark:ring-blue-400')

    const free = [...card('Free').classList]
    expect(free).toContain('surface')
    expect(free).toContain('border-default')
    expect(free).not.toContain('border-gray-200')
    // Ring-only differentiation (D4): the Free card must NOT acquire one.
    expect(free).not.toContain('ring-1')

    // D5: the badge straddles the card edge at -top-3, so a solid blue-600 pill
    // with white text is deliberate — it reads against the card AND the canvas
    // in both themes. Pinned so a future change is a decision, not a drift.
    const badge = screen.getByText('Recommended')
    expect([...badge.classList]).toContain('bg-blue-600')
    expect([...badge.classList]).toContain('text-white')
  })

  it('themes the plan card body text and the positive check glyph', () => {
    render(<PricingPageView />)
    const premium = card('Premium')
    // Scoped to the card: the €99 lifetime line also appears in the prose below,
    // so a page-level text query is ambiguous.
    const inCard = within(premium)

    const name = premium.querySelector('h2')
    if (!name) throw new Error('missing plan name')
    expect([...name.classList]).toContain('text-heading')

    expect([...inCard.getByText('€39').classList]).toContain('text-heading')
    expect([...inCard.getByText('/ year').classList]).toContain('text-muted')
    expect([...inCard.getByText(/€99 once/).classList]).toContain('text-muted')
    expect([...inCard.getByText('Everything in Free, plus:').classList]).toContain('text-label')

    const feature = inCard.getByText('Custom profiles (e.g. personal vs. household)').closest('li')
    if (!feature) throw new Error('missing feature row')
    expect([...feature.classList]).toContain('text-body')

    const glyph = feature.querySelector('svg')
    if (!glyph) throw new Error('missing check glyph')
    expect([...glyph.classList]).toContain('text-green-600')
    expect([...glyph.classList]).toContain('dark:text-green-400')
  })

  it('gives the solid CTA a fixed blue-600 fill and the outlined CTA a gray-700 dark fill', () => {
    render(<PricingPageView />)

    const primary = [...screen.getByRole('link', { name: 'Get Premium' }).classList]
    // The blue-600 fill is held in BOTH themes on purpose. The shipped
    // convention (`contact-form.tsx:309`) drops to blue-500 on dark, but white
    // on blue-500 measures 3.68:1 — below AA's 4.5:1 for normal text — against
    // 5.17:1 for blue-600. Measured in a real browser during story 31-1 (AC-7).
    expect(primary).toContain('bg-blue-600')
    expect(primary).toContain('hover:bg-blue-700')
    expect(primary).toContain('text-white')
    // The INVARIANT, not one token: any dark background override reintroduces
    // the AA failure this fix closed. A code review found `not.toContain(
    // 'dark:bg-blue-500')` still permitted `dark:bg-blue-400`, `dark:bg-sky-500`
    // and friends — it guarded one past draft, not the stated rule.
    expect(primary.filter((token) => token.startsWith('dark:bg-'))).toEqual([])
    expect(primary.filter((token) => token.startsWith('dark:hover:bg-'))).toEqual([])

    const outlined = [...screen.getByRole('link', { name: 'Start for free' }).classList]
    expect(outlined).toContain('dark:border-gray-600')
    expect(outlined).toContain('dark:text-gray-200')
    expect(outlined).toContain('dark:hover:bg-gray-600')
    // gray-700, NOT the gray-800 that `FinancialSummaryReport.tsx:230` uses —
    // that button sits on the page canvas, this one sits ON a `.surface`
    // (gray-800) card, where gray-800 would make it vanish. Asserted as an exact
    // single value so any other dark fill fails, not just gray-800.
    expect(outlined.filter((token) => token.startsWith('dark:bg-'))).toEqual(['dark:bg-gray-700'])

    // AC-7: the focus affordance survives on both CTAs, and its ring-offset is
    // dark-aware — Tailwind's offset defaults to WHITE, which would paint a band
    // between button and ring on the gray-800 card these sit on.
    for (const tokens of [primary, outlined]) {
      expect(tokens).toContain('focus-visible:ring-2')
      expect(tokens).toContain('focus-visible:ring-blue-500')
      expect(tokens).toContain('focus-visible:ring-offset-2')
      expect(tokens).toContain('dark:focus-visible:ring-offset-gray-800')
    }
  })

  it('leaves no light-only colour value without a dark counterpart', () => {
    const { container } = render(<PricingPageView />)
    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing page root')
    expect(lightOnlyLeaks(root)).toEqual([])
  })
})
