import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithRouter, screen } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { Route } from '../forecasting'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

// Isolation only, not guards: the page swallows these failures with console.error.
vi.mock('../../lib/forecasting/forecast-api', () => ({
	fetchProfiles: vi.fn(async () => ({ success: true, data: [] })),
	fetchForecasts: vi.fn(async () => ({ success: true, data: [] })),
	saveForecast: vi.fn(async () => ({ success: true, data: null })),
	deleteForecast: vi.fn(async () => ({ success: true })),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement

// Matched as a string, never a RegExp: the trailing `?` would become a quantifier.
const INTRO_SENTENCE =
	'Wondering how a raise, steadily rising bills, a big one-off cost, paying down a loan or saving more each month would change things?'

const INTRO_SECOND_SENTENCE =
	'Build it out here and see how your finances track over the years ahead.'

const PROMPT_MESSAGE =
	'See how a raise, rising bills, a big one-off cost, paying down a loan or saving more each month would change your finances over the years ahead — and save each scenario to reopen later.'

const META_DESCRIPTION =
	'Model how a raise, rising bills, a one-off cost, paying down a loan or saving more each month changes your finances over the years ahead — with saved, reloadable scenarios.'

type MetaEntry = {
	title?: string
	name?: string
	property?: string
	content?: string
}

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

describe('the /forecasting page intro', () => {
	it('names situations the engine can actually model, in both sentences', async () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		renderWithRouter(<ForecastingPage />)

		const intro = await screen.findByTestId('forecasting-intro')
		// Normalize JSX's source-wrapping whitespace before comparing prose.
		const text = (intro.textContent ?? '').replace(/\s+/g, ' ').trim()

		expect(text).toContain(INTRO_SENTENCE)
		expect(text).toContain(INTRO_SECOND_SENTENCE)
	})

	it('places the intro inside <main>, ahead of the tab strip and not within it', async () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		renderWithRouter(<ForecastingPage />)

		const intro = await screen.findByTestId('forecasting-intro')

		// Asserted directly: moving the intro into the sticky PageHeader would pass every ordering check.
		expect(intro.closest('main')).not.toBeNull()

		// `closest('div')` is the inner tablist strip, not the outer tab section.
		const tabStrip = screen.getByRole('tab', { name: /scenario builder/i }).closest('div')
		expect(tabStrip).not.toBeNull()

		const position = intro.compareDocumentPosition(tabStrip as Node)

		// DOCUMENT_POSITION_FOLLOWING is also set for a descendant, so assert no containment too.
		expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(position & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeFalsy()
		expect(intro.contains(tabStrip as Node)).toBe(false)
		expect((tabStrip as HTMLElement).contains(intro)).toBe(false)
	})

	it('keeps all three tabs but renders none of the old per-tab descriptions', async () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		renderWithRouter(<ForecastingPage />)

		expect(await screen.findByRole('tab', { name: /scenario builder/i })).toBeInTheDocument()
		expect(screen.getByRole('tab', { name: /projections/i })).toBeInTheDocument()
		expect(screen.getByRole('tab', { name: /my forecasts/i })).toBeInTheDocument()

		// jsdom applies no Tailwind and only the active tab renders its description, so check each in turn.
		const descriptionByTab = [
			[/scenario builder/i, 'Create and model financial scenarios'],
			[/projections/i, 'View forecast visualizations'],
			[/my forecasts/i, 'Saved scenarios and results'],
		] satisfies [RegExp, string][]
		for (const [tabName, description] of descriptionByTab) {
			fireEvent.click(screen.getByRole('tab', { name: tabName }))
			expect(screen.queryByText(description), `"${description}" must be gone`).toBeNull()
		}
	})

	it('reads standalone for a nav arrival: it does not depend on the Overview copy', async () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		renderWithRouter(<ForecastingPage />)

		const intro = await screen.findByTestId('forecasting-intro')
		const text = intro.textContent ?? ''

		expect(text.length).toBeGreaterThan(40)
		expect(text).toMatch(/one-off cost/i)

		expect(text).not.toMatch(
			/\b(overview|dashboard|home page|the card|that card|the tile|the box|benefit box|as shown|earlier)\b/i
		)
		// The builder is only on the first tab, so positional wording is false on the other two.
		expect(text).not.toMatch(/\b(below|above|beneath|on the right|on the left)\b/i)
	})

	it('does not render the intro for a free user (the gate returns the upgrade prompt)', async () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		renderWithRouter(<ForecastingPage />)

		// `findAllBy`: the regex matches both the featureName span and the benefit <li>.
		expect(await screen.findAllByText(/advanced forecasting/i)).not.toHaveLength(0)
		expect(screen.queryByTestId('forecasting-intro')).toBeNull()
	})
})

describe('/forecasting landmarks', () => {
	it.each([
		['loading', { isLoading: true }, () => screen.findAllByText(/^loading\.\.\.$/i)],
		[
			'locked',
			{ hasAccess: false, subscriptionStatus: 'free' as const },
			() => screen.findAllByText(/advanced forecasting/i),
		],
		[
			'active',
			{ hasAccess: true, subscriptionStatus: 'active' as const, isAuthenticated: true },
			() => screen.findAllByTestId('forecasting-intro'),
		],
	])('the %s state is exactly one <main>', async (_state, overrides, branchRendered) => {
		mockStatus(overrides)
		renderWithRouter(<ForecastingPage />)

		expect((await branchRendered()).length).toBeGreaterThan(0)
		expect(screen.getAllByRole('main')).toHaveLength(1)
	})
})

describe('the /forecasting mechanism copy (57.1 follow-up #3)', () => {
	const DELETED_SUBTITLE = 'Advanced tools for modeling your financial future'

	it('renders no subtitle under the page heading, so the page opens with one tagline', async () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		renderWithRouter(<ForecastingPage />)

		const heading = await screen.findByRole('heading', { name: 'Financial Forecasting' })
		const header = heading.closest('header')
		expect(header).not.toBeNull()

		// Child count, not a <p> count: catches a subtitle reinstated as any element.
		const headingWrapper = heading.parentElement as HTMLElement
		expect(headingWrapper.children).toHaveLength(1)
		expect(headingWrapper.children[0]).toBe(heading)

		expect(screen.queryByText(DELETED_SUBTITLE)).toBeNull()

		expect(await screen.findByTestId('forecasting-intro')).toBeInTheDocument()
	})

	it("pitches concrete situations to a free user, not 'advanced' tooling", async () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		renderWithRouter(<ForecastingPage />)

		const message = await screen.findByText(PROMPT_MESSAGE)
		expect(message).toBeInTheDocument()

		expect(screen.queryByText(/access advanced financial forecasting/i)).toBeNull()
	})

	it('describes the same situations in the meta description', () => {
		const meta = (Route.options.head as (arg: unknown) => { meta?: MetaEntry[] })({})?.meta ?? []
		const description = meta.find((m) => m.name === 'description')?.content

		expect(description).toBeTruthy()
		expect(description).toBe(META_DESCRIPTION)
		expect(description).not.toContain(DELETED_SUBTITLE)
	})

	// Each surface is read from its real source. The denials below only pin two known
	// overpromises; they don't prove new copy is honest.
	it('names the same modellable situations on all three surfaces', async () => {
		mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
		const entitled = renderWithRouter(<ForecastingPage />)
		const intro = (await screen.findByTestId('forecasting-intro')).textContent ?? ''
		entitled.unmount()

		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
		renderWithRouter(<ForecastingPage />)
		const prompt = (await screen.findByTestId('premium-prompt-message')).textContent ?? ''

		const meta = (Route.options.head as (arg: unknown) => { meta?: MetaEntry[] })({})?.meta ?? []
		const description = meta.find((m) => m.name === 'description')?.content ?? ''

		for (const [surface, text] of [
			['intro', intro],
			['meta description', description],
			['premium prompt', prompt],
		] as const) {
			expect(
				text.length,
				`${surface} is empty — the checks below would be vacuous`
			).toBeGreaterThan(40)
			// ⚠️ `\b` anchored: a bare /raise/i also matches "praise" and "raised".
			expect(text, `${surface} does not name a raise`).toMatch(/\braise\b/i)
			expect(text, `${surface} does not name rising bills`).toMatch(/rising bills/i)
			expect(text, `${surface} does not name a one-off cost`).toMatch(/one-off cost/i)

			expect(
				text,
				`${surface} promises a mortgage, which needs a dated recurring change`
			).not.toMatch(/\bmortgage\b/i)
			expect(
				text,
				`${surface} promises early retirement, which the engine cannot express`
			).not.toMatch(/early retirement/i)
		}
	})
})
