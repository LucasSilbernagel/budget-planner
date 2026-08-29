import {
  FIELD_LABEL_CLASS,
  FieldLabel,
  RESPONSIVE_ACTIONS_CELL_CLASS,
  RESPONSIVE_ACTIONS_GROUP_CLASS,
  RESPONSIVE_ACTION_BUTTON_CLASS,
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
  RESPONSIVE_VALUE_NOWRAP_CLASS,
  RESPONSIVE_VALUE_TAG_CLASS,
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

/** Class tokens with every variant prefix removed, so a negative assertion
 * cannot be evaded by shipping the same utility under `max-sm:` / `sm:` / etc.
 * ⚠️ Strips variants ONLY — non-greedy and bracket-aware — because a greedy
 * `replace(/^.*:/, '')` mangles arbitrary-property tokens like
 * `[padding-left:1rem]` into `1rem]`, which then matches nothing. Code review
 * found exactly that hole in this file. */
const bareUtilities = (list: string[]): string[] =>
  list.map((token) => {
    const bracket = token.indexOf('[')
    const head = bracket === -1 ? token : token.slice(0, bracket)
    const stripped = head.replace(/^(?:[a-z][a-z0-9-]*:)+/, '')
    return bracket === -1 ? stripped : stripped + token.slice(bracket)
  })

describe('ResponsiveTable class layer', () => {
  describe('desktop classes are preserved verbatim (AC-2)', () => {
    // Each entry: the constant, and the exact classes it carries at `lg` and
    // above. Nothing in this column may change value, and nothing may be added
    // that is not breakpoint-scoped below `lg`.
    //
    // ⚠️ `max-lg:px-4` IS LISTED EXPLICITLY RATHER THAN FILTERED OUT, and that
    // is the whole point of the shape below. It is the width budget that keeps
    // the four-column `/income` and `/expenses` tables inside their scroll
    // wrapper between `sm` and `lg` on the CI font (see the block above
    // `RESPONSIVE_HEADER_CELL_CLASS` for the measurements). Widening the filter
    // to skip every `max-*` token instead would have made this suite silent
    // about the one class that a future "simplify the padding" edit is most
    // likely to delete — and a local run cannot catch that deletion, because
    // dev fonts are narrow enough to fit either way. Pinned exactly, deleting
    // it fails HERE, in milliseconds, instead of on the runner.
    const cases: [string, string, string[]][] = [
      ['wrapper', RESPONSIVE_WRAPPER_CLASS, ['overflow-x-auto']],
      [
        'table',
        RESPONSIVE_TABLE_CLASS,
        ['min-w-full', 'divide-y', 'divide-gray-200', 'dark:divide-gray-700'],
      ],
      ['thead', RESPONSIVE_THEAD_CLASS, ['surface-inset']],
      // ⚠️ `surface` is ABSENT here since story 42.2, and that is the change, not
      // an omission. An opaque <tbody> spans the table's full SCROLL width and
      // paints over the wrapper's scroll shadows, making the affordance
      // invisible in light mode while every assertion in this file stays green.
      // The colour moved to the wrapper. See the dedicated case below.
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

    // The `px-6` half of each pair above is what renders at `lg` and up, so the
    // pre-31.2 desktop claim in this block's title still holds literally: no
    // constant lost `px-6`, and `max-lg:px-4` cannot apply at >= 1024px.
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
      // These exist ONLY below `sm`. Every token must be breakpoint-scoped.
      for (const value of [RESPONSIVE_ACTIONS_GROUP_CLASS, RESPONSIVE_ACTION_BUTTON_CLASS]) {
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

    it('the body switches to block alongside the table', () => {
      expect(tokens(RESPONSIVE_TBODY_CLASS)).toContain('max-sm:block')
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

    it('the actions cell stacks its label above the button group below sm (34.1b)', () => {
      // Four 44px tap targets (move up, move down, Edit, Delete) do not fit
      // beside the "Actions" label in the ~200px a 320px row leaves for the
      // cell. `flex-col` puts the label on its own line and hands the full
      // width to the buttons. Reverting this is what `e2e/responsive-320.spec.ts`
      // catches as an overflow; this pins it one layer earlier.
      expect(tokens(RESPONSIVE_ACTIONS_CELL_CLASS)).toContain('max-sm:flex-col')
    })

    it('the actions group separates and wraps its four buttons below sm (34.1b)', () => {
      const groupTokens = tokens(RESPONSIVE_ACTIONS_GROUP_CLASS)
      // 4 x 44px + 3 x 4px gap = 188px, inside the ~200px available.
      expect(groupTokens).toContain('max-sm:gap-1')
      // Wrapping is graceful degradation at a larger root font size, not the
      // expected layout — story 31.5's lesson that a reserve computed at the
      // 16px default drifts with the root font size.
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

  describe('value/tag pairs (story 42.3, UX-DR47)', () => {
    // ⚠️ Declaration only. jsdom computes no layout and Tailwind never loads,
    // so nothing here can prove a line count — `e2e/value-tag-one-line.spec.ts`
    // is the only layer that can. Read each title as "the class this AC needs
    // is present".

    it('the pair is a non-wrapping flex row, aligned to the first line below sm', () => {
      const pairTokens = tokens(RESPONSIVE_VALUE_TAG_CLASS)
      expect(pairTokens).toContain('flex')
      expect(pairTokens).toContain('items-center')
      // ⚠️ Partitioned by breakpoint, per the module's own composition rule:
      // desktop keeps `items-center` byte-identical, and only below `sm` does
      // the tag anchor to the name's FIRST line. Measured at 320px with the
      // 138-character seeded name: `items-center` floated the intact badge 88px
      // down the block, detached from any line of text; `max-sm:items-start`
      // puts it at -2px. Measured at 1280px: computed `center`, unchanged, and
      // the allocation pair's top delta stays 0 at BOTH widths.
      expect(pairTokens).toContain('max-sm:items-start')
      // `flex-wrap` would let the tag drop to its own line — the defect wearing
      // a different shape. Variant-stripped: `max-sm:flex-wrap` is the form that
      // would actually ship, since max-sm IS the regime where the defect lives.
      expect(bareUtilities(pairTokens)).not.toContain('flex-wrap')
    })

    it('the tag resists mid-word breaking, and does NOT carry shrink-0', () => {
      const tagTokens = tokens(RESPONSIVE_TAG_CLASS)
      // The cell's inherited `overflow-wrap: anywhere` drops the tag's
      // min-content width to ~1 character. Measured pre-fix at 320px: the
      // four-letter "Goal" badge rendered 25px wide across FOUR lines.
      // `whitespace-nowrap` restores the floor to the full string.
      expect(tagTokens).toContain('whitespace-nowrap')
      // ⚠️ NOT an omission. Measured: `shrink-0` is a no-op alongside nowrap,
      // and ON ITS OWN it overflows the wrapper (242 vs 240 at 320px) by
      // pinning the tag at max-content while its text can still break. See the
      // constant's docblock. Re-adding it needs a failing test first.
      // Variant-stripped: `max-sm:shrink-0` is the only regime where shrink
      // would matter, so an un-stripped check would miss the real revert.
      expect(bareUtilities(tagTokens)).not.toContain('shrink-0')
    })

    it('the bounded-value class carries nowrap and nothing that reserves width', () => {
      // Applied to a formatted currency figure only. Anything that adds
      // horizontal box size here would spend width the 640-1024px budget does
      // not have (see the block above RESPONSIVE_SCROLL_SHADOW_CLASS).
      const valueTokens = tokens(RESPONSIVE_VALUE_NOWRAP_CLASS)
      expect(valueTokens).toContain('whitespace-nowrap')
      for (const utility of bareUtilities(valueTokens)) {
        expect(utility).not.toMatch(/^(p|px|py|ps|pe|pl|pr|m|mx|ms|me|ml|mr|gap|w|min-w)-/)
        // ⚠️ A greedy `replace(/^.*:/, '')` would turn `[padding-left:1rem]`
        // into `1rem]` and sail straight through the check above — the guard
        // evading itself. `bareUtilities` strips variants only, so an arbitrary
        // PROPERTY that reserves width is caught here instead.
        expect(utility).not.toMatch(/^\[(padding|margin|width|min-width|gap|inline-size)/)
      }
    })

    // ⚠️ Titled for what it CHECKS. It pins the two load-bearing tokens and the
    // absence of a nowrap revert — it is NOT a byte-for-byte pin of the whole
    // constant, and an earlier title claiming "byte-identical" over-promised.
    // The byte-level guarantee for this story comes from the diff (no hunk
    // touches these constants), not from this case.
    it('⚠️ the cell wrapping contract survives this story (AC-2)', () => {
      // The tempting fix — putting `whitespace-nowrap` back on the CELL —
      // reverts the 320px card layout. `ResponsiveTable.tsx` records that
      // swapping out either token was measured at ~1134px inside a 320px
      // viewport. The fix belongs on the pair, one level in.
      for (const value of [RESPONSIVE_CELL_CLASS, RESPONSIVE_STACKED_CELL_CLASS]) {
        const cellTokens = tokens(value)
        expect(cellTokens).toContain('max-sm:whitespace-normal')
        expect(cellTokens).toContain('max-sm:[overflow-wrap:anywhere]')
        // Variant-stripped: catches `whitespace-nowrap`, `max-sm:whitespace-nowrap`
        // and `sm:whitespace-nowrap` alike. The unprefixed base token is
        // EXPECTED on these constants (desktop), so exclude it from the check
        // by looking only at what the max-sm regime would add.
        expect(
          cellTokens.filter((t) => t.startsWith('max-sm:')).map((t) => t.replace(/^max-sm:/, ''))
        ).not.toContain('whitespace-nowrap')
      }
    })
  })

  describe('scroll affordance (story 42.2, UX-DR46)', () => {
    // ⚠️ EVERY case here is structural. Whether the shadow is actually PAINTED,
    // and whether it correctly disappears on a table that fits, are geometry
    // claims that jsdom cannot make — `e2e/table-scroll-affordance.spec.ts`
    // samples real pixels for those. Read these as "the declaration the AC
    // needs is present".

    it('is a separate constant, so the wrapper pin is untouched', () => {
      // The wrapper is pinned by exact equality above, deliberately (story
      // 31.2). Merging the affordance into it would force that pin to be
      // loosened, which deletes the guard rather than satisfying it.
      expect(tokens(RESPONSIVE_WRAPPER_CLASS)).not.toContain('surface')
      expect(tokens(RESPONSIVE_SCROLL_SHADOW_CLASS).length).toBeGreaterThan(0)
      expect(tokens(RESPONSIVE_WRAPPER_CLASS)).toEqual(['overflow-x-auto'])
    })

    it('declares four background layers pinned local, local, scroll, scroll', () => {
      // The two covers travel with the content (`local`); the two shadows stay
      // pinned to the box (`scroll`). That asymmetry IS the self-hiding
      // mechanism — with all four `local` the shadows travel away and the
      // affordance never appears; with all four `scroll` it is painted
      // permanently, including on tables that fit (an AC-6 defect).
      expect(tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)).toContain(
        '[background-attachment:local,local,scroll,scroll]'
      )
      expect(tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)).toContain('[background-repeat:no-repeat]')
    })

    it('sets attachment via an arbitrary PROPERTY, never bg-local/bg-scroll', () => {
      // Tailwind v3.4's `backgroundAttachment` plugin takes no arbitrary value,
      // so `bg-local` would set ONE value for ALL FOUR layers and silently
      // break the mechanism while looking correct in a diff.
      const t = tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)
      expect(t).not.toContain('bg-local')
      expect(t).not.toContain('bg-scroll')
      expect(t).not.toContain('bg-fixed')
    })

    it('carries the surface colour and a dark cover pair', () => {
      // The covers must match the surface behind the table or they smear. The
      // colour lives here rather than on the <tbody> precisely so it does not
      // occlude the shadows.
      const t = tokens(RESPONSIVE_SCROLL_SHADOW_CLASS)
      expect(t).toContain('surface')
      expect(t.some((c) => c.startsWith('dark:bg-['))).toBe(true)
      expect(t.some((c) => c.startsWith('bg-[linear-gradient'))).toBe(true)
    })

    it('the tbody declares no background at any variant, so it cannot occlude the shadows', () => {
      // Restoring `surface` here is the one edit that reintroduces the original
      // defect: the affordance stops being visible and nothing else changes.
      //
      // ⚠️ VARIANTS COUNT. An earlier version of this case tested only bare
      // `bg-`/`surface` prefixes, so `dark:bg-gray-800` would have slipped
      // through and re-occluded the shadow in DARK MODE ONLY — where, before
      // review, no test asserted the affordance was painted at all. Strip every
      // variant prefix before judging the utility.
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

    it('reserves no layout width (AC-8)', () => {
      // The 640-1024px budget has zero slack: the free-tier four-column table
      // measures 656 against a 656px wrapper on the CI font. Backgrounds do not
      // affect box size; padding, borders and margins do. A width-reserving
      // token here would fail on the runner and pass on a dev box.
      // ⚠️ Strip ANY variant prefix first — `max-lg:px-4` and `dark:p-2` reserve
      // width just as surely as `px-4`, and an earlier version of this pattern
      // only anticipated `dark:`. Logical properties (`ps-`/`pe-`/`ms-`/`me-`),
      // `gap-`, `indent-` and arbitrary `[padding-left:…]` all count too.
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
