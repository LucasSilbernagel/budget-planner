// The router is needed only for PremiumPrompt, whose CTA is a <Link>.

import { describe, expect, it, vi } from 'vitest'
import { render, renderWithRouter, screen, within } from '@/test/utils'
import { getDocPage } from '../../../content/docs'
import { PRICING_PAGE } from '../../../content/legal'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../../lib/premium/benefits'
import { PREMIUM_FEATURES as PROMPT_COPY } from '../../auth/premium-prompt'
import { PREMIUM_FEATURES as PRICING_COPY } from '../../pricing/pricing-page'

// The type system already enforces each TS surface's key set. This adds what tsc can't: keys
// built past the type, copy reaching the DOM, and the untyped markdown surfaces.

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

import { PremiumPrompt } from '../../auth/premium-prompt'
import { HomePage, OVERVIEW_BENEFITS } from '../../HomePage'
import { PricingPageView } from '../../pricing/pricing-page'

function mockFreeTier(): void {
	const status: PremiumAccessStatus = {
		hasAccess: false,
		subscriptionStatus: 'free',
		isLoading: false,
		error: null,
		isAuthenticated: true,
	}
	usePremiumAccess.mockReturnValue({ status })
}

/** The collapse is load-bearing: the .md sources are hard-wrapped, so multi-word matches break. */
function flatten(markdown: string): string {
	return markdown.replace(/\s+/g, ' ').toLowerCase()
}

const FEATURES_MD = getDocPage('features')?.content ?? ''
const PRICING_MD = PRICING_PAGE.content

/** Scoped to the Premium section: a benefit documented under the wrong tier must fail. */
function premiumSectionOfFeaturesMd(): string {
	const start = FEATURES_MD.indexOf('### Premium tier')
	expect(start, 'features.md must still have a "### Premium tier" heading').toBeGreaterThan(-1)
	const rest = FEATURES_MD.slice(start + '### Premium tier'.length)
	const end = rest.indexOf('\n###')
	return flatten(end === -1 ? rest : rest.slice(0, end))
}

/** Scoped to the summary sentence: the rest of the file legitimately mentions Premium. */
function summarySentenceOfPricingMd(): string {
	const afterDate = PRICING_MD.indexOf('_\n')
	const body = afterDate === -1 ? PRICING_MD : PRICING_MD.slice(afterDate + 2)
	const end = body.indexOf('\n###')
	const summary = flatten(end === -1 ? body : body.slice(0, end))
	expect(summary.length, 'pricing.md must still open with a tier summary').toBeGreaterThan(0)
	return summary
}

const FEATURES_MD_ANCHORS: Record<PremiumBenefitId, string> = {
	sync: 'multi-device sync',
	forecasting: 'advanced forecasting',
	profiles: 'custom profiles',
	report: 'financial summary report',
	categories: 'custom categories',
}

const PRICING_MD_ANCHORS: Record<PremiumBenefitId, string> = {
	sync: 'multi-device sync',
	forecasting: 'advanced forecasting',
	profiles: 'custom profiles',
	report: 'financial summary report',
	categories: 'custom categories with a per-category breakdown',
}

describe('the canonical Premium benefit set is the same on every surface', () => {
	it('has no duplicate ids and a stable order', () => {
		// Anti-vacuous: every count below derives from this array.
		expect(PREMIUM_BENEFIT_IDS.length).toBeGreaterThan(0)
		expect(new Set(PREMIUM_BENEFIT_IDS).size).toBe(PREMIUM_BENEFIT_IDS.length)
	})

	it('pins the CONTENT of the tuple, not just that surfaces follow it (story 5-20, AC-3)', () => {
		// The order is a product decision (sync last); every other assertion only follows the tuple.
		expect(PREMIUM_BENEFIT_IDS).toEqual(['forecasting', 'report', 'profiles', 'categories', 'sync'])
	})

	it.each([
		['pricing card (surface)', PRICING_COPY],
		['upgrade prompt (surface)', PROMPT_COPY],
		['overview section (surface)', OVERVIEW_BENEFITS],
		['features.md anchors (fixture)', FEATURES_MD_ANCHORS],
		['pricing.md anchors (fixture)', PRICING_MD_ANCHORS],
	] as const)('%s covers exactly the canonical ids — no omission, no invention', (_name, copy) => {
		const keys = Object.keys(copy)
		for (const id of PREMIUM_BENEFIT_IDS) {
			expect(keys, `missing copy for the "${id}" benefit`).toContain(id)
		}
		for (const key of keys) {
			expect(
				PREMIUM_BENEFIT_IDS as readonly string[],
				`"${key}" is not a canonical benefit id`
			).toContain(key)
		}
		expect(keys).toHaveLength(PREMIUM_BENEFIT_IDS.length)
	})

	it('states every benefit exactly once on the /pricing Premium card, in canonical order', () => {
		render(<PricingPageView />)
		const heading = screen.getByRole('heading', { name: 'Premium', level: 2 })
		const card = heading.closest('div')
		if (!card) throw new Error('No card container found for the Premium plan')

		const items = within(card).getAllByRole('listitem')
		expect(items).toHaveLength(PREMIUM_BENEFIT_IDS.length)
		// Compare the whole rendered array: per-item `getByText` can't see order.
		expect(items.map((li) => li.textContent?.trim())).toEqual(
			PREMIUM_BENEFIT_IDS.map((id) => PRICING_COPY[id])
		)
	})

	it('states every benefit exactly once in the upgrade prompt, in canonical order (inline and dialog)', async () => {
		const expected = PREMIUM_BENEFIT_IDS.map((id) => PROMPT_COPY[id])

		const { unmount } = renderWithRouter(<PremiumPrompt />)
		const inline = await screen.findByRole('list')
		const inlineItems = within(inline).getAllByRole('listitem')
		expect(inlineItems).toHaveLength(PREMIUM_BENEFIT_IDS.length)
		expect(inlineItems.map((li) => li.textContent?.trim())).toEqual(expected)
		unmount()

		renderWithRouter(<PremiumPrompt asDialog onClose={vi.fn()} />)
		const dialog = await screen.findByRole('dialog', { name: /go premium/i })
		const list = within(dialog).getByRole('list')
		const dialogItems = within(list).getAllByRole('listitem')
		expect(dialogItems).toHaveLength(PREMIUM_BENEFIT_IDS.length)
		expect(dialogItems.map((li) => li.textContent?.trim())).toEqual(expected)
	})

	it('"Downloadable" is the upgrade prompt\'s wording only; other surfaces keep the plain name (story 95.1, D1)', () => {
		expect(PROMPT_COPY.report).toBe('Downloadable Financial Summary Report')
		const overviewReport = OVERVIEW_BENEFITS.report
		if (overviewReport.activation === 'none') throw new Error('report must be activatable')
		expect(overviewReport.featureName).toBe('Financial Summary Report')
	})

	it('points each openable benefit at its own route', () => {
		// Written out independently: an expectation derived from OVERVIEW_BENEFITS can never fail.
		const EXPECTED: Record<
			PremiumBenefitId,
			| { activation: 'prompt'; featureName: string }
			| { activation: 'route'; href: string; featureName: string }
		> = {
			sync: { activation: 'prompt', featureName: 'Multi-device sync' },
			forecasting: {
				activation: 'route',
				href: '/forecasting',
				featureName: 'Advanced Forecasting',
			},
			profiles: { activation: 'route', href: '/profiles', featureName: 'Custom Profiles' },
			report: {
				activation: 'route',
				href: '/financial-summary',
				featureName: 'Financial Summary Report',
			},
			categories: { activation: 'route', href: '/categories', featureName: 'Custom Categories' },
		}

		for (const id of PREMIUM_BENEFIT_IDS) {
			const benefit = OVERVIEW_BENEFITS[id]
			const expected = EXPECTED[id]
			expect(benefit.activation, `"${id}" is in the wrong activation state`).toBe(
				expected.activation
			)
			if (expected.activation === 'prompt') {
				expect(benefit, `"${id}" has no page, so it must carry no href`).not.toHaveProperty('href')
				if (benefit.activation === 'prompt') {
					expect(benefit.featureName, `"${id}" announces the wrong name`).toBe(expected.featureName)
				}
				continue
			}
			if (benefit.activation === 'route') {
				expect(benefit.href, `"${id}" links to the wrong page`).toBe(expected.href)
				expect(benefit.featureName, `"${id}" announces the wrong name`).toBe(expected.featureName)
			}
		}
	})

	it('renders one badged box per benefit on the Overview, in canonical order', () => {
		mockFreeTier()
		render(<HomePage />)

		const stack = screen.getByRole('heading', { name: 'Premium Features' }).nextElementSibling
		expect(stack, 'the Premium Features stack must follow its heading').not.toBeNull()
		const rendered = [...(stack?.children ?? [])].map((box) => box.textContent ?? '')
		expect(rendered).toHaveLength(PREMIUM_BENEFIT_IDS.length)
		for (const [index, id] of PREMIUM_BENEFIT_IDS.entries()) {
			const { container, unmount } = render(OVERVIEW_BENEFITS[id].label())
			const title = container.querySelector('span')?.textContent ?? ''
			unmount()
			expect(title.length, `"${id}" must render a non-empty title`).toBeGreaterThan(0)
			expect(rendered[index], `box ${index} should be the "${id}" benefit`).toContain(title)
		}

		expect(screen.getAllByText('Premium')).toHaveLength(PREMIUM_BENEFIT_IDS.length)

		const activatable = PREMIUM_BENEFIT_IDS.filter(
			(id) => OVERVIEW_BENEFITS[id].activation !== 'none'
		)
		expect(screen.getAllByTestId('premium-gate-locked')).toHaveLength(activatable.length)

		for (const id of PREMIUM_BENEFIT_IDS) {
			if (OVERVIEW_BENEFITS[id].activation === 'route') continue
			const box = screen.getByTestId(`premium-benefit-${id}`)
			expect(within(box).queryByRole('link'), `"${id}" has no page to link to`).toBeNull()
			expect(within(box).queryByText('Open →'), `"${id}" has no page to open`).toBeNull()
		}
	})

	it('documents every benefit under the Premium tier in features.md', () => {
		const premium = premiumSectionOfFeaturesMd()
		for (const id of PREMIUM_BENEFIT_IDS) {
			expect(premium, `features.md's Premium section never mentions "${id}"`).toContain(
				FEATURES_MD_ANCHORS[id]
			)
		}
	})

	it('names every benefit in the pricing.md summary sentence', () => {
		const summary = summarySentenceOfPricingMd()
		for (const id of PREMIUM_BENEFIT_IDS) {
			expect(summary, `pricing.md's summary sentence never names the "${id}" benefit`).toContain(
				PRICING_MD_ANCHORS[id]
			)
		}
	})

	it('enumerates the full Premium set in the features.md intro', () => {
		const intro = flatten(FEATURES_MD.slice(0, FEATURES_MD.indexOf('### Free tier')))
		expect(
			intro.length,
			'features.md must still have an intro above "### Free tier"'
		).toBeGreaterThan(0)
		for (const id of PREMIUM_BENEFIT_IDS) {
			expect(intro, `the features.md intro never names the "${id}" benefit`).toContain(
				FEATURES_MD_ANCHORS[id]
			)
		}
	})
})

describe('the benefit copy claims only what ships', () => {
	/** Per surface, never joined: a joined haystack lets one surface satisfy a positive for all. */
	function copyBySurface(id: PremiumBenefitId): Record<string, string> {
		const Label = OVERVIEW_BENEFITS[id].label
		const { container, unmount } = render(<Label />)
		const overview = container.textContent ?? ''
		unmount()
		// Anti-vacuous: an empty haystack passes every `not.toMatch`.
		expect(overview.length, `the Overview renders no text for "${id}"`).toBeGreaterThan(0)
		return {
			'/pricing': PRICING_COPY[id].toLowerCase(),
			'upgrade prompt': PROMPT_COPY[id].toLowerCase(),
			Overview: overview.toLowerCase(),
		}
	}

	function assertEverySurface(
		id: PremiumBenefitId,
		check: (copy: string, surface: string) => void
	): void {
		for (const [surface, copy] of Object.entries(copyBySurface(id))) {
			check(copy, surface)
		}
	}

	it('never claims the summary report covers retirement, projections or charts', () => {
		// The shipped report covers no retirement or projections, whatever the requirement text says.
		assertEverySurface('report', (copy, surface) =>
			expect(copy, `${surface} overclaims the report's scope`).not.toMatch(
				/retirement|projection|chart/
			)
		)
	})

	it('never calls the summary report a backup or something re-importable', () => {
		assertEverySurface('report', (copy, surface) =>
			expect(copy, `${surface} calls the report a backup`).not.toMatch(
				/backup|back up|re-?import|restore/
			)
		)
	})

	it('never claims the app itself generates or downloads the PDF', () => {
		// The button calls `window.print()`, so nothing generates a PDF. The prompt's "Downloadable"
		// is the one decided exemption.
		assertEverySurface('report', (copy, surface) => {
			const fenced =
				surface === 'upgrade prompt'
					? copy.replace(/^downloadable financial summary report$/, 'financial summary report')
					: copy
			expect(fenced, `${surface} attributes the PDF to the app`).not.toMatch(
				/generates? a pdf|download/
			)
		})
	})

	it('never claims categories sync across devices', () => {
		// Categories never sync: the sync bridge pins `categoryId: null`.
		assertEverySurface('categories', (copy, surface) =>
			expect(copy, `${surface} claims categories sync`).not.toMatch(
				/sync|across (?:all )?your devices|other devices|phone to laptop/
			)
		)
	})

	it('never claims categories apply to savings or balances', () => {
		assertEverySurface('categories', (copy, surface) =>
			expect(copy, `${surface} extends categories beyond income and expenses`).not.toMatch(
				/savings|balances|investments|debts/
			)
		)
	})

	it('never claims the category figures match the overview', () => {
		// Pies denormalize per entry and /categories per bucket, so they can differ by cents.
		assertEverySurface('categories', (copy, surface) =>
			expect(copy, `${surface} promises the figures agree`).not.toMatch(
				/match|same as|identical|agree/
			)
		)
	})

	it('names the category breakdown on EVERY surface, not just the ability to create categories', () => {
		assertEverySurface('categories', (copy, surface) =>
			expect(copy, `${surface} never names the per-category breakdown`).toMatch(/breakdown|totals/)
		)
	})

	it('never reintroduces free or universal features as Premium perks', () => {
		for (const id of PREMIUM_BENEFIT_IDS) {
			assertEverySurface(id, (copy, surface) =>
				expect(copy, `${surface} sells "${id}" on a free or universal feature`).not.toMatch(
					/dark mode|no ads|coming soon/
				)
			)
		}
	})

	it('never claims a side-by-side comparison of two saved forecasts', () => {
		assertEverySurface('forecasting', (copy, surface) =>
			expect(copy, `${surface} promises a side-by-side comparison`).not.toMatch(
				/side[\s-]by[\s-]side/
			)
		)
	})
})
