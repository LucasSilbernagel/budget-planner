import { describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithRouter, screen, within } from '@/test/utils'
import { PREMIUM_BENEFIT_IDS } from '../../lib/premium/benefits'
import { PremiumPrompt } from './premium-prompt'

const CANONICAL_BENEFITS = [
	'Multi-Device Data Sync',
	'Advanced Forecasting — Raises, Rising Bills & One-Off Costs',
	'Custom User Profiles',
	// "Downloadable" is the prompt's decided exception; other surfaces keep the plain name.
	'Downloadable Financial Summary Report',
	'Custom Categories & Category Breakdown',
]

describe('PremiumPrompt benefit list', () => {
	it('lists exactly the canonical benefit set and no more (inline)', async () => {
		renderWithRouter(<PremiumPrompt />)

		const list = await screen.findByRole('list')
		const items = within(list).getAllByRole('listitem')

		expect(items).toHaveLength(PREMIUM_BENEFIT_IDS.length)
		expect(CANONICAL_BENEFITS).toHaveLength(PREMIUM_BENEFIT_IDS.length)
		for (const benefit of CANONICAL_BENEFITS) {
			expect(within(list).getByText(benefit)).toBeInTheDocument()
		}
	})

	it('shows no "coming soon" placeholder and no free/universal benefits (inline)', async () => {
		renderWithRouter(<PremiumPrompt />)
		await screen.findByRole('list')

		expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
		// Dark mode is free and "no ads" is universal: neither is a perk.
		expect(screen.queryByText(/dark mode/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/no ads/i)).not.toBeInTheDocument()
	})

	it('renders as an accessible dialog named "Go Premium" with the same benefit set', async () => {
		renderWithRouter(<PremiumPrompt asDialog onClose={vi.fn()} />)

		const dialog = await screen.findByRole('dialog', { name: /go premium/i })
		expect(dialog).toHaveAttribute('aria-modal', 'true')

		const list = within(dialog).getByRole('list')
		expect(within(list).getAllByRole('listitem')).toHaveLength(PREMIUM_BENEFIT_IDS.length)
		for (const benefit of CANONICAL_BENEFITS) {
			expect(within(list).getByText(benefit)).toBeInTheDocument()
		}
		expect(within(dialog).queryByText(/coming soon/i)).not.toBeInTheDocument()
		expect(within(dialog).queryByText(/dark mode/i)).not.toBeInTheDocument()
		expect(within(dialog).queryByText(/no ads/i)).not.toBeInTheDocument()
	})

	// Exact text: the old copy contained the new one, so a substring pin would pass on it.
	it('footer reads exactly "All data stored in Germany (EU)" in both modes', async () => {
		const { unmount } = renderWithRouter(<PremiumPrompt />)
		await screen.findByRole('list')
		// Inline mode renders nothing but the card, so the body IS the card's scope.
		const inline = document.body
		expect(within(inline).getByText('All data stored in Germany (EU)')).toBeInTheDocument()
		expect(inline.textContent).not.toMatch(/CLOUD Act/)
		unmount()

		renderWithRouter(<PremiumPrompt asDialog onClose={vi.fn()} />)
		const dialog = await screen.findByRole('dialog', { name: /go premium/i })
		expect(within(dialog).getByText('All data stored in Germany (EU)')).toBeInTheDocument()
		expect(dialog.textContent).not.toMatch(/CLOUD Act/)
	})

	it('closes the dialog on Escape via the shared Modal', async () => {
		const onClose = vi.fn()
		renderWithRouter(<PremiumPrompt asDialog onClose={onClose} />)
		await screen.findByRole('dialog', { name: /go premium/i })

		fireEvent.keyDown(document, { key: 'Escape' })

		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('renders the upgrade CTA as a link pointing at the upgrade target', async () => {
		renderWithRouter(<PremiumPrompt upgradeHref="/pricing" />)

		const cta = await screen.findByRole('link', { name: /upgrade to premium/i })
		expect(cta).toHaveAttribute('href', '/pricing')
	})
})
