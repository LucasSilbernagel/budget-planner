import { expect, test } from '@playwright/test'

/**
 * Premium dark-mode E2E (story 7-3, FR23).
 *
 * These drive the REAL hydration path (not a mocked hook), the exact surface
 * that SSR-HTML smoke and mocked-only unit tests miss (project memory, 4-11):
 *   - the no-flash guarantee (AC-4): the blocking <head> script applies `.dark`
 *     to <html> synchronously, before hydration and before the async premium
 *     check runs, so a persisted dark preference paints on the first frame.
 *   - the locked free-tier affordance (AC-3): a first-time (unauthenticated)
 *     visitor sees the dark-mode toggle locked + discoverable, activating it
 *     opens the upgrade prompt, and the app stays light.
 */

const THEME_KEY = 'budget-planner-theme-prefs-v1'

test('AC-4: a persisted dark theme is applied before hydration (no flash of light)', async ({
  page,
}) => {
  // Seed the persisted preference and capture <html>'s class exactly at
  // DOMContentLoaded — after the blocking <head> script has run but before the
  // async client-side premium check can resolve (and possibly correct a free
  // user back to light). This pins the first-paint state deterministically.
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

test('AC-3: a free visitor sees the dark-mode toggle locked and the app stays light', async ({
  page,
}) => {
  // The dark-mode toggle now lives on the consolidated settings surface
  // (story 11-6), relocated from the global footer.
  await page.goto('/settings')

  // The settings toggle resolves to the locked control for a free/unauthenticated
  // user (after the in-flight tier check's neutral skeleton).
  const lockedToggle = page.getByRole('button', { name: /dark mode — premium, locked/i })
  await expect(lockedToggle).toBeVisible()

  // The lock badge is discoverable within the toggle (FR24 — not hidden).
  await expect(lockedToggle.getByText('Premium', { exact: true })).toBeVisible()

  // Activating it opens the upgrade prompt rather than switching the theme.
  await lockedToggle.click()
  await expect(page.getByRole('heading', { name: /go premium/i })).toBeVisible()

  // The app stays light for free users (AC-3): no dark class on <html>.
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

// NOTE (code review 2026-07-03): the DECISION-3 *correction* of a stale persisted
// `dark` for an authoritatively-resolved not-premium user (force light + clear the
// stored value) is intentionally NOT e2e'd here. It only fires when the tier check
// resolves cleanly (`error === null`), but the premium-access server function does
// not resolve in the Playwright preview runtime (`Buffer is not defined`), so every
// check errors — and under the reviewed fail-safe rule an *unverifiable* check
// preserves the preference rather than wiping it (so a transient error can't
// silently downgrade a paid user). Both branches are unit-covered in
// components/theme/__tests__/ThemeProvider.test.tsx (authoritative not-premium →
// light+clear; errored check → dark preserved). A real correction e2e is blocked by
// the same missing paid/authenticated-session harness noted for 5-15 AC-4 / 5-6.
