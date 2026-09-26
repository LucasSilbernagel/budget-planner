import { type SessionSeed, SessionSeedProvider } from '@/context/session-seed'
import { fireEvent, renderWithRouter, screen, waitFor, within } from '@/test/utils'
import { afterEach, describe, expect, it } from 'vitest'

import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
import { DISCLOSURE_CHEVRON_CLASS } from '../../ui/ChevronDownIcon'
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
 * ⚠️⚠️ THE LINK COUNTS BELOW STAY 6 AND STAY GREEN. Do NOT "fix" them to 4.
 * They prove the destinations are RENDERED. They do not prove a user can REACH
 * them. Since story 59.2 the More destinations (two since story 69.2 moved
 * Settings to the account cluster) sit inside a native
 * `<details>` at EVERY width, and a closed `<details>` hides its content from a
 * real browser's accessibility tree. jsdom does not: its default stylesheet
 * (`jsdom/lib/jsdom/browser/default-stylesheet.js`) has no closed-details rule,
 * so `getAllByRole('link')` still resolves all six, and every `it.each` row
 * below still passes. Before 59.2 the same count had a different reason: jsdom
 * applies no media queries. (It was EIGHT until story 43.3 removed
 * `/net-worth-projection`, and SEVEN until story 69.2 removed `/settings`; the
 * count follows the nav, never the viewport.)
 *
 * Where openness DOES matter, this file uses jest-dom's `toBeVisible()`, which
 * respects `details[open]`. That is the story 59.2 block at the bottom. What a
 * user can actually reach is a rendered fact, asserted in
 * `e2e/nav-more-disclosure.spec.ts`, `e2e/chrome-320.spec.ts` and
 * `e2e/nav-responsive-css.spec.ts`.
 */
const PRIMARY_TABS: readonly [label: RegExp, href: string][] = [
  [/^overview$/i, '/'],
  [/^income$/i, '/income'],
  [/^expenses$/i, '/expenses'],
  [/^savings$/i, '/savings'],
]

const MORE_DESTINATIONS: readonly [label: RegExp, href: string][] = [
  [/^balances$/i, '/balance'],
  [/^retirement$/i, '/retirement'],
]

const SECTIONS: readonly [label: RegExp, href: string][] = [...PRIMARY_TABS, ...MORE_DESTINATIONS]

/**
 * ⚠️⚠️ STORY 69.3 (FR110, decision D2): Balances and Retirement are in the DOM
 * TWICE. The sheet copy (inside More, `lg:hidden`) and a ROW copy (an outer
 * `<li data-nav-promoted>`, `hidden lg:block`). A real browser renders exactly
 * one of them at any width; jsdom applies no stylesheet, so it sees BOTH. So:
 *
 *  - a DOM anchor count is destinations + promoted copies (6 + 2 = 8 free),
 *  - a role query by name for those two MUST be scoped to the sheet or the row
 *    (`sheetOf` / `rowCopiesOf`), never resolved with `getAllBy…()[0]`, which
 *    picks a copy by DOM order and asserts nothing about which one.
 *
 * Which copy a user actually sees at which width is a RENDERED fact:
 * `e2e/nav-lg-row{,.paid}.spec.ts`.
 */
const PROMOTED_COPIES = MORE_DESTINATIONS.length

/** The More panel's list. Non-null asserted, so a scoped query cannot pass on nothing. */
const sheetOf = (nav: HTMLElement): HTMLElement => {
  const sheet = nav.querySelector('details > ul')
  expect(sheet, 'the More panel list is missing').not.toBeNull()
  return sheet as HTMLElement
}

/** The promoted destinations' ROW copies' anchors, in order (story 69.3). */
const rowCopiesOf = (nav: HTMLElement): HTMLAnchorElement[] => [
  ...nav.querySelectorAll<HTMLAnchorElement>(':scope > ul > li[data-nav-promoted] > a'),
]

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
 * Every nav ICON, i.e. every svg except the desktop disclosure chevron (story
 * 69.1). The icon tests require `sm:hidden`; the chevron must NOT have it.
 * ⚠️ Never make those tests pass by adding `sm:hidden` to the chevron: it hides
 * the chevron at every width it exists for, and jsdom (no stylesheet) cannot
 * tell. `e2e/nav-more-disclosure.spec.ts` is what proves it visible.
 */
const ICON_SVG = 'svg:not([data-disclosure-chevron])'

/**
 * Colour utilities, for the AC-5 guard below. Tailwind emits every `max-sm:`
 * rule AFTER the unprefixed utilities, so a `max-sm:` COLOUR would beat an
 * unprefixed colour of equal specificity below 640px. Layout/spacing/typography
 * may be `max-sm:`-scoped; colour may not.
 * ⚠️ Corrected by story 69.3: this used to say it would beat the unprefixed
 * `hover:` states. It would not (`:hover` is 0-2-0, a media-scoped class 0-1-0;
 * measured for `max-lg:` in `e2e/nav-lg-row{,.paid}.spec.ts`). The guard stays
 * for the non-hover case, the unprefixed active treatment included.
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
    // A promoted destination has two DOM copies since story 69.3; every other
    // destination has one. Each copy must point at the route.
    const links = within(nav).getAllByRole('link', { name })
    const promoted = MORE_DESTINATIONS.some(([, h]) => h === href)
    expect(links).toHaveLength(promoted ? 2 : 1)
    for (const link of links) expect(link).toHaveAttribute('href', href)
  })

  it('exposes exactly the six top-level sections, as eight DOM anchors (no premium entry)', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    // Eight DOM anchors: six destinations + the two promoted row copies (69.3).
    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length + PROMOTED_COPIES)
    expect(
      new Set(
        within(nav)
          .getAllByRole('link')
          .map((a) => a.getAttribute('href'))
      ).size
    ).toBe(SECTIONS.length)
    // Forecasting stays surfaced-but-locked on Home (story 7-2), not in the nav.
    expect(within(nav).queryByRole('link', { name: /forecast/i })).not.toBeInTheDocument()
  })

  // Story 69.2 (FR109): Settings left the nav for the account cluster (the
  // account menu signed in, a gear link signed out). The count above cannot
  // say WHICH destination went; this says it by route, so a rename or a
  // swap cannot pass it. The route to /settings that replaced this one is
  // asserted in `auth-indicator.test.tsx` and `e2e/settings-route.spec.ts`.
  it('carries no link to /settings, in any form', async () => {
    renderWithRouter(<GlobalNav />, { path: '/settings' })
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    expect(nav.querySelector('a[href="/settings"]')).toBeNull()
    expect(within(nav).queryByRole('link', { name: /settings/i })).toBeNull()
    // Nothing in the nav is current on /settings, the More tab included: it is
    // not a nav destination any more.
    expect(nav.querySelector('[aria-current]')).toBeNull()
    const summary = nav.querySelector('details > summary') as HTMLElement
    expect(tokens(summary)).not.toContain('bg-green-50')
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
  // a second, mobile-only subtree and then re-counted the section links. With one
  // CSS-switched DOM that claim is a byte-for-byte duplicate of "exposes exactly
  // the six top-level sections" above and would stay green while proving
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

    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length + PROMOTED_COPIES)
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
    // surviving desktop `gap-1 pl-4 py-2` resizes every track and the labels
    // re-overflow. Measured in `e2e/nav-responsive-css.spec.ts`.
    expect(listTokens).toContain('max-sm:gap-0')
    expect(listTokens).toContain('max-sm:px-0')
    expect(listTokens).toContain('max-sm:py-0')
    // The desktop row is untouched (AC-3), including `flex-wrap`. Since story
    // 59.2's review the nav is `sm:shrink-0`, so the token is inert at >= 640px
    // and is kept deliberately (see the `GlobalNav.tsx` comment on the list).
    // The row's measured headroom lives ONLY in `e2e/nav-responsive-css.spec.ts`.
    //
    // ⚠️ `pl-4`, not `px-4`, since story 69.1 (decision D1): the list's right
    // padding pays for the More chevron, because the signed-out 640px row had
    // almost no headroom (the figure lives in that record, not here).
    // `max-sm:px-0` still zeroes BOTH sides below `sm`, so
    // the mobile bar is untouched. Putting `px-4` back overflows the document at
    // 640px signed out.
    expect(listTokens).toEqual(
      expect.arrayContaining(['flex', 'flex-wrap', 'gap-1', 'pl-4', 'py-2'])
    )
    expect(listTokens, 'the list regained its right padding').not.toContain('px-4')
  })

  /**
   * Story 31.5 — the structure that lets five cells and eight destinations
   * coexist without duplicating a single label.
   *
   * The obvious implementation (leave eight `<li>` in the bar, hide four with
   * `max-sm:hidden`, re-list them in a mobile-only sheet) is forbidden twice
   * over: it puts four destination labels in the DOM TWICE, and it breaks
   * jsdom multi-match and Playwright strict mode alike. The compliant shape is
   * a NESTED `<ul>` inside the fifth `<li>`. Until story 59.2 that list was
   * dissolved into the desktop row at >= 640px; since 59.2 it sits inside the
   * cell's `<details>` as a disclosure panel.
   *
   * ⚠️ Story 69.3 (decision D2) DOES put two labels in the DOM twice, on
   * purpose, for the `lg` row, and it corrected the docblock this comment used
   * to cite: what `GlobalNav.tsx` rejects is two `<nav>` LANDMARKS. The mobile
   * reasoning above stands; the `lg` copies are asserted below.
   */
  it('nests the More destinations in ONE list, duplicated only as the lg row copies', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const lists = nav.querySelectorAll('ul')
    expect(lists, 'expected exactly one outer list and one nested sheet list').toHaveLength(2)
    const [outer, sheet] = [...lists]
    expect(outer.contains(sheet), 'the sheet list is not nested inside the outer list').toBe(true)

    // The bar's own cells are the outer list's direct anchors; the sheet's rows
    // sit one level deeper. Since story 69.3 the outer list ALSO holds the two
    // promoted row copies (`data-nav-promoted`, rendered only at `lg`).
    const barAnchors = [...outer.querySelectorAll(':scope > li:not([data-nav-promoted]) > a')]
    const sheetAnchors = [...sheet.querySelectorAll(':scope > li > a')]
    expect(barAnchors.map((a) => a.textContent?.trim())).toEqual([
      'Overview',
      'Income',
      'Expenses',
      'Savings',
    ])
    expect(sheetAnchors.map((a) => a.textContent?.trim())).toEqual(['Balances', 'Retirement'])
    expect(rowCopiesOf(nav).map((a) => a.textContent?.trim())).toEqual(['Balances', 'Retirement'])

    // ⚠️ REVERSED by story 69.3 (decision D2, Lucas 2026-09-25). Until then
    // this asserted that NO href appears twice. The promoted destinations now
    // appear exactly twice, and nothing else does: a third copy, or a copy of
    // a tab or a premium row, is still the dual-render defect.
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    const counts = new Map<string | null, number>()
    for (const h of hrefs) counts.set(h, (counts.get(h) ?? 0) + 1)
    for (const [h, n] of counts) {
      const promoted = MORE_DESTINATIONS.some(([, href]) => href === h)
      expect(n, `${h} appears ${n} times in the nav DOM`).toBe(promoted ? 2 : 1)
    }
    // Only ONE copy is ever rendered: the sheet copy is `lg:hidden`, the row
    // copy `hidden lg:block`. Token-level only; e2e proves the render.
    // The PROMOTED sheet rows specifically (the free sheet happens to be only
    // those, but the assertion is about the set, not the tier).
    for (const [, href] of MORE_DESTINATIONS) {
      const li = sheet.querySelector(`:scope > li[data-nav-path="${href}"]`)
      expect(li, `no sheet row for ${href}`).not.toBeNull()
      expect(tokens(li as Element), 'a promoted sheet row renders at lg too').toContain('lg:hidden')
    }
    for (const a of rowCopiesOf(nav)) {
      expect(tokens(a.parentElement as HTMLElement)).toEqual(['hidden', 'lg:block'])
      // A desktop-only element: no mobile glyph, no mobile tokens.
      expect(a.querySelector('svg'), 'a row copy carries an icon').toBeNull()
    }

    // Story 59.2: the nested list is the panel of the fifth cell's `<details>`.
    // Until 59.2 this asserted the OPPOSITE — two `sm:contents` tokens
    // dissolving the list into the desktop row — and that dissolve is now the
    // regression. Its absence is pinned in the story 59.2 block below.
    const details = sheet.parentElement as HTMLElement
    expect(details.tagName, 'the sheet list is not the panel of a <details>').toBe('DETAILS')
    expect((details.parentElement as HTMLElement).tagName).toBe('LI')
  })

  /**
   * Story 69.1 (FR108): the desktop disclosure chevron. TOKEN-LEVEL ONLY —
   * jsdom applies no stylesheet, so nothing here can prove the chevron is
   * visible or that it turns. `e2e/nav-more-disclosure{,.paid}.spec.ts` does,
   * including with JavaScript off. This pins the tokens those proofs rely on.
   */
  it('carries one desktop-only chevron that turns on the `open` attribute', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const chevrons = nav.querySelectorAll('[data-disclosure-chevron]')
    expect(chevrons, 'expected exactly one disclosure chevron in the nav').toHaveLength(1)
    const chevron = chevrons[0] as Element
    expect(
      chevron.closest('details > summary'),
      'the chevron is not in the More trigger'
    ).not.toBeNull()
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    const chevronTokens = tokens(chevron)
    expect(chevronTokens).toEqual(
      expect.arrayContaining(['max-sm:hidden', 'group-open:rotate-180'])
    )
    expect(chevronTokens, 'the chevron is hidden at desktop').not.toContain('sm:hidden')
    // AC-2: the SAME visual class as the account menu's chevron, not a copy.
    expect(chevronTokens).toEqual(expect.arrayContaining(DISCLOSURE_CHEVRON_CLASS.split(' ')))
    const details = nav.querySelector('details') as HTMLDetailsElement
    expect(details, 'the <details> lost `group`').toHaveClass('group')
    const summary = nav.querySelector('details > summary') as HTMLElement
    expect(summary).toHaveAccessibleName('More')

    // Rotation is the attribute's job, never state's (decision D2). Asserted
    // OPEN as well as closed: a state-driven `isMoreOpen ? ' rotate-180'`
    // is absent while closed, so a closed-only check could not fail on it
    // (code review 2026-09-25).
    expect(chevronTokens).not.toContain('rotate-180')
    fireEvent.click(summary)
    await waitFor(() => expect(details.open, 'the disclosure did not open').toBe(true))
    expect(
      tokens(nav.querySelector('[data-disclosure-chevron]') as Element),
      'the chevron rotates from React state — it must read the `open` attribute'
    ).not.toContain('rotate-180')
  })

  /**
   * Story 31.5 — the More trigger. Every other sweep in this file misses it:
   * the chrome test reads only `nav.className`, and the colour-scoping test
   * iterates `getAllByRole('link')`, which skips the trigger entirely.
   *
   * ⚠️ Story 59.2 made it a `<summary>` that reaches the desktop row, reversing
   * this test's old title, "never reaches the desktop row". A `<summary>` has no
   * role in `@testing-library/dom` (see the story 59.2 block), so it is found by
   * selector and asserted non-null before anything else.
   */
  it('exposes a single More trigger, a <summary>, styled for both layouts', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const summaries = nav.querySelectorAll('details > summary')
    expect(summaries, 'expected exactly one More <summary> in the nav').toHaveLength(1)
    expect(nav.querySelectorAll('button'), 'a <button> survived in the nav').toHaveLength(0)
    const trigger = summaries[0] as HTMLElement
    expect(trigger).toHaveAccessibleName('More')

    // A SHARED element now, so the composition rule for shared elements applies:
    // desktop base + APPENDED `max-sm:` variants (`GlobalNav.tsx` docblock).
    const triggerTokens = tokens(trigger)
    // Desktop: the same look as every desktop anchor.
    expect(triggerTokens).toEqual(
      expect.arrayContaining(['inline-block', 'rounded-md', 'px-3', 'py-2', 'text-sm'])
    )
    // Mobile: the 64px bar cell it has always been, via `max-sm:` only.
    expect(triggerTokens).toContain('max-sm:flex-col')
    expect(triggerTokens).toContain('max-sm:min-h-[44px]')
    expect(triggerTokens).toContain('max-sm:text-[11px]')
    expect(triggerTokens).toContain('focus-visible:ring-2')
    expect(triggerTokens).toContain('max-sm:focus-visible:ring-inset')
    // The inset ring is for the flush mobile tracks only; desktop rings are outset.
    expect(triggerTokens, '`ring-inset` leaked onto the desktop trigger').not.toContain(
      'focus-visible:ring-inset'
    )
  })

  /**
   * Story 59.2 — the closed state is the NATIVE `<details>` state, at every width.
   *
   * ⚠️ THIS TEST'S CONTRACT INVERTED IN 59.2. It used to guard that the closed
   * state did NOT hide the destinations on desktop: it was a `max-sm:`-scoped
   * class, never the `hidden` attribute, because `hidden={!isOpen}` would have
   * deleted them from the flat desktop row. Hiding them at every width is now
   * the DESIGN (decision, Lucas 2026-09-21), and the old assertion
   * ("no `hidden` attribute") would have stayed green while being meaningless.
   *
   * What still must not happen is a SECOND hiding mechanism layered on the
   * native one. A `hidden` attribute or a `max-sm:hidden` class would keep the
   * panel shut after the native toggle opened it, so it would never open with
   * JavaScript off. The fail-open property (every route reachable with zero
   * JavaScript) rests on the native toggle being the ONLY thing that hides it.
   */
  it('hides the closed panel natively at every width, and by nothing else', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const sheet = [...nav.querySelectorAll('ul')][1]

    expect(sheet.hasAttribute('hidden'), 'the panel uses the `hidden` attribute').toBe(false)
    expect(tokens(sheet), 'a class-based closed state is layered on the native one').not.toContain(
      'max-sm:hidden'
    )
    expect(tokens(sheet)).not.toContain('hidden')
    // Closed means hidden, and jest-dom can see it: it respects `details[open]`.
    expect(within(sheet).getByRole('link', { name: /^balances$/i })).not.toBeVisible()
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

    // ICONS only: the desktop disclosure chevron (story 69.1) is the one svg
    // that must NOT carry `sm:hidden`, and it has its own test below.
    const icons = [...nav.querySelectorAll(ICON_SVG)]
    // Seven: one per bar tab (4), one for More, one per sheet row (2). Was NINE
    // until story 43.3 removed the Net Worth destination and its icon, and
    // EIGHT until story 69.2 removed Settings and its gear.
    expect(icons, 'expected one icon per destination plus the More trigger').toHaveLength(7)
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
    // Nine labels: the seven above + the two promoted row copies (story 69.3),
    // which carry a label and NO icon, so the icon count stays seven.
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
  // every unprefixed utility, so a `max-sm:` colour on a link would beat an
  // unprefixed colour of equal specificity below 640px (NOT the `hover:`
  // states, as this once said: see `COLOUR_FAMILY`'s note).
  it('scopes only layout with max-sm: on the links — never colour', async () => {
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    for (const anchor of within(nav).getAllByRole('link')) {
      const label = anchor.textContent?.trim()
      for (const token of tokens(anchor)) {
        const variants = token.split(':')
        const base = variants.pop() ?? token
        // Every `max-*` media variant, not only `max-sm:` (story 69.3 code
        // review): the rationale is the same for all of them, and 69.3 added
        // the first `max-lg:` colour to this component (on the More trigger,
        // which is not a link and is the one documented exception).
        const scope = variants.find((v) => v.startsWith('max-'))
        if (!scope) continue
        expect(
          isColourUtility(base),
          `"${label}" carries a ${scope}:-scoped colour (${token}), which beats unprefixed colours of equal specificity in that range`
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
   * would show NO active tab on two of six destinations — worse orientation
   * than the grid this story replaced. The state is derived from the router
   * location instead, which is exactly as hydration-safe (`useRouterState` reads
   * the same store `<Link>` does, seeded before the first React render).
   */
  describe('the More tab is active on the routes it owns (two since story 69.2)', () => {
    // ⚠️ Non-null FIRST. The `.not.toContain` cases below would pass against a
    // missing node, and `getByRole('button')` no longer finds the trigger at all.
    const moreTrigger = (nav: HTMLElement): HTMLElement => {
      const summary = nav.querySelector('details > summary')
      expect(summary, 'the More <summary> is missing').not.toBeNull()
      return summary as HTMLElement
    }

    // Story 69.3: these two are behind More only BELOW `lg`, so More's active
    // treatment is `max-lg:`-scoped on their routes. The unprefixed token would
    // light More at `lg` too, beside the row anchor that is the real "you are
    // here" there (AC-8 mutation iii). e2e reads the computed colour at both
    // widths (`nav-lg-row{,.paid}.spec.ts`).
    it.each(MORE_DESTINATIONS)('is active below lg only on %s (%s)', async (_label, href) => {
      renderWithRouter(<GlobalNav />, { path: href })
      const nav = await screen.findByRole('navigation', { name: /primary/i })
      // The matching row inside the sheet is marked, by `<Link>`'s own active
      // handling, and so is its row copy...
      const sheetRow = await within(sheetOf(nav)).findByRole('link', { name: _label })
      expect(sheetRow).toHaveAttribute('aria-current', 'page')
      const rowCopy = rowCopiesOf(nav).find((a) => a.getAttribute('href') === href)
      expect(rowCopy, `no row copy for ${href}`).toBeDefined()
      expect(rowCopy).toHaveAttribute('aria-current', 'page')
      // ...and the TAB that discloses it carries the active treatment, below lg.
      const triggerTokens = tokens(moreTrigger(nav))
      expect(triggerTokens, `the More tab is not marked active on ${href}`).toEqual(
        expect.arrayContaining(['max-lg:bg-green-50', 'max-lg:text-green-700'])
      )
      expect(triggerTokens, `the More tab is active at lg on ${href}`).not.toContain('bg-green-50')
    })

    it.each(PRIMARY_TABS)('is NOT active on %s (%s)', async (_label, href) => {
      renderWithRouter(<GlobalNav />, { path: href })
      const nav = await screen.findByRole('navigation', { name: /primary/i })
      await screen.findByRole('link', { name: _label })
      const triggerTokens = tokens(moreTrigger(nav))
      expect(triggerTokens, `the More tab is wrongly marked active on ${href}`).not.toContain(
        'bg-green-50'
      )
      expect(triggerTokens).not.toContain('max-lg:bg-green-50')
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
 * ⚠️ These counts are 6 and 7, and that does NOT contradict the "STAY 7"
 * warning at the top of this file. That warning is about jsdom not hiding what a
 * browser hides: the sheet anchors always resolve here, whether the panel is
 * open or not (story 59.2). This block asserts something different in kind — with
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
    // Five destinations, not six: the node is not rendered, rather than hidden
    // by CSS. Plus ONE promoted row copy (Balances): the Retirement row copy is
    // filtered with its sheet row (story 69.3). 5 + 1 = 6.
    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length - 1 + 1)
    expect(rowCopiesOf(nav).map((a) => a.textContent?.trim())).toEqual(['Balances'])
  })

  it('leaves the sheet holding exactly its other destination', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const lists = nav.querySelectorAll('ul')
    const sheet = [...lists][1]
    expect(
      [...sheet.querySelectorAll(':scope > li > a')].map((a) => a.textContent?.trim())
    ).toEqual(['Balances'])
  })

  it('drops exactly one icon and one label with the entry', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    // Six icons: four bar tabs, the More trigger, one sheet row. (Eight until
    // story 43.3 removed the Net Worth destination; seven until story 69.2
    // removed Settings.) Seven labels: those six + the Balances row copy, which
    // has a label and no icon (story 69.3).
    expect([...nav.querySelectorAll(ICON_SVG)]).toHaveLength(6)
    expect(nav.querySelectorAll('[data-nav-label]')).toHaveLength(7)
  })

  it('leaves the four bar tabs and the More trigger untouched', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const outer = [...nav.querySelectorAll('ul')][0]
    expect(
      [...outer.querySelectorAll(':scope > li:not([data-nav-promoted]) > a')].map((a) =>
        a.textContent?.trim()
      )
    ).toEqual(['Overview', 'Income', 'Expenses', 'Savings'])
    expect(nav.querySelectorAll('details > summary')).toHaveLength(1)
  })

  /**
   * AC-3 — the More trigger cannot claim a destination the sheet does not hold.
   *
   * ⚠️ This is the state the story made unrepresentable rather than guarded:
   * More's active state (`moreActiveClass`, `isMoreActive` until story 69.3) is
   * derived from the SAME filtered list the rows render from.
   * Computing it from the unfiltered constant would light the trigger here while
   * the sheet it discloses holds no Retirement row — an orientation cue pointing
   * at nothing.
   */
  it('does not mark the More trigger active on /retirement while hidden', async () => {
    hidePlanner()
    renderWithRouter(<GlobalNav />, { path: '/retirement' })
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    const summary = nav.querySelector('details > summary')
    expect(summary, 'the More <summary> is missing').not.toBeNull()
    expect(
      tokens(summary as HTMLElement),
      'the More tab claims a destination its sheet no longer holds'
    ).not.toContain('bg-green-50')
    expect(tokens(summary as HTMLElement)).not.toContain('max-lg:bg-green-50')
  })

  it('restores the entry when the preference is switched back on', async () => {
    hidePlanner()
    const { unmount } = renderWithRouter(<GlobalNav />)
    const hiddenNav = await screen.findByRole('navigation', { name: /primary/i })
    // ⚠️ Assert the BEFORE state too. Checking only the restored render would
    // pass identically on a component that never filters anything — the test
    // could not tell the feature from its absence.
    // 5 destinations + the Balances row copy (story 69.3).
    expect(within(hiddenNav).getAllByRole('link')).toHaveLength(SECTIONS.length - 1 + 1)
    unmount()

    usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
    renderWithRouter(<GlobalNav />)
    const nav = await screen.findByRole('navigation', { name: /primary/i })

    expect(within(sheetOf(nav)).getByRole('link', { name: /^retirement$/i })).toHaveAttribute(
      'href',
      '/retirement'
    )
    expect(rowCopiesOf(nav).map((a) => a.getAttribute('href'))).toEqual(['/balance', '/retirement'])
    expect(within(nav).getAllByRole('link')).toHaveLength(SECTIONS.length + PROMOTED_COPIES)
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
    // DOM order: the four tabs, the two promoted ROW copies (story 69.3), then
    // the sheet rows. The row copies MUST be tagged: the pre-paint rule hides
    // `[data-nav-path='/retirement']`, and an untagged row copy would paint a
    // hidden planner at lg on the first frame (AC-5).
    expect(tagged).toEqual([
      '/',
      '/income',
      '/expenses',
      '/savings',
      '/balance',
      '/retirement',
      '/balance',
      '/retirement',
    ])
  })
})

/**
 * Story 58.1 (FR87) — the nav is tier-aware.
 *
 * A paid session gets four extra sheet destinations; every other session gets
 * exactly the nav it got before this story. The tier comes from the SSR session
 * seed, read ONCE as a `useState` initializer (`session-seed.tsx:14-16`), so the
 * first painted frame is already correct — the same mechanism `usePremiumAccess`
 * uses, and the reason this could not be built on `usePremiumAccess` itself,
 * whose no-seed path fires a client round-trip and would flash 7 items then 11.
 *
 * ⚠️ These counts (11 / 7) do not contradict the "STAY 7" warning at the top of
 * this file. That warning is about REACHABILITY: jsdom does not hide a closed
 * `<details>` (story 59.2), so every anchor resolves whether or not a real
 * browser would let a user reach it. This block varies TIER, which changes what
 * is rendered at all, at every width.
 *
 * ⚠️ Geometry is NOT asserted here and cannot be: jsdom loads no Tailwind and
 * computes no layout. The 11-anchor desktop row and 7-row sheet are measured for
 * real in `e2e/nav-tier-aware.paid.spec.ts`, against a server booted with a paid
 * seed. Neither half proves the other: this file proves the nav RENDERS the
 * destinations, that spec proves the CSS SURVIVES them.
 */
describe('GlobalNav — tier-aware destinations (story 58.1, FR87)', () => {
  const seedWith = (overrides: Partial<SessionSeed> = {}): SessionSeed => ({
    isAuthenticated: true,
    userId: 'u1',
    email: 'u1@example.test',
    subscriptionStatus: 'active',
    ...overrides,
  })

  const renderWithSeed = (seed: SessionSeed | null, path = '/') =>
    renderWithRouter(
      <SessionSeedProvider seed={seed}>
        <GlobalNav />
      </SessionSeedProvider>,
      { path }
    )

  const nav = () => screen.findByRole('navigation', { name: /primary/i })

  const sheetLabels = (navEl: HTMLElement): (string | undefined)[] => {
    const lists = [...navEl.querySelectorAll('ul')]
    const sheet = lists[1]
    return [...sheet.querySelectorAll(':scope > li > a')].map((a) => a.textContent?.trim())
  }

  /** The four destinations this story adds, with the labels D1 settled on. */
  const PREMIUM: readonly [label: string, href: string][] = [
    ['Forecasting', '/forecasting'],
    ['Profiles', '/profiles'],
    ['Report', '/report'],
    ['Categories', '/categories'],
  ]

  const FREE_SHEET = ['Balances', 'Retirement']
  const PAID_SHEET = ['Balances', 'Retirement', 'Forecasting', 'Profiles', 'Report', 'Categories']

  describe('an entitled session', () => {
    // Twelve DOM anchors: ten destinations + the two promoted row copies
    // (story 69.3). The premium rows have no row copy: they stay behind More.
    it('renders ten destinations as twelve anchors', async () => {
      renderWithSeed(seedWith())
      const navEl = await nav()
      expect(within(navEl).getAllByRole('link')).toHaveLength(12)
      expect(rowCopiesOf(navEl).map((a) => a.textContent?.trim())).toEqual([
        'Balances',
        'Retirement',
      ])
    })

    // Story 58.1's D3 spliced these in BEFORE Settings so it stayed last. Story
    // 69.2 took Settings out of the nav, so the premium block now simply follows
    // the free rows. The ORDER is still the assertion, not the count.
    it('appends the four premium rows after the free rows, in order', async () => {
      renderWithSeed(seedWith())
      const navEl = await nav()
      expect(sheetLabels(navEl)).toEqual(PAID_SHEET)
      // Story 69.3: an entitled session keeps its More at lg (the premium four
      // are behind it at every width), so its cell is NOT `lg:hidden`.
      const cell = navEl.querySelector('details')?.parentElement as HTMLElement
      expect(tokens(cell)).not.toContain('lg:hidden')
    })

    it.each(PREMIUM)('links %s to %s', async (label, href) => {
      renderWithSeed(seedWith())
      const link = within(await nav()).getByRole('link', { name: label, exact: true })
      expect(link).toHaveAttribute('href', href)
    })

    it('treats a lifetime purchase as entitled too', async () => {
      renderWithSeed(seedWith({ subscriptionStatus: 'lifetime' }))
      expect(within(await nav()).getAllByRole('link')).toHaveLength(12)
    })

    it('tags every new <li> with its route for the pre-paint CSS hook', async () => {
      renderWithSeed(seedWith())
      const tagged = [...(await nav()).querySelectorAll('li[data-nav-path]')].map((li) =>
        li.getAttribute('data-nav-path')
      )
      // The tabs, the two promoted row copies (story 69.3), then the sheet.
      expect(tagged).toEqual([
        '/',
        '/income',
        '/expenses',
        '/savings',
        '/balance',
        '/retirement',
        '/balance',
        '/retirement',
        '/forecasting',
        '/profiles',
        '/report',
        '/categories',
      ])
    })

    it('scopes every new icon to mobile with `sm:hidden`', async () => {
      renderWithSeed(seedWith())
      const navEl = await nav()
      const icons = [...navEl.querySelectorAll(ICON_SVG)]
      // Eleven: 4 bar tabs + More + 6 sheet rows (twelve until story 69.2 took
      // Settings out). Without `sm:hidden` each new icon grows the DESKTOP nav,
      // and nothing else in the suite would catch it.
      expect(icons).toHaveLength(11)
      for (const icon of icons) {
        expect(tokens(icon), 'a premium icon is missing `sm:hidden`').toContain('sm:hidden')
        expect(icon).toHaveAttribute('aria-hidden', 'true')
      }
      // Thirteen labels: the eleven above + the two promoted row copies, which
      // have no icon (story 69.3).
      expect(navEl.querySelectorAll('[data-nav-label]')).toHaveLength(13)
    })

    it.each(PREMIUM)('marks the More trigger active on %s', async (label, href) => {
      renderWithSeed(seedWith(), href)
      const navEl = await nav()
      // Both halves: the row itself is current, AND the tab that discloses it
      // shows it. `moreActiveClass` reading a different list from the rendered rows
      // is the specific regression this catches.
      expect(within(navEl).getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'aria-current',
        'page'
      )
      const summary = navEl.querySelector('details > summary')
      expect(summary, 'the More <summary> is missing').not.toBeNull()
      expect(tokens(summary as HTMLElement)).toContain('bg-green-50')
    })
  })

  describe('every non-entitled session is unchanged from before this story', () => {
    const NOT_ENTITLED: readonly [name: string, seed: SessionSeed | null][] = [
      ['a free subscriber', seedWith({ subscriptionStatus: 'free' })],
      ['a past_due subscriber', seedWith({ subscriptionStatus: 'past_due' })],
      ['a canceled subscriber', seedWith({ subscriptionStatus: 'canceled' })],
      ['a null subscription status', seedWith({ subscriptionStatus: null })],
      [
        'a signed-out session',
        { isAuthenticated: false, userId: null, email: null, subscriptionStatus: null },
      ],
      // The resolver-errored case. A null seed is UNVERIFIED, never entitled —
      // fail closed, or a transient blip hands out the paid nav.
      ['no seed at all (resolver errored)', null],
      // Fail-closed by construction, not by luck of what the resolver emits: a
      // malformed seed claiming `active` while not authenticated must not pass.
      [
        'an unauthenticated seed claiming active',
        { isAuthenticated: false, userId: null, email: null, subscriptionStatus: 'active' },
      ],
    ]

    // Six destinations, eight DOM anchors (the two promoted row copies, story
    // 69.3).
    it.each(NOT_ENTITLED)(
      'gives %s the unchanged six-destination free nav',
      async (_name, seed) => {
        renderWithSeed(seed)
        const navEl = await nav()
        expect(within(navEl).getAllByRole('link')).toHaveLength(8)
        expect(sheetLabels(navEl)).toEqual(FREE_SHEET)
        // Story 69.3: with nothing left behind More at lg, a free session's More
        // cell is `lg:hidden`. Token-level; e2e proves the render.
        const cell = navEl.querySelector('details')?.parentElement as HTMLElement
        expect(tokens(cell), 'a free session keeps a More trigger at lg').toContain('lg:hidden')
      }
    )

    it.each(NOT_ENTITLED)('shows %s no premium destination', async (_name, seed) => {
      renderWithSeed(seed)
      const navEl = await nav()
      // Absence per destination, not just a count: a count stays 6 if one
      // premium row leaked in while an existing one dropped out.
      for (const [, href] of PREMIUM) {
        expect(navEl.querySelector(`a[href="${href}"]`), `${href} leaked into the free nav`).toBe(
          null
        )
      }
    })
  })

  describe('tier and the Retirement preference are independent filters', () => {
    afterEach(() => {
      usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
    })

    // The product case neither the tier tests nor the story 35.2 block covers:
    // both conditions act on ONE list, so testing each alone leaves the
    // combination untested.
    it('gives an entitled session with the planner hidden nine anchors and five rows', async () => {
      usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
      renderWithSeed(seedWith())
      const navEl = await nav()

      // Nine destinations + the Balances row copy (story 69.3) = ten anchors.
      expect(within(navEl).getAllByRole('link')).toHaveLength(10)
      expect(sheetLabels(navEl)).toEqual([
        'Balances',
        'Forecasting',
        'Profiles',
        'Report',
        'Categories',
      ])
    })

    it('does not mark the More trigger active on /retirement while it is hidden', async () => {
      usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
      renderWithSeed(seedWith(), '/retirement')
      const summary = (await nav()).querySelector('details > summary')
      expect(summary, 'the More <summary> is missing').not.toBeNull()
      expect(tokens(summary as HTMLElement)).not.toContain('bg-green-50')
      expect(tokens(summary as HTMLElement)).not.toContain('max-lg:bg-green-50')
    })
  })

  it('never adds Multi-device sync, in either tier (AC-7)', async () => {
    for (const seed of [seedWith(), null]) {
      const { unmount } = renderWithSeed(seed)
      const navEl = await nav()
      expect(within(navEl).queryByRole('link', { name: /sync/i })).not.toBeInTheDocument()
      unmount()
    }
  })
})

/**
 * Story 59.2 (FR90) — the More disclosure exists at EVERY width, as a native
 * `<details>`/`<summary>`.
 *
 * ⚠️ How the trigger is found, and why not by role. `@testing-library/dom`
 * resolves implicit roles through aria-query 5.3.0, which has NO entry for
 * `summary`, so `getByRole('button')` finds nothing and `getAllByRole('button')`
 * THROWS. (dom-accessibility-api does map `summary` to `button`, but `getByRole`
 * never consults it; `toHaveAccessibleName` does, which is why that matcher still
 * works on the element.) Everything here locates `details > summary`, and it
 * asserts the element is non-null FIRST, so a `.not.toContain` can never pass
 * against a missing node.
 *
 * ⚠️ jsdom does NOT hide the content of a closed `<details>` from `getByRole`
 * (its default stylesheet has no closed-details rule). jest-dom's `toBeVisible()`
 * DOES respect `details[open]`, so it is the one matcher here that can tell open
 * from closed.
 *
 * ⚠️ WHO toggles `open` in these tests: React, not jsdom. jsdom does implement
 * the native summary activation (a click on the first `<summary>` flips `open`
 * synchronously, and `toggle` fires as a later task). But the component's
 * `onClick` calls `preventDefault()`, which cancels that activation, and toggles
 * its own state instead, and the `open` flip comes from React's re-render. The
 * native path is exercised directly by "adopts an open it did not cause" below,
 * which sets `.open` from script.
 */
// "At every width" since story 59.2 for an ENTITLED session; below `lg` only
// for a free one since story 69.3 (which has no More at `lg`). jsdom applies no
// media queries, so these tests see the disclosure regardless.
describe('GlobalNav — the More disclosure at every width (story 59.2)', () => {
  const parts = async () => {
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const details = nav.querySelector('details')
    const summary = nav.querySelector('details > summary')
    const panel = nav.querySelector('details > ul')
    expect(details, 'the More disclosure is not a <details>').not.toBeNull()
    expect(summary, 'the <details> has no <summary> trigger').not.toBeNull()
    expect(panel, 'the panel list is not inside the <details>').not.toBeNull()
    return {
      nav,
      details: details as HTMLDetailsElement,
      summary: summary as HTMLElement,
      panel: panel as HTMLElement,
    }
  }

  it('is a native disclosure in the fifth cell, closed on the first render', async () => {
    renderWithRouter(<GlobalNav />)
    const { nav, details, summary, panel } = await parts()

    const outer = nav.querySelector('ul') as HTMLElement
    // The fifth cell of the RENDERED bar below lg. The promoted row copies
    // (story 69.3) sit between Savings and More in the DOM but are `hidden`
    // below lg, so they are excluded here, as a browser excludes them.
    const fifth = outer.querySelectorAll(':scope > li:not([data-nav-promoted])')[4]
    expect(fifth?.firstElementChild, 'the <details> is not the fifth cell').toBe(details)
    expect(details.firstElementChild, 'the <summary> must be the first child').toBe(summary)
    expect(summary).toHaveAccessibleName('More')
    // Closed on the first render, so the server and client agree.
    expect(details.open).toBe(false)
    expect(details).not.toHaveAttribute('open')
    // Closed MEANS hidden now, wherever the disclosure renders — by design.
    expect(within(panel).getByRole('link', { name: /^balances$/i })).not.toBeVisible()
  })

  it('carries no hand-rolled ARIA — the platform supplies the expanded state', async () => {
    renderWithRouter(<GlobalNav />)
    const { summary, panel } = await parts()
    for (const attr of ['role', 'aria-expanded', 'aria-controls', 'aria-haspopup', 'type']) {
      expect(summary, `the summary carries a hand-rolled ${attr}`).not.toHaveAttribute(attr)
    }
    expect(panel).not.toHaveAttribute('role')
    expect(panel).not.toHaveAttribute('aria-modal')
    // No `<button>` survives in the nav: the trigger IS the summary.
    expect(
      within(screen.getByRole('navigation', { name: /primary/i })).queryAllByRole('button')
    ).toHaveLength(0)
  })

  it('no longer dissolves into the desktop row, and overlays instead', async () => {
    renderWithRouter(<GlobalNav />)
    const { details, summary, panel } = await parts()
    const cell = details.parentElement as HTMLElement

    expect(tokens(cell), 'the fifth cell still dissolves at >= 640px').not.toContain('sm:contents')
    expect(tokens(panel), 'the panel still dissolves at >= 640px').not.toContain('sm:contents')
    expect(tokens(summary), 'the trigger is still hidden at >= 640px').not.toContain('sm:hidden')
    // The desktop overlay's containing block is the CELL, and only at >= 640px:
    // below `sm` the panel must keep resolving against the `max-sm:fixed` nav.
    expect(tokens(cell)).toContain('sm:relative')
    expect(tokens(cell)).not.toContain('relative')
    expect(tokens(panel)).toEqual(
      expect.arrayContaining([
        'sm:absolute',
        'sm:top-full',
        'sm:left-0',
        'sm:bg-white',
        'dark:sm:bg-gray-800',
        'sm:border',
        'sm:shadow-lg',
        'sm:overflow-y-auto',
      ])
    )
    // Never positioned unprefixed: that would change the mobile sheet too.
    for (const leaked of ['absolute', 'fixed', 'top-full', 'bg-white']) {
      expect(tokens(panel), `\`${leaked}\` is unprefixed on the panel`).not.toContain(leaked)
    }
    // WebKit's disclosure marker is hidden. `list-none` is inert today (the
    // summary is never `display: list-item`) and is pinned as a guard for a
    // future display change. See the MORE_TRIGGER_CLASS docblock.
    expect(tokens(summary)).toEqual(
      expect.arrayContaining(['list-none', '[&::-webkit-details-marker]:hidden'])
    )
    // Story 59.2 code review: the nav keeps its content width on the desktop
    // row, so a signed-in account cluster yields instead of wrapping the row.
    const nav = screen.getByRole('navigation', { name: /primary/i })
    expect(tokens(nav), 'the nav can shrink — a signed-in cluster will wrap it').toContain(
      'sm:shrink-0'
    )
    expect(tokens(nav), '`shrink-0` must stay desktop-only').not.toContain('shrink-0')
  })

  it('keeps the mobile sheet half of the panel exactly as it was', async () => {
    renderWithRouter(<GlobalNav />)
    const { panel } = await parts()
    const mobile = tokens(panel).filter(
      (t) => t.startsWith('max-sm:') || t.startsWith('dark:max-sm:')
    )
    expect(mobile).toEqual([
      'max-sm:absolute',
      'max-sm:inset-x-0',
      'max-sm:bottom-full',
      'max-sm:max-h-[calc(100svh-5rem)]',
      'max-sm:overflow-y-auto',
      'max-sm:overscroll-contain',
      'max-sm:border-t',
      'max-sm:border-gray-200',
      'max-sm:bg-white',
      'max-sm:py-1',
      'dark:max-sm:border-gray-700',
      'dark:max-sm:bg-gray-800',
    ])
  })

  it('opens on a summary click and closes on Escape, returning focus to the trigger', async () => {
    renderWithRouter(<GlobalNav />)
    const { details, summary, panel } = await parts()

    fireEvent.click(summary)
    expect(details.open).toBe(true)
    await waitFor(() =>
      expect(within(panel).getByRole('link', { name: /^balances$/i })).toBeVisible()
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(details.open).toBe(false))
    expect(summary).toHaveFocus()
  })

  it('adopts an open it did not cause, so Escape still closes it', async () => {
    // The native paths React does not drive: find-in-page, script, or a
    // pre-hydration toggle whose event lands late. Only `onToggle` keeps state
    // honest there. Without it the listeners stay unarmed and Escape is dead.
    renderWithRouter(<GlobalNav />)
    const { details } = await parts()
    details.open = true
    await waitFor(() =>
      expect(within(details).getByRole('link', { name: /^balances$/i })).toBeVisible()
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(details.open, 'Escape did not close a script-opened panel').toBe(false)
    )
  })

  it('closes when the CURRENT bar tab is clicked', async () => {
    // Same-route click: no pathname change, and the press is inside the nav, so
    // only the tab's own handler can close it (story 59.2 code review).
    renderWithRouter(<GlobalNav />, { path: '/income' })
    const { nav, details, summary } = await parts()
    fireEvent.click(summary)
    await waitFor(() => expect(details.open).toBe(true))
    fireEvent.click(within(nav).getByRole('link', { name: /^income$/i }))
    await waitFor(() =>
      expect(details.open, 'the panel survived a same-route tab click').toBe(false)
    )
  })

  it('Escape does not steal focus from page content outside the nav', async () => {
    renderWithRouter(
      <>
        <GlobalNav />
        <button type="button">Page action</button>
      </>
    )
    const { details, summary } = await parts()
    fireEvent.click(summary)
    await waitFor(() => expect(details.open).toBe(true))
    const pageButton = screen.getByRole('button', { name: 'Page action' })
    pageButton.focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(details.open).toBe(false))
    expect(pageButton, 'Escape yanked focus from page content to the trigger').toHaveFocus()
  })

  it('closes when a row is chosen', async () => {
    renderWithRouter(<GlobalNav />)
    const { details, summary, panel } = await parts()
    fireEvent.click(summary)
    await waitFor(() =>
      expect(within(panel).getByRole('link', { name: /^balances$/i })).toBeVisible()
    )
    fireEvent.click(within(panel).getByRole('link', { name: /^balances$/i }))
    await waitFor(() => expect(details.open).toBe(false))
  })
})
