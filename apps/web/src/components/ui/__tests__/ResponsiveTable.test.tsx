import { describe, expect, it } from 'vitest'
import {
	FIELD_LABEL_CLASS,
	FieldLabel,
	RESPONSIVE_ACTION_BUTTON_CLASS,
	RESPONSIVE_ACTIONS_CELL_CLASS,
	RESPONSIVE_ACTIONS_GROUP_CLASS,
	RESPONSIVE_AMOUNT_CLASS,
	RESPONSIVE_CELL_CLASS,
	RESPONSIVE_HEADER_CELL_CLASS,
	RESPONSIVE_HEADER_CELL_RIGHT_CLASS,
	RESPONSIVE_ROW_CLASS,
	RESPONSIVE_SCROLL_SHADOW_CLASS,
	RESPONSIVE_STACKED_CELL_CLASS,
	RESPONSIVE_TABLE_CLASS,
	RESPONSIVE_TAG_CLASS,
	RESPONSIVE_TBODY_CLASS,
	RESPONSIVE_THEAD_CLASS,
	RESPONSIVE_VALUE_TAG_CLASS,
	RESPONSIVE_WRAPPER_CLASS,
} from '@/components/ui/ResponsiveTable'
import { render, screen } from '@/test/utils'

// Class TOKEN membership, never substrings (`toContain('hidden')` matches `overflow-hidden`).
// jsdom has no layout: these prove declarations only.

const tokens = (value: string): string[] => value.split(/\s+/).filter(Boolean)

/** Strips variant prefixes only, bracket-aware, so `[padding-left:1rem]` stays intact. */
const bareUtilities = (list: string[]): string[] =>
	list.map((token) => {
		const bracket = token.indexOf('[')
		const head = bracket === -1 ? token : token.slice(0, bracket)
		const stripped = head.replace(/^(?:[a-z][a-z0-9-]*:)+/, '')
		return bracket === -1 ? stripped : stripped + token.slice(bracket)
	})

describe('ResponsiveTable class layer', () => {
	describe('desktop classes are preserved verbatim', () => {
		// `max-lg:px-4` is listed explicitly: it is the 640-1024px width budget, and dev fonts are
		// narrow enough that deleting it would only fail on CI.
		const cases: [string, string, string[]][] = [
			['wrapper', RESPONSIVE_WRAPPER_CLASS, ['overflow-x-auto']],
			[
				'table',
				RESPONSIVE_TABLE_CLASS,
				['min-w-full', 'divide-y', 'divide-gray-200', 'dark:divide-gray-700'],
			],
			['thead', RESPONSIVE_THEAD_CLASS, ['surface-inset']],
			// No `surface`: an opaque <tbody> would paint over the wrapper's scroll shadows.
			['tbody', RESPONSIVE_TBODY_CLASS, ['divide-y', 'divide-gray-200', 'dark:divide-gray-700']],
			['row', RESPONSIVE_ROW_CLASS, ['hover:bg-gray-50', 'dark:hover:bg-gray-700/40']],
			['cell', RESPONSIVE_CELL_CLASS, ['px-6', 'max-lg:px-4', 'py-4', 'whitespace-nowrap']],
			[
				'actions cell',
				RESPONSIVE_ACTIONS_CELL_CLASS,
				['px-6', 'max-lg:px-4', 'py-4', 'whitespace-nowrap', 'text-right', 'text-sm'],
			],
			[
				'stacked cell',
				RESPONSIVE_STACKED_CELL_CLASS,
				['px-6', 'max-lg:px-4', 'py-4', 'whitespace-nowrap'],
			],
		]

		for (const [name, value, expected] of cases) {
			it(`${name} keeps exactly its pre-31.2 desktop classes`, () => {
				const unprefixed = tokens(value).filter((t) => !t.startsWith('max-sm:'))
				expect(unprefixed.sort()).toEqual([...expected].sort())
			})
		}

		it('every padded constant keeps px-6 as its >= lg base alongside the max-lg override', () => {
			for (const value of [
				RESPONSIVE_CELL_CLASS,
				RESPONSIVE_ACTIONS_CELL_CLASS,
				RESPONSIVE_STACKED_CELL_CLASS,
				RESPONSIVE_HEADER_CELL_CLASS,
				RESPONSIVE_HEADER_CELL_RIGHT_CLASS,
			]) {
				expect(tokens(value)).toContain('px-6')
				expect(tokens(value)).toContain('max-lg:px-4')
			}
		})

		it('the mobile-only constants add no unprefixed class that could reach desktop', () => {
			for (const value of [RESPONSIVE_ACTIONS_GROUP_CLASS, RESPONSIVE_ACTION_BUTTON_CLASS]) {
				expect(tokens(value).every((t) => t.startsWith('max-sm:'))).toBe(true)
			}
		})
	})

	describe('mobile card switching', () => {
		it('the table declares block display and drops its min width', () => {
			expect(tokens(RESPONSIVE_TABLE_CLASS)).toContain('max-sm:block')
			expect(tokens(RESPONSIVE_TABLE_CLASS)).toContain('max-sm:min-w-0')
		})

		it('the table drops its dividers below sm so no rule floats above the first card', () => {
			// `divide-y` targets `> * + *`, and a `display: none` <thead> is still
			// counted by the `+` combinator.
			expect(tokens(RESPONSIVE_TABLE_CLASS)).toContain('max-sm:divide-y-0')
			expect(tokens(RESPONSIVE_TBODY_CLASS)).toContain('max-sm:divide-y-0')
		})

		it('the header row is hidden below sm', () => {
			expect(tokens(RESPONSIVE_THEAD_CLASS)).toContain('max-sm:hidden')
		})

		it('the body switches to block alongside the table', () => {
			expect(tokens(RESPONSIVE_TBODY_CLASS)).toContain('max-sm:block')
		})

		it('a row declares bordered, spaced card styling below sm', () => {
			const rowTokens = tokens(RESPONSIVE_ROW_CLASS)
			expect(rowTokens).toContain('max-sm:block')
			expect(rowTokens).toContain('max-sm:mb-3')
			expect(rowTokens).toContain('max-sm:rounded-lg')
			expect(rowTokens).toContain('max-sm:border')
			expect(rowTokens).toContain('max-sm:border-default')
			expect(rowTokens.some((t) => t.startsWith('max-sm:dark:'))).toBe(false)
		})

		it('the row card does not stack two background tokens on one element', () => {
			// Both set background-color in @layer components, where global.css order wins over className order.
			const rowTokens = tokens(RESPONSIVE_ROW_CLASS)
			expect(rowTokens).not.toContain('max-sm:surface-inset')
			expect(rowTokens).not.toContain('max-sm:surface-interactive')
			expect(rowTokens).not.toContain('hover:surface-inset')
		})
	})

	describe('cells declare the classes that make them fit 320px', () => {
		for (const [name, value] of [
			['cell', RESPONSIVE_CELL_CLASS],
			['actions cell', RESPONSIVE_ACTIONS_CELL_CLASS],
			['stacked cell', RESPONSIVE_STACKED_CELL_CLASS],
		] as const) {
			it(`${name} declares nowrap relief and a min-content-reducing wrap below sm`, () => {
				const cellTokens = tokens(value)
				expect(cellTokens).toContain('max-sm:whitespace-normal')
				// `break-words` doesn't reduce min-content width; only `anywhere` does (no Tailwind v3.4 utility).
				expect(cellTokens).toContain('max-sm:[overflow-wrap:anywhere]')
				expect(cellTokens).not.toContain('max-sm:break-words')
				expect(cellTokens).toContain('max-sm:px-3')
			})
		}

		it('a data cell declares label-left / value-right, the stacked cell does not', () => {
			expect(tokens(RESPONSIVE_CELL_CLASS)).toContain('max-sm:flex')
			expect(tokens(RESPONSIVE_CELL_CLASS)).toContain('max-sm:justify-between')
			expect(tokens(RESPONSIVE_STACKED_CELL_CLASS)).toContain('max-sm:block')
			expect(tokens(RESPONSIVE_STACKED_CELL_CLASS)).not.toContain('max-sm:flex')
		})

		it('the actions cell stacks its label above the button group below sm (34.1b)', () => {
			expect(tokens(RESPONSIVE_ACTIONS_CELL_CLASS)).toContain('max-sm:flex-col')
		})

		it('the actions group separates and wraps its two buttons below sm (34.1b, 48.2)', () => {
			const groupTokens = tokens(RESPONSIVE_ACTIONS_GROUP_CLASS)
			expect(groupTokens).toContain('max-sm:gap-1')
			expect(groupTokens).toContain('max-sm:flex-wrap')
		})

		it('no cell variant carries two conflicting align-items utilities', () => {
			// Tailwind resolves competing utilities by CSS source order, not
			// className order, so a cell holding both would align unpredictably.
			expect(tokens(RESPONSIVE_CELL_CLASS)).toContain('max-sm:items-baseline')
			expect(tokens(RESPONSIVE_CELL_CLASS)).not.toContain('max-sm:items-center')
			expect(tokens(RESPONSIVE_ACTIONS_CELL_CLASS)).toContain('max-sm:items-center')
			expect(tokens(RESPONSIVE_ACTIONS_CELL_CLASS)).not.toContain('max-sm:items-baseline')
		})

		it('the wrapper stays a scroll container at every width', () => {
			expect(tokens(RESPONSIVE_WRAPPER_CLASS)).toEqual(['overflow-x-auto'])
			expect(tokens(RESPONSIVE_WRAPPER_CLASS)).not.toContain('max-sm:overflow-x-visible')
		})
	})

	describe('value/tag pairs', () => {
		it('the pair is a non-wrapping flex row, aligned to the first line below sm', () => {
			const pairTokens = tokens(RESPONSIVE_VALUE_TAG_CLASS)
			expect(pairTokens).toContain('flex')
			expect(pairTokens).toContain('items-center')
			expect(pairTokens).toContain('max-sm:items-start')
			expect(bareUtilities(pairTokens)).not.toContain('flex-wrap')
		})

		it('the tag resists mid-word breaking, and does NOT carry shrink-0', () => {
			const tagTokens = tokens(RESPONSIVE_TAG_CLASS)
			expect(tagTokens).toContain('whitespace-nowrap')
			// `shrink-0` is deliberately absent: on its own it overflows the wrapper. Variant-stripped.
			expect(bareUtilities(tagTokens)).not.toContain('shrink-0')
		})

		it('the amount class turns the inherited `anywhere` off and reserves no width', () => {
			const valueTokens = tokens(RESPONSIVE_AMOUNT_CLASS)
			expect(valueTokens).toContain('[overflow-wrap:normal]')
			expect(valueTokens.some((t) => t.startsWith('max-sm:'))).toBe(false)
			// Load-bearing on desktop: Chromium breaks at `<wbr>` even under the cell's `nowrap`.
			expect(valueTokens).toContain('sm:[&_wbr]:hidden')
			expect(bareUtilities(valueTokens)).not.toContain('whitespace-nowrap')
			for (const utility of bareUtilities(valueTokens)) {
				expect(utility).not.toMatch(/^(p|px|py|ps|pe|pl|pr|m|mx|ms|me|ml|mr|gap|w|min-w)-/)
				// A greedy `replace(/^.*:/, '')` would turn `[padding-left:1rem]` into `1rem]` and evade this check.
				expect(utility).not.toMatch(/^\[(padding|margin|width|min-width|gap|inline-size)/)
			}
		})

		it('⚠️ the cell wrapping contract survives this story', () => {
			for (const value of [RESPONSIVE_CELL_CLASS, RESPONSIVE_STACKED_CELL_CLASS]) {
				const cellTokens = tokens(value)
				expect(cellTokens).toContain('max-sm:whitespace-normal')
				expect(cellTokens).toContain('max-sm:[overflow-wrap:anywhere]')
				expect(
					cellTokens.filter((t) => t.startsWith('max-sm:')).map((t) => t.replace(/^max-sm:/, ''))
				).not.toContain('whitespace-nowrap')
			}
		})
	})

	describe('scroll affordance', () => {
		it('is a separate constant, so the wrapper pin is untouched', () => {
			// The wrapper is pinned by exact equality; merging the affordance into it would loosen that pin.
			expect(tokens(RESPONSIVE_WRAPPER_CLASS)).not.toContain('surface')
			expect(tokens(RESPONSIVE_SCROLL_SHADOW_CLASS).length).toBeGreaterThan(0)
			expect(tokens(RESPONSIVE_WRAPPER_CLASS)).toEqual(['overflow-x-auto'])
		})

		it('declares four background layers pinned local, local, scroll, scroll', () => {
			// Covers `local`, shadows `scroll`: that asymmetry is the self-hiding mechanism.
			expect(tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)).toContain(
				'[background-attachment:local,local,scroll,scroll]'
			)
			expect(tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)).toContain('[background-repeat:no-repeat]')
		})

		it('sets attachment via an arbitrary PROPERTY, never bg-local/bg-scroll', () => {
			// `bg-local` would set one value for all four layers and silently break the mechanism.
			const t = tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)
			expect(t).not.toContain('bg-local')
			expect(t).not.toContain('bg-scroll')
			expect(t).not.toContain('bg-fixed')
		})

		it('carries the surface colour and a dark cover pair', () => {
			const t = tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)
			expect(t).toContain('surface')
			expect(t.some((c) => c.startsWith('dark:bg-['))).toBe(true)
			expect(t.some((c) => c.startsWith('bg-[linear-gradient'))).toBe(true)
		})

		it('the tbody declares no background at any variant, so it cannot occlude the shadows', () => {
			// Variants count: `dark:bg-gray-800` would re-occlude the shadow in dark mode only.
			const bare = (c: string) => c.slice(c.lastIndexOf(':') + 1)
			for (const c of tokens(RESPONSIVE_TBODY_CLASS)) {
				const u = bare(c)
				expect(
					u === 'surface' ||
						u.startsWith('surface-') ||
						u.startsWith('bg-') ||
						u.startsWith('[background'),
					`${c} gives the tbody a background, which paints over the wrapper's scroll shadows`
				).toBe(false)
			}
		})

		it('reserves no layout width', () => {
			// Zero width slack between 640 and 1024px: strip variants, then reject anything that reserves width.
			const bare = (c: string) => c.slice(c.lastIndexOf(':') + 1)
			const RESERVES_WIDTH =
				/^(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|border|w|min-w|max-w|gap|gap-x|indent|basis|size)(-|$)/
			for (const t of tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)) {
				const u = bare(t)
				expect(
					RESERVES_WIDTH.test(u) || /^\[(padding|margin|border|width|inline-size)/.test(u),
					`${t} reserves layout width, which this band has none of`
				).toBe(false)
			}
		})
	})

	describe('tap targets', () => {
		it('a row action button declares a >= 44px floor in both dimensions below sm', () => {
			const buttonTokens = tokens(RESPONSIVE_ACTION_BUTTON_CLASS)
			expect(buttonTokens).toContain('max-sm:min-h-[44px]')
			expect(buttonTokens).toContain('max-sm:min-w-[44px]')
			expect(buttonTokens).toContain('max-sm:inline-flex')
		})

		it('the 44px floor is breakpoint-scoped so desktop is untouched', () => {
			expect(tokens(RESPONSIVE_ACTION_BUTTON_CLASS)).not.toContain('min-h-[44px]')
			expect(tokens(RESPONSIVE_ACTION_BUTTON_CLASS)).not.toContain('min-w-[44px]')
		})
	})

	describe('FieldLabel', () => {
		it('renders its text and declares sm:hidden', () => {
			render(<FieldLabel>Monthly Allocation</FieldLabel>)
			const label = screen.getByText('Monthly Allocation')
			expect([...label.classList]).toContain('sm:hidden')
		})

		it('uses the muted text token rather than a hand-rolled dark pair', () => {
			const labelTokens = tokens(FIELD_LABEL_CLASS)
			expect(labelTokens).toContain('text-muted')
			expect(labelTokens.some((t) => t.startsWith('dark:'))).toBe(false)
		})

		it('carries a concrete type scale rather than inheriting the value size', () => {
			// Concrete floor, not relative ordering: a label that merely renders
			// "smaller than" the value would pass while being unreadable.
			expect(tokens(FIELD_LABEL_CLASS)).toContain('text-xs')
		})

		it('is a mobile-only ELEMENT, so it uses sm:hidden and never a max-sm: variant', () => {
			// The module convention: mobile-only STYLING on a shared element uses
			// `max-sm:`; a mobile-only ELEMENT uses base classes + `sm:hidden`.
			const labelTokens = tokens(FIELD_LABEL_CLASS)
			expect(labelTokens).toContain('sm:hidden')
			expect(labelTokens.some((t) => t.startsWith('max-sm:'))).toBe(false)
		})

		it('breaks only between words, not mid-word', () => {
			const labelTokens = tokens(FIELD_LABEL_CLASS)
			expect(labelTokens).toContain('[overflow-wrap:normal]')
			// Never nowrap: a one-line `MONTHLY ALLOCATION` would starve the value.
			expect(bareUtilities(labelTokens)).not.toContain('whitespace-nowrap')
		})

		it('takes only the width the value leaves (basis-0 grow), never a shrink factor', () => {
			// `shrink-[1000]` was rejected: it still takes sub-pixels from the value, wrapping an exact fit.
			const labelTokens = tokens(FIELD_LABEL_CLASS)
			expect(labelTokens).toContain('basis-0')
			expect(labelTokens).toContain('grow')
			expect(bareUtilities(labelTokens).some((t) => t.startsWith('shrink'))).toBe(false)
		})

		it('is not aria-hidden — it is the only field/value association below sm', () => {
			render(<FieldLabel>Amount</FieldLabel>)
			expect(screen.getByText('Amount')).not.toHaveAttribute('aria-hidden')
		})
	})
})
