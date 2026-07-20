import { expect, test } from '@playwright/test'

/**
 * Dark-mode E2E (story 7-3; dark mode moved to the Free tier in story 25-3).
 *
 * These drive the REAL hydration path (not a mocked hook), the exact surface
 * that SSR-HTML smoke and mocked-only unit tests miss (project memory, 4-11):
 *   - the no-flash guarantee: the blocking <head> script applies `.dark` to
 *     <html> synchronously, before hydration, so a persisted dark preference
 *     paints on the first frame.
 *   - dark mode as a free feature (25-3 AC-1/AC-2): a first-time (unauthenticated)
 *     visitor gets a live toggle, can switch to dark, and the choice persists
 *     across reload with no tier check reverting it to light.
 */

const THEME_KEY = 'budget-planner-theme-prefs-v1'

test('no-flash: a persisted dark theme is applied before hydration (no flash of light)', async ({
  page,
}) => {
  // Seed the persisted preference and capture <html>'s class exactly at
  // DOMContentLoaded — after the blocking <head> script has run but before
  // hydration. This pins the first-paint state deterministically.
  await page.addInitScript(
    ([key]) => {
      window.localStorage.setItem(key, JSON.stringify({ state: { theme: 'dark' }, version: 0 }))
      document.addEventListener('DOMContentLoaded', () => {
        ;(window as unknown as { __htmlClassAtDCL?: string }).__htmlClassAtDCL =
          document.documentElement.className
      })
    },
    [THEME_KEY]
  )

  await page.goto('/')

  const classAtFirstPaint = await page.evaluate(
    () => (window as unknown as { __htmlClassAtDCL?: string }).__htmlClassAtDCL ?? ''
  )
  expect(classAtFirstPaint).toContain('dark')
})

test('25-3 AC-1/AC-2: a free visitor can toggle dark mode and it persists across reload', async ({
  page,
}) => {
  // The dark-mode toggle lives on the consolidated settings surface (story 11-6).
  await page.goto('/settings')

  // Dark mode is free for everyone (25-3): the surface exposes a LIVE switch, not
  // a locked premium affordance — and there is no upgrade prompt.
  const toggle = page.getByRole('switch', { name: /dark mode/i })
  await expect(toggle).toBeVisible()
  await expect(page.getByRole('heading', { name: /go premium/i })).toHaveCount(0)

  // Starts light.
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  // Toggling applies dark to <html>. The switch may paint in SSR HTML before React
  // wires its onClick, so retry until the theme flips (Playwright's recommended way
  // to act on a possibly-unhydrated control); only click while still light so the
  // action stays idempotent toward dark.
  await expect(async () => {
    const isDark = ((await page.locator('html').getAttribute('class')) ?? '').includes('dark')
    if (!isDark) await toggle.click()
    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 1000 })
  }).toPass()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // The choice persists across a reload with NO fail-safe reverting it to light
  // (the removed story 7-3 premium correction). The no-flash <head> script paints
  // dark on the first frame for this free/unauthenticated user.
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('switch', { name: /dark mode/i })).toHaveAttribute(
    'aria-checked',
    'true'
  )
})
