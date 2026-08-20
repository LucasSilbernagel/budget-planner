import { expect, test } from '@playwright/test'

/**
 * Story 11-2: dark-mode coverage across the page bodies 7-3 deferred.
 *
 * Asserts the REAL rendered surfaces (computed background-color, not class
 * strings) darken on every live page — the "white card floating on a dark
 * canvas" bug this story closes, which mocked unit tests and SSR-HTML smoke both
 * miss (project memory, 4-11).
 *
 * Verified by forcing the `.dark` class onto `<html>` after hydration (the "seed
 * the `.dark` class" approach the story's Testing standards prescribe). The theme
 * store is left at its 'light' default, so `ThemeProvider`'s mount effect applies
 * 'light' exactly once and then nothing changes the store — once our `.dark` class
 * is applied nothing strips it. Dark mode is free for every user (story 25-3), so
 * no tier check ever touches the theme; this tests the CSS/theming in isolation.
 */

// The palette the global.css tokens compile to under `.dark`.
const CANVAS_DARK = 'rgb(17, 24, 39)' // gray-900 — .surface-sunken page canvas
const CARD_DARK = 'rgb(31, 41, 55)' // gray-800 — .surface card

const PAGES = [
  // Bonus coverage only (story 30-1): this sweep asserts `.surface-sunken` and
  // `.surface`, which on `/` are the page shell and a section wrapper — NOT the
  // premium boxes 30-1 restyled. The box-scoped proof lives in
  // `premium-locked.spec.ts`; do not treat a green run here as covering them.
  '/',
  '/income',
  '/expenses',
  '/savings',
  '/balance',
  '/net-worth-projection',
  '/retirement',

  // Story 31-1 (UX-DR35): the commercial/legal/docs/sign-in set, which had
  // drifted light-only. They are coverable here because they were converted to
  // the `.surface`/`.surface-sunken` tokens the selectors below name literally.
  //
  // ⚠️ Be precise about what that buys, because an earlier version of this
  // comment had it backwards. A fully hand-rolled page added here does NOT pass
  // silently — `expect(locator.first()).toBeVisible()` on a locator matching
  // zero elements FAILS after timeout, and a page with a tokenised canvas but
  // hand-rolled cards fails on the `.surface` assertion. The real blind spot is
  // per-ELEMENT: only the FIRST match of each selector is asserted, so any
  // additional hand-rolled panel on an otherwise-covered page is untested here.
  // In this story that means the sidebar active pill, the plan-card ring and
  // CTAs, and `/login`'s `.surface-inset` notice — whose dark value is
  // translucent (`gray-700/40`) and so could never match an exact-rgb equality
  // anyway. Those need the unit class-token sweeps; this file is necessary but
  // not sufficient. (Code review 2026-08-10.)
  '/docs',
  '/docs/getting-started',
  // Story 32.3 — same docs detail layout, but it is the only page whose body
  // renders a fenced code block, which `prose`/`dark:prose-invert` themes
  // separately from ordinary paragraph text.
  '/docs/how-totals-are-calculated',
  // Story 36.3 — same docs detail layout, no fenced block.
  // ⚠️ This list is HAND-MAINTAINED and nothing derives it from `DOC_PAGES`, so
  // the next doc page added will silently have no dark-mode coverage here until
  // someone remembers this file. Stated rather than implied — an earlier version
  // of this comment claimed the set "stays complete as pages are added", which
  // is precisely what it does not do (review 36.3).
  '/docs/where-a-mortgage-belongs',
  '/login',
  '/pricing',
  '/terms',
  '/privacy',
  '/refund',
]

for (const path of PAGES) {
  test(`${path} renders dark surfaces (no white-card-on-dark)`, async ({ page }) => {
    await page.goto(path)

    // Wait for the page body, then force `.dark` and hold it until the canvas is
    // actually dark. Re-applying inside waitForFunction defeats the one-shot race
    // with ThemeProvider's mount effect (which applies the store's 'light' default
    // exactly once); after that the store never changes, so the class sticks.
    await expect(page.locator('.surface-sunken').first()).toBeVisible()
    await page.waitForFunction((canvasDark) => {
      document.documentElement.classList.add('dark')
      const canvas = document.querySelector('.surface-sunken')
      return !!canvas && getComputedStyle(canvas).backgroundColor === canvasDark
    }, CANVAS_DARK)

    // The page canvas is the dark gray-900, not the light gray-50 it is by day.
    await expect(page.locator('.surface-sunken').first()).toHaveCSS('background-color', CANVAS_DARK)

    // The first card surface renders dark gray-800 — never a white card bleeding
    // through on the dark canvas.
    await expect(page.locator('.surface').first()).toHaveCSS('background-color', CARD_DARK)
  })
}
