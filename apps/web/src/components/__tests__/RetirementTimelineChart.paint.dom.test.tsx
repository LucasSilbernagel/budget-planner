import { act, render } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrencyStore } from '../../stores/currencyStore'

// Only ResponsiveContainer is replaced (with a fixed 600x300) so the real Recharts chart renders.
// Tick thinning depends on measured text width, which jsdom lacks, so it is not pinned.

vi.mock('recharts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('recharts')>()
	return {
		...actual,
		ResponsiveContainer: ({ children }: { children: ReactElement }) =>
			cloneElement(children, { width: 600, height: 300 } as never),
	}
})

const { RetirementTimelineChart } = await import('../RetirementTimelineChart')

const PROPS = {
	currentSavedCents: 100_000_00,
	monthlySavingsCents: 1_000_00,
	annualReturnRate: 0.06,
	currentAge: 40,
	yearsToProject: 10,
	earliestRetirementAge: 45,
}
const FINAL_AGE = PROPS.currentAge + PROPS.yearsToProject

function ticks(container: HTMLElement): { age: number; x: number }[] {
	return [...container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick text')].map(
		(node) => ({ age: Number(node.textContent), x: Number(node.getAttribute('x')) })
	)
}

/** Narrow for WIDTH queries only, so "narrow" does not also mean "dark". */
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

beforeEach(() => {
	useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
})

afterEach(() => {
	window.matchMedia = originalMatchMedia
})

for (const narrow of [true, false]) {
	describe(`the age axis (${narrow ? 'narrow' : 'wide'} viewport)`, () => {
		it('plots ages from the current age to the last projected age, not years from now (was e2e retirement-age-axis:186)', () => {
			matchNarrow(narrow)
			const { container } = render(<RetirementTimelineChart {...PROPS} />)
			const ages = ticks(container).map((tick) => tick.age)

			expect(ages.length, 'no tick text rendered: the harness drew no axis').toBeGreaterThanOrEqual(
				2
			)
			for (const age of ages) {
				expect(Number.isInteger(age)).toBe(true)
				expect(age).toBeGreaterThanOrEqual(PROPS.currentAge)
				expect(age).toBeLessThanOrEqual(FINAL_AGE)
			}
			for (let i = 1; i < ages.length; i++) {
				expect(ages[i] as number).toBeGreaterThan(ages[i - 1] as number)
			}
			expect(ages.at(-1)).toBe(FINAL_AGE)
		})

		it('puts the "Retirement" marker on the tick of the earliest retirement age (was e2e retirement-age-axis:223)', () => {
			matchNarrow(narrow)
			const { container } = render(<RetirementTimelineChart {...PROPS} />)

			const line = container.querySelector('.recharts-reference-line line')
			expect(line, 'no reference line was drawn').not.toBeNull()
			expect(container.querySelector('.recharts-reference-line')).toHaveTextContent('Retirement')

			// Both positions come from Recharts' band scale, which jsdom computes exactly.
			const tick = ticks(container).find((t) => t.age === PROPS.earliestRetirementAge)
			expect(tick, `no tick for age ${PROPS.earliestRetirementAge}`).toBeDefined()
			expect(Number(line?.getAttribute('x1'))).toBeCloseTo(tick?.x as number, 6)
		})
	})
}

it('titles the axis "Age" on a wide viewport (was e2e retirement-age-axis:258)', () => {
	matchNarrow(false)
	const { container } = render(<RetirementTimelineChart {...PROPS} />)
	const titles = [...container.querySelectorAll('.recharts-surface .recharts-label')].map(
		(node) => node.textContent
	)
	expect(titles).toContain('Age')
	expect(titles).not.toContain('Years from Now')
})

type MediaApi = 'modern' | 'legacy'
type MediaState = { dark: boolean; narrow: boolean }

/** A live `matchMedia` answering the width and colour-scheme queries from one mutable state. */
function stubLiveMedia(initial: Partial<MediaState> = {}, api: MediaApi = 'modern') {
	const state = { dark: false, narrow: false, ...initial } satisfies MediaState
	const listeners = new Set<() => void>()
	const matchMedia = vi.fn((query: string) => {
		const listenerApi =
			api === 'modern'
				? {
						addEventListener: (_: string, cb: () => void) => listeners.add(cb),
						removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
					}
				: {
						addListener: (cb: () => void) => listeners.add(cb),
						removeListener: (cb: () => void) => listeners.delete(cb),
					}
		return Object.defineProperty(listenerApi, 'matches', {
			get: () => (/max-width/.test(query) ? state.narrow : /dark/.test(query) && state.dark),
			enumerable: true,
		})
	})
	vi.stubGlobal('matchMedia', matchMedia)
	return {
		matchMedia,
		set(next: Partial<MediaState>) {
			Object.assign(state, next)
			act(() => {
				for (const cb of listeners) cb()
			})
		},
	}
}

const LIGHT = { axis: '#6b7280', grid: '#e5e7eb' }
const DARK = { axis: '#9ca3af', grid: '#374151' }

function paint(container: HTMLElement) {
	const tick = container.querySelector('.recharts-xAxis .recharts-cartesian-axis-tick text')
	const grid = container.querySelector('.recharts-cartesian-grid line')
	return { axis: tick?.getAttribute('fill'), grid: grid?.getAttribute('stroke') }
}

function axisTitles(container: HTMLElement): (string | null)[] {
	return [...container.querySelectorAll('.recharts-surface .recharts-label')].map(
		(node) => node.textContent
	)
}

describe('the chart follows the device', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it.each([
		['light', false, LIGHT],
		['dark', true, DARK],
	])('paints the axis and grid in the %s palette', (_label, dark, expected) => {
		stubLiveMedia({ dark })
		const { container } = render(<RetirementTimelineChart {...PROPS} />)
		expect(paint(container)).toEqual(expected)
	})

	it('asks for the dark colour scheme and the sub-640px width specifically', () => {
		// Spelled as literals: the stub answers any query, so this is the only check on the strings.
		const { matchMedia } = stubLiveMedia()
		render(<RetirementTimelineChart {...PROPS} />)
		expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
		expect(matchMedia).toHaveBeenCalledWith('(max-width: 639.98px)')
	})

	it('drops the axis titles on a narrow viewport', () => {
		stubLiveMedia({ narrow: true })
		const { container } = render(<RetirementTimelineChart {...PROPS} />)
		expect(axisTitles(container)).not.toContain('Age')
	})

	it.each(['modern', 'legacy'] as const)(
		'follows a live scheme and width change without a remount (%s listener API)',
		(api) => {
			const media = stubLiveMedia({}, api)
			const { container, unmount } = render(<RetirementTimelineChart {...PROPS} />)
			expect(paint(container)).toEqual(LIGHT)
			expect(axisTitles(container)).toContain('Age')

			media.set({ dark: true, narrow: true })

			expect(paint(container)).toEqual(DARK)
			expect(axisTitles(container)).not.toContain('Age')
			expect(() => unmount()).not.toThrow()
		}
	)

	it('renders light and wide when matchMedia is unavailable', () => {
		vi.stubGlobal('matchMedia', undefined)
		const { container } = render(<RetirementTimelineChart {...PROPS} />)
		expect(paint(container)).toEqual(LIGHT)
		expect(axisTitles(container)).toContain('Age')
	})
})
