import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/utils'
import { COMPARE_PAGES } from '../../../content/compare'
import { CompareHub, HUB_DESCRIPTION, HUB_TITLE } from '../compare-hub'

function sentencesOf(container: HTMLElement): string[] {
	return (container.textContent ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
}

describe('CompareHub', () => {
	it('targets the hub query phrase and links every comparison by title', () => {
		expect(HUB_TITLE).toBe('Budget planner without bank sync')
		render(<CompareHub />)
		for (const page of COMPARE_PAGES) {
			const heading = screen.getByRole('heading', { level: 3, name: page.title })
			expect(heading.closest('a')).toHaveAttribute('href', `/compare/${page.slug}`)
		}
	})

	it('describes only the comparisons that exist, names the row count and the section order', () => {
		for (const page of COMPARE_PAGES) expect(page.slug).not.toMatch(/ynab|monarch/)
		expect(HUB_DESCRIPTION).not.toMatch(/YNAB|Monarch/)
		const { container } = render(<CompareHub />)
		const text = (container.textContent ?? '').replace(/\s+/g, ' ')
		expect(text).toContain('the same 17 rows')
		expect(text).toContain('before it says where Longhand Budget is better')
		expect(text).toContain('trademarks of their respective owners')
	})

	it('says "EU-hosted" only of premium sync, says "private", and never ties EU to the free tier', () => {
		const { container } = render(<CompareHub />)
		const sentences = sentencesOf(container)
		const euSentences = sentences.filter((s) => /\bEU\b|European/.test(s))
		expect(euSentences.length).toBeGreaterThan(0)
		for (const sentence of euSentences) {
			expect(sentence).toMatch(/premium/i)
			expect(sentence).toMatch(/sync/i)
		}
		const freeTierSentences = sentences.filter((s) => /free tier/i.test(s))
		expect(freeTierSentences.length).toBeGreaterThan(0)
		for (const sentence of freeTierSentences) expect(sentence).not.toMatch(/\bEU\b|European/)
		const text = sentences.join(' ')
		expect(text).toMatch(/\bprivate\b/i)
		expect(text).toMatch(/never connects to a bank/i)
		expect(text).toMatch(/does not track individual purchases/i)
	})
})
