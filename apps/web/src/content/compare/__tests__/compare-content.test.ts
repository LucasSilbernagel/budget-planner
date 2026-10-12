import { describe, expect, it } from 'vitest'
import {
	COMPARE_PAGES,
	COMPARE_ROW_IDS,
	COMPARE_ROW_LABELS,
	type ComparePage,
	getComparePage,
} from '../index'

const SUPERLATIVE = /\b(best|cheapest)\b/i

// Abbreviations keep their space so a split never lands mid-sentence.
function sentences(text: string): string[] {
	return text
		.replace(/\s+/g, ' ')
		.replace(/\b(e\.g|i\.e|vs|U\.S)\. /gi, (m) => m.replace('. ', '. '))
		.split(/(?<=[.!?]) +/)
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

// Everything a reader sees on the page, with the one literal `!` token a spreadsheet has.
function visibleText(page: ComparePage): string[] {
	return [...cells(page), page.description, ...page.competitorBetter, ...prose(page)].map((text) =>
		text.replaceAll('#REF!', '#REF')
	)
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
	it('finds a known slug exactly and refuses variants', () => {
		expect(getComparePage('longhand-vs-spreadsheet')?.title).toBe(
			'Longhand Budget vs a spreadsheet'
		)
		expect(getComparePage('Longhand-vs-spreadsheet')).toBeUndefined()
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

	it('sources every competitor cell that quotes a figure', () => {
		for (const id of COMPARE_ROW_IDS) {
			const cell = page.rows[id]
			if (/[\d$€]/.test(cell.competitor)) {
				expect(cell.source, `${id}: "${cell.competitor}" quotes a figure without a source`).toMatch(
					/^https:\/\//
				)
			}
		}
	})

	it('carries a real calendar date that is not in the future', () => {
		expect(page.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		const date = new Date(`${page.verifiedOn}T00:00:00Z`)
		expect(Number.isNaN(date.getTime())).toBe(false)
		expect(date.toISOString().slice(0, 10)).toBe(page.verifiedOn)
		expect(date.getTime()).toBeLessThanOrEqual(Date.now())
	})

	it('makes no superlative claim and never shouts, anywhere a reader can see', () => {
		for (const text of visibleText(page)) {
			expect(text, text).not.toMatch(SUPERLATIVE)
			expect(text, text).not.toContain('!')
		}
	})

	it('shows no competitor imagery', () => {
		for (const text of prose(page)) expect(text).not.toMatch(/<img|!\[/)
	})

	it('says "EU" only of the premium tier or sync, never in a sentence about the free tier', () => {
		for (const text of prose(page)) {
			for (const sentence of sentences(text)) {
				if (/\bEU\b|European/.test(sentence)) {
					expect(sentence, sentence).toMatch(/premium|sync/i)
					expect(sentence, sentence).not.toMatch(/free tier/i)
				}
			}
		}
	})

	it('follows the slug, title and name conventions', () => {
		expect(page.slug).toMatch(/^longhand-vs-[a-z0-9-]+$/)
		expect(page.title.startsWith('Longhand Budget vs ')).toBe(true)
		expect(page.competitorName, 'no leading article: it is read mid-sentence').not.toMatch(
			/^(A|An|The) /
		)
		expect(page.competitorPricingLabel.length).toBeGreaterThan(0)
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

describe('the sentence splitter', () => {
	it('does not split on common abbreviations', () => {
		expect(sentences('Use e.g. a sheet. Then vs. an app.')).toEqual([
			'Use e.g. a sheet.',
			'Then vs. an app.',
		])
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
		['Debt.com sample size', '1,051 respondents'],
		['Tiller price', '$99 a year'],
		['Microsoft 365 Personal price', '$99.99'],
		['Microsoft 365 Personal price in Germany', '99 €'],
		['Etsy bestseller price band', '$0.99 to $2.50'],
		['the formula failure mode', '#REF'],
	])('mentions %s (%s)', (_label, needle) => {
		expect(everything).toContain(needle)
	})

	it('concedes the spreadsheet is free and owned, and that a desktop file is as private', () => {
		expect(page.competitorBetter.join(' ')).toMatch(/free/i)
		expect(page.competitorBetter.join(' ')).toMatch(/own the file/i)
		expect(page.faq.map((f) => f.a).join(' ')).toMatch(/exactly as private/i)
	})

	it('links the competitor prices it quotes to the pages that show them', () => {
		expect(page.competitorPricingUrl).toContain('microsoft.com')
		expect(page.competitorPricingLabel).toBe('Microsoft 365 pricing')
		expect(page.rows.priceMonthly.source).toBe(page.competitorPricingUrl)
		expect(page.rows.priceAnnual.source).toContain('hagel-it.de')
		expect(page.sources.map((s) => s.url)).toContain(page.rows.priceAnnual.source)
	})

	it('states the cloud-spreadsheet AI-training possibility as a hedged, sourced claim', () => {
		const cell = page.rows.adsTrackersAi
		expect(cell.competitor).toMatch(/may include training AI models/)
		expect(cell.competitor).toMatch(/improve or develop their services/)
		expect(cell.source).toContain('microsoft.com/en-us/privacy')
		expect(page.sources.map((s) => s.url)).toContain('https://policies.google.com/privacy')
	})

	it('names the premium third parties honestly', () => {
		expect(page.rows.thirdParties.longhand).toMatch(/hosting provider/i)
		expect(page.rows.thirdParties.longhand).toMatch(/Paddle/)
		expect(page.rows.thirdParties.longhand).toMatch(/Brevo/)
	})
})

describe('the Actual Budget page states its sourced facts', () => {
	const page = getComparePage('longhand-vs-actual-budget')
	if (!page) throw new Error('actual budget page missing')
	const everything = [
		page.body,
		...cells(page),
		...page.competitorBetter,
		...page.longhandBetter,
		...page.faq.map((f) => f.a),
	]
		.join(' ')
		.replace(/\s+/g, ' ')

	it.each([
		['PikaPods hosting cost', '$2 a month'],
		['SimpleFIN yearly price', '$15 a year'],
		['the hosted total from the 2026 breakdown', '$33 a year'],
		['the docs quote on the browser-only app', 'not recommended for long-term use'],
		['the licence', 'MIT'],
		['encryption', 'end-to-end encryption'],
		['the version', 'v26.10.0'],
	])('mentions %s (%s)', (_label, needle) => {
		expect(everything).toContain(needle)
	})

	it('leads the competitor-better list with free, encryption, desktop app, open source and import', () => {
		const text = page.competitorBetter.slice(0, 5).join(' ')
		for (const needle of [/free/i, /encryption/i, /desktop app/i, /open source/i, /import/i]) {
			expect(text).toMatch(needle)
		}
	})

	it('keeps the proper noun capitalised and the hosting doc as its pricing page', () => {
		expect(page.competitorName).toBe('Actual Budget')
		expect(page.competitorPricingUrl).toBe('https://actualbudget.org/docs/install/pikapods/')
		expect(page.competitorPricingLabel).toBe('Actual Budget hosting costs')
	})

	it('says nothing about the scam app, the security fix or AI-written commits', () => {
		expect(everything).not.toMatch(/scam|fake|impostor|official Actual app/i)
		expect(everything).not.toMatch(/26\.3\.0|security fix/i)
		expect(everything).not.toMatch(/AI-written|written by AI/i)
	})
})
