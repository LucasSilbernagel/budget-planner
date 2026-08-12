import {
  FIELD_LABEL_CLASS,
  FieldLabel,
  RESPONSIVE_ACTIONS_CELL_CLASS,
  RESPONSIVE_ACTIONS_GROUP_CLASS,
  RESPONSIVE_ACTION_BUTTON_CLASS,
  RESPONSIVE_CELL_CLASS,
  RESPONSIVE_FOOTER_CELL_CLASS,
  RESPONSIVE_FOOTER_ROW_CLASS,
  RESPONSIVE_ROW_CLASS,
  RESPONSIVE_STACKED_CELL_CLASS,
  RESPONSIVE_TABLE_CLASS,
  RESPONSIVE_TBODY_CLASS,
  RESPONSIVE_TFOOT_CLASS,
  RESPONSIVE_THEAD_CLASS,
  RESPONSIVE_WRAPPER_CLASS,
} from '@/components/ui/ResponsiveTable'
import { render, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'

/**
 * Shared responsive-table class layer (story 31.2).
 *
 * Every assertion here is on class TOKEN membership, never on a substring of
 * the joined class string: `-` and `:` are substring boundaries, so
 * `toContain('block')` would false-match `max-sm:block` and `toContain('hidden')`
 * would false-match `overflow-hidden`. jsdom computes no layout, so these
 * constants can only be proven structurally here: these cases assert that the
 * module DECLARES the right classes, never that anything fits, stacks or hides.
 * Those are geometry claims and only `e2e/responsive-320.spec.ts` can make
 * them. Read an AC number in a title below as "the class this AC needs is
 * present", not "this AC holds".
 */

const tokens = (value: string): string[] => value.split(/\s+/).filter(Boolean)

describe('ResponsiveTable class layer', () => {
  describe('desktop classes are preserved verbatim (AC-2)', () => {
    // Each entry: the constant, and the exact unprefixed classes the four
    // pages carried before this story. Nothing in this column may change
    // value, and nothing unprefixed may be added.
    const cases: [string, string, string[]][] = [
      ['wrapper', RESPONSIVE_WRAPPER_CLASS, ['overflow-x-auto']],
      [
        'table',
        RESPONSIVE_TABLE_CLASS,
        ['min-w-full', 'divide-y', 'divide-gray-200', 'dark:divide-gray-700'],
      ],
      ['thead', RESPONSIVE_THEAD_CLASS, ['surface-inset']],
      [
        'tbody',
        RESPONSIVE_TBODY_CLASS,
        ['surface', 'divide-y', 'divide-gray-200', 'dark:divide-gray-700'],
      ],
      ['row', RESPONSIVE_ROW_CLASS, ['hover:bg-gray-50', 'dark:hover:bg-gray-700/40']],
      ['cell', RESPONSIVE_CELL_CLASS, ['px-6', 'py-4', 'whitespace-nowrap']],
      [
        'actions cell',
        RESPONSIVE_ACTIONS_CELL_CLASS,
        ['px-6', 'py-4', 'whitespace-nowrap', 'text-right', 'text-sm'],
      ],
      ['stacked cell', RESPONSIVE_STACKED_CELL_CLASS, ['px-6', 'py-4', 'whitespace-nowrap']],
      ['tfoot', RESPONSIVE_TFOOT_CLASS, ['surface-inset']],
      ['footer cell', RESPONSIVE_FOOTER_CELL_CLASS, ['px-6', 'py-3']],
    ]

    for (const [name, value, expected] of cases) {
      it(`${name} keeps exactly its pre-31.2 unprefixed classes`, () => {
        const unprefixed = tokens(value).filter((t) => !t.startsWith('max-sm:'))
        expect(unprefixed.sort()).toEqual([...expected].sort())
      })
    }

    it('the mobile-only constants add no unprefixed class that could reach desktop', () => {
      // These three exist ONLY below `sm`. Every token must be breakpoint-scoped.
      for (const value of [
        RESPONSIVE_FOOTER_ROW_CLASS,
        RESPONSIVE_ACTIONS_GROUP_CLASS,
        RESPONSIVE_ACTION_BUTTON_CLASS,
      ]) {
        expect(tokens(value).every((t) => t.startsWith('max-sm:'))).toBe(true)
      }
    })
  })

  describe('mobile card switching (AC-1)', () => {
    it('the table declares block display and drops its min width', () => {
      // Defensive, not the mechanism — measured at 320px, removing either of
      // these changes no geometry, because `max-sm:flex` on every <td> already
      // takes the cells out of table formatting. Pinned here so the explicit
      // display chain cannot be dropped in favour of anonymous-box generation.
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

    it('the body and footer switch to block alongside the table', () => {
      // A <tfoot> left as `table-footer-group` while <tbody> is `block` would
      // leave one table holding both block and table-internal subtrees.
      expect(tokens(RESPONSIVE_TBODY_CLASS)).toContain('max-sm:block')
      expect(tokens(RESPONSIVE_TFOOT_CLASS)).toContain('max-sm:block')
    })

    it('a row declares bordered, spaced card styling below sm', () => {
      const rowTokens = tokens(RESPONSIVE_ROW_CLASS)
      expect(rowTokens).toContain('max-sm:block')
      expect(rowTokens).toContain('max-sm:mb-3')
      expect(rowTokens).toContain('max-sm:rounded-lg')
      expect(rowTokens).toContain('max-sm:border')
      // Token, not a hand-rolled `dark:border-*` pair (AC-7).
      expect(rowTokens).toContain('max-sm:border-default')
      expect(rowTokens.some((t) => t.startsWith('max-sm:dark:'))).toBe(false)
    })

    it('the row card does not stack two background tokens on one element', () => {
      // `.surface-inset` and `.surface-interactive` both set background-color
      // in @layer components, where declaration order in global.css wins over
      // className order. Never both on one element.
      const rowTokens = tokens(RESPONSIVE_ROW_CLASS)
      expect(rowTokens).not.toContain('max-sm:surface-inset')
      expect(rowTokens).not.toContain('max-sm:surface-interactive')
      expect(rowTokens).not.toContain('hover:surface-inset')
    })
  })

  describe('cells declare the classes that make them fit 320px (AC-3)', () => {
    for (const [name, value] of [
      ['cell', RESPONSIVE_CELL_CLASS],
      ['actions cell', RESPONSIVE_ACTIONS_CELL_CLASS],
      ['stacked cell', RESPONSIVE_STACKED_CELL_CLASS],
    ] as const) {
      it(`${name} declares nowrap relief and a min-content-reducing wrap below sm`, () => {
        const cellTokens = tokens(value)
        expect(cellTokens).toContain('max-sm:whitespace-normal')
        // `break-words` (overflow-wrap: break-word) does NOT reduce an
        // element's min-content width — measured at 1097px inside a 320px
        // viewport. Only `anywhere` does. Tailwind v3.4 has no
        // `wrap-anywhere` utility, hence the arbitrary property.
        expect(cellTokens).toContain('max-sm:[overflow-wrap:anywhere]')
        expect(cellTokens).not.toContain('max-sm:break-words')
        // px-6 (24px each side) is 15% of a 320px viewport per cell.
        expect(cellTokens).toContain('max-sm:px-3')
      })
    }

    it('a data cell declares label-left / value-right, the stacked cell does not', () => {
      expect(tokens(RESPONSIVE_CELL_CLASS)).toContain('max-sm:flex')
      expect(tokens(RESPONSIVE_CELL_CLASS)).toContain('max-sm:justify-between')
      expect(tokens(RESPONSIVE_STACKED_CELL_CLASS)).toContain('max-sm:block')
      expect(tokens(RESPONSIVE_STACKED_CELL_CLASS)).not.toContain('max-sm:flex')
    })

    it('no cell variant carries two conflicting align-items utilities', () => {
      // Tailwind resolves competing utilities by CSS source order, not
      // className order, so a cell holding both would align unpredictably.
      expect(tokens(RESPONSIVE_CELL_CLASS)).toContain('max-sm:items-baseline')
      expect(tokens(RESPONSIVE_CELL_CLASS)).not.toContain('max-sm:items-center')
      expect(tokens(RESPONSIVE_ACTIONS_CELL_CLASS)).toContain('max-sm:items-center')
      expect(tokens(RESPONSIVE_ACTIONS_CELL_CLASS)).not.toContain('max-sm:items-baseline')
    })

    it('the footer summary strip relaxes padding AND wrapping', () => {
      // The combined total is the one unbounded string in the converted
      // subtree, and the call site adds an unprefixed `whitespace-nowrap` on
      // top — without this relief it was the only unguarded nowrap below `sm`.
      expect(tokens(RESPONSIVE_FOOTER_CELL_CLASS)).toContain('max-sm:px-3')
      expect(tokens(RESPONSIVE_FOOTER_CELL_CLASS)).toContain('max-sm:whitespace-normal')
      expect(tokens(RESPONSIVE_FOOTER_CELL_CLASS)).toContain('max-sm:[overflow-wrap:anywhere]')
    })

    it('the wrapper stays a scroll container at every width', () => {
      // Deliberate, and reconsidered once. Making it `overflow-x-visible` below
      // `sm` would let a regression reach `documentElement` and trip the
      // document-level check — but the per-wrapper check catches the same
      // regression either way (measured both ways), so the only real effect is
      // that a phone user would get a sideways-scrolling DOCUMENT instead of
      // one sideways-scrolling table. Containment wins.
      expect(tokens(RESPONSIVE_WRAPPER_CLASS)).toEqual(['overflow-x-auto'])
      expect(tokens(RESPONSIVE_WRAPPER_CLASS)).not.toContain('max-sm:overflow-x-visible')
    })
  })

  describe('tap targets (AC-6)', () => {
    it('a row action button declares a >= 44px floor in both dimensions below sm', () => {
      const buttonTokens = tokens(RESPONSIVE_ACTION_BUTTON_CLASS)
      expect(buttonTokens).toContain('max-sm:min-h-[44px]')
      expect(buttonTokens).toContain('max-sm:min-w-[44px]')
      // Centres the label inside the enlarged box. It is NOT what produces the
      // 44px rect — a <button> is inline-block by default, so min-h/min-w
      // already apply (measured: dropping this keeps the 44px hit area).
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

    it('uses the muted text token rather than a hand-rolled dark pair (AC-7)', () => {
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

    it('is not aria-hidden — it is the only field/value association below sm', () => {
      render(<FieldLabel>Amount</FieldLabel>)
      expect(screen.getByText('Amount')).not.toHaveAttribute('aria-hidden')
    })
  })
})
