import { describe, expect, it } from 'vitest'
import { renderWithProviders, screen } from '@/test/utils'
import { useCurrencyStore } from '../../stores/currencyStore'
import { RetirementAccumulationPlanner } from '../RetirementAccumulationPlanner'

/** Class-TOKEN membership. `className.includes('p-4')` also matches `sm:p-4`. */
function tokens(el: Element): string[] {
	return el.className.split(/\s+/).filter(Boolean)
}

function baseClass(token: string): string {
	return (token.split(':').pop() ?? '').replace(/^!/, '').replace(/!$/, '')
}

function renderPlanner() {
	useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	const { container } = renderWithProviders(<RetirementAccumulationPlanner />)
	const fieldset = container.querySelector('fieldset') as HTMLFieldSetElement
	const legend = container.querySelector('fieldset legend') as HTMLLegendElement
	const panel = screen.getByTestId('retirement-model-panel')
	return { container, fieldset, legend, panel }
}

describe('retirement target model grouping (AC-2)', () => {
	it('keeps the native fieldset/legend grouping', () => {
		const { fieldset, legend } = renderPlanner()
		expect(fieldset).toBeInTheDocument()
		expect(legend).toBeInTheDocument()
	})

	it('keeps the legend as the fieldset FIRST child, which is what names the group', () => {
		// A legend that is not the first child stops naming the group while looking identical on screen.
		const { fieldset, legend } = renderPlanner()
		expect(fieldset.firstElementChild).toBe(legend)
	})

	it('exposes a group named by the legend to assistive technology', () => {
		renderPlanner()
		const group = screen.getByRole('group', { name: 'Retirement target model' })
		expect(group.tagName).toBe('FIELDSET')
		expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2)
	})
})

describe('the panel moved off the fieldset (AC-1)', () => {
	it('puts the panel styling on the inner panel, not the fieldset', () => {
		const { panel } = renderPlanner()
		for (const token of ['p-4', 'surface-inset', 'rounded-lg', 'clear-both']) {
			expect(tokens(panel)).toContain(token)
		}
	})

	it('keeps the responsive grid on the panel (AC-4)', () => {
		const { panel } = renderPlanner()
		for (const token of ['grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-3']) {
			expect(tokens(panel)).toContain(token)
		}
	})

	it('leaves the fieldset carrying NO panel styling', () => {
		const { fieldset } = renderPlanner()
		const fieldsetTokens = tokens(fieldset)
		for (const banned of ['p-4', 'surface-inset', 'rounded-lg']) {
			expect(fieldsetTokens).not.toContain(banned)
			expect(fieldsetTokens.map(baseClass).includes(banned)).toBe(false)
		}
	})

	it('keeps the legend out of rendered-legend layout across browsers', () => {
		// Not a defect guard: the float tokens are cross-browser insurance for the rendered legend.
		const { legend } = renderPlanner()
		expect(tokens(legend)).toContain('float-left')
		expect(tokens(legend)).toContain('w-full')
	})
})

describe('the radio options are untouched (AC-5)', () => {
	it('keeps both options, their 44px targets and their focus rings', () => {
		const { panel } = renderPlanner()
		const labels = panel.querySelectorAll('label')
		expect(labels).toHaveLength(2)
		for (const label of labels) {
			expect(tokens(label)).toContain('min-h-[44px]')
		}
		const radios = panel.querySelectorAll('input[type="radio"]')
		expect(radios).toHaveLength(2)
		for (const radio of radios) {
			expect(tokens(radio)).toContain('focus:ring-2')
		}
	})

	it('keeps the selected/unselected border treatment', () => {
		const { panel } = renderPlanner()
		const [selected, unselected] = [...panel.querySelectorAll('label')]
		expect(tokens(selected as Element)).toContain('border-blue-500')
		expect(tokens(unselected as Element)).toContain('border-gray-300')
		// `.text-muted` on the selected option's blue-50 background fails AA contrast.
		for (const label of [selected, unselected] as Element[]) {
			const explanation = label.querySelectorAll('span > span')[1] as Element
			expect(tokens(explanation)).toContain('text-body')
			expect(tokens(explanation)).not.toContain('text-muted')
		}
	})

	it('still renders both models by name', () => {
		renderPlanner()
		expect(screen.getByRole('radio', { name: /Deplete by life expectancy/ })).toBeInTheDocument()
		expect(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ })).toBeInTheDocument()
	})
})
