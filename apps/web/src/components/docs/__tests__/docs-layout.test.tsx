import { describe, expect, it } from 'vitest'
import { render } from '@/test/utils'
import { DocsLayout } from '../docs-layout'

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

function renderLayout() {
	const { container } = render(
		<DocsLayout title="Documentation" description="Guides and answers.">
			<p>Body</p>
		</DocsLayout>
	)
	const root = container.firstElementChild
	if (!(root instanceof HTMLElement)) throw new Error('DocsLayout rendered no root element')
	return root
}

describe('DocsLayout theming', () => {
	it('paints the page canvas with the surface-sunken token', () => {
		const root = renderLayout()
		const tokens = [...root.classList]
		expect(tokens).toContain('surface-sunken')
		expect(tokens).toContain('min-h-screen')
		expect(tokens).not.toContain('bg-gray-50')
	})

	it('uses the semantic text tokens for the header chrome', () => {
		const root = renderLayout()

		const backLink = root.querySelector('a[href="/"]')
		if (!(backLink instanceof HTMLElement)) throw new Error('missing back link')
		expect([...backLink.classList]).toContain('text-accent')
		expect([...backLink.classList]).not.toContain('text-blue-600')

		const heading = root.querySelector('h1')
		if (!heading) throw new Error('missing h1')
		expect([...heading.classList]).toContain('text-heading')

		const description = root.querySelector('header p')
		if (!description) throw new Error('missing description')
		expect([...description.classList]).toContain('text-body')
	})

	it('leaves no light-only colour token anywhere in the docs shell', () => {
		const classes = sweep(renderLayout())
		for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
			expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
		}
	})
})
