import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/utils'
import { COMPARE_PAGES } from '../../../content/compare'
import { CompareHub, HUB_TITLE } from '../compare-hub'

describe('CompareHub', () => {
	it('targets the hub query phrase and links every comparison by title', () => {
		expect(HUB_TITLE).toBe('Budget planner without bank sync')
		render(<CompareHub />)
		for (const page of COMPARE_PAGES) {
			expect(screen.getByRole('link', { name: new RegExp(page.title) })).toHaveAttribute(
				'href',
				`/compare/${page.slug}`
			)
		}
	})

	it('says "EU-hosted" only in a sentence about premium sync, never of the free tier', () => {
		const { container } = render(<CompareHub />)
		const text = (container.textContent ?? '').replace(/\s+/g, ' ')
		const sentences = text.split(/(?<=[.!?])\s+/)
		const euSentences = sentences.filter((s) => /\bEU\b|European/.test(s))
		expect(euSentences.length).toBeGreaterThan(0)
		for (const sentence of euSentences) {
			expect(sentence).toMatch(/premium/i)
			expect(sentence).toMatch(/sync/i)
			expect(sentence).not.toMatch(/free tier is .*EU/i)
		}
		expect(text).toMatch(/never connects to a bank/i)
		expect(text).toMatch(/does not track individual purchases/i)
	})
})
