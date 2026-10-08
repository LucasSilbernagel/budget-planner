import { describe, expect, it } from 'vitest'
import { getLegalPage, LEGAL_PAGES, PRICING_PAGE, PRIVACY_PAGE } from '../index'

describe('LEGAL_PAGES', () => {
	it('exposes the pricing, terms, privacy, and refund pages', () => {
		const slugs = LEGAL_PAGES.map((page) => page.slug)
		expect(slugs).toEqual(expect.arrayContaining(['pricing', 'terms', 'privacy', 'refund']))
	})

	it('gives every page a slug, title, description, and non-empty markdown body', () => {
		for (const page of LEGAL_PAGES) {
			expect(page.slug).toMatch(/^[a-z0-9-]+$/)
			expect(page.title.length).toBeGreaterThan(0)
			expect(page.description.length).toBeGreaterThan(0)
			expect(page.content.trim().length).toBeGreaterThan(0)
		}
	})

	it('uses unique slugs', () => {
		const slugs = LEGAL_PAGES.map((page) => page.slug)
		expect(new Set(slugs).size).toBe(slugs.length)
	})

	it('keeps the route header as the single h1: no body-level h1, at least one h2', () => {
		for (const page of LEGAL_PAGES) {
			// The route header owns the only `<h1>`; bodies must not introduce another.
			expect(page.content).not.toMatch(/^# .+/m)
			expect(page.content).toMatch(/^## .+/m)
		}
	})

	it('never opens a body with a heading that just repeats the page title', () => {
		for (const page of LEGAL_PAGES) {
			const firstHeading = page.content.match(/^#{2,6} (.+)$/m)?.[1]?.trim()
			expect(firstHeading).not.toBe(page.title)
		}
	})

	it('contains no unresolved DRAFT banner or bracketed placeholder (10-3 AC-1)', () => {
		for (const page of LEGAL_PAGES) {
			expect(page.content).not.toMatch(/DRAFT — pending legal review/)
			expect(page.content).not.toMatch(/\[(?:DATE|PRICE|CONFIRM)\b[^\]]*\]/)
		}
	})

	it('refers to the product as "Longhand Budget", never the retired brands (stories 27-3, brand-1)', () => {
		for (const page of LEGAL_PAGES) {
			expect(page.content).not.toContain('Budget Planner')
			expect(page.description).not.toContain('Budget Planner')
			expect(page.description).not.toContain('SoluBudget')
		}
		expect(getLegalPage('terms')?.content).toContain('Longhand Budget')
		expect(getLegalPage('terms')?.description).toContain('Longhand Budget')
	})

	it('every legal page carries a visible last-updated date (AC-5)', () => {
		for (const page of LEGAL_PAGES) {
			expect(page.content).toMatch(/_Last updated: \d{1,2} \w+ \d{4}_/)
		}
	})
})

describe('getLegalPage', () => {
	it('returns the matching page for a known slug', () => {
		expect(getLegalPage('privacy')?.title).toBe('Privacy Policy')
	})

	it('returns undefined for an unknown slug', () => {
		expect(getLegalPage('does-not-exist')).toBeUndefined()
	})
})

describe('privacy page: retention period (story 73.1)', () => {
	const RETENTION_HEADING = /^## How long we keep your data$/gm

	function retentionSection(): string {
		const content = PRIVACY_PAGE.content
		const headings = [...content.matchAll(RETENTION_HEADING)]
		if (headings.length !== 1) {
			throw new Error(`privacy.md must have exactly one retention h2, found ${headings.length}`)
		}
		const rest = content.slice((headings[0].index ?? 0) + headings[0][0].length)
		const next = rest.search(/^## /m)
		return next === -1 ? rest : rest.slice(0, next)
	}

	function bullet(label: string): string {
		const found = retentionSection()
			.split(/^- /m)
			.find((item) => item.startsWith(`**${label}**`))
		if (found === undefined) {
			throw new Error(`retention section has no "${label}" bullet`)
		}
		return found
	}

	it('states the 12-month period and the 30-day notice, and no other duration', () => {
		const section = retentionSection().replaceAll('*', '')
		const durations = [
			...section.matchAll(
				/\b(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty[\s-]four)[\s-]+(day|week|month|year)s?\b/gi
			),
		].map((match) => `${match[1].toLowerCase()} ${match[2].toLowerCase()}`)
		expect(durations).toContain('12 month')
		expect(durations).toContain('30 day')
		expect(
			durations.every((duration) => duration === '12 month' || duration === '30 day'),
			`durations stated: ${durations}`
		).toBe(true)
	})

	it('exempts every entitled account in the Premium bullet: active, payment retried, lifetime', () => {
		const premium = bullet('While you have Premium')
		expect(premium).toMatch(/as long as your Premium access continues/)
		expect(premium).toMatch(/payment is being retried/)
		// A lifetime purchase can be revoked (refund or chargeback), so "never lapses" would be false.
		expect(premium).toMatch(/lifetime license \(unless the purchase is refunded or charged back\)/)
	})

	it('states the trigger, the clock and the commitment in the lapse bullet', () => {
		const lapsed = bullet('After Premium access ends')
		expect(lapsed).toMatch(/if your Premium access ends/)
		expect(lapsed).toMatch(/a purchase is refunded or charged back/)
		expect(lapsed).toMatch(/your subscription ends or is paused/)
		expect(lapsed).toMatch(/you do not buy Premium again/)
		expect(lapsed).toMatch(/from the day your access ended/)
		expect(lapsed).toMatch(/Signing in during that time does not reset the 12 months/)
		expect(lapsed).toMatch(/we will delete your account and all of your synced data/)
		expect(lapsed).toMatch(/We will email you at least 30 days before that happens/)
		// "normally": an account whose warning keeps failing is never deleted unwarned, so it can run past the bound.
		expect(lapsed).toMatch(/normally within 30 days of the 12 months ending/)
		expect(lapsed).not.toMatch(/payment is being retried|lifetime license/)
	})

	it('says, in the Premium sync section, that the retirement plan is synced (story 99.3, D8)', () => {
		const content = PRIVACY_PAGE.content
		const start = content.search(/^## Premium tier: EU-hosted sync$/m)
		expect(start, 'privacy.md has no "## Premium tier: EU-hosted sync" section').toBeGreaterThan(-1)
		const next = content.slice(start + 1).search(/^## /m)
		const section = content.slice(start, next === -1 ? undefined : start + 1 + next)
		expect(section).toContain(
			'The synced data also covers your retirement plan, including your age, your life expectancy, the retirement income you want and your expected investment returns.'
		)
	})

	it('covers the Premium account and its synced data, not the free tier', () => {
		const section = retentionSection()
		expect(section).toMatch(/covers your Premium account and the data it syncs/)
		expect(section).toMatch(/Free-tier data stays on your device/)
	})

	it('points a lapsed user at self-service deletion, and the section it cites exists after it', () => {
		const self = bullet("You don't have to wait")
		expect(self).toMatch(/at any time from Settings/)
		expect(self).toMatch(/see "Your rights" below/)
		const content = PRIVACY_PAGE.content
		const rights = content.search(/^## Your rights$/m)
		expect(rights, 'privacy.md has no "## Your rights" section').toBeGreaterThan(
			content.search(RETENTION_HEADING)
		)
	})

	it('states commitments, not the mechanism that carries them out', () => {
		expect(retentionSection()).not.toMatch(
			/\b(automatic(ally)?|automated|auto-?delet\w*|scheduled|nightly|daily|weekly|periodic(ally)?|cron|job|every (night|day|week|month))\b|our system deletes/i
		)
	})
})

describe('pricing page content (AC-4)', () => {
	it('discloses Paddle as the Merchant of Record', () => {
		expect(PRICING_PAGE.content).toMatch(/Paddle/)
		expect(PRICING_PAGE.content).toMatch(/Merchant of Record/i)
	})

	it('states the finalized EUR pricing — three plans (stories 25-2, 5-20)', () => {
		expect(PRICING_PAGE.content).toMatch(/€39 per year/)
		expect(PRICING_PAGE.content).toMatch(/€99/)
		expect(PRICING_PAGE.content).toMatch(/lifetime/i)

		expect(PRICING_PAGE.content).toMatch(/€5\.99 per month/)

		const savingPct = Math.round((1 - 39 / (5.99 * 12)) * 100)
		expect(PRICING_PAGE.content).toMatch(new RegExp(`${savingPct}% cheaper`))

		expect(PRICING_PAGE.content).not.toMatch(/€10\b/)
	})

	it('de-duplicates the plan comparison — prose carries billing/legal only, not the card feature lists (story 20-4, CONTENT-L)', () => {
		expect(PRICING_PAGE.content).toMatch(/### Billing & payments/)
		expect(PRICING_PAGE.content).not.toMatch(/### Free/)
		expect(PRICING_PAGE.content).not.toMatch(/### Premium/)
		expect(PRICING_PAGE.content).not.toMatch(/Everything in Free, plus/i)
		expect(PRICING_PAGE.content).not.toMatch(/Track income, expenses/i)
	})

	it('keeps forecasting benefit detail out of the prose (stories 20-1, 20-4, 30-2)', () => {
		expect(PRICING_PAGE.content).not.toMatch(/reloadable/i)

		expect(PRICING_PAGE.content).not.toMatch(/side[\s-]by[\s-]side/i)
	})
})

describe('privacy page: the retention warning email is disclosed (story 73.2)', () => {
	it('names the retention warning in the Brevo section, and still only the address', () => {
		const content = PRIVACY_PAGE.content
		const start = content.search(/^## Sign-in and account emails$/m)
		expect(start, 'privacy.md has no "## Sign-in and account emails" section').toBeGreaterThan(-1)
		const rest = content.slice(start + 1)
		const section = rest.slice(0, rest.search(/^## /m))
		expect(section).toMatch(/Brevo/)
		expect(section).toMatch(/warning before a lapsed account is deleted/)
		expect(section).toMatch(/only the email address/)
		expect(section).toMatch(/never receives your financial data/)
	})
})

describe('privacy page: display preferences (story 95.1)', () => {
	function displayPreferencesBullet(): string {
		const lines = PRIVACY_PAGE.content
			.split('\n')
			.filter((line) => line.startsWith('- **Display preferences**'))
		expect(lines, 'privacy.md must have exactly one Display preferences bullet').toHaveLength(1)
		return lines[0] ?? ''
	}

	it('says the currency choice is saved and the theme follows the device', () => {
		const bullet = displayPreferencesBullet()
		expect(bullet).toMatch(/currency\s+choice\s+is\s+saved\s+locally/i)
		expect(bullet).toMatch(/theme\s+simply\s+follows\s+your\s+device's\s+setting/i)
		expect(bullet).toMatch(/nothing\s+is\s+stored\s+for\s+it/i)
	})

	it('no longer claims the theme is saved, nor that currency is the only thing saved', () => {
		const bullet = displayPreferencesBullet()
		expect(bullet).not.toMatch(/theme\s+and\s+currency\s+choices\s+are\s+saved/i)
		expect(bullet).not.toMatch(/only\s+(your\s+)?currency/i)
	})
})
