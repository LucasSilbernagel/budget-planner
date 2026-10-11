import { describe, expect, it } from 'vitest'
import { render } from '@/test/utils'
import { CompareLayout } from '../compare-layout'

function sweep(root: HTMLElement): string[] {
	return [root, ...root.querySelectorAll('*')].flatMap((element) => [...element.classList])
}

// Keep identical across every subtree sweep, so no file carries a weaker guarantee.
const RETIRED_LIGHT_ONLY_TOKENS = [
	'bg-white',
	'bg-gray-50',
	'text-gray-900',
	'text-gray-800',
	'text-gray-700',
	'text-gray-600',
	'text-gray-500',
	'text-blue-600',
	'text-blue-700',
	'border-gray-200',
] as const

function renderLayout(activeSlug?: string) {
	const { container } = render(
		<CompareLayout title="Compare" description="How Longhand compares." activeSlug={activeSlug}>
			<p>Body</p>
		</CompareLayout>
	)
	const root = container.firstElementChild
	if (!(root instanceof HTMLElement)) throw new Error('CompareLayout rendered no root element')
	return root
}

describe('CompareLayout', () => {
	it('paints the page canvas with the surface-sunken token and the semantic header tokens', () => {
		const root = renderLayout()
		expect([...root.classList]).toContain('surface-sunken')
		const heading = root.querySelector('h1')
		if (!heading) throw new Error('missing h1')
		expect(heading.textContent).toBe('Compare')
		expect([...heading.classList]).toContain('text-heading')
		const backLink = root.querySelector('a[href="/"]')
		if (!(backLink instanceof HTMLElement)) throw new Error('missing back link')
		expect([...backLink.classList]).toContain('text-accent')
	})

	it('leaves no light-only colour token anywhere in the compare shell', () => {
		const classes = sweep(renderLayout())
		for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
			expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
		}
	})

	it('lists the hub and every spoke in a labelled nav, marking the active one', () => {
		const root = renderLayout('longhand-vs-spreadsheet')
		const nav = root.querySelector('nav[aria-label="Comparisons"]')
		if (!nav) throw new Error('missing nav')
		const hub = nav.querySelector('a[href="/compare"]')
		expect(hub?.textContent).toBe('All comparisons')
		expect(hub).not.toHaveAttribute('aria-current')
		const active = nav.querySelector('a[aria-current="page"]')
		expect(active).toHaveAttribute('href', '/compare/longhand-vs-spreadsheet')
	})

	it('marks the hub current when no spoke is active', () => {
		const root = renderLayout()
		expect(root.querySelector('nav a[aria-current="page"]')).toHaveAttribute('href', '/compare')
	})
})
