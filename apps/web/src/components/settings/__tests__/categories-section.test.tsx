import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { lockedName } from '../../../test/locked-name'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
	PremiumPrompt: () => <div data-testid="premium-prompt" />,
}))

import { CategoriesSection } from '../categories-section'

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
	usePremiumAccess.mockReturnValue({
		status: {
			hasAccess: false,
			subscriptionStatus: null,
			isLoading: false,
			error: null,
			isAuthenticated: false,
			...overrides,
		} satisfies PremiumAccessStatus,
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('CategoriesSection', () => {
	it('names the section and explains what a rename does', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<CategoriesSection />)

		expect(screen.getByRole('heading', { level: 2, name: /^categories$/i })).toBeInTheDocument()
		expect(
			screen.getByText(/renaming a category updates every entry that uses it/i)
		).toBeInTheDocument()
	})

	it('links an active Premium user straight to the management page', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<CategoriesSection />)

		const link = screen.getByRole('link', { name: /custom categories/i })
		expect(link).toHaveAttribute('href', '/categories')
		expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
	})

	it.each([
		['free' as const, false],
		['past_due' as const, true],
		['canceled' as const, true],
		[null, false],
	])('shows an inert locked control and no link for %s', (subscriptionStatus, isAuthenticated) => {
		mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated })
		render(<CategoriesSection />)

		expect(
			screen.getByRole('button', { name: lockedName('Custom categories') })
		).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /custom categories/i })).not.toBeInTheDocument()
		expect(screen.getByText('Premium')).toBeInTheDocument()
	})

	it('treats an ERRORED tier check as not premium (fail-closed)', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
		render(<CategoriesSection />)

		expect(screen.getByTestId('premium-gate-locked')).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /custom categories/i })).not.toBeInTheDocument()
	})

	it('leaks neither the link nor the lock while the tier is unknown', () => {
		mockStatus({ isLoading: true })
		render(<CategoriesSection />)

		expect(screen.getByTestId('premium-gate-skeleton')).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /custom categories/i })).not.toBeInTheDocument()
		expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
		expect(screen.queryByText('Premium')).not.toBeInTheDocument()
	})

	it('carries the product name nowhere — the retired brand must not creep back in', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		const { container } = render(<CategoriesSection />)
		// This file is not on the retired-brand allowed list, so no "Budget Planner" prose.
		expect(container.textContent).not.toMatch(/budget planner/i)
	})
})
