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
    expect(premium.getByText('Advanced forecasting and saved scenarios')).toBeInTheDocument()

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
