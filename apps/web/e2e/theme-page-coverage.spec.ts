import { expect, test } from '@playwright/test'

/**
 * Story 11-2: dark-mode coverage across the page bodies 7-3 deferred.
 *
 * Asserts the REAL rendered surfaces (computed background-color, not class
 * strings) darken on every live page — the "white card floating on a dark
 * canvas" bug this story closes, which mocked unit tests and SSR-HTML smoke both
 * miss (project memory, 4-11).
 *
 * Verified by emulating a dark DEVICE preference (story 61.1, FR93: the app is
 * `darkMode: 'media'`, so `prefers-color-scheme` is its only theme input). Before
 * 61.1 this forced a `.dark` class onto `<html>` after hydration and had to fight
 * `ThemeProvider`'s mount effect for it; both the class and the provider are gone.
 *
 * This file asserts COMPUTED COLOURS on real pages, which is what makes it able
 * to see a theme regression at all.
 *
 * ⚠️ WHAT IT DOES **NOT** COVER, measured rather than assumed. `styles/global.css`
 * styles the page canvas (<body>) with a hand-written rule, not a `dark:` utility,
 * and that rule had to be converted by hand when story 61.1 moved
 * `tailwind.config.js` to `darkMode: 'media'`. Reverting that conversion leaves
 * THIS FILE ENTIRELY GREEN: the `.surface-sunken` and `.surface` selectors below
 * are `dark:` utilities, so they recompile to the media query automatically and
 * darken no matter what the <body> rule does. Verified by mutation — 15/15 here
 * passed while `theme-dark-mode.spec.ts` went red on three cases.
 *
 * So: the canvas guard is `e2e/theme-dark-mode.spec.ts`; this file guards the
 * SURFACES. An earlier version of this comment claimed the opposite, which would
 * have pointed the next reader at a test that cannot fail for that reason.
 *
 * Dark mode is free for every user (story 25-3), so no tier check ever touches
 * the theme; this tests the CSS/theming in isolation.
 */

// The palette the global.css tokens compile to under a dark device preference.
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
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(path)

    await expect(page.locator('.surface-sunken').first()).toBeVisible()

    // The page canvas is the dark gray-900, not the light gray-50 it is by day.
    await expect(page.locator('.surface-sunken').first()).toHaveCSS('background-color', CANVAS_DARK)

    // The first card surface renders dark gray-800 — never a white card bleeding
    // through on the dark canvas.
    await expect(page.locator('.surface').first()).toHaveCSS('background-color', CARD_DARK)
  })
}
