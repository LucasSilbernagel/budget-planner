import { renderWithRouter, screen, within } from '@/test/utils'
import { afterEach, describe, expect, it } from 'vitest'

import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
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

/**
 * Split into the two groups story 31.5 introduced — for READABILITY only.
 *
 * ⚠️⚠️ THE LINK COUNTS BELOW STAY 8 AND STAY GREEN. Do NOT "fix" them to 5.
 * jsdom applies no media queries, so `display: none` is never computed and
 * `getAllByRole('link')` resolves ALL EIGHT anchors regardless of which four are
 * behind the More trigger at 320px in a real browser. Every one of the eight
 * `it.each` rows passes unchanged too. Changing these counts to 5 would turn
 * four correct, green tests red. The bar-versus-sheet distinction is a rendered
 * fact, and it is asserted where it can actually be measured:
 * `e2e/chrome-320.spec.ts` and `e2e/nav-responsive-css.spec.ts`.
 */
const PRIMARY_TABS: readonly [label: RegExp, href: string][] = [
  [/^overview$/i, '/'],
  [/^income$/i, '/income'],
  [/^expenses$/i, '/expenses'],
  [/^savings$/i, '/savings'],
]

const MORE_DESTINATIONS: readonly [label: RegExp, href: string][] = [
  [/^balance tracking$/i, '/balance'],
  [/^net worth$/i, '/net-worth-projection'],
  [/^retirement$/i, '/retirement'],
  [/^settings$/i, '/settings'],
]

const SECTIONS: readonly [label: RegExp, href: string][] = [...PRIMARY_TABS, ...MORE_DESTINATIONS]

/**
 * Class-token membership helper (the canonical form used across the repo).
 *
 * ⚠️ Takes an ELEMENT, not a string. `HTMLElement.className` is a string but
 * `SVGElement.className` is an `SVGAnimatedString`, so the old
 * `tokens(el.className)` form threw `TypeError: value.split is not a function`
 * the moment story 31.5 put an inline `<svg>` in this subtree. `classList` is
 * the idiom every other subtree sweep in the repo already uses
 * (`docs-layout.test.tsx:22`, `legal-page-view.test.tsx:101`,
 * `pricing-page.test.tsx:178`, `CategoryBreakdown.test.tsx:777`,
 * `src/test/responsive-table-tokens.ts:116`) and it works for both.
 */
const tokens = (el: Element): string[] => [...el.classList]

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
    expect(tokens(nav)).toContain('max-sm:fixed')
    // ...while the same <ul> carries BOTH the desktop flex row and the mobile grid.
    const listTokens = tokens(list as HTMLElement)
    expect(listTokens).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'max-sm:grid']))
  })

  // Story 31.5 supersedes 18-2's 4x2 grid. Eight destinations cannot fit one
  // legible row at 320px (~40px cells), and stacking an icon over each label to
  // make the bar recognisable would have taken the 4x2 grid to ~112px — WORSE
  // than the 89px it replaced. Icons and eight items are arithmetically mutually
  // exclusive at this width, so the bar carries FIVE cells (four destinations +
  // the More trigger), giving 64px tracks and a 56.75px single-row bar.
  it('lays the mobile bottom bar out as a 5-column grid (story 31.5)', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const list = nav.querySelector('ul')
    const listTokens = list ? tokens(list) : []

    expect(listTokens).toContain('max-sm:grid')
    expect(listTokens).toContain('max-sm:grid-cols-5')
    // The three neutralisers. `grid-cols-5` is `repeat(5, minmax(0,1fr))`, so any
    // surviving desktop `gap-1 px-4 py-2` resizes every track and the labels
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

  /**
   * Story 31.5 — the structure that lets five cells and eight destinations
   * coexist without duplicating a single label.
   *
   * The obvious implementation (leave eight `<li>` in the bar, hide four with
   * `max-sm:hidden`, re-list them in a mobile-only sheet) is forbidden twice
   * over: it puts four destination labels in the DOM TWICE — the dual-render
   * this component's docblock rejects — and it breaks jsdom multi-match and
   * Playwright strict mode alike. The compliant shape is a NESTED `<ul>` inside
   * the fifth `<li>`, dissolved at >= 640px.
   */
  it('nests the More destinations in ONE list, with no duplicated label', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const lists = nav.querySelectorAll('ul')
    expect(lists, 'expected exactly one outer list and one nested sheet list').toHaveLength(2)
    const [outer, sheet] = [...lists]
    expect(outer.contains(sheet), 'the sheet list is not nested inside the outer list').toBe(true)

    // The bar's own cells are the outer list's direct anchors; the sheet's rows
    // sit one level deeper. Together they are the eight destinations, each once.
    const barAnchors = [...outer.querySelectorAll(':scope > li > a')]
    const sheetAnchors = [...sheet.querySelectorAll(':scope > li > a')]
    expect(barAnchors.map((a) => a.textContent?.trim())).toEqual([
      'Overview',
      'Income',
      'Expenses',
      'Savings',
    ])
    expect(sheetAnchors.map((a) => a.textContent?.trim())).toEqual([
      'Balance Tracking',
      'Net Worth',
      'Retirement',
      'Settings',
    ])

    // No destination label appears twice anywhere in the subtree.
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(new Set(hrefs).size, 'a destination is duplicated in the nav DOM').toBe(hrefs.length)

    // ⚠️⚠️ BOTH `sm:contents` tokens are load-bearing and the e2e suite was
    // blind to losing them: measured, the nested list without `sm:contents`
    // takes the desktop nav from 52px to 160px at 1280px (140 computed diffs)
    // with ZERO of 69 tests red.
    const wrapper = sheet.parentElement as HTMLElement
    expect(wrapper.tagName).toBe('LI')
    expect(tokens(wrapper), 'the sheet wrapper <li> does not dissolve on desktop').toContain(
      'sm:contents'
    )
    expect(tokens(sheet), 'the nested <ul> does not dissolve on desktop').toContain('sm:contents')
  })

  /**
   * Story 31.5 — the More trigger. Every other sweep in this file misses it:
   * the chrome test reads only `nav.className`, and the colour-scoping test
   * iterates `getAllByRole('link')`, which skips a `<button>` entirely.
   */
  it('exposes a single More trigger that never reaches the desktop row', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const buttons = within(nav).getAllByRole('button')
    expect(buttons, 'expected exactly one <button> in the nav').toHaveLength(1)
    const trigger = buttons[0]
    expect(trigger).toHaveAccessibleName('More')
    expect(trigger).toHaveAttribute('type', 'button')

    // A mobile-only ELEMENT takes base classes + `sm:hidden` (the composition
    // rule in `ui/ResponsiveTable.tsx:31-39`). A ninth item in the desktop flex
    // row would change the widest-link right edge that
    // `e2e/nav-responsive-css.spec.ts` measures at 640/700/760px.
    const triggerTokens = tokens(trigger)
    expect(triggerTokens, 'the More trigger reaches the desktop row').toContain('sm:hidden')
    // Its own chrome, which no `nav.className` sweep can see.
    expect(triggerTokens).toContain('flex-col')
    expect(triggerTokens).toContain('min-h-[44px]')
    expect(triggerTokens).toContain('text-[11px]')
    expect(triggerTokens).toContain('focus-visible:ring-2')
    expect(triggerTokens).toContain('focus-visible:ring-inset')

    // Closed on the first render, so the server and client agree (AC-7).
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    const panelId = trigger.getAttribute('aria-controls')
    expect(panelId, 'the More trigger has no aria-controls').toBeTruthy()
    expect(nav.querySelector(`#${panelId}`), 'aria-controls names no element').not.toBeNull()
  })

  /**
   * Story 31.5 (AC-7) — the state is a `max-sm:`-scoped CLASS, never the
   * `hidden` attribute.
   *
   * ⚠️ `hidden={!isOpen}` is the textbook disclosure idiom and the first thing a
   * dev reaches for. It applies at EVERY width, so it would delete Balance, Net
   * Worth, Retirement and Settings from the DESKTOP nav entirely.
   */
  it('hides the closed sheet with a max-sm: class, not the `hidden` attribute', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const sheet = [...nav.querySelectorAll('ul')][1]

    expect(sheet.hasAttribute('hidden'), 'the sheet uses the `hidden` attribute').toBe(false)
    expect(tokens(sheet), 'the closed sheet is not hidden below `sm`').toContain('max-sm:hidden')
    // Out of flow against the `max-sm:fixed` nav — NOT `max-sm:fixed` itself,
    // which resolves `bottom: 100%` against the viewport and renders the sheet
    // entirely off the top of the screen (measured at y=-279).
    expect(tokens(sheet)).toContain('max-sm:absolute')
    expect(tokens(sheet), 'the sheet is `fixed` — it will render off-screen').not.toContain(
      'max-sm:fixed'
    )
    // Its own opaque background, for the same reason the bar has one.
    expect(tokens(sheet)).toContain('max-sm:bg-white')
    expect(tokens(sheet)).toContain('dark:max-sm:bg-gray-800')
  })

  /**
   * Story 31.5 — every icon is a mobile-only element.
   *
   * ⚠️⚠️ Measured: an icon rendered without `sm:hidden` grows the desktop nav
   * 52px -> 76px at 1280px and 92px -> 140px at 640px, every anchor 36px ->
   * 60px, for 212 computed diffs — and NOT ONE test in the pre-31.5 suite went
   * red, including the one named "the desktop cascade is untouched", because
   * nothing anywhere read a height.
   */
  it('scopes every icon to mobile with `sm:hidden`', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const icons = [...nav.querySelectorAll('svg')]
    // Nine: one per bar tab, one for More, one per sheet row.
    expect(icons, 'expected one icon per destination plus the More trigger').toHaveLength(9)
    for (const icon of icons) {
      expect(
        tokens(icon),
        'an icon is missing `sm:hidden` — it will grow the desktop nav'
      ).toContain('sm:hidden')
      // Decorative: the anchor's own label is the announced name.
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }

    // Each label is wrapped so the e2e line-count probe can scope a Range to the
    // TEXT — over the whole anchor it measures 3 rects on a correct cell.
    expect(nav.querySelectorAll('[data-nav-label]')).toHaveLength(9)
  })

  // Story 18-2 (review follow-ups), still true of the 31.5 single-row bar: the
  // fixed bar pads by the iOS `safe-area-inset-bottom` so it clears the home
  // indicator, and each anchor is `h-full` so it fills its stretched grid cell
  // (the active background and centering hold when a cell grows under
  // text-zoom/wrap). `flex-col` is what makes the cell an icon-over-label stack
  // — the single token this whole redesign turns on.
  it('pads for the safe-area inset and stretches each mobile cell (story 18-2)', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    expect(tokens(nav)).toContain('max-sm:pb-[env(safe-area-inset-bottom)]')
    const anchor = within(nav).getByRole('link', { name: /^overview$/i })
    const anchorTokens = tokens(anchor)
    expect(anchorTokens).toContain('max-sm:h-full')
    expect(anchorTokens).toContain('max-sm:min-h-[44px]')
    expect(anchorTokens).toContain('max-sm:flex-col')
    expect(anchorTokens).toContain('max-sm:gap-0.5')
  })

  // Story 31.4 — the two mobile-only INK tokens. Neither has any geometric
  // consequence, so nothing else in the suite (here or in e2e's scrollWidth /
  // height / line-count assertions) can see them go missing; a reference
  // implementation shipping both regressions at once passed all 129 e2e tests.
  it('keeps the mobile cells square and their focus ring inset', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const anchorTokens = tokens(within(nav).getByRole('link', { name: /^overview$/i }))

    // `rounded-md` is unprefixed, so it reaches the mobile cells unless undone:
    // 6px corners on tab cells that have never had them.
    expect(anchorTokens).toContain('rounded-md')
    expect(anchorTokens).toContain('max-sm:rounded-none')

    // The grid tracks are 64px x 5 flush to x=0..320, so an OUTSET 2px ring
    // paints at x=-2/x=322 — clipped off-screen on the 1st and 5th cells.
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
    const navTokens = tokens(nav)

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
      for (const token of tokens(anchor)) {
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
      for (const token of tokens(el)) {
        expect(
          token,
          `<${el.tagName.toLowerCase()}> uses \`max-sm:dark:\` — variant order must be \`dark:max-sm:\``
        ).not.toContain('max-sm:dark:')
      }
    }
  })

  /**
   * Story 31.5 (AC-8) — the More tab's active state.
   *
   * ⚠️⚠️ `<Link activeProps>` CANNOT make this claim and would not fail loudly:
   * More is not a route, so it would simply mark nothing, and the mobile bar
   * would show NO active tab on four of eight destinations — worse orientation
   * than the grid this story replaced. The state is derived from the router
   * location instead, which is exactly as hydration-safe (`useRouterState` reads
   * the same store `<Link>` does, seeded before the first React render).
   */
  describe('the More tab is active on the four routes it owns', () => {
    const moreTrigger = (nav: HTMLElement): HTMLElement => within(nav).getByRole('button')

    it.each(MORE_DESTINATIONS)('is active on %s (%s)', async (_label, href) => {
      renderWithRouter(<GlobalNav />, { path: href })
      const nav = await screen.findByRole('navigation', { name: /primary/i })
      // The matching row inside the sheet is marked, by `<Link>`'s own active
      // handling...
      await screen.findByRole('link', { name: _label })
      expect(screen.getByRole('link', { name: _label })).toHaveAttribute('aria-current', 'page')
      // ...and the TAB that discloses it carries the same active treatment.
      expect(tokens(moreTrigger(nav)), `the More tab is not marked active on ${href}`).toContain(
        'bg-green-50'
      )
    })

    it.each(PRIMARY_TABS)('is NOT active on %s (%s)', async (_label, href) => {
      renderWithRouter(<GlobalNav />, { path: href })
      const nav = await screen.findByRole('navigation', { name: /primary/i })
      await screen.findByRole('link', { name: _label })
      expect(
        tokens(moreTrigger(nav)),
        `the More tab is wrongly marked active on ${href}`
      ).not.toContain('bg-green-50')
    })

    // Anti-vacuity: `bg-green-50` must actually be the token the active
    // treatment uses, or both halves above would pass on a component that never
    // applies any active styling at all.
    it('uses the same active treatment the route tabs use', async () => {
      renderWithRouter(<GlobalNav />, { path: '/income' })
      const active = await screen.findByRole('link', { name: /^income$/i })
      expect(tokens(active)).toContain('bg-green-50')
    })
  })
})

/**
 * Story 35.2 (FR55) — the Retirement planner visibility preference.
 *
 * ⚠️ These counts are 7 and 8, and that does NOT contradict the "stay 8, stay
 * green" warning at the top of this file. That warning is about jsdom computing
 * no CSS: the four sheet anchors are always in the DOM because `display: none`
 * is never applied here. This block asserts something different in kind — with
 * the preference off, the Retirement `<li>` is NEVER RENDERED, so it is absent
 * from the DOM at every width, in jsdom and in a real browser alike.
 *
 * The pre-paint half of the feature (the `<head>` script + the CSS rule that
 * suppress the entry BEFORE React runs) is deliberately NOT asserted here —
 * jsdom applies no stylesheet, so an assertion of it would be measuring a class
 * string, not a style. It is measured in `e2e/nav-planner-visibility.spec.ts`.
 */
describe('GlobalNav — Retirement planner hidden (story 35.2)', () => {
  const hidePlanner = () => usePlannerVisibilityStore.setState({ showRetirementPlanner: false })

  afterEach(() => {
    usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  })

  it('omits the Retirement entry entirely when the preference is off', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    expect(within(nav).queryByRole('link', { name: /^retirement$/i })).toBeNull()
    expect(
      [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      'the Retirement href survived the filter'
    ).not.toContain('/retirement')
    // Seven, not eight: the node is not rendered, rather than hidden by CSS.
    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length - 1)
  })

  it('leaves the sheet holding exactly its other three destinations', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const lists = nav.querySelectorAll('ul')
    const sheet = [...lists][1]
    expect(
      [...sheet.querySelectorAll(':scope > li > a')].map((a) => a.textContent?.trim())
    ).toEqual(['Balance Tracking', 'Net Worth', 'Settings'])
  })

  it('drops exactly one icon and one label with the entry', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    // Eight: four bar tabs, the More trigger, three sheet rows.
    expect([...nav.querySelectorAll('svg')]).toHaveLength(8)
    expect(nav.querySelectorAll('[data-nav-label]')).toHaveLength(8)
  })

  it('leaves the four bar tabs and the More trigger untouched', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const outer = [...nav.querySelectorAll('ul')][0]
    expect(
      [...outer.querySelectorAll(':scope > li > a')].map((a) => a.textContent?.trim())
    ).toEqual(['Overview', 'Income', 'Expenses', 'Savings'])
    expect(within(nav).getAllByRole('button')).toHaveLength(1)
  })

  /**
   * AC-3 — the More trigger cannot claim a destination the sheet does not hold.
   *
   * ⚠️ This is the state the story made unrepresentable rather than guarded:
   * `isMoreActive` is derived from the SAME filtered list the rows render from.
   * Computing it from the unfiltered constant would light the trigger here while
   * the sheet it discloses holds no Retirement row — an orientation cue pointing
   * at nothing.
   */
  it('does not mark the More trigger active on /retirement while hidden', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />, { path: '/retirement' })
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    expect(
      tokens(within(nav).getByRole('button')),
      'the More tab claims a destination its sheet no longer holds'
    ).not.toContain('bg-green-50')
  })

  it('restores the entry when the preference is switched back on', async () => {
    hidePlanner()
    const { unmount } = renderWithRouter(<GlobalNav />)
    const hiddenNav = await screen.findByRole('navigation', { name: /primary/i })
    // ⚠️ Assert the BEFORE state too. Checking only the restored render would
    // pass identically on a component that never filters anything — the test
    // could not tell the feature from its absence.
    expect(within(hiddenNav).getAllByRole('link')).toHaveLength(SECTIONS.length - 1)
    unmount()

    usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    expect(within(nav).getByRole('link', { name: /^retirement$/i })).toHaveAttribute(
      'href',
      '/retirement'
    )
    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length)
  })

  /**
   * The CSS hook the pre-paint script targets.
   *
   * `[data-hide-retirement='1'] [data-nav-path='/retirement']` is what suppresses
   * the entry on the first frame. jsdom cannot evaluate that rule, but it CAN
   * prove the attribute the selector depends on exists on every destination —
   * without which the rule silently matches nothing and the flash returns.
   */
  it('tags every destination <li> with its route for the pre-paint CSS hook', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const tagged = [...nav.querySelectorAll('li[data-nav-path]')].map((li) =>
      li.getAttribute('data-nav-path')
    )
    expect(tagged).toEqual([
      '/',
      '/income',
      '/expenses',
      '/savings',
      '/balance',
      '/net-worth-projection',
      '/retirement',
      '/settings',
    ])
  })
})
