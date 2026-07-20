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
  '/income',
  '/expenses',
  '/savings',
  '/balance',
  '/net-worth-projection',
  '/retirement',
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
