import { renderWithRouter, screen, within } from '@/test/utils'
import { describe, expect, it } from 'vitest'

import { GlobalNav } from '../GlobalNav'

/**
 * GlobalNav component tests (story 11-1, rewritten for the CSS switch in 31.4).
 *
 * Covers the persistent primary navigation: it is a real `<nav>` landmark with
 * an accessible name, exposes every top-level section with the correct route,
 * marks the current route with `aria-current="page"` (with the Overview link
 * matching `/` exactly so it is not active everywhere), and — since 31.4 —
 * carries BOTH the desktop top-bar and the mobile bottom-bar layouts on one DOM
 * subtree.
 *
 * The active-route assertions rely on `renderWithRouter`'s `path` seed: TanStack
 * Router `<Link>` derives active state from the current location, which the
 * throwaway in-memory router exposes. (The one-click cross-section navigation
 * and the hydrated active state on the real route tree are additionally proven
 * in e2e/global-nav.spec.ts.)
 *
 * Nodes render asynchronously through RouterProvider, so every assertion awaits
 * `findBy*` first (mirrors the Footer suite).
 *
 * ⚠️ There is no longer a viewport hook to mock, and mocking one would select
 * nothing: `GlobalNav` has no JS layout branch. jsdom applies no media queries
 * and has no layout engine, so the mobile layout can only be asserted here as
 * `max-sm:` class TOKENS — the rendered geometry, the computed colours and the
 * first-paint position are measured for real in `e2e/nav-responsive-css.spec.ts`
 * and `e2e/chrome-320.spec.ts`.
 *
 * ⚠️ Token membership, never substring. `className.toContain('fixed')`
 * false-matches `max-sm:fixed`, and `-`/`:` are substring boundaries — that is
 * precisely the distinction this component now turns on.
 */

const SECTIONS: readonly [label: RegExp, href: string][] = [
  [/^overview$/i, '/'],
  [/^income$/i, '/income'],
  [/^expenses$/i, '/expenses'],
  [/^savings$/i, '/savings'],
  [/^balance$/i, '/balance'],
  [/^net worth$/i, '/net-worth-projection'],
  [/^retirement$/i, '/retirement'],
  [/^settings$/i, '/settings'],
]

/** Class-token membership helper (the canonical form used across the repo). */
const tokens = (value: string): string[] => value.split(/\s+/).filter(Boolean)

/**
 * Colour utilities, for the AC-5 guard below. Tailwind emits every `max-sm:`
 * rule AFTER the unprefixed utilities, so a `max-sm:` COLOUR would beat the
 * unprefixed `hover:` states below 640px and silently invert mobile hover
 * behaviour. Layout/spacing/typography may be `max-sm:`-scoped; colour may not.
 *
 * ⚠️ Matched by PROPERTY FAMILY, not by palette name. An earlier version listed
 * nine palettes, which let `max-sm:bg-slate-100`, `max-sm:text-emerald-600` and
 * `max-sm:bg-[#fff]` through — i.e. it admitted precisely the defect it exists
 * to block. The colour-bearing families are enumerated instead, and the
 * non-colour members of ambiguous ones are excluded explicitly below.
 */
const COLOUR_FAMILY =
  /^(bg|text|border|ring|divide|placeholder|caret|accent|outline|decoration|shadow|fill|stroke|from|via|to)-/

/**
 * Non-colour utilities that share a colour family's prefix. `text-` and
 * `border-` are the ambiguous ones, and this story deliberately scopes mobile
 * TYPOGRAPHY with `max-sm:` (`text-[11px]`, `text-center`), so a family match
 * alone would false-positive on exactly the tokens it is meant to allow.
 */
const NON_COLOUR: readonly RegExp[] = [
  /^text-(left|center|right|justify|start|end)$/,
  /^text-(xs|sm|base|lg|[2-9]?xl)$/,
  /^text-\[[^\]]*(px|rem|em|%|ch|vw|vh)\]$/,
  /^border(-[trblxy])?(-\d+)?$/,
  /^border-(solid|dashed|dotted|double|none|hidden|collapse|separate)$/,
  /^border-\[[^\]]*(px|rem|em)\]$/,
  /^ring(-\d+)?$/,
  /^ring-(inset|offset-\d+)$/,
  /^shadow(-(sm|md|lg|xl|2xl|inner|none))?$/,
  /^divide-[xy](-\d+)?$/,
  /^decoration-\d+$/,
  /^outline(-\d+|-none|-dashed|-dotted|-double)?$/,
  /^(from|via|to)-\d+%$/,
]

const isColourUtility = (base: string): boolean =>
  COLOUR_FAMILY.test(base) && !NON_COLOUR.some((pattern) => pattern.test(base))

describe('GlobalNav', () => {
  it('renders a nav landmark with an accessible name', async () => {
    renderWithRouter(<GlobalNav />)
    expect(await screen.findByRole('navigation', { name: /primary/i })).toBeInTheDocument()
  })

  it.each(SECTIONS)('exposes the %s section link to %s', async (name, href) => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const link = within(nav).getByRole('link', { name })
    expect(link).toHaveAttribute('href', href)
  })

  it('exposes exactly the eight top-level sections (no premium entry in the nav)', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length)
    // Forecasting stays surfaced-but-locked on Home (story 7-2), not in the nav.
    expect(within(nav).queryByRole('link', { name: /forecast/i })).not.toBeInTheDocument()
  })

  it('marks the current section with aria-current="page"', async () => {
    renderWithRouter(<GlobalNav />, { path: '/expenses' })
    const link = await screen.findByRole('link', { name: /^expenses$/i })
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark Overview active on a sub-route (exact match on "/")', async () => {
    renderWithRouter(<GlobalNav />, { path: '/expenses' })
    // Expenses resolving active is the signal the router has settled.
    await screen.findByRole('link', { name: /^expenses$/i })
    expect(screen.getByRole('link', { name: /^overview$/i })).not.toHaveAttribute('aria-current')
  })

  it('marks Overview active only on the root route', async () => {
    renderWithRouter(<GlobalNav />, { path: '/' })
    const overview = await screen.findByRole('link', { name: /^overview$/i })
    expect(overview).toHaveAttribute('aria-current', 'page')
  })

  // Story 31.4. This replaces a test that mocked `useIsNarrowViewport` to render
  // a second, mobile-only subtree and then re-counted the eight links. With one
  // CSS-switched DOM that claim is a byte-for-byte duplicate of "exposes exactly
  // the eight top-level sections" above and would stay green while proving
  // nothing about mobile. The claim that survives is the one the merge is
  // actually about: BOTH layouts live on the SAME elements at once.
  it('drives both layouts from ONE subtree — desktop and max-sm: utilities co-exist', async () => {
    renderWithRouter(<GlobalNav />)
    const navs = await screen.findAllByRole('navigation', { name: /primary/i })
    // A dual-render (`hidden sm:block` + `sm:hidden`) would put two identically
    // named landmarks in the DOM. Explicitly forbidden — see the GlobalNav
    // docblock and `ui/ResponsiveTable.tsx:19-30`.
    expect(navs, 'more than one Primary landmark is in the DOM').toHaveLength(1)
    const nav = navs[0]
    const list = nav.querySelector('ul')
    expect(list).not.toBeNull()

    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length)
    // The single <nav> carries the mobile bar's own positioning...
    expect(tokens(nav.className)).toContain('max-sm:fixed')
    // ...while the same <ul> carries BOTH the desktop flex row and the mobile grid.
    const listTokens = tokens((list as HTMLElement).className)
    expect(listTokens).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'max-sm:grid']))
  })

  // Story 18-2: eight destinations cannot fit one legible row at 320px (each
  // cell would be ~40px and every label overflowed/overlapped its neighbour).
  // The mobile bottom bar lays the eight items out as a 4-column grid (4x2) so
  // each cell is 80px at 320px and every label stays single-line and tappable.
  it('lays the mobile bottom bar out as a 4-column grid (story 18-2)', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const list = nav.querySelector('ul')
    const listTokens = tokens(list?.className ?? '')

    expect(listTokens).toContain('max-sm:grid')
    expect(listTokens).toContain('max-sm:grid-cols-4')
    // The three neutralisers. `grid-cols-4` is `repeat(4, minmax(0,1fr))`, so any
    // surviving desktop `gap-1 px-4 py-2` resizes every track: with both live the
    // cells compute to 69px instead of the required 80px, and the labels
    // re-overflow. Measured in `e2e/nav-responsive-css.spec.ts`.
    expect(listTokens).toContain('max-sm:gap-0')
    expect(listTokens).toContain('max-sm:px-0')
    expect(listTokens).toContain('max-sm:py-0')
    // The desktop row is untouched (AC-3) — including `flex-wrap`, which is
    // load-bearing at 640-830px in its own right, NOT a flash artefact.
    expect(listTokens).toEqual(
      expect.arrayContaining(['flex', 'flex-wrap', 'gap-1', 'px-4', 'py-2'])
    )
  })

  // Story 18-2 (review follow-ups): the two-row fixed bar pads by the iOS
  // `safe-area-inset-bottom` so its bottom row clears the home indicator, and
  // each anchor is `h-full` so it fills its stretched grid cell (the active
  // background and centering hold when a row grows under text-zoom/wrap).
  it('pads for the safe-area inset and stretches each mobile cell (story 18-2)', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    expect(tokens(nav.className)).toContain('max-sm:pb-[env(safe-area-inset-bottom)]')
    const anchor = within(nav).getByRole('link', { name: /^overview$/i })
    const anchorTokens = tokens(anchor.className)
    expect(anchorTokens).toContain('max-sm:h-full')
    expect(anchorTokens).toContain('max-sm:min-h-[44px]')
  })

  // Story 31.4 — the two mobile-only INK tokens. Neither has any geometric
  // consequence, so nothing else in the suite (here or in e2e's scrollWidth /
  // height / line-count assertions) can see them go missing; a reference
  // implementation shipping both regressions at once passed all 129 e2e tests.
  it('keeps the mobile cells square and their focus ring inset', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const anchorTokens = tokens(within(nav).getByRole('link', { name: /^overview$/i }).className)

    // `rounded-md` is unprefixed, so it reaches the mobile cells unless undone:
    // 6px corners on tab cells that have never had them.
    expect(anchorTokens).toContain('rounded-md')
    expect(anchorTokens).toContain('max-sm:rounded-none')

    // The grid tracks are 80px x 4 flush to x=0..320, so an OUTSET 2px ring
    // paints at x=-2/x=322 — clipped off-screen on 4 of the 8 cells.
    expect(anchorTokens).toContain('focus-visible:ring-2')
    expect(anchorTokens).toContain('max-sm:focus-visible:ring-inset')
    // Mobile-only: unprefixed would change the >= 640px rendering (AC-3).
    expect(anchorTokens, '`ring-inset` leaked onto the desktop nav').not.toContain(
      'focus-visible:ring-inset'
    )
  })

  // Story 31.4 (AC-3) — the desktop cascade must be reachable at >= 640px. An
  // unprefixed `fixed` on the <nav> would make the bar a fixed bottom tab bar at
  // EVERY width while passing every mobile assertion in the suite.
  it('never positions the nav out of flow at desktop widths', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const navTokens = tokens(nav.className)

    // A denylist can only catch what it enumerates, so this one is checked two
    // ways. First the specific tokens that would re-create the bottom bar at
    // every width...
    for (const leaked of ['fixed', 'inset-x-0', 'bottom-0', 'z-40', 'border-t']) {
      expect(navTokens, `\`${leaked}\` is unprefixed — it reaches desktop too`).not.toContain(
        leaked
      )
    }
    // ...then the general rule those tokens are only instances of: below `sm`
    // this element is out of flow with its own chrome, and NONE of that may be
    // unprefixed. `absolute`/`sticky`/`bg-white` are not in the list above and
    // would each be a real desktop regression.
    for (const token of navTokens) {
      if (token.includes(':')) continue // variant-scoped tokens are fine
      expect(
        /^(fixed|absolute|sticky|inset-|bottom-|top-|left-|right-|z-|border|bg-|shadow)/.test(
          token
        ),
        `the nav carries an unprefixed positioning/chrome utility (${token}) — it reaches desktop too`
      ).toBe(false)
    }
    // The old desktop-nav chrome that existed ONLY to style the pre-hydration
    // flash. The real bottom bar carries `max-sm:border-t` instead.
    expect(navTokens, 'the flash-era `max-sm:border-b` chrome is still here').not.toContain(
      'max-sm:border-b'
    )
  })

  // Story 31.4 (AC-5) — the composition trap. Tailwind emits `max-sm:` after
  // every unprefixed utility, so a `max-sm:` colour on a link would beat the
  // unprefixed `hover:bg-gray-100` / `hover:text-gray-900` below 640px and
  // silently invert today's mobile hover behaviour.
  it('scopes only layout with max-sm: on the links — never colour', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    for (const anchor of within(nav).getAllByRole('link')) {
      const label = anchor.textContent?.trim()
      for (const token of tokens(anchor.className)) {
        const variants = token.split(':')
        const base = variants.pop() ?? token
        if (!variants.includes('max-sm')) continue
        expect(
          isColourUtility(base),
          `"${label}" carries a max-sm:-scoped colour (${token}), which beats the unprefixed hover states below 640px`
        ).toBe(false)
      }
    }

    // Repo convention, asserted the same way in `ResponsiveTable.test.tsx:122`:
    // `dark:` comes first. Both orders compile identically in Tailwind 3.4.19.
    //
    // ⚠️ This sweeps the WHOLE subtree, not just the links. The `<nav>` is the
    // only element that actually carries `dark:max-sm:` tokens, so a links-only
    // loop checked every element except the one that could break the rule.
    const subtree = [nav, ...nav.querySelectorAll('*')] as HTMLElement[]
    for (const el of subtree) {
      for (const token of tokens(el.className ?? '')) {
        expect(
          token,
          `<${el.tagName.toLowerCase()}> uses \`max-sm:dark:\` — variant order must be \`dark:max-sm:\``
        ).not.toContain('max-sm:dark:')
      }
    }
  })
})
