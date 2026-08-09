import { fireEvent, renderWithRouter, screen, within } from '@/test/utils'
import { describe, expect, it, vi } from 'vitest'
import { PremiumPrompt } from './premium-prompt'

/**
 * Premium upgrade-prompt tests (story 20-3, CONTENT-J).
 *
 * Regression guard for the benefit list that Story 25-3 corrected: the prompt
 * must show EXACTLY the canonical Premium benefit set and NO "+ more features
 * coming soon" placeholder. Before this file `premium-prompt.tsx` had no test,
 * so nothing stopped a future edit from reintroducing the placeholder, padding
 * the list past three, or listing a benefit that is actually free/universal
 * (Dark mode → free per 25-3; ad-freeness is universal per 25-1).
 *
 * These pins encode the SCP 2026-07-18 canonical set:
 *   Multi-device sync · Custom profiles · Advanced forecasting.
 *
 * Rendered with `renderWithRouter` because the CTA is a TanStack Router `<Link>`
 * that needs a router in scope (see Footer.test.tsx for the same pattern).
 */

/** The exact benefit strings the prompt must list — and only these three. */
const CANONICAL_BENEFITS = [
  'Multi-Device Data Sync',
  'Custom User Profiles',
  'Advanced Forecasting — What-If Scenarios You Can Save & Reload',
]

describe('PremiumPrompt benefit list (story 20-3)', () => {
  it('lists exactly the three canonical benefits and no more (inline)', async () => {
    renderWithRouter(<PremiumPrompt />)

    const list = await screen.findByRole('list')
    const items = within(list).getAllByRole('listitem')

    // Exactly three — a 4th item or a "coming soon" row would break this.
    expect(items).toHaveLength(3)
    for (const benefit of CANONICAL_BENEFITS) {
      expect(within(list).getByText(benefit)).toBeInTheDocument()
    }
  })

  it('shows no "coming soon" placeholder and no free/universal benefits (inline)', async () => {
    renderWithRouter(<PremiumPrompt />)
    await screen.findByRole('list')

    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
    // Dark mode is free (25-3); "no ads" is universal (25-1) — neither is a perk.
    expect(screen.queryByText(/dark mode/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no ads/i)).not.toBeInTheDocument()
  })

  it('renders as an accessible dialog named "Go Premium" with the same three benefits', async () => {
    renderWithRouter(<PremiumPrompt asDialog onClose={vi.fn()} />)

    const dialog = await screen.findByRole('dialog', { name: /go premium/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const list = within(dialog).getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    for (const benefit of CANONICAL_BENEFITS) {
      expect(within(list).getByText(benefit)).toBeInTheDocument()
    }
    // Same negative guards as the inline mode — both render modes must be clean.
    expect(within(dialog).queryByText(/coming soon/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/dark mode/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/no ads/i)).not.toBeInTheDocument()
  })

  it('closes the dialog on Escape via the shared Modal', async () => {
    const onClose = vi.fn()
    renderWithRouter(<PremiumPrompt asDialog onClose={onClose} />)
    await screen.findByRole('dialog', { name: /go premium/i })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the upgrade CTA as a link pointing at the upgrade target', async () => {
    // The whole `renderWithRouter` harness exists for this <Link>; pin that the
    // primary action renders and routes to `upgradeHref` (PremiumFeatureGate
    // passes `/pricing`), so the CTA cannot silently break or misroute.
    renderWithRouter(<PremiumPrompt upgradeHref="/pricing" />)

    const cta = await screen.findByRole('link', { name: /upgrade to premium/i })
    expect(cta).toHaveAttribute('href', '/pricing')
  })
})
