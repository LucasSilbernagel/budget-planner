import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@/test/utils'
import { type SessionSeed, SIGNED_OUT_SEED } from '../../context/session-seed'
import { SessionSeedProvider } from '../../context/session-seed-provider'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { useSavingsStore } from '../../stores/savingsStore'
import {
	ANY_LOCKED_NAME,
	expectLockedRowsNamedByVisibleText,
	lockedName,
} from '../../test/locked-name'
import { renderAfterReload } from '../../test/reload-chain'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

import { expectSharedGreen } from '@/test/white-fill-tokens'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../lib/premium/benefits'
import { HomePage, OVERVIEW_BENEFITS } from '../HomePage'

const ROUTED_COUNT = PREMIUM_BENEFIT_IDS.filter(
	(id: PremiumBenefitId) => OVERVIEW_BENEFITS[id].activation === 'route'
).length

const GATED_COUNT = PREMIUM_BENEFIT_IDS.filter(
	(id: PremiumBenefitId) => OVERVIEW_BENEFITS[id].activation !== 'none'
).length

const OPENABLE_ROUTES = PREMIUM_BENEFIT_IDS.flatMap((id) => {
	const benefit = OVERVIEW_BENEFITS[id]
	if (benefit.activation !== 'route') return []
	// Escaped: a featureName may contain regex metacharacters.
	const name = new RegExp(benefit.featureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
	return [[name, benefit.href] as const]
})

const CHASSIS = [
	'flex',
	'w-full',
	'items-center',
	'justify-between',
	'gap-3',
	'rounded-md',
	'border',
	'border-default',
	'px-4',
	'py-3',
] as const

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
	const status = {
		hasAccess: false,
		subscriptionStatus: null,
		isLoading: false,
		error: null,
		isAuthenticated: false,
		...overrides,
	} satisfies PremiumAccessStatus
	usePremiumAccess.mockReturnValue({ status })
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('HomePage premium discovery', () => {
	it('shows Advanced Forecasting locked with a Premium badge for a free user', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		render(<HomePage />)

		const forecasting = screen.getByRole('button', { name: lockedName('Advanced Forecasting') })
		expect(within(forecasting).getByText('Premium')).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /advanced forecasting/i })).not.toBeInTheDocument()
	})

	it('shows a working /forecasting link with no badge for a paid user', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<HomePage />)

		const link = screen.getByRole('link', { name: /advanced forecasting/i })
		expect(link).toHaveAttribute('href', '/forecasting')
		expect(screen.queryByText('Premium')).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: ANY_LOCKED_NAME })).not.toBeInTheDocument()
		expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
	})

	it('57.1: pins the Advanced Forecasting subtitle to honest, situation-based copy', () => {
		// Only claim situations the engine reads: growth rates and dated one-off events.
		// Recurring items have no start year, so no house purchase or early retirement.
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<HomePage />)

		expect(
			screen.getByText(
				'See how a raise, rising bills, a big one-off cost, paying down a loan or saving more each month plays out over the years ahead'
			)
		).toBeInTheDocument()
	})

	it('116.2: every locked row is named by its visible title and description, then "Premium, locked"', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		const { container } = render(<HomePage />)
		expect(expectLockedRowsNamedByVisibleText(container)).toHaveLength(GATED_COUNT)
	})

	it('shows Custom Profiles locked with a Premium badge for a free user (13-3)', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		render(<HomePage />)

		const profiles = screen.getByRole('button', { name: lockedName('Custom Profiles') })
		expect(within(profiles).getByText('Premium')).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /custom profiles/i })).not.toBeInTheDocument()
	})

	it('shows a working /profiles link with no badge for a paid user (13-3)', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<HomePage />)

		const link = screen.getByRole('link', { name: /custom profiles/i })
		expect(link).toHaveAttribute('href', '/profiles')
		expect(
			screen.queryByRole('button', { name: lockedName('Custom Profiles') })
		).not.toBeInTheDocument()
	})

	it('41.1: badges AND gates every benefit including sync, with no page affordance', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		render(<HomePage />)

		const sync = screen.getByTestId('premium-benefit-sync')
		expect(within(sync).getByText('Multi-device sync')).toBeInTheDocument()
		expect(within(sync).getByText('Premium')).toBeInTheDocument()
		const syncButton = screen.getByRole('button', { name: lockedName('Multi-device sync') })
		expect(sync).toContainElement(syncButton)
		expect(within(sync).getByTestId('premium-gate-locked')).toBe(syncButton)

		expect(screen.queryByRole('link', { name: /multi-device sync/i })).not.toBeInTheDocument()
		expect(within(sync).queryByRole('link')).toBeNull()
		expect(within(sync).queryByText('Open →')).toBeNull()
		expect(syncButton).not.toHaveAttribute('href')

		expect(screen.getAllByText('Premium')).toHaveLength(PREMIUM_BENEFIT_IDS.length)
		expect(screen.getAllByTestId('premium-gate-locked')).toHaveLength(GATED_COUNT)
		expect(GATED_COUNT).toBe(PREMIUM_BENEFIT_IDS.length)
	})

	it('41.1: shows no badge on sync while the tier is unresolved, and no lock button', () => {
		mockStatus({ hasAccess: false, isLoading: true, subscriptionStatus: null })
		render(<HomePage />)

		expect(screen.getAllByTestId('premium-gate-skeleton')).toHaveLength(GATED_COUNT)
		expect(screen.queryAllByTestId('premium-gate-locked')).toHaveLength(0)

		const sync = screen.getByTestId('premium-benefit-sync')
		const pending = within(sync).getByTestId('premium-gate-skeleton')
		expect(pending).toHaveAttribute('aria-hidden', 'true')

		expect(within(sync).queryByRole('button')).toBeNull()
		expect(within(sync).queryByText('Premium')).toBeNull()
		expect(within(sync).getByText('Multi-device sync')).toBeInTheDocument()
	})

	it('33.1: badges sync when the tier check errors — fail-closed', () => {
		mockStatus({
			hasAccess: false,
			isLoading: false,
			error: 'network',
			subscriptionStatus: 'free',
			isAuthenticated: false,
		})
		render(<HomePage />)

		const sync = screen.getByTestId('premium-benefit-sync')
		expect(within(sync).getByText('Premium')).toBeInTheDocument()
		expect(within(sync).queryByTestId('premium-gate-skeleton')).toBeNull()
		expect(within(sync).getByTestId('premium-gate-locked')).toBeInTheDocument()
	})

	it('41.1: an entitled user gets the sync box exactly as before — inert, unbadged', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<HomePage />)

		const sync = screen.getByTestId('premium-benefit-sync')
		expect(within(sync).getByText('Multi-device sync')).toBeInTheDocument()
		expect(within(sync).queryByText('Premium')).toBeNull()
		expect(within(sync).queryByTestId('premium-gate-skeleton')).toBeNull()
		expect(within(sync).queryByTestId('premium-gate-locked')).toBeNull()
		expect(within(sync).queryByRole('button')).toBeNull()
		expect(within(sync).queryByRole('link')).toBeNull()
		expect(within(sync).queryByText('Open →')).toBeNull()

		// Anchored structurally (the wrapper's only child): selecting by the asserted class could not fail.
		const syncBox = sync.firstElementChild
		expect(syncBox, "the entitled sync box must be the wrapper's only child").not.toBeNull()
		expect(sync.children).toHaveLength(1)
		const syncBoxTokens = (syncBox?.className ?? '').split(/\s+/)
		expect(syncBoxTokens).toContain('surface-inset')
		expect(syncBoxTokens).not.toContain('surface-interactive')
		expect(syncBoxTokens).not.toContain('transition-colors')

		for (const token of CHASSIS) {
			expect(syncBoxTokens, `the entitled sync box is missing "${token}"`).toContain(token)
		}
		expect(syncBoxTokens.filter((t) => t.startsWith('dark:'))).toEqual([])

		expect(OPENABLE_ROUTES).toHaveLength(ROUTED_COUNT)
		for (const [name, href] of OPENABLE_ROUTES) {
			const link = screen.getByRole('link', { name })
			expect(link).toHaveAttribute('href', href)
			expect(within(link).getByText('Open →')).toBeInTheDocument()
		}
	})

	it('33.2: pins the two new benefit sub-texts verbatim', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		render(<HomePage />)

		expect(
			screen.getByText(
				'A print-ready summary of your budget, net worth and savings, built in your browser'
			)
		).toBeInTheDocument()
		expect(
			screen.getByText('Group your income and expenses your way, and see what each category totals')
		).toBeInTheDocument()
	})

	it('30-1: every premium benefit box shares one chassis', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		render(<HomePage />)

		const tiles = screen.getAllByTestId('premium-gate-locked')
		expect(tiles).toHaveLength(GATED_COUNT)

		for (const box of tiles) {
			const tokens = box.className.split(/\s+/)
			for (const token of CHASSIS) {
				expect(tokens, `${box.dataset.testid ?? 'tile'} is missing "${token}"`).toContain(token)
			}
			expect(tokens.filter((t) => t.startsWith('dark:'))).toEqual([])
			const RETIRED = ['bg-blue-50', 'border-blue-200', 'hover:bg-blue-100']
			expect(tokens.filter((t) => RETIRED.includes(t))).toEqual([])
		}

		for (const tile of tiles) {
			const tokens = tile.className.split(/\s+/)
			expect(tokens).toContain('surface-interactive')
			expect(tokens).toContain('focus-visible:ring-2')
			expect(tokens).toContain('focus-visible:ring-blue-500')
			// Never both background tokens on one element: they collide by source order.
			expect(tokens).not.toContain('surface-inset')
		}

		expect(screen.getByTestId('premium-benefit-sync')).toContainElement(
			screen.getByRole('button', { name: lockedName('Multi-device sync') })
		)
	})

	it('30-1: the unlocked (paid) tiles carry the chassis and the accent', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<HomePage />)

		const links = OPENABLE_ROUTES.map(([name]) => screen.getByRole('link', { name }))
		expect(links).toHaveLength(ROUTED_COUNT)

		for (const link of links) {
			const tokens = link.className.split(/\s+/)
			for (const token of ['flex', 'w-full', 'rounded-md', 'border', 'border-default', 'px-4']) {
				expect(tokens).toContain(token)
			}
			expect(tokens).toContain('surface-interactive')
			expect(tokens).toContain('focus-visible:ring-blue-500')
			expect(tokens.filter((t) => t.startsWith('dark:'))).toEqual([])

			const open = within(link).getByText('Open →')
			expect(open.className.split(/\s+/)).toContain('text-accent')
		}
	})

	it('41.1: every locked box carries a persistent chevron, sync included', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		render(<HomePage />)

		const tiles = screen.getAllByTestId('premium-gate-locked')
		expect(tiles).toHaveLength(GATED_COUNT)
		for (const tile of tiles) {
			const chevron = within(tile).getByText('›')
			expect(chevron.className.split(/\s+/)).toContain('text-accent')
			expect(chevron).toHaveAttribute('aria-hidden', 'true')
		}

		const syncChevron = within(screen.getByTestId('premium-benefit-sync')).getByText('›')
		expect(syncChevron.className.split(/\s+/)).not.toContain('invisible')
		expect(syncChevron).toHaveAttribute('aria-hidden', 'true')
		for (const tile of tiles) {
			expect(within(tile).getByText('›').className.split(/\s+/)).not.toContain('invisible')
		}
	})

	it('41.1: activating the sync box opens the SHARED upgrade dialog', async () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		renderWithRouter(<HomePage />)

		// RouterProvider resolves its route asynchronously, so the box must be awaited.
		const sync = await screen.findByTestId('premium-benefit-sync')
		expect(screen.queryByRole('dialog', { name: /go premium/i })).not.toBeInTheDocument()

		fireEvent.click(within(sync).getByRole('button', { name: lockedName('Multi-device sync') }))

		const dialog = await screen.findByRole('dialog', { name: /go premium/i })
		expect(within(dialog).getByRole('link', { name: /upgrade to premium/i })).toHaveAttribute(
			'href',
			'/pricing'
		)
		expect(within(dialog).getAllByRole('listitem')).toHaveLength(PREMIUM_BENEFIT_IDS.length)

		expect(sync).toContainElement(dialog)
	})

	it("41.1: an ENTITLED user still gets sync's reserved, unpainted chevron", () => {
		// invisible keeps the glyph's layout box so the row lines up with the "Open →" rows.
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<HomePage />)

		const syncChevron = within(screen.getByTestId('premium-benefit-sync')).getByText('›')
		expect(syncChevron.className.split(/\s+/)).toContain('invisible')
		expect(syncChevron).toHaveAttribute('aria-hidden', 'true')
	})

	it('20-2: explains Custom Profiles with a concrete example (CONTENT-H)', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		render(<HomePage />)

		expect(
			screen.getByText(
				'Keep separate finances — e.g. personal vs. household — and switch without mixing the numbers'
			)
		).toBeInTheDocument()
	})
})

describe('subtitle parity: HomePage and login', () => {
	const SUBTITLE = 'Track your finances with privacy and control'
	const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8')

	it('both first-contact surfaces render the identical subtitle string', () => {
		expect(read('../HomePage.tsx')).toContain(`>${SUBTITLE}</p>`)
		expect(read('../../routes/login.tsx')).toContain(`>${SUBTITLE}</p>`)
	})

	it('neither surface has re-grown a trailing period', () => {
		expect(read('../HomePage.tsx')).not.toContain(`>${SUBTITLE}.</p>`)
		expect(read('../../routes/login.tsx')).not.toContain(`>${SUBTITLE}.</p>`)
	})
})

describe('HomePage subtitle', () => {
	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
	})

	it('surfaces the new subtitle while keeping the app name', () => {
		render(<HomePage />)
		expect(screen.getByText('Track your finances with privacy and control')).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'Longhand Budget', level: 1 })).toBeInTheDocument()
		expect(screen.queryByText(/solubudget/i)).toBeNull()
		expect(screen.queryByText(/minds its own business/i)).toBeNull()
		expect(screen.queryByText('The budget planner that never sees your money')).toBeNull()
	})
})

describe('HomePage overview subtitle + mobile padding', () => {
	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
	})

	it("no longer renders the bird's-eye secondary subtitle", () => {
		render(<HomePage />)
		expect(screen.getByText('Track your finances with privacy and control')).toBeInTheDocument()
		expect(
			screen.queryByText("Get a bird's-eye view of your income, expenses, savings, and more!")
		).toBeNull()
	})

	it('Premium Features section is mobile-tight (p-4) and restores padding at sm (sm:p-6)', () => {
		render(<HomePage />)
		const section = screen
			.getByRole('heading', { name: 'Premium Features', level: 2 })
			.closest('section')
		expect(section).not.toBeNull()
		const tokens = (section as HTMLElement).className.split(/\s+/)
		expect(tokens).toContain('p-4')
		expect(tokens).toContain('sm:p-6')
	})

	it('empty-state onboarding section is mobile-tight (p-4) and restores padding at sm (sm:p-6)', () => {
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useSavingsStore.setState({ savingsGoals: [] })
		useBalanceStore.setState({ entries: [] })
		render(<HomePage />)
		const section = screen.getByText("Let's set up your budget").closest('section')
		expect(section).not.toBeNull()
		const tokens = (section as HTMLElement).className.split(/\s+/)
		expect(tokens).toContain('p-4')
		expect(tokens).toContain('sm:p-6')
		expectSharedGreen(screen.getByRole('link', { name: '+ Add income' }))
	})
})

describe('HomePage privacy positioning', () => {
	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
	})

	it('surfaces the "without bank sync or AI integrations" framing', () => {
		render(<HomePage />)
		expect(
			screen.getByText('Intentional budgeting without bank sync or AI integrations.')
		).toBeInTheDocument()
		expect(screen.queryByText('Intentional budgeting without the bank sync.')).toBeNull()
	})

	it('states the no-AI claim once, on the framing line and not the pillars line', () => {
		render(<HomePage />)
		const pillars = screen.getByText(
			/No account needed · Optional sync is EU-hosted · No bank connection\./
		)
		expect(pillars).toBeInTheDocument()

		const framing = screen.getByText('Intentional budgeting without bank sync or AI integrations.')
		expect(framing).toHaveTextContent(/\bAI\b/)
		expect(pillars).not.toHaveTextContent(/\bAI\b|artificial intelligence/i)
	})

	it('states the three privacy pillars with EU-hosting scoped to the optional sync (no over-claiming)', () => {
		render(<HomePage />)
		expect(
			screen.getByText('No account needed · Optional sync is EU-hosted · No bank connection.')
		).toBeInTheDocument()
	})
})

describe('95.1: the account notice is hidden for any signed-in session', () => {
	const PILLARS = 'No account needed · Optional sync is EU-hosted · No bank connection.'
	const SUBTITLE = 'Track your finances with privacy and control'

	function renderWithSeed(seed: SessionSeed | null) {
		return render(
			<SessionSeedProvider seed={seed}>
				<HomePage />
			</SessionSeedProvider>
		)
	}

	it.each(['free', 'active', 'lifetime', 'past_due', 'canceled'] as const)(
		'renders no notice for a signed-in %s session',
		(subscriptionStatus) => {
			const entitled = subscriptionStatus === 'active' || subscriptionStatus === 'lifetime'
			mockStatus({ hasAccess: entitled, subscriptionStatus, isAuthenticated: true })
			renderWithSeed({
				isAuthenticated: true,
				userId: 'u1',
				email: 'u1@example.test',
				subscriptionStatus,
			})

			expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
			expect(screen.queryByText(PILLARS)).toBeNull()
			expect(
				screen.queryByText('Intentional budgeting without bank sync or AI integrations.')
			).toBeNull()
		}
	)

	it.each([
		['signed-out', SIGNED_OUT_SEED],
		['unverified (null)', null],
	] as const)('still renders the notice for a %s seed', (_label, seed) => {
		mockStatus({ hasAccess: false, subscriptionStatus: null, isAuthenticated: false })
		renderWithSeed(seed)

		expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
		expect(screen.getByText(PILLARS)).toBeInTheDocument()
		expect(
			screen.getByText('Intentional budgeting without bank sync or AI integrations.')
		).toBeInTheDocument()
	})
})

describe('HomePage "Manage Your Finances" tiles removed', () => {
	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
	})

	it('the "Manage Your Finances" section is not rendered', () => {
		render(<HomePage />)
		expect(screen.queryByRole('heading', { name: 'Manage Your Finances' })).toBeNull()
	})

	it('the tile-only "Projections" destination link is no longer on the overview', () => {
		render(<HomePage />)
		expect(screen.queryByRole('link', { name: 'Projections' })).toBeNull()
	})
})

describe('HomePage financial overview copy', () => {
	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		useIncomeStore.setState({ incomeSources: [] })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	it('stat cards read in plain language with no "Normalized"/"Raw" jargon', () => {
		render(<HomePage />)
		expect(screen.getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)).toBeInTheDocument()
		expect(
			screen.getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
		).toBeInTheDocument()
		expect(screen.queryByText(/Normalized/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/^Raw:/)).not.toBeInTheDocument()
	})

	it('a normalized non-monthly amount drops the "Raw:" line and reveals the conversion (with the raw total) progressively on focus', async () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'test-weekly',
					userId: 0,
					categoryId: null,
					name: 'Weekly gig',
					amount: 10000,
					frequency: 'weekly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
		render(<HomePage />)

		expect(screen.queryByText(/^Raw:/)).not.toBeInTheDocument()

		const trigger = screen.getByRole('button', {
			name: /more information about the income figure/i,
		})
		expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
		expect(trigger).not.toHaveAttribute('aria-describedby')

		fireEvent.focus(trigger)
		const tooltip = await screen.findByRole('tooltip')
		expect(trigger).toHaveAttribute('aria-describedby')
		expect(tooltip).toHaveTextContent(
			/convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable/i
		)
		expect(tooltip).toHaveTextContent(/about 4\.33 weeks a month/i)
		expect(tooltip).toHaveTextContent(/these totals are estimates/i)
		expect(tooltip).toHaveTextContent(/entered total before conversion/i)
	})
})

describe('HomePage financial overview — no Financial Health score', () => {
	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		useIncomeStore.setState({ incomeSources: [] })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	it('the "Financial Health" card and its percentage are gone', () => {
		render(<HomePage />)
		expect(screen.queryByText('Financial Health')).not.toBeInTheDocument()
		expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument()
	})

	it('the three remaining overview cards still render', () => {
		render(<HomePage />)
		expect(screen.getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)).toBeInTheDocument()
		expect(
			screen.getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
		).toBeInTheDocument()
		expect(screen.getByText('Net Worth')).toBeInTheDocument()
	})

	it('the "Net Period Income" card and its figure are gone', () => {
		render(<HomePage />)
		expect(screen.queryByText('Net Period Income')).not.toBeInTheDocument()
	})

	it('the overview grid reflows to three columns (no 4-column gap on desktop)', () => {
		render(<HomePage />)
		const heading = screen.getByRole('heading', { name: 'Financial Overview' })
		const grid = heading.closest('section')?.querySelector('div.grid')
		expect(grid).not.toBeNull()
		expect(grid?.className).toContain('md:grid-cols-3')
		expect(grid?.className).not.toContain('md:grid-cols-4')
		expect(grid?.children.length).toBe(3)
	})
})

describe('HomePage overview duration selector', () => {
	function seedMonthly(): void {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-monthly',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 120000,
					frequency: 'monthly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-monthly',
					userId: 0,
					categoryId: null,
					name: 'Rent',
					amount: 60000,
					frequency: 'monthly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
	}

	function incomeCard(): HTMLElement {
		return screen
			.getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)
			.closest('div.surface-inset') as HTMLElement
	}

	function expenseCard(): HTMLElement {
		return screen
			.getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
			.closest('div.surface-inset') as HTMLElement
	}

	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
	})

	it('renders one selector defaulting to Annually, with annual card labels', () => {
		render(<HomePage />)

		const select = screen.getByRole('combobox', {
			name: /show income and expenses per/i,
		}) as HTMLSelectElement
		expect(select.value).toBe('annually')

		expect(screen.getAllByRole('combobox', { name: /show income and expenses per/i })).toHaveLength(
			1
		)
		expect(screen.getByText('Total Income (per year)')).toBeInTheDocument()
		expect(screen.getByText('Total Expenses (per year)')).toBeInTheDocument()

		expect(Array.from(select.options).map((option) => option.value)).toEqual([
			'weekly',
			'biweekly',
			'monthly',
			'annually',
		])
	})

	it('figures start annual and re-express when the duration changes', () => {
		seedMonthly()
		render(<HomePage />)

		expect(within(incomeCard()).getByText('14,400.00')).toBeInTheDocument()
		expect(within(expenseCard()).getByText('7,200.00')).toBeInTheDocument()

		fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
			target: { value: 'monthly' },
		})
		expect(screen.getByText('Total Income (per month)')).toBeInTheDocument()
		expect(within(incomeCard()).getByText('1,200.00')).toBeInTheDocument()
		expect(within(expenseCard()).getByText('600.00')).toBeInTheDocument()

		fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
			target: { value: 'weekly' },
		})
		expect(screen.getByText('Total Income (per week)')).toBeInTheDocument()
		expect(within(incomeCard()).getByText('276.92')).toBeInTheDocument()
		expect(within(expenseCard()).getByText('138.46')).toBeInTheDocument()

		fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
			target: { value: 'biweekly' },
		})
		expect(screen.getByText('Total Income (per 2 weeks)')).toBeInTheDocument()
		expect(within(incomeCard()).getByText('553.85')).toBeInTheDocument()
		expect(within(expenseCard()).getByText('276.92')).toBeInTheDocument()
	})

	// Weekly $330 + annual $1,200 normalizes to exactly the raw sum, so the disclosure
	// must not be gated on normalized !== raw.
	it('discloses the conversion even when it lands coincidentally on the raw sum', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-weekly',
					userId: 0,
					categoryId: null,
					name: 'Weekly',
					amount: 33000,
					frequency: 'weekly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
				{
					id: 'inc-annual',
					userId: 0,
					categoryId: null,
					name: 'Annual',
					amount: 120000,
					frequency: 'annually',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
		useExpenseStore.setState({ expenses: [] })
		render(<HomePage />)

		expect(
			screen.getByRole('button', { name: /more information about the income figure/i })
		).toBeInTheDocument()
	})

	it('shows no conversion disclosure when every row is already monthly', () => {
		seedMonthly()
		render(<HomePage />)

		expect(
			screen.queryByRole('button', { name: /more information about the income figure/i })
		).not.toBeInTheDocument()
	})

	it('the selection is a single source of truth that survives remount', () => {
		const { unmount } = render(<HomePage />)

		fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
			target: { value: 'monthly' },
		})
		expect(
			(screen.getByRole('combobox', { name: /show income and expenses per/i }) as HTMLSelectElement)
				.value
		).toBe('monthly')

		unmount()
		render(<HomePage />)
		const select = screen.getByRole('combobox', {
			name: /show income and expenses per/i,
		}) as HTMLSelectElement
		expect(select.value).toBe('monthly')
		expect(screen.getByText('Total Income (per month)')).toBeInTheDocument()
	})
})

describe('HomePage income-vs-expense breakdown period control', () => {
	function seedMixedFrequencyIncome(): void {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-weekly',
					userId: 0,
					categoryId: null,
					name: 'Weekly gig',
					amount: 10000,
					frequency: 'weekly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
				{
					id: 'inc-annual',
					userId: 0,
					categoryId: null,
					name: 'Annual bonus',
					amount: 10000,
					frequency: 'annually',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
	}

	function breakdownSelect(): HTMLSelectElement {
		return screen.getByRole('combobox', { name: /show breakdown per/i }) as HTMLSelectElement
	}

	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
	})

	it('offers the four shared durations, defaulting to Annually, with no preset labels', () => {
		seedMixedFrequencyIncome()
		render(<HomePage />)

		const select = breakdownSelect()
		expect(select.value).toBe('annually')

		const optionValues = Array.from(select.options).map((o) => o.value)
		expect(optionValues).toEqual(['weekly', 'biweekly', 'monthly', 'annually'])
		const optionLabels = Array.from(select.options).map((o) => o.textContent)
		expect(optionLabels).toEqual(['Weekly', 'Bi-weekly', 'Monthly', 'Annually'])

		expect(screen.queryByText(/Last Month/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/Last 3 Months/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/Year to Date/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/Custom Range/i)).not.toBeInTheDocument()
	})

	it('category figures are frequency-normalized and re-express when the period changes', () => {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-weekly',
					userId: 0,
					categoryId: null,
					name: 'Weekly gig',
					amount: 10000,
					frequency: 'weekly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
				{
					id: 'exp-annual',
					userId: 0,
					categoryId: null,
					name: 'Annual bonus',
					amount: 10000,
					frequency: 'annually',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-weekly',
					userId: 0,
					categoryId: null,
					name: 'Weekly salary',
					amount: 15000,
					frequency: 'weekly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
				{
					id: 'inc-annual',
					userId: 0,
					categoryId: null,
					name: 'Annual dividend',
					amount: 15000,
					frequency: 'annually',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
		render(<HomePage />)

		expect(screen.getByText('5,199.96')).toBeInTheDocument()
		expect(screen.getByText('99.96')).toBeInTheDocument()
		expect(screen.queryByText('100.00')).not.toBeInTheDocument()
		expect(screen.getByTestId('breakdown-pie-total-expense-ratio')).toHaveTextContent('66.7%')

		fireEvent.change(breakdownSelect(), { target: { value: 'monthly' } })
		expect(breakdownSelect().value).toBe('monthly')
		expect(screen.getByText('433.33')).toBeInTheDocument()
		expect(screen.getByText('8.33')).toBeInTheDocument()
		expect(screen.queryByText('5,199.96')).not.toBeInTheDocument()
		expect(screen.queryByText('99.96')).not.toBeInTheDocument()
		expect(screen.getByTestId('breakdown-pie-total-expense-ratio')).toHaveTextContent('66.7%')
	})

	it('changing EITHER selector moves BOTH the overview card and the pies', () => {
		seedMixedFrequencyIncome()
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-weekly',
					userId: 0,
					categoryId: null,
					name: 'Weekly gig',
					amount: 12000,
					frequency: 'weekly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
				{
					id: 'exp-annual',
					userId: 0,
					categoryId: null,
					name: 'Annual bonus',
					amount: 6000,
					frequency: 'annually',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
		render(<HomePage />)

		const overviewSelect = () =>
			screen.getByRole('combobox', { name: /show income and expenses per/i }) as HTMLSelectElement
		const cardText = () => screen.getByTestId('overview-total-income').textContent
		const breakdownSection = (): HTMLElement => {
			const section = screen
				.getByRole('heading', { name: 'Income vs Expense Breakdown' })
				.closest('section')
			if (!(section instanceof HTMLElement)) throw new Error('breakdown <section> not found')
			return section
		}

		expect(overviewSelect().value).toBe('annually')
		expect(breakdownSelect().value).toBe('annually')
		expect(cardText()).toContain('5,299.92')
		expect(within(breakdownSection()).getByText('6,300.00')).toBeInTheDocument()

		fireEvent.change(breakdownSelect(), { target: { value: 'monthly' } })
		expect(overviewSelect().value).toBe('monthly')
		expect(cardText()).toContain('441.66')
		expect(within(breakdownSection()).getByText('525.00')).toBeInTheDocument()

		fireEvent.change(overviewSelect(), { target: { value: 'annually' } })
		expect(breakdownSelect().value).toBe('annually')
		expect(cardText()).toContain('5,299.92')
		expect(within(breakdownSection()).getByText('6,300.00')).toBeInTheDocument()
	})

	it('each pie title states the period, so it is never implicit', () => {
		seedMixedFrequencyIncome()
		render(<HomePage />)

		expect(screen.getByText('Expenses as % of income (per year)')).toBeInTheDocument()
		expect(screen.getByText('Expenses by category (per year)')).toBeInTheDocument()

		fireEvent.change(breakdownSelect(), { target: { value: 'weekly' } })
		expect(screen.getByText('Expenses as % of income (per week)')).toBeInTheDocument()
		expect(screen.getByText('Expenses by category (per week)')).toBeInTheDocument()
	})

	// Pies scale each entry then sum; cards sum then scale once. They differ only at
	// the non-integral periods, so the note must appear at exactly those.
	it('the pies disclose per-entry rounding at weekly and biweekly only', () => {
		seedMixedFrequencyIncome()
		render(<HomePage />)

		expect(screen.queryByTestId('breakdown-pies-rounding-note')).not.toBeInTheDocument()

		fireEvent.change(breakdownSelect(), { target: { value: 'weekly' } })
		expect(screen.getByTestId('breakdown-pies-rounding-note')).toBeInTheDocument()

		expect(screen.getByTestId('breakdown-pies-rounding-note')).toHaveTextContent(
			/Each entry is rounded on its own/
		)
		expect(screen.getByTestId('breakdown-pies-rounding-note')).not.toHaveTextContent(
			/Each category is rounded/
		)
		expect(screen.getByTestId('breakdown-pies-rounding-note')).toHaveTextContent(
			/about half a cent per entry/
		)

		fireEvent.change(breakdownSelect(), { target: { value: 'biweekly' } })
		expect(screen.getByTestId('breakdown-pies-rounding-note')).toBeInTheDocument()

		fireEvent.change(breakdownSelect(), { target: { value: 'monthly' } })
		expect(screen.queryByTestId('breakdown-pies-rounding-note')).not.toBeInTheDocument()
	})

	it('no rounding note when both pies are EMPTY (balances-only user)', () => {
		useBalanceStore.setState({
			entries: [
				{
					id: 'b1',
					type: 'investment',
					name: 'ISA',
					currentBalance: 500_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: '2026-08-15T00:00:00.000Z',
					updatedAt: '2026-08-15T00:00:00.000Z',
				},
			],
		})
		useOverviewDurationStore.setState({ duration: 'weekly' })
		render(<HomePage />)

		expect(screen.getByText('No income to compare against yet')).toBeInTheDocument()
		expect(screen.getByText('No expenses to break down yet')).toBeInTheDocument()
		expect(screen.queryByTestId('breakdown-pies-rounding-note')).not.toBeInTheDocument()

		useBalanceStore.setState({ entries: [] })
	})

	it('a user with income but no expenses yet sees a 0% ratio, not an empty/broken pie', () => {
		// expenseRatioData gates emptiness on income rows, so this renders one
		// "Remaining income" slice rather than the empty state.
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-only',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 500000,
					frequency: 'monthly',
					createdAt: '2026-08-15T00:00:00.000Z',
					updatedAt: '2026-08-15T00:00:00.000Z',
				},
			],
		})
		render(<HomePage />)

		const ratioPie = screen.getByTestId('breakdown-pie-expense-ratio')
		expect(within(ratioPie).queryByText('No income to compare against yet')).not.toBeInTheDocument()
		expect(screen.getByTestId('breakdown-pie-total-expense-ratio')).toHaveTextContent('0%')
		expect(within(ratioPie).getAllByRole('listitem')).toHaveLength(1)
		expect(within(ratioPie).getByText('Remaining income')).toBeInTheDocument()
		expect(within(ratioPie).getByText(/100%/)).toBeInTheDocument()

		expect(screen.getByText('No expenses to break down yet')).toBeInTheDocument()
	})

	it('no rounding note for a SINGLE entry, where divergence is impossible', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-only',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 10000,
					frequency: 'weekly',
					createdAt: '2026-08-15T00:00:00.000Z',
					updatedAt: '2026-08-15T00:00:00.000Z',
				},
			],
		})
		useOverviewDurationStore.setState({ duration: 'biweekly' })
		render(<HomePage />)

		expect(screen.queryByTestId('breakdown-pies-rounding-note')).not.toBeInTheDocument()
	})
})

describe('HomePage asset/liability breakdown removed', () => {
	function seedIncomeAndSavings(): void {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 500000,
					frequency: 'monthly',
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
		useSavingsStore.setState({
			savingsGoals: [
				{
					id: 'sav-1',
					name: 'Emergency Fund',
					targetAmount: 1000000,
					currentBalance: 250000,
					createdAt: '2026-07-04T00:00:00.000Z',
					updatedAt: '2026-07-04T00:00:00.000Z',
				},
			],
		})
	}

	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useSavingsStore.setState({ savingsGoals: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useSavingsStore.setState({ savingsGoals: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
	})

	it('the redundant "Asset & Liability Breakdown" pie and its heading are gone', () => {
		seedIncomeAndSavings()
		render(<HomePage />)
		expect(
			screen.queryByRole('heading', { name: /asset & liability breakdown/i })
		).not.toBeInTheDocument()
	})

	it('the "Financial Category Summary" bar chart remains as the sole carrier of the Savings/Investments/Debts figures', () => {
		seedIncomeAndSavings()
		render(<HomePage />)
		expect(screen.getByRole('heading', { name: /financial category summary/i })).toBeInTheDocument()
	})

	it('income and expenses render as two separately-headed breakdown pies (asset & liability pie still gone)', () => {
		seedIncomeAndSavings()
		render(<HomePage />)
		expect(
			screen.getByRole('heading', { name: /income vs expense breakdown/i })
		).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: /expenses as % of income/i })).toBeInTheDocument()
		expect(screen.queryByRole('heading', { name: /income by category/i })).toBeNull()
		expect(screen.queryByRole('heading', { name: /income by source/i })).toBeNull()
		expect(screen.getByRole('heading', { name: /expenses by category/i })).toBeInTheDocument()
		expect(screen.queryByRole('heading', { name: /asset & liability breakdown/i })).toBeNull()
	})
})

describe('HomePage flows/balances split', () => {
	const TS = '2026-07-14T00:00:00.000Z'

	function seedIncome(amountCents: number): void {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: amountCents,
					frequency: 'monthly',
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
	}

	function seedExpense(amountCents: number): void {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-1',
					userId: 0,
					categoryId: null,
					name: 'Rent',
					amount: amountCents,
					frequency: 'monthly',
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
	}

	function seedSavings(balanceCents: number): void {
		useSavingsStore.setState({
			savingsGoals: [
				{
					id: 'sav-1',
					name: 'Emergency Fund',
					targetAmount: 1000000,
					currentBalance: balanceCents,
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
	}

	function seedBalances(): void {
		useBalanceStore.setState({
			entries: [
				{
					id: 'inv-1',
					type: 'investment',
					name: '401k',
					currentBalance: 800000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: TS,
					updatedAt: TS,
				},
				{
					id: 'debt-1',
					type: 'debt',
					name: 'Car Loan',
					currentBalance: 300000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: TS,
					updatedAt: TS,
				},
			],
		})
	}

	function resetAll(): void {
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useSavingsStore.setState({ savingsGoals: [] })
		useBalanceStore.setState({ entries: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
	}

	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		resetAll()
	})

	afterEach(resetAll)

	it('renders separate "Income & expenses" and "Balances" sub-charts when both exist', () => {
		seedIncome(500000)
		seedExpense(200000)
		seedSavings(500000)
		seedBalances()
		render(<HomePage />)
		expect(screen.getByRole('heading', { name: /financial category summary/i })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: /^income & expenses/i })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: /^balances$/i })).toBeInTheDocument()
		expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
	})

	it('the flows sub-heading carries the overview-duration suffix (not regressing #8)', () => {
		seedIncome(500000)
		seedExpense(200000)
		render(<HomePage />)
		expect(
			screen.getByRole('heading', { name: 'Income & expenses (per year)' })
		).toBeInTheDocument()

		fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
			target: { value: 'monthly' },
		})
		expect(
			screen.getByRole('heading', { name: 'Income & expenses (per month)' })
		).toBeInTheDocument()
		expect(
			screen.queryByRole('heading', { name: 'Income & expenses (per year)' })
		).not.toBeInTheDocument()
	})

	it('a genuinely balances-only user (no income/expense rows) still reaches the Balances sub-chart', () => {
		seedSavings(250000)
		render(<HomePage />)
		expect(screen.queryByText(/let's set up your budget/i)).not.toBeInTheDocument()
		expect(screen.getByRole('heading', { name: /^balances$/i })).toBeInTheDocument()
		expect(screen.queryByRole('heading', { name: /^income & expenses/i })).not.toBeInTheDocument()
		expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
	})

	it('with only flows (no balances), the balances sub-chart is hidden', () => {
		seedIncome(500000)
		seedExpense(200000)
		render(<HomePage />)
		expect(screen.getByRole('heading', { name: /^income & expenses/i })).toBeInTheDocument()
		expect(screen.queryByRole('heading', { name: /^balances$/i })).not.toBeInTheDocument()
		expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
	})

	it('with neither flows nor balances present, the section shows the empty hint', () => {
		seedIncome(0)
		render(<HomePage />)
		expect(screen.getByText(/no financial data to display/i)).toBeInTheDocument()
		expect(screen.queryByRole('heading', { name: /^income & expenses/i })).not.toBeInTheDocument()
		expect(screen.queryByRole('heading', { name: /^balances$/i })).not.toBeInTheDocument()
	})
})

describe('HomePage net worth includes savings', () => {
	const NW_TS = '2026-08-15T00:00:00.000Z'

	function resetAll(): void {
		useIncomeStore.setState({ incomeSources: [] })
		useExpenseStore.setState({ expenses: [] })
		useSavingsStore.setState({ savingsGoals: [] })
		useBalanceStore.setState({ entries: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
	}

	beforeEach(() => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		resetAll()
	})

	afterEach(resetAll)

	function seedSavings(): void {
		useSavingsStore.setState({
			savingsGoals: [
				{
					id: 'sav-1',
					name: 'Emergency fund',
					targetAmount: 1_000_000,
					currentBalance: 250_000,
					createdAt: NW_TS,
					updatedAt: NW_TS,
				},
				{
					id: 'sav-2',
					name: 'Rainy day',
					targetAmount: null,
					currentBalance: 50_000,
					createdAt: NW_TS,
					updatedAt: NW_TS,
				},
			],
		})
	}

	function seedBalances(): void {
		useBalanceStore.setState({
			entries: [
				{
					id: 'inv-1',
					type: 'investment',
					name: 'ISA',
					currentBalance: 800_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: NW_TS,
					updatedAt: NW_TS,
				},
				{
					id: 'inv-2',
					type: 'investment',
					name: 'Pension',
					currentBalance: 1_200_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: NW_TS,
					updatedAt: NW_TS,
				},
				{
					id: 'debt-1',
					type: 'debt',
					name: 'Mortgage',
					currentBalance: 15_000_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: NW_TS,
					updatedAt: NW_TS,
				},
			],
		})
	}

	it('adds savings into the Overview net-worth figure', () => {
		seedSavings()
		seedBalances()
		render(<HomePage />)

		expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('-127,000.00')
		expect([...screen.getByTestId('overview-net-worth').classList]).toEqual(
			expect.arrayContaining(['text-red-600', 'dark:text-red-400'])
		)
		expect([...screen.getByTestId('overview-total-expenses').classList]).toEqual(
			expect.arrayContaining(['text-red-600', 'dark:text-red-400'])
		)
		expect([...screen.getByTestId('overview-total-income').classList]).toEqual(
			expect.arrayContaining(['text-green-600', 'dark:text-green-400'])
		)
	})

	it('no longer shows the pre-32.2 investments-minus-debts figure', () => {
		seedSavings()
		seedBalances()
		render(<HomePage />)

		expect(screen.getByTestId('overview-net-worth')).not.toHaveTextContent('-130,000.00')
	})

	it('the net-worth tooltip names savings as a component', async () => {
		seedSavings()
		seedBalances()
		render(<HomePage />)

		const trigger = screen.getByRole('button', { name: /more information about net worth/i })
		fireEvent.focus(trigger)
		const tooltip = await screen.findByRole('tooltip')

		expect(tooltip).toHaveTextContent(/savings/i)
		expect(tooltip).not.toHaveTextContent(/your investments minus your debts/i)
		expect(tooltip).toHaveTextContent(/balance/i)
	})

	it('a savings-only user sees a positive net worth equal to their savings', () => {
		seedSavings()
		render(<HomePage />)

		expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('3,000.00')
		expect([...screen.getByTestId('overview-net-worth').classList]).toEqual(
			expect.arrayContaining(['text-purple-600', 'dark:text-purple-400'])
		)
	})

	it('a savings-only user is NOT told the figure is untracked', () => {
		seedSavings()
		render(<HomePage />)

		expect(screen.queryByTestId('net-worth-empty-hint')).not.toBeInTheDocument()
	})

	it('a user with only flows still sees the hint, now naming both pages', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 500_000,
					frequency: 'monthly',
					createdAt: NW_TS,
					updatedAt: NW_TS,
				},
			],
		})
		render(<HomePage />)

		const hint = screen.getByTestId('net-worth-empty-hint')
		expect(hint).toBeInTheDocument()
		expect(hint.textContent).toMatch(/savings/i)
	})

	it('shows zero, not NaN, with no balances and no savings', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 500_000,
					frequency: 'monthly',
					createdAt: NW_TS,
					updatedAt: NW_TS,
				},
			],
		})
		render(<HomePage />)

		const netWorth = screen.getByTestId('overview-net-worth')
		expect(netWorth).toHaveTextContent('0.00')
		expect(netWorth.textContent).not.toMatch(/NaN/)
	})
})

// The section's visibility follows the session seed, not the usePremiumAccess mock;
// other tests here have a null seed and always see the section.
describe('58.2: the Premium Features section is tier-conditional', () => {
	// The inner span: the outer one's textContent is title + subtitle.
	function benefitTitles(): ReadonlyArray<readonly [PremiumBenefitId, string]> {
		return PREMIUM_BENEFIT_IDS.map((id) => {
			const Label = OVERVIEW_BENEFITS[id].label
			const { container, unmount } = render(<Label />)
			const spans = container.querySelectorAll('span')
			const title = spans[1]?.textContent ?? ''
			unmount()
			expect(spans.length, `"${id}" label must wrap a title + subtitle`).toBeGreaterThanOrEqual(3)
			expect(title.length, `"${id}" must render a non-empty title`).toBeGreaterThan(0)
			expect(title, `"${id}" title looks like a subtitle`).not.toMatch(/\s\w+\s\w+\s\w+\s\w+\s/)
			return [id, title] as const
		})
	}

	// Built in beforeAll: rendering during describe collection aborts the whole file on failure.
	let BENEFIT_TITLES: ReadonlyArray<readonly [PremiumBenefitId, string]> = []
	beforeAll(() => {
		BENEFIT_TITLES = benefitTitles()
	})

	function paidSeed(overrides: Partial<SessionSeed> = {}): SessionSeed {
		return {
			isAuthenticated: true,
			userId: 'u1',
			email: 'u1@example.test',
			subscriptionStatus: 'active',
			...overrides,
		}
	}

	function renderWithSeed(seed: SessionSeed | null) {
		return render(
			<SessionSeedProvider seed={seed}>
				<HomePage />
			</SessionSeedProvider>
		)
	}

	function expectPageRendered(): void {
		expect(screen.getByText('Track your finances with privacy and control')).toBeInTheDocument()
	}

	it.each(['active', 'lifetime'] as const)(
		'renders no section, no heading and none of the five boxes for a %s session',
		(subscriptionStatus) => {
			mockStatus({ hasAccess: true, subscriptionStatus, isAuthenticated: true })
			renderWithSeed(paidSeed({ subscriptionStatus }))

			expectPageRendered()

			expect(screen.queryByRole('heading', { name: 'Premium Features', level: 2 })).toBeNull()

			// Probe by title: only sync carries a premium-benefit-* testid.
			for (const [, title] of BENEFIT_TITLES) {
				expect(screen.queryByText(title), `"${title}" must not render`).toBeNull()
			}
			expect(screen.queryByTestId('premium-benefit-sync')).toBeNull()

			expect(screen.queryAllByTestId('premium-gate-locked')).toHaveLength(0)
			expect(screen.queryAllByTestId('premium-gate-skeleton')).toHaveLength(0)
			for (const [name, href] of OPENABLE_ROUTES) {
				expect(screen.queryByRole('link', { name }), `${href} must not be linked`).toBeNull()
			}
		}
	)

	it('hides Multi-device sync too, an accepted cost of hiding the benefit list', () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		renderWithSeed(paidSeed())

		expectPageRendered()
		expect(screen.queryByTestId('premium-benefit-sync')).toBeNull()
		expect(screen.queryByText('Multi-device sync')).toBeNull()
	})

	it.each([
		['a null seed (resolver could not verify)', null, { isAuthenticated: false }],
		[
			'an unauthenticated seed',
			{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null },
			{ isAuthenticated: false },
		],
		['a free session', { subscriptionStatus: 'free' as const }, { isAuthenticated: true }],
		['a past_due session', { subscriptionStatus: 'past_due' as const }, { isAuthenticated: true }],
		['a canceled session', { subscriptionStatus: 'canceled' as const }, { isAuthenticated: true }],
	])('renders the full section, all five boxes, for %s', (_label, overrides, tier) => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', ...tier })
		renderWithSeed(overrides === null ? null : paidSeed(overrides as Partial<SessionSeed>))

		expectPageRendered()
		expect(screen.getByRole('heading', { name: 'Premium Features', level: 2 })).toBeInTheDocument()

		for (const [, title] of BENEFIT_TITLES) {
			expect(screen.getByText(title)).toBeInTheDocument()
		}
		expect(screen.getAllByTestId('premium-gate-locked')).toHaveLength(GATED_COUNT)
		expect(screen.getAllByText('Premium')).toHaveLength(PREMIUM_BENEFIT_IDS.length)
	})

	it('⚠️ FAILS OPEN on a null seed — the direction is the OPPOSITE of the nav, deliberately', () => {
		// GlobalNav fails closed but this gate fails open: otherwise an unverified paid user
		// would have no route to the premium pages.
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		renderWithSeed(null)

		expectPageRendered()
		expect(
			screen.getByRole('heading', { name: 'Premium Features', level: 2 }),
			'a null seed must FAIL OPEN and still show the section'
		).toBeInTheDocument()

		for (const [name, href] of OPENABLE_ROUTES) {
			expect(screen.getByRole('link', { name }), `${href} must stay reachable`).toHaveAttribute(
				'href',
				href
			)
		}
	})

	it('leaves the canonical benefit set at five keys', () => {
		expect(PREMIUM_BENEFIT_IDS).toHaveLength(5)
		expect(Object.keys(OVERVIEW_BENEFITS).sort()).toEqual([...PREMIUM_BENEFIT_IDS].sort())
	})
})

describe('Overview: was e2e', () => {
	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useOverviewDurationStore.setState({ duration: 'annually' })
		document.body.style.overflow = ''
	})

	it('the chosen duration survives the reload chain (was e2e overview-duration:155)', async () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
		render(<HomePage />)
		const select = () =>
			screen.getByRole('combobox', { name: /show income and expenses per/i }) as HTMLSelectElement
		expect(select().value).toBe('annually')

		fireEvent.change(select(), { target: { value: 'monthly' } })
		expect(select().value).toBe('monthly')

		await renderAfterReload(<HomePage />)

		expect(select().value).toBe('monthly')
		expect(screen.getByText('Total Income (per month)')).toBeInTheDocument()
	})

	it("every gate's upgrade dialog stays inside the gate's OWN wrapper (was e2e premium-locked:27)", async () => {
		// Modal has no portal and a locked gate returns a fragment, so in the space-y-3
		// stack the overlay would take a top margin and leave an undimmed strip.
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		renderWithRouter(<HomePage />)
		const gates = await screen.findAllByTestId('premium-gate-locked')
		expect(gates).toHaveLength(GATED_COUNT)

		const stack = gates[0]?.closest('.space-y-3') as HTMLElement
		expect(stack, 'the benefit stack must be found, or every check below is vacuous').not.toBeNull()

		for (const gate of gates) {
			fireEvent.click(gate)
			const dialog = await screen.findByRole('dialog', { name: /go premium/i })
			const overlay = dialog.parentElement as HTMLElement
			const wrapper = overlay.parentElement as HTMLElement
			expect(wrapper).not.toBe(stack)
			expect(wrapper.parentElement).toBe(stack)
			expect(wrapper).toContainElement(gate)
			fireEvent.keyDown(document, { key: 'Escape' })
			expect(screen.queryByRole('dialog')).toBeNull()
		}
	})

	it('two open gate dialogs close one at a time and release the scroll lock (was e2e premium-locked:101)', async () => {
		// .focus() stands in for focus returning from browser chrome, which the Tab trap does not intercept.
		const user = userEvent.setup()
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		renderWithRouter(<HomePage />)
		const gates = await screen.findAllByTestId('premium-gate-locked')

		await user.click(gates[0] as HTMLElement)
		expect(screen.getAllByRole('dialog')).toHaveLength(1)

		act(() => (gates[1] as HTMLElement).focus())
		await user.keyboard('{Enter}')
		expect(
			screen.getAllByRole('dialog'),
			'the two-dialog state must actually be reachable, or this test proves nothing'
		).toHaveLength(2)

		await user.keyboard('{Escape}')
		expect(screen.getAllByRole('dialog'), 'one Escape must not close both dialogs').toHaveLength(1)
		expect(document.body.style.overflow, 'the lock must hold while a dialog is still open').toBe(
			'hidden'
		)

		await user.keyboard('{Escape}')
		expect(screen.queryAllByRole('dialog')).toHaveLength(0)
		expect(document.body.style.overflow, 'the scroll lock must be released').toBe('')
	})
})
