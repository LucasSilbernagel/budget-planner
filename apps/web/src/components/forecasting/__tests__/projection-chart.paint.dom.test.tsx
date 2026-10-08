import type { ForecastingResult } from '@budget-planner/core'
import { render } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { Line } from 'recharts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrencyStore } from '../../../stores/currencyStore'

// Recharts renders no SVG under jsdom's 0x0 ResponsiveContainer, so it is replaced with a fixed 600x400 one.

vi.mock('recharts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('recharts')>()
	return {
		...actual,
		ResponsiveContainer: ({ children }: { children: ReactElement }) =>
			cloneElement(children, { width: 600, height: 400 } as never),
	}
})

const { CustomTooltip, ProjectionChart } = await import('../projection-chart')

const LONG = 'Buy a house in the countryside and retire early with the kids'

function row(year: number, netWorth: number) {
	return { year, income: 0, expenses: 0, netIncome: 0, savings: 0, investments: 0, netWorth }
}

function result(name: string): ForecastingResult {
	return {
		scenario: { name, incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 },
		baseline: [row(1, 5_369_034_260), row(2, 11_869_034_260), row(3, 18_369_034_260)],
		projection: [row(1, 5_369_034_260), row(2, 15_000_000_000), row(3, 31_010_148_369)],
		summary: {
			startingNetWorth: 2_560_000_000,
			endingNetWorth: 31_010_148_369,
			totalGrowth: 28_450_148_369,
			averageAnnualGrowth: 9_483_382_790,
		},
	}
}

function matchNarrow(narrow: boolean): void {
	window.matchMedia = ((query: string) => ({
		matches: narrow && /max-width/.test(query),
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia
}

const originalMatchMedia = window.matchMedia
const lineDefaults = Line.defaultProps as Record<string, unknown>
const originalAnimation = lineDefaults['isAnimationActive']

beforeAll(() => {
	lineDefaults['isAnimationActive'] = false
})
afterAll(() => {
	lineDefaults['isAnimationActive'] = originalAnimation
})
beforeEach(() => {
	useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
})
afterEach(() => {
	window.matchMedia = originalMatchMedia
})

function legendTexts(container: HTMLElement) {
	return [...container.querySelectorAll('.recharts-legend-item-text')] as HTMLElement[]
}

function yTicks(container: HTMLElement): string[] {
	return [...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick text')].map(
		(t) => t.textContent ?? ''
	)
}

describe('the legend names the scenario', () => {
	it('reads "Baseline" and the scenario name', () => {
		const { container } = render(<ProjectionChart result={result('Buy a house')} />)
		expect(legendTexts(container).map((t) => t.textContent)).toEqual(['Baseline', 'Buy a house'])
		expect(container.querySelectorAll('.recharts-line-curve').length).toBe(2)
	})

	it('a long name: full text and title, truncated by CSS only', () => {
		const { container } = render(<ProjectionChart result={result(LONG)} />)
		const scenario = legendTexts(container)[1] as HTMLElement
		expect(scenario.textContent).toBe(LONG)
		const label = scenario.querySelector('[title]') as HTMLElement
		expect(label).not.toBeNull()
		expect(label.getAttribute('title')).toBe(LONG)
		expect(label.textContent).toBe(LONG)
		expect(label.className.split(/\s+/)).toEqual(
			expect.arrayContaining(['inline-block', 'truncate', 'align-bottom', 'max-w-[5rem]'])
		)
	})

	it('the legend wrapper has no fixed height (Recharts then offsets the plot by its measured height)', () => {
		const { container } = render(<ProjectionChart result={result('Buy a house')} />)
		const wrapper = container.querySelector('.recharts-legend-wrapper') as HTMLElement
		expect(wrapper).not.toBeNull()
		expect(wrapper.style.height).toBe('auto')
	})

	it('the subtitle names the measure and the full scenario name', () => {
		const { getByText } = render(<ProjectionChart result={result(LONG)} />)
		expect(getByText(`Net worth by year: Baseline vs. ${LONG}`)).toBeInTheDocument()
	})
})

describe('the tooltip', () => {
	it('shows a long name in full, wrapping inside a bounded box', () => {
		const { container, getByText } = render(
			<CustomTooltip
				active
				label="2"
				payload={[
					{ name: 'Baseline', value: 100, dataKey: 'baselineNetWorth' },
					{ name: LONG, value: 200, dataKey: 'scenarioNetWorth' },
				]}
			/>
		)
		const rowEl = getByText(
			(_, el) => el?.tagName === 'P' && el.textContent?.startsWith(LONG) === true
		)
		expect(rowEl.textContent).toBe(`${LONG}: $2.00`)
		expect(rowEl.className.split(/\s+/)).toEqual(expect.arrayContaining(['break-words']))
		const box = container.firstElementChild as HTMLElement
		expect(box.className.split(/\s+/)).toEqual(
			expect.arrayContaining(['max-w-[16rem]', 'whitespace-normal'])
		)
	})
})

describe('the "Starting" reference line', () => {
	it('puts its label above the line, never on it (DN1 (b), story 97.2 review)', () => {
		const seven: ForecastingResult = {
			...result('Buy a house'),
			baseline: [row(1, 203_400_000), row(2, 225_000_000), row(3, 248_457_568)],
			projection: [row(1, 203_400_000), row(2, 225_000_000), row(3, 248_457_568)],
			summary: {
				startingNetWorth: 200_000_000,
				endingNetWorth: 248_457_568,
				totalGrowth: 48_457_568,
				averageAnnualGrowth: 16_152_522,
			},
		}
		const { container } = render(<ProjectionChart result={seven} />)
		const line = container.querySelector('.recharts-reference-line line') as Element
		expect(line, 'the line is drawn at the floor').not.toBeNull()
		const label = container.querySelector('.recharts-reference-line .recharts-label') as Element
		expect(label.textContent).toBe('Starting')
		expect(label.getAttribute('text-anchor')).toBe('end')
		expect(Number(label.getAttribute('y'))).toBeLessThan(Number(line.getAttribute('y1')))
	})
})

for (const narrow of [false, true]) {
	describe(`the value axis (${narrow ? 'narrow' : 'wide'} viewport)`, () => {
		it('prints compact, distinct labels, never full amounts with cents', () => {
			matchNarrow(narrow)
			const { container } = render(<ProjectionChart result={result('Buy a house')} />)
			const ticks = yTicks(container)
			expect(ticks.length).toBeGreaterThanOrEqual(2)
			for (const tick of ticks) expect(tick).toMatch(/^\$\d+(\.\d+)?M$/)
			expect(new Set(ticks).size).toBe(ticks.length)
			const tickText = container.querySelector(
				'.recharts-yAxis .recharts-cartesian-axis-tick text'
			) as Element
			expect(tickText.getAttribute('font-size')).toBe(narrow ? '10' : '12')
		})

		it('sizes the gutter to the widest label, for a 3-letter symbol too', () => {
			matchNarrow(narrow)
			for (const [currency, width] of [
				['USD', narrow ? 43.6 : 52.3],
				['CHF', narrow ? 57.5 : 69.0],
			] as const) {
				useCurrencyStore.setState({ mode: 'symbol', currency })
				const { container, unmount } = render(<ProjectionChart result={result('Buy a house')} />)
				const texts = [
					...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick text'),
				]
				expect(texts.length, currency).toBeGreaterThanOrEqual(2)
				expect(texts.at(-1)?.textContent, currency).toMatch(/^(\$|CHF)350\.0M$/)
				for (const t of texts) {
					expect(
						Number(t.getAttribute('x')) - width,
						`${currency} ${t.textContent}`
					).toBeGreaterThanOrEqual(0)
				}
				unmount()
			}
		})

		it('has no rotated "Net Worth" title in the SVG', () => {
			matchNarrow(narrow)
			const { container } = render(<ProjectionChart result={result('Buy a house')} />)
			const svgText = container.querySelector('.recharts-surface')?.textContent ?? ''
			expect(svgText).toContain('Time (Years)')
			expect(container.querySelector('.recharts-yAxis .recharts-label')).toBeNull()
			expect(svgText).not.toContain('Net Worth')
		})
	})
}
