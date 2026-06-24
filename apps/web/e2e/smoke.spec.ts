import { test, expect } from '@playwright/test'

/**
 * Smoke E2E test — verifies the app boots and serves a document.
 *
 * This is intentionally minimal scaffolding to prove the Playwright pipeline
 * works end to end. Expand with real user-flow coverage (auth, CRUD, sync) as
 * features stabilise.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */
test('app serves the home page', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.ok()).toBeTruthy()
  // The document renders a body element (sanity check the app mounted).
  await expect(page.locator('body')).toBeVisible()
})
