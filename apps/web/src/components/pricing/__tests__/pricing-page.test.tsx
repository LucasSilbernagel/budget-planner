/**
 * PricingPageView benefit-list guard (stories 25-1 / 25-3).
 *
 * The `/pricing` route renders its plan cards from hard-coded FREE_FEATURES /
 * PREMIUM_FEATURES arrays (separate from the pricing.md prose below them). These
 * guards pin the canonical split so a future edit can't reintroduce "Dark mode"
 * or "No ads" as a Premium perk on this surface — the exact miss this test closes:
 *   - Premium = exactly the 3 canonical benefits (Multi-device sync · Custom
 *     profiles · Advanced forecasting), never Dark mode or No ads.
 *   - Dark mode is a FREE feature (story 25-3).
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PricingPageView } from '../pricing-page'

// Each plan renders as a card <div> whose first child is an <h2>{name}</h2>.
function card(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name, level: 2 })
  const el = heading.closest('div')
  if (!el) throw new Error(`No card container found for the "${name}" plan`)
  return el
}

describe('PricingPageView benefit lists', () => {
  it('lists exactly the three canonical Premium benefits — no Dark mode, no No ads', () => {
    render(<PricingPageView />)
    const premium = within(card('Premium'))

    expect(premium.getByText('Multi-device sync, securely stored in the EU')).toBeInTheDocument()
    expect(premium.getByText('Custom profiles (e.g. personal vs. household)')).toBeInTheDocument()
    expect(
      premium.getByText('Advanced forecasting — save, search, and reload what-if scenarios')
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
