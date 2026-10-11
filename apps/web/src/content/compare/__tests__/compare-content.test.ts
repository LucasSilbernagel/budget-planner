import { describe, expect, it } from 'vitest'
import {
	COMPARE_PAGES,
	COMPARE_ROW_IDS,
	COMPARE_ROW_LABELS,
	type ComparePage,
	getComparePage,
} from '../index'

const SUPERLATIVE = /\b(best|cheapest)\b/i

function sentences(text: string): string[] {
	return text
		.replace(/\s+/g, ' ')
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter(Boolean)
}

function prose(page: ComparePage): string[] {
	return [
		page.verdict,
		page.body,
		page.switching,
		...page.longhandBetter,
		...page.faq.map((f) => f.a),
		...COMPARE_ROW_IDS.map((id) => page.rows[id].longhand),
	]
}

function cells(page: ComparePage): string[] {
	return COMPARE_ROW_IDS.flatMap((id) => [page.rows[id].longhand, page.rows[id].competitor])
}

describe('COMPARE_PAGES', () => {
	it('has at least the spreadsheet page', () => {
		expect(COMPARE_PAGES.map((p) => p.slug)).toContain('longhand-vs-spreadsheet')
	})

	it('uses unique slugs', () => {
		const slugs = COMPARE_PAGES.map((p) => p.slug)
		expect(new Set(slugs).size).toBe(slugs.length)
	})

	it('labels every row id exactly once', () => {
		expect(Object.keys(COMPARE_ROW_LABELS).sort()).toEqual([...COMPARE_ROW_IDS].sort())
	})
})

describe('getComparePage', () => {
	it('finds a known slug and refuses an unknown one', () => {
		expect(getComparePage('longhand-vs-spreadsheet')?.title).toBe(
			'Longhand Budget vs a spreadsheet'
		)
		expect(getComparePage('longhand-vs-nothing')).toBeUndefined()
	})
})

describe.each(COMPARE_PAGES)('honesty guards: $slug', (page) => {
	it('names at least three things the competitor does better', () => {
		expect(page.competitorBetter.length).toBeGreaterThanOrEqual(3)
	})

	it('frames the planner-versus-tracker difference in the verdict', () => {
		expect(page.verdict).toMatch(/track/i)
	})

	it('cites https sources and a competitor pricing page', () => {
		expect(page.competitorPricingUrl).toMatch(/^https:\/\//)
		expect(page.sources.length).toBeGreaterThan(0)
		for (const source of page.sources) expect(source.url).toMatch(/^https:\/\//)
		for (const id of COMPARE_ROW_IDS) {
			const source = page.rows[id].source
			if (source !== undefined) expect(source).toMatch(/^https:\/\//)
		}
	})

	it('carries a real verification date that is not in the future', () => {
		expect(page.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		const date = new Date(`${page.verifiedOn}T00:00:00Z`)
		expect(Number.isNaN(date.getTime())).toBe(false)
		expect(date.getTime()).toBeLessThanOrEqual(Date.now())
	})

	it('makes no superlative claim and never shouts', () => {
		for (const text of [...cells(page), page.verdict, ...page.longhandBetter]) {
			expect(text, text).not.toMatch(SUPERLATIVE)
			expect(text, text).not.toContain('!')
		}
	})

	it('shows no competitor imagery', () => {
		for (const text of prose(page)) expect(text).not.toMatch(/<img|!\[/)
	})

	it('says "EU" only of the premium tier or sync, never of the local-only free tier', () => {
		for (const text of prose(page)) {
			for (const sentence of sentences(text)) {
				if (/\bEU\b|European/.test(sentence)) {
					expect(sentence, sentence).toMatch(/premium|sync/i)
				}
			}
		}
	})

	it('follows the slug and title conventions', () => {
		expect(page.slug).toMatch(/^longhand-vs-[a-z0-9-]+$/)
		expect(page.title.startsWith('Longhand Budget vs ')).toBe(true)
		expect(page.description.length).toBeGreaterThan(0)
		expect(page.faq.length).toBeGreaterThanOrEqual(4)
		expect(page.faq.length).toBeLessThanOrEqual(6)
		expect(page.switching).toMatch(/no import/i)
		for (const id of COMPARE_ROW_IDS) {
			expect(page.rows[id].longhand.length, id).toBeGreaterThan(0)
			expect(page.rows[id].competitor.length, id).toBeGreaterThan(0)
		}
	})
})

describe('the spreadsheet page states its sourced facts', () => {
	const page = getComparePage('longhand-vs-spreadsheet')
	if (!page) throw new Error('spreadsheet page missing')
	const everything = [page.body, ...cells(page), ...page.competitorBetter, ...page.longhandBetter]
		.join(' ')
		.replace(/\s+/g, ' ')

	it.each([
		['Debt.com spreadsheet share', '27.4%'],
		['Debt.com "too time-consuming" share', '34.2%'],
		['Tiller price', '$99 a year'],
		['Microsoft 365 Personal price', '$99.99'],
		['Microsoft 365 Personal price in Germany', '99 €'],
		['the formula failure mode', '#REF'],
	])('mentions %s (%s)', (_label, needle) => {
		expect(everything).toContain(needle)
	})

	it('concedes the spreadsheet is free and owned, and that a desktop file is as private', () => {
		expect(page.competitorBetter.join(' ')).toMatch(/free/i)
		expect(page.competitorBetter.join(' ')).toMatch(/own the file/i)
		expect(page.faq.map((f) => f.a).join(' ')).toMatch(/exactly as private/i)
	})

	it('links the one competitor price it quotes', () => {
		expect(page.competitorPricingUrl).toContain('microsoft.com')
		expect(page.rows.priceAnnual.source).toBe(page.competitorPricingUrl)
	})
})
