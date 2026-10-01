import { expect, test } from '@playwright/test'

/**
 * Theme E2E (story 7-3 → rewritten by story 61.1, FR93).
 *
 * The app's theme now follows the device's `prefers-color-scheme` and there is
 * no in-app control that can disagree with it. `tailwind.config.js` is
 * `darkMode: 'media'`, so this is pure CSS — no store, no provider, no `<head>`
 * bootstrap, no `.dark` class anywhere.
 *
 * These drive the REAL browser path, the surface that SSR-HTML smoke and
 * mocked-only unit tests miss (project memory, 4-11):
 *   - first paint matches the device on a cold load, and on a client-side nav;
 *   - a LIVE change of the device preference is followed without a reload;
 *   - the deleted toggle has not come back.
 *
 * ⚠️ Every assertion here reads a PAINTED CONSEQUENCE (the canvas colour), never
 * the lever. `page.emulateMedia({ colorScheme })` is now the app's real input, so
 * an assertion that re-reads the emulated value could not fail — which is exactly
 * how the dark half of `nav-planner-visibility.spec.ts` was once proven by
 * nothing. `body` is `bg-gray-50` light / `bg-gray-900` dark (`styles/global.css`).
 */

const CANVAS_LIGHT = 'rgb(249, 250, 251)' // gray-50
const CANVAS_DARK = 'rgb(17, 24, 39)' // gray-900

const bodyBackground = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test('a LIVE change of the device preference is followed without a reload (AC-7)', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect.poll(() => bodyBackground(page)).toBe(CANVAS_LIGHT)

  // No reload, no navigation — the OS preference simply changes under the open
  // page, which is what a user flipping their system theme does.
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => bodyBackground(page)).toBe(CANVAS_DARK)

  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => bodyBackground(page)).toBe(CANVAS_LIGHT)
})

test('the Settings page no longer offers a dark-mode control (AC-2)', async ({ page }) => {
  await page.goto('/settings')

  // ⚠️ POSITIVE CONTROL FIRST. A bare absence probe is a silent green: if this
  // route failed to render, `toHaveCount(0)` would pass and report success.
  // Assert that the Display section IS here and its surviving sibling control
  // renders before concluding anything is absent.
  await expect(page.getByRole('heading', { name: 'Display' })).toBeVisible()
  await expect(page.getByRole('switch', { name: /currency symbols/i })).toBeVisible()

  // Now the absence is meaningful.
  //
  // ⚠️ SCOPE, stated because an earlier version of this comment overclaimed. This
  // proves no control is LABELLED "dark mode"; it does NOT catch a control renamed
  // to "Appearance" or "Theme" (a text probe using the same /dark mode/i regex
  // would miss it too — the previous comment claimed the opposite). The real guard
  // against a reintroduced control is that `settings/theme-toggle.tsx` is deleted
  // and nothing imports it.
  //
  // Counted over SWITCHES only, not all text: AC-2 forbids a control, not the word.
  // A future "Dark mode follows your device" hint on this page is legitimate copy
  // and must not turn this red — which a `getByText(/dark mode/i)` probe would.
  await expect(page.getByRole('switch', { name: /dark mode/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /dark mode/i })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /dark mode/i })).toHaveCount(0)
})
