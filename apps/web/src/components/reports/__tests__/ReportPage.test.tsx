import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('../../auth/premium-prompt', () => ({
	PremiumPrompt: ({ featureName }: { featureName: string }) => (
		<div data-testid="premium-prompt">{featureName}</div>
	),
}))

vi.mock('../FinancialSummaryReport', () => ({
	FinancialSummaryReport: () => <div data-testid="financial-summary-report" />,
}))

import { ReportPage } from '../ReportPage'

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

describe('ReportPage', () => {
	it('renders the report for an active subscriber', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<ReportPage />)
		expect(screen.getByTestId('financial-summary-report')).toBeInTheDocument()
		expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
	})

	it('renders the report for a lifetime licence holder', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'lifetime', isAuthenticated: true })
		render(<ReportPage />)
		expect(screen.getByTestId('financial-summary-report')).toBeInTheDocument()
	})

	it.each([
		['free' as const, false],
		['past_due' as const, true],
		['canceled' as const, true],
		[null, false],
	])('shows the upgrade surface instead of the report for %s', (subscriptionStatus, isAuth) => {
		mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated: isAuth })
		render(<ReportPage />)

		// Anchored: the gate's featureName keeps the plain name.
		expect(screen.getByTestId('premium-prompt')).toHaveTextContent(/^Financial Summary Report$/)
		expect(screen.queryByTestId('financial-summary-report')).not.toBeInTheDocument()
	})

	it('treats an ERRORED tier check as not premium (fail-closed)', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
		render(<ReportPage />)
		expect(screen.getByTestId('premium-prompt')).toBeInTheDocument()
		expect(screen.queryByTestId('financial-summary-report')).not.toBeInTheDocument()
	})

	it('never renders the report while the tier is still unknown', () => {
		mockStatus({ isLoading: true })
		render(<ReportPage />)

		expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
		expect(screen.queryByTestId('financial-summary-report')).not.toBeInTheDocument()
		expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
	})
})

describe('ReportPage landmarks (story 116.1)', () => {
	it.each([
		['loading', { isLoading: true }],
		['locked', { hasAccess: false, subscriptionStatus: 'free' as const }],
	])('the %s state is exactly one <main>', (_state, overrides) => {
		mockStatus(overrides)
		render(<ReportPage />)
		expect(screen.getAllByRole('main')).toHaveLength(1)
	})
})

describe('ReportPage loading → resolved (story 117.2)', () => {
	it.each([
		['the locked prompt', { hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true }],
		['the paid page', { hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true }],
	] as const)('replaces the loading nodes with %s', (_resolved, status) => {
		mockStatus({ isLoading: true })
		const { container, rerender } = render(<ReportPage />)
		const spinner = screen.getByRole('status', { name: 'Loading' })
		const shell = container.firstElementChild
		expect(shell, 'anti-vacuity: the loading shell rendered').not.toBeNull()

		mockStatus(status)
		rerender(<ReportPage />)

		expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull()
		expect(spinner.isConnected, 'the spinner node was reused').toBe(false)
		expect(shell?.isConnected, 'the loading shell was reused').toBe(false)
	})
})
