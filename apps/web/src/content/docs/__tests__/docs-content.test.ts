import { calculateFinancialForecast } from '@budget-planner/core/finance/forecasting'
import {
	calculateTotalMonthlyNormalized,
	denormalizeFromMonthly,
	normalizeToMonthly,
} from '@budget-planner/core/finance/normalization'
import { describe, expect, it } from 'vitest'
import { DOC_PAGES, getDocPage } from '../index'

/** Plain `Intl` only builds the search substring; the VALUE must come from core. */
function formatCents(cents: number): string {
	return (cents / 100).toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})
}

describe('DOC_PAGES', () => {
	it('exposes at least the getting-started, features, and faq pages', () => {
		const slugs = DOC_PAGES.map((page) => page.slug)
		expect(slugs).toEqual(expect.arrayContaining(['getting-started', 'features', 'faq']))
	})

	it('gives every page a slug, title, description, and non-empty markdown body', () => {
		for (const page of DOC_PAGES) {
			expect(page.slug).toMatch(/^[a-z0-9-]+$/)
			expect(page.title.length).toBeGreaterThan(0)
			expect(page.description.length).toBeGreaterThan(0)
			expect(page.content.trim().length).toBeGreaterThan(0)
		}
	})

	it('uses unique slugs', () => {
		const slugs = DOC_PAGES.map((page) => page.slug)
		expect(new Set(slugs).size).toBe(slugs.length)
	})
})

describe('getDocPage', () => {
	it('returns the matching page for a known slug', () => {
		expect(getDocPage('faq')?.title).toBe('FAQ')
	})

	it('returns undefined for an unknown slug', () => {
		expect(getDocPage('does-not-exist')).toBeUndefined()
	})
})

describe('documentation content accuracy', () => {
	const contentFor = (slug: string): string => {
		const page = getDocPage(slug)
		if (!page) throw new Error(`missing expected doc page: ${slug}`)
		return page.content
	}

	it('no page references the "Financial Health" score, which was removed', () => {
		for (const page of DOC_PAGES) {
			expect(page.content.toLowerCase()).not.toContain('financial health')
		}
	})

	it('the FAQ locates the currency control on /settings, not an old page header', () => {
		const faq = contentFor('faq')
		expect(faq).toContain('/settings')
		expect(faq).not.toContain('in the page header')
	})

	it('the FAQ documents the in-app "Clear local data" control', () => {
		expect(contentFor('faq')).toContain('Clear local data')
	})

	it('the FAQ discloses the cookieless (counter.dev) analytics posture', () => {
		expect(contentFor('faq').toLowerCase()).toContain('counter.dev')
	})

	it('the FAQ routes support requests to the in-app contact form and links the Privacy Policy', () => {
		const faq = contentFor('faq')
		expect(faq).toContain('/contact')
		expect(faq).toContain('/privacy')
	})

	it('the FAQ no longer advertises the phantom data import/export feature', () => {
		// Guard the CLAIM, not one phrasing: match verb stem against object. The print/PDF summary
		// report legitimately exists, so the bare word "export" is not banned.
		const faq = contentFor('faq').toLowerCase()
		expect(faq).not.toContain('import or export')

		const OBJECT = '(?:data|entries|budget|figures|records|copy|file|spreadsheet|csv|json)'
		const VERB = '(?:export|download|back ?up|backup)'
		expect(faq).not.toMatch(new RegExp(`\\b${VERB}\\w*\\b[^.!?\\n]{0,40}?\\b${OBJECT}\\b`))
		// Both orders are needed: verb-first alone misses "a full data export".
		expect(faq).not.toMatch(new RegExp(`\\b${OBJECT}\\b[^.!?\\n]{0,20}?\\b${VERB}\\w*\\b`))
		expect(faq).not.toMatch(/\bsave a copy of\b/)
		// Banned in the FAQ as proxies for an export target; narrow only with something that still
		// catches "export to spreadsheet".
		expect(faq).not.toMatch(/\b(?:csv|spreadsheet|json)\b/)

		// "import" is deliberately unguarded: the FAQ truthfully says the app does not import transactions.
	})

	it('the FAQ frames Longhand Budget as a planning tool and points to a spend tracker', () => {
		const faq = contentFor('faq')
		expect(faq.toLowerCase()).toContain('planning tool')
		expect(faq).toContain('Lunch Money')
	})

	it('refers to the product as "Longhand Budget", never the retired brands', () => {
		for (const page of DOC_PAGES) {
			expect(page.content).not.toContain('Budget Planner')
			expect(page.description).not.toContain('Budget Planner')
			expect(page.content).not.toContain('SoluBudget')
			expect(page.description).not.toContain('SoluBudget')
		}
		// Assert the full name: `toContain('Longhand')` also passes on "Longhand Budget".
		expect(getDocPage('features')?.content).toContain('Longhand Budget is split into')
		expect(getDocPage('features')?.content).toMatch(/\bLonghand Budget is built for\b/)
		expect(getDocPage('features')?.description).toContain('Everything Longhand Budget can do')
	})

	it('the Features page pledges no AI, scoped to what was actually verified', () => {
		// The evidence supports "no AI features", not the broader "no machine-learning features".
		const features = contentFor('features')
		expect(features).toContain('No ads, no trackers, no AI — ever.')
		expect(features).toMatch(/no AI features/)
		expect(features).not.toMatch(/machine[- ]learning/i)
	})

	it('the FAQ describes Lunch Money accurately as a Canadian app, not implied-US', () => {
		// Lunch Money is Canadian. The phrase hard-wraps, hence `\s+`.
		const faq = contentFor('faq')
		expect(faq).toMatch(/Lunch Money,\s+a Canadian app/)
		expect(faq).not.toContain('Non-US options exist too')
	})

	it('the FAQ explains the monthly-basis conversion is an estimate using the ~4.33 factor', () => {
		// "4.33" and "estimate" predate this copy, so anchor on the distinguishing new phrasing.
		const faq = contentFor('faq')
		expect(faq).toContain('4.33')
		expect(faq.toLowerCase()).toContain('average number of weeks in a month')
		expect(faq.toLowerCase()).toContain('estimate rather than an exact calendar-month total')
		expect(faq.toLowerCase()).not.toContain('how it was converted')
	})

	it('the Features page discloses the common monthly basis is an estimate/average', () => {
		const free = featureSections().free
		expect(free).toContain('common monthly basis')
		expect(free).toContain('4.33')
		expect(free).toContain('estimate')
	})

	// `free` includes the intro paragraph, which names Premium benefits; tier placement uses
	// `freeTier`, the Free bullet list alone.
	const featureSections = () => {
		const content = getDocPage('features')?.content ?? ''
		const premiumIndex = content.indexOf('### Premium tier')
		if (premiumIndex === -1) throw new Error('Features page is missing the Premium tier section')
		const freeIndex = content.indexOf('### Free tier')
		if (freeIndex === -1) throw new Error('Features page is missing the Free tier section')
		// Without this, a reordered file makes `freeTier` empty and every negative below passes vacuously.
		if (freeIndex >= premiumIndex) {
			throw new Error('Features page lists the Premium tier before the Free tier')
		}
		return {
			free: content.slice(0, premiumIndex).toLowerCase(),
			freeTier: content.slice(freeIndex, premiumIndex).toLowerCase(),
			premium: content.slice(premiumIndex).toLowerCase(),
		}
	}

	it('the Features page states no ads universally, not as a Premium perk', () => {
		const content = getDocPage('features')?.content ?? ''
		expect(content.toLowerCase()).toContain('no ads')
		expect(featureSections().premium).not.toContain('no ads')
	})

	it('the Features page lists Dark mode under the Free tier, not Premium', () => {
		const { freeTier, premium } = featureSections()
		expect(freeTier).toContain('dark mode')
		expect(premium).not.toContain('dark mode')
	})

	it('the Features page does not promise a dark-mode CONTROL on the Settings page', () => {
		// The sibling test only checks the topic; this pins that no in-app toggle is promised.
		const { freeTier } = featureSections()
		const darkLine = freeTier.split('\n').find((line) => line.includes('dark mode')) ?? ''
		expect(darkLine, 'the Dark mode bullet vanished — this guard now proves nothing').not.toBe('')
		expect(darkLine).not.toContain('switch on')
		expect(darkLine).not.toContain('settings page')
		expect(darkLine).toContain('device')
	})

	it('the Features page keeps Retirement modeling under the Free tier', () => {
		const { freeTier, premium } = featureSections()
		expect(freeTier).toContain('retirement modeling')
		expect(premium).not.toContain('retirement modeling')
	})

	it('the Features page documents Custom categories under Premium only', () => {
		const { freeTier, premium } = featureSections()
		expect(premium).toContain('custom categories')
		expect(freeTier).not.toContain('custom categories')
	})

	it('the Custom categories bullet documents the per-category breakdown', () => {
		// Deliberately scoped to `free`, not `freeTier`: narrowing it would silently weaken the guard.
		const { premium, free } = featureSections()
		expect(premium).toContain('what share of that side it is')
		expect(premium).toContain('uncategorized line')
		expect(free).not.toContain('what share of that side it is')
	})

	it('the Custom categories bullet claims no cross-device sync', () => {
		// Category rows can't reach the server yet, so the copy must not claim they sync.
		const { premium } = featureSections()
		const start = premium.indexOf('**custom categories**')
		// `>= 0`, not `> 0`: this is an existence check, and `indexOf` returning 0
		// is a hit, not a miss.
		expect(start).toBeGreaterThanOrEqual(0)
		// Fall back to the section end, never -1: `slice(start, -1)` drops the last character.
		const candidates = [premium.indexOf('\n- **', start), premium.indexOf('\n###', start)].filter(
			(index) => index > start
		)
		const end = candidates.length > 0 ? Math.min(...candidates) : premium.length
		const bullet = premium.slice(start, end)
		expect(bullet).not.toMatch(/sync|across (?:all )?your devices|other devices|phone to laptop/)
	})

	it('the Features page describes Advanced forecasting honestly', () => {
		// Both slices are lowercased by featureSections(), so every literal here must be lowercase.
		const { premium } = featureSections()
		expect(premium).toContain('what-if scenarios')
		expect(premium).toContain('searchable list')
		// Interior spaces are \s+ because the paragraph hard-wraps.
		expect(premium).toMatch(/reload\s+any\s+of\s+them\s+back\s+into\s+the\s+builder/)

		// Nothing plots two saved forecasts together. Matches both spaced and hyphenated spellings.
		expect(premium).not.toMatch(/side[\s-]by[\s-]side/)
	})

	it('scopes the EU-storage claim to SAVED forecasts, and states it once', () => {
		// Only SAVED forecasts are EU-stored; the math runs in the browser. Anchor on the scoping words.
		const { premium } = featureSections()
		expect(premium).toMatch(
			/saved\s+forecasts\s+are\s+stored\s+on\s+servers\s+in\s+the\s+european\s+union/
		)

		// Assert the heading exists before slicing: `slice(0, -1)` would yield nearly the whole section.
		const privacyIndex = premium.indexOf('### privacy')
		expect(privacyIndex).toBeGreaterThan(0)
		const premiumBullets = premium.slice(0, privacyIndex)
		expect(premiumBullets.match(/european union/g) ?? []).toHaveLength(2)
	})

	it('contrasts the free retirement projection with Premium forecasting', () => {
		// The builder seeds hardcoded defaults rather than reading budget figures, so no continuity claim.
		const { free } = featureSections()
		// Don't weaken this to /projections/, which appears throughout the page.
		expect(free).toMatch(
			/free\s+retirement\s+projection\s+charts\s+where\s+your\s+current\s+numbers\s+lead/
		)
		expect(free).toMatch(/premium\s+forecasting\s+is\s+a\s+separate\s+what-if\s+workspace/)
	})

	it('the docs carry the "without bank sync or AI integrations" framing', () => {
		const framing = /intentional\s+budgeting\s+without\s+bank\s+sync\s+or\s+AI\s+integrations/i
		expect(framing.test(contentFor('features'))).toBe(true)
		expect(framing.test(contentFor('getting-started'))).toBe(true)
		const oldFraming = /without\s+the\s+bank\s+sync/i
		expect(oldFraming.test(contentFor('features'))).toBe(false)
		expect(oldFraming.test(contentFor('getting-started'))).toBe(false)
	})

	/**
	 * Scoped to its section: a whole-document match can't tell which section the copy landed in.
	 * The `throw` on a missing heading is load-bearing: otherwise slices go empty and pass vacuously.
	 */
	const gettingStartedSections = () => {
		const content = contentFor('getting-started')
		const bounds = (start: string, end: string): string => {
			const from = content.indexOf(start)
			if (from === -1) throw new Error(`Getting started is missing the "${start}" heading`)
			const to = content.indexOf(end, from)
			if (to === -1) throw new Error(`Getting started is missing the "${end}" heading`)
			// Adjacency, not just order: a section inserted between the headings would widen the slice.
			const nextHeading = content.indexOf('\n### ', from + start.length)
			if (nextHeading !== -1 && nextHeading + 1 !== to) {
				throw new Error(
					`Getting started: "${end}" is not the section immediately after "${start}" — a section was inserted between them and the slice would span it`
				)
			}
			return content.slice(from, to)
		}
		return {
			addIncome: bounds('### Add your first income source', '### Add your expenses'),
			overview: bounds('### See your overview', '### Next steps'),
		}
	}

	it('tells you in the income steps that the amount is take-home pay', () => {
		const { addIncome } = gettingStartedSections()

		// Anchored on the distinguishing clause; "income" and "amount" appear all over this section.
		expect(addIncome).toMatch(/reaches\s+your\s+bank\s+account/i)
		expect(addIncome).toMatch(/after\s+tax/i)
		expect(addIncome).toMatch(/deductions/i)
	})

	it('uses "net" on this page ONLY for net worth', () => {
		// Core's `netIncome` means income minus expenses, so ban the word "net" and carve out "net worth".
		expect(contentFor('getting-started')).not.toMatch(/\bnet\b(?!\s+worth)/i)
		expect(contentFor('getting-started')).toMatch(/\bnet\s+worth\b/i)
	})

	it('does not claim the overview shows a figure it no longer renders', () => {
		const { overview } = gettingStartedSections()

		// The overview doesn't render net income, so the clause is gone rather than re-pointed.
		expect(overview).not.toMatch(/net\s+period\s+income/i)
		expect(overview).not.toMatch(/gap\s+between\s+them/i)
		expect(overview).toMatch(/net\s+worth/i)
		expect(overview).toMatch(/income\s+and\s+expenses/i)
	})

	/** Anchor on phrasing only this page carries: `4.33` and `estimate` also appear in faq.md and features.md. */
	const howTotals = () => contentFor('how-totals-are-calculated')

	/** Each heading must exist before slicing, or `indexOf` -1 silently widens a slice. */
	const howTotalsSections = () => {
		const content = howTotals()
		const bounds = [
			['factors', '### The conversion factors'],
			['spreadsheet', '### The same maths as your spreadsheet'],
			['example', '### A worked example'],
			['rounding', '### Why a few cents go missing'],
		] as const
		const starts = bounds.map(([, heading]) => {
			const index = content.indexOf(heading)
			if (index === -1) throw new Error(`how-totals page is missing the heading: ${heading}`)
			return index
		})
		const sections = {} as Record<(typeof bounds)[number][0], string>
		for (const [i, [key]] of bounds.entries()) {
			sections[key] = content.slice(starts[i], starts[i + 1] ?? content.length)
		}
		return sections
	}

	it('states the conversion factors as DIVISIONS, not as a 4.33 rule of thumb', () => {
		const { factors } = howTotalsSections()
		expect(factors).toMatch(/×\s*52\s*÷\s*12/)
		expect(factors).toMatch(/×\s*26\s*÷\s*12/)
		expect(factors).toMatch(/\*\*yearly\*\*\s*=\s*monthly\s*×\s*12/)
		expect(factors).toMatch(/\*\*weekly\*\*\s*=\s*monthly\s*×\s*12\s*÷\s*52/)
		expect(factors).toMatch(/\*\*Bi-weekly\*\*/)
	})

	it('tells a spreadsheet user the arithmetic is the SAME, so they check their data', () => {
		// Anchored on the distinguishing sentence, not "spreadsheet", which the FAQ also uses.
		const { spreadsheet } = howTotalsSections()
		expect(spreadsheet).toMatch(/the\s+same\s+arithmetic\s+you\s+are\s*\n?\s*already\s+doing/)
		expect(spreadsheet).toMatch(/algebraically\s+identical/)
		expect(spreadsheet).toMatch(/yearly\s*÷\s*52/)
		expect(spreadsheet).toMatch(/monthly\s*×\s*12\s*÷\s*52/)
		expect(spreadsheet).toMatch(/only\s+a\s+few\s+cents/)
	})

	it('discloses BOTH rounding sources with their magnitudes, and the $99.96 case', () => {
		const { rounding } = howTotalsSections()
		expect(rounding).toMatch(/rounded\s+to\s+the\s+nearest\s+cent\s+as\s+it\s+is\s+converted/)
		expect(rounding).toMatch(/under\s+half\s+a\s+cent\s+per\s+entry/)
		expect(rounding).toMatch(/under\s+about\s+six\s+cents\s+per\s+entry/)
		expect(rounding).toMatch(/rounded\s+separately\s+from\s+the\s+total/)
		expect(rounding).toContain('$99.96')
	})

	it('names forecasts as the exception, with the figure the engine actually computes', () => {
		// Computed from the engine: a forecast year counts each entry in full, so year 1 at 0% growth
		// is the spreadsheet figure.
		const forecast = calculateFinancialForecast(
			{
				income: [
					{ amount: 200_000, frequency: 'biweekly' },
					{ amount: 60_000, frequency: 'monthly' },
					{ amount: 120_000, frequency: 'annually' },
				],
				expenses: [],
				savings: 0,
				investments: 0,
			},
			{ name: 'flat', incomeGrowthRate: 0, expenseGrowthRate: 0, oneTimeEvents: [] },
			1
		)
		const firstYear = forecast.projection[0]?.income ?? Number.NaN
		expect(firstYear).toBe(6_040_000)

		const { rounding } = howTotalsSections()
		expect(rounding).toMatch(/Forecasts\s+are\s+the\s+one\s+exception/)
		expect(rounding).toContain(`$${formatCents(firstYear)}`) // '$60,400.00'
		expect(rounding).toMatch(
			/a\s+total\s+on\s+your\s+budget\s+pages\s+is\s+never\s+quietly\s+recomputed/
		)
	})

	it('makes no claim about WHERE entries are stored (the app stores what you entered)', () => {
		// The stores hold the entered amount and frequency and derive monthly per render.
		const page = howTotals()
		expect(page).not.toMatch(/\bstores\b/)
		expect(page).not.toMatch(/\bstored\s+as\b/)
		expect(page).toMatch(/kept\s+exactly\s+as\s+you\s+typed\s+them/)
	})

	it('the worked example matches what core actually computes (computed, not retyped)', () => {
		// Computed from core, never retyped, so the doc goes red if core's factors or rounding change.
		const monthly = calculateTotalMonthlyNormalized([
			{ amount: 200_000, frequency: 'biweekly' },
			{ amount: 60_000, frequency: 'monthly' },
			{ amount: 120_000, frequency: 'annually' },
		])
		const yearly = denormalizeFromMonthly(monthly, 'annually')

		const { example } = howTotalsSections()
		expect(example).toContain(formatCents(monthly)) // 503_333c → '5,033.33'
		expect(example).toContain(formatCents(yearly)) // 6_039_996c → '60,399.96'

		const spreadsheetYearly = 2_000_00 * 26 + 600_00 * 12 + 1_200_00
		expect(spreadsheetYearly - yearly).toBe(4)
		expect(example).toContain(formatCents(spreadsheetYearly)) // '60,400.00'

		for (const [amount, frequency] of [
			[200_000, 'biweekly'],
			[60_000, 'monthly'],
			[120_000, 'annually'],
		] as const) {
			expect(example).toContain(formatCents(normalizeToMonthly(amount, frequency)))
		}
	})

	it('the FAQ lists all FOUR selectable durations, including biweekly', () => {
		// The sentence hard-wraps between "duration" and "selector".
		const faq = contentFor('faq')
		expect(faq).toMatch(/weekly,\s+biweekly,\s+monthly,\s+and\s+annual\s+totals/)
		expect(faq).not.toMatch(/between\s+weekly,\s+monthly,\s+and\s+annual/)
	})

	it('all three existing surfaces link to the new page', () => {
		// The link guard below proves links resolve; only this proves they exist.
		const link = '(/docs/how-totals-are-calculated)'
		expect(contentFor('faq')).toContain(link)
		expect(contentFor('features')).toContain(link)
		expect(contentFor('getting-started')).toContain(link)
	})

	it('uses no markdown table — a bare <table> overflows the 320px floor', () => {
		// `MarkdownRenderer` renders a bare <table> with no overflow wrapper, which overflows at 320px.
		const page = howTotals()
		expect(page).not.toMatch(/^\s*\|/m)
		// GFM also accepts pipeless tables and one-dash delimiter cells (`-|-`), hence `-+`.
		expect(page).not.toMatch(/^\s*:?-+:?\s*\|/m)
	})

	it('every internal doc link targets a real app route', () => {
		// The routes referenced by the docs; each exists under apps/web/src/routes.
		const knownRoutes = new Set([
			'/docs/getting-started',
			'/docs/features',
			'/docs/faq',
			'/docs/how-totals-are-calculated',
			'/docs/where-a-mortgage-belongs',
			'/expenses',
			'/balance',
			'/privacy',
			'/settings',
			'/contact',
			// Hand-maintained: a removed route must leave this set too, or a doc link to a 404 passes.
			'/retirement',
			'/savings',
		])
		const internalLink = /\]\((\/[^)]*)\)/g
		for (const page of DOC_PAGES) {
			for (const match of page.content.matchAll(internalLink)) {
				expect(knownRoutes.has(match[1])).toBe(true)
			}
		}
	})

	const mortgage = () => contentFor('where-a-mortgage-belongs')

	/** The page's `###` sections; each heading must exist before slicing. */
	const mortgageSections = () => {
		const content = mortgage()
		const bounds = [
			['intro', '## Where a mortgage belongs'],
			['where', '### Where each part goes'],
			['example', '### A worked example'],
			['payment', '### What the payment changes'],
			['owed', '### What the amount still owed changes'],
			['property', '### What the property is worth changes'],
			['wrong', '### If your net worth looks wrong'],
		] as const
		const starts = bounds.map(([, heading]) => {
			const index = content.indexOf(heading)
			if (index === -1) throw new Error(`mortgage page is missing the heading: ${heading}`)
			return index
		})
		// If the file is reordered a slice becomes empty and every negative passes vacuously.
		for (const [i, start] of starts.entries()) {
			if (i > 0 && start <= starts[i - 1]) {
				throw new Error(`mortgage page sections are out of order at: ${bounds[i][1]}`)
			}
		}
		const sections = {} as Record<(typeof bounds)[number][0], string>
		for (const [i, [key]] of bounds.entries()) {
			sections[key] = content.slice(starts[i], starts[i + 1] ?? content.length)
		}
		return sections
	}

	it('the mortgage page tells the reader to link the payment in the debt’s Paid by field', () => {
		const { where } = mortgageSections()
		// Named by the literal field label the debt form renders.
		expect(where).toMatch(/\*Paid\s+by\*\s+field,\s+pick\s+the\s+payment[^.]*Expenses\s+page/i)
		expect(where).toMatch(/enter\s+it\s+only\s+once/i)
	})

	it('the mortgage page states the three-part model and scopes the debt claims', () => {
		const page = mortgage()
		const { where } = mortgageSections()
		expect(where).toMatch(/recurring\s+\*\*payment\*\*\s+goes\s+on\s+the\s+\[Expenses\]/i)
		expect(where).toMatch(
			/\*\*amount\s+still\s+owed\*\*\s+goes\s+on\s+the\s+\[Balance\s+Tracking\]/i
		)
		expect(where).toMatch(/type\s+\*\*Debt\*\*/)
		// The literal Type label is `Asset`, not "Property" or "owned outright".
		expect(where).toMatch(
			/\*\*property\s+itself\*\*\s+goes\s+on\s+the\s+same\s+page[^.]*type\s+\*\*Asset\*\*/i
		)
		expect(where).toMatch(/\*\*Investment\*\*,\s+\*\*Debt\*\*\s+and\s+\*\*Asset\*\*/)
		const { intro } = mortgageSections()
		expect(intro).toMatch(/there\s+is\s+a\s+third\s+figure/i)
		expect(page).toContain('(/expenses)')
		expect(page).toContain('(/balance)')
		// Debt-scoped: an investment contribution entered as an expense IS double-counted. One regex
		// spans the list and the reassurance so it can't drift into an unqualified sentence.
		expect(page).toMatch(
			/car\s+loan,\s+a\s+student\s+loan,\s+or\s+a\s+credit-card\s+balance[^.]*does\s+not\s+count\s+the\s+same\s+money\s+twice/i
		)
	})

	/** Forecasting has no debt term and its inputs are typed by hand, so the projection sentences were deleted. */
	/** A mortgage payment no longer affects the retirement planner, so the bullet was deleted, not re-pointed. */
	it('the payment section no longer claims to move the retirement planner', () => {
		const { payment, owed, property } = mortgageSections()

		// Positive anchors first: the section still lists what the payment DOES
		// change, so this cannot pass by the section having gone missing.
		expect(payment).toMatch(/the\s+total\s+on\s+the\s+Expenses\s+page/i)
		expect(payment).toMatch(
			/how\s+much\s+is\s+left\s+over\s+to\s+share\s+out\s+on\s+the\s+\[Savings\]/i
		)

		expect(payment).not.toMatch(/retirement/i)
		expect(payment).not.toMatch(/gap\s+between\s+your\s+income\s+and\s+your\s+expenses/i)

		// The deletion was narrow: both "stays out of the pot" claims must survive.
		expect(owed).toMatch(/retirement\s+planner's\s+pot/i)
		expect(property).toMatch(/retirement\s+planner's/i)
	})

	it('the mortgage page says what each figure does NOT affect', () => {
		const page = mortgage()
		const { payment, owed, property } = mortgageSections()
		expect(payment).toMatch(/does\s+\*\*not\*\*\s+change\s+your\s+net\s+worth,\s+on\s+any\s+page/i)
		expect(page).not.toMatch(/only\s+in\s+the\s+forward\s+direction/i)
		// `net[-\s]worth`: the unhyphenated form must be caught too.
		expect(page).not.toMatch(/net[-\s]worth\s+projection/i)
		expect(owed).toMatch(/does\s+\*\*not\*\*\s+change\s+your\s+cash\s+flow/i)
		expect(owed).toMatch(/left\s+out\s+of\s+the\s+retirement\s+planner/i)
		// The rationale is consistency (cash savings are already excluded), not "a condo isn't retirement savings".
		expect(property).toMatch(/stays\s+out\s+of\s+the\s+retirement\s+planner/i)
		expect(property).toMatch(/same\s+reason\s+cash\s+in\s+a\s+savings\s+account\s+does/i)
		expect(property).toMatch(/does\s+not\s+ask\s+you\s+to\s+set\s+a\s+contribution/i)
		expect(property).toContain('(/savings)')
	})

	it("each figure's effects are listed under THAT figure", () => {
		const { payment, owed, property } = mortgageSections()
		// Each positive effect is pinned to its own section AND denied to the others.
		const paymentEffects = [
			/the\s+total\s+on\s+the\s+Expenses\s+page/i,
			/Total\s+Expenses\s+figure\s+on\s+the\s+home\s+page/i,
			/left\s+over\s+to\s+share\s+out\s+on\s+the\s+\[Savings\]/i,
		]
		const owedEffects = [
			/Total\s+Debts\s+and\s+Net\s+Worth\s+on\s+the\s+Balance\s+Tracking\s+page/i,
			/debts\s+bar\s+in\s+the\s+balances\s+chart/i,
		]
		const propertyEffects = [
			/Other\s+Assets\s+and\s+Net\s+Worth\s+on\s+the\s+Balance\s+Tracking\s+page/i,
			/assets\s+bar\s+in\s+the\s+balances\s+chart/i,
		]
		for (const effect of paymentEffects) {
			expect(payment).toMatch(effect)
			expect(owed).not.toMatch(effect)
			expect(property).not.toMatch(effect)
		}
		for (const effect of owedEffects) {
			expect(owed).toMatch(effect)
			expect(payment).not.toMatch(effect)
		}
		for (const effect of propertyEffects) {
			expect(property).toMatch(effect)
			expect(payment).not.toMatch(effect)
		}
	})

	it('the mortgage page does not promise the debt shrinks', () => {
		const { owed, property } = mortgageSections()
		// No rate is asked for, so nothing amortises and no figure is recalculated.
		expect(owed).toMatch(/does\s+not\s+ask\s+for\s+your\s+interest\s+rate/i)
		expect(owed).toMatch(/does\s+not\s+work\s+out\s+how\s+a\s+loan\s+amortises/i)
		expect(owed).not.toMatch(/does\s+not\s+ask\s+for\s+your\s+repayment\s+schedule/i)
		expect(owed).toMatch(/stays\s+exactly\s+where\s+you\s+put\s+it\s+until\s+you\s+change\s+it/i)
		expect(property).toMatch(/does\s+not\s+track\s+the\s+value\s+for\s+you/i)
		// Split on line breaks too, so one `not` can't excuse a claim elsewhere in the chunk; the
		// particle may follow the object ("pays the mortgage down").
		const progressVerb =
			/(reduc|lower|shrink|decreas|diminish|dwindl|erod|whittl|chip)\w*|\bpay\w*\b(?:[^.]{0,40}?)\b(down|off)\b|\bbring\w*\b(?:[^.]{0,40}?)\bdown\b|\bgo(?:es)?\s+down\b|\bfall\w*\b/i
		const debtObject = /(balance|principal|mortgage|loan|what\s+you\s+owe|debt)/i
		// Denials are legitimate; cover contracted and prefixed forms ("doesn't", "cannot").
		const denial =
			/\b(not|never|no|cannot|can't|won't|doesn't|does not|isn't|nothing)\b|\bcannot\b/i
		// One claim per line-or-sentence, so a `not` in a neighbouring sentence
		// cannot vouch for a bullet three lines away.
		const chunks = mortgage()
			.split(/\n\s*\n|\n(?=\s*[-*#])|(?<=\.)\s+/)
			.map((chunk) => chunk.replace(/\s+/g, ' ').trim())
			.filter(Boolean)
		const offenders = chunks.filter(
			(chunk) => progressVerb.test(chunk) && debtObject.test(chunk) && !denial.test(chunk)
		)
		// Name the offending text: "expected true to be false" is undiagnosable.
		expect(offenders).toEqual([])
	})

	it('the mortgage page tells a homeowner how to record the house', () => {
		const page = mortgage()
		const { property, wrong } = mortgageSections()
		expect(page).not.toMatch(/cannot\s+yet\s+record\s+a\s+house/i)
		expect(page).not.toMatch(
			/negative\s+net\s+worth\s+after\s+adding\s+a\s+mortgage\s+is\s+expected/i
		)
		expect(page).not.toMatch(/records\s+investments\s+and\s+debts\b/i)
		// The Balance-page card is "Other Assets", not "Total Assets".
		expect(property).toMatch(
			/Other\s+Assets\s+and\s+Net\s+Worth\s+on\s+the\s+Balance\s+Tracking\s+page/i
		)
		expect(property).toMatch(/assets\s+bar\s+in\s+the\s+balances\s+chart/i)
		expect(wrong).toMatch(/property\s+itself\s+has\s+not\s+been\s+entered\s+yet/i)
		expect(wrong).toMatch(/add\s+it\s+as\s+an\s+\*\*Asset\*\*/i)
	})

	it('the mortgage page description matches the three-part model', () => {
		// The description is not in the .md; it renders as the page subtitle and on the index card.
		const page = DOC_PAGES.find((doc) => doc.slug === 'where-a-mortgage-belongs')
		if (!page) throw new Error('missing expected doc page: where-a-mortgage-belongs')
		// A loan is two things; the property is a separate, conditional third entry.
		expect(page.description).toMatch(
			/both\s+a\s+recurring\s+payment\s+and\s+a\s+debt,\s+where\s+the\s+property\s+itself\s+goes/i
		)
		expect(page.description).not.toMatch(
			/a\s+loan\s+is\s+a\s+recurring\s+payment,\s+a\s+debt\s+and\s+a\s+property/i
		)
	})

	/**
	 * Section-scoped: the same figures already appear in the closing section.
	 * Pinned as literals: this is an illustrative scenario no function produces.
	 */
	it('the worked example lays out three entries with their pages and fields', () => {
		const { example } = mortgageSections()

		// Type names are the literal dropdown labels (`Asset`, `Debt`).
		expect(example).toMatch(
			/Balance\s+Tracking\s+Condo\s+Asset\s+Current\s+Balance\/Value\s+\$400,000/
		)
		expect(example).toMatch(
			/Balance\s+Tracking\s+Condo\s+mortgage\s+Debt\s+Current\s+Balance\/Value\s+\$300,000/
		)
		expect(example).toMatch(/Expenses\s+Condo\s+mortgage\s+—\s+Amount\s+\(Monthly\)\s+\$1,800/)

		expect(example).toMatch(/Page\s+Entry\s+Type\s+Field\s+Value/)

		// `Current Balance/Value`, case-insensitive and token-bounded so "…/Valued" doesn't match.
		expect(example).not.toMatch(/current\s+balance(?!\/value\b)/i)

		expect(example).toMatch(/\$400,000\s+owned\s+less\s+\$300,000\s+owed\s+leaves\s+\$100,000/)
		expect(example).toMatch(/cash\s+flow\s+counts\s+only\s+the\s+third/i)
	})

	it('the worked example answers the down payment, and answers it there', () => {
		const { example } = mortgageSections()
		const page = mortgage()

		// Anchored on "down payment": the page has a whole section about "payment".
		expect(example).toMatch(/down\s+payment\s+is\s+not\s+entered\s+anywhere/i)
		expect(example).toMatch(
			/already\s+reflected\s+in\s+the\s+gap\s+between\s+what\s+the\s+property\s+is\s+worth\s+and\s+what\s+is\s+still\s+owed/i
		)

		// One down-payment claim, in one place; `[-\s]?` catches hyphenated and joined spellings.
		expect(page.match(/down[-\s]?payment/gi)).toHaveLength(1)
	})

	it('the mortgage page uses no markdown table', () => {
		// A bare <table> overflows at 320px, and a payment-vs-principal table is this page's most natural shape.
		const page = mortgage()
		expect(page).not.toMatch(/^\s*\|/m)
		// Pipeless GFM tables too, and one-dash delimiter cells, hence `-+`.
		expect(page).not.toMatch(/^\s*:?-+:?\s*\|/m)
	})

	it('both doc surfaces still link to the mortgage page', () => {
		// The link guard proves links resolve; only this proves they exist.
		const link = '(/docs/where-a-mortgage-belongs)'
		expect(contentFor('getting-started')).toContain(link)
		expect(contentFor('features')).toContain(link)
	})
})
