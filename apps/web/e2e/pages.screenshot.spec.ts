import { type Page, expect, test } from '@playwright/test'
import { MORE_PANEL, MORE_SUMMARY } from './helpers/nav-more'
import { FIXED_NOW, SHOT_TIMEOUT, chartsDrawn, copyrightYear } from './helpers/screenshot'
import { seedFinanceRows } from './helpers/seed-finance-rows'

/**
 * Screenshots of the key pages, FREE tier (story 84.1, FR137).
 *
 * These replace the layout-tagged measurement tests (story 84.2 deletes them): a
 * layout break at 320, 768 or 1280 px, or a dark surface left light, changes the
 * picture. The paid pages are in `nav.screenshot.paid.spec.ts`.
 *
 * ## ⚠️ Baselines are made in CI, never on a dev box
 *
 * CI resolves `system-ui` to DejaVu Sans, a dev box to Noto Sans, so a baseline
 * rendered locally fails in CI and the other way round. The committed PNGs in
 * `e2e/__screenshots__/` come ONLY from `.github/workflows/screenshots.yml`:
 *
 *   gh workflow run screenshots.yml --ref <branch> -f mode=update
 *   gh run download <run-id> -n screenshot-baselines -D apps/web/e2e/__screenshots__
 *
 * Re-run it after any deliberate visual change, a Playwright upgrade or a
 * runner image change, then look at every changed PNG before committing it.
 * `pnpm gates` does not run this project; CI runs it on every push.
 *
 * Determinism: fixed clock (the seed's own date, so the footer year is fixed),
 * `seedFinanceRows` (including its 138-character unbroken name, the fixture
 * the 320 px guards used), explicit light/dark via `emulateMedia`, and
 * `toHaveScreenshot`'s own wait for two identical frames, which is what lets
 * the Recharts JS animations settle (`animations: 'disabled'` only stops CSS).
 */

interface Shot {
  name: string
  path: string
  width: number
  dark?: boolean
  /** How many Recharts charts the page draws (see `chartsDrawn`). */
  charts: number
}

const PAGE_SHOTS: Shot[] = [
  { name: 'overview-320-light', path: '/', width: 320, charts: 4 },
  { name: 'overview-320-dark', path: '/', width: 320, dark: true, charts: 4 },
  { name: 'overview-1280-light', path: '/', width: 1280, charts: 4 },
  { name: 'overview-1280-dark', path: '/', width: 1280, dark: true, charts: 4 },
  { name: 'income-320-light', path: '/income', width: 320, charts: 0 },
  { name: 'income-768-light', path: '/income', width: 768, charts: 0 },
  { name: 'income-1280-dark', path: '/income', width: 1280, dark: true, charts: 0 },
  { name: 'balance-768-light', path: '/balance', width: 768, charts: 0 },
  { name: 'balance-1280-light', path: '/balance', width: 1280, charts: 0 },
  { name: 'retirement-320-light', path: '/retirement', width: 320, charts: 1 },
  { name: 'retirement-1280-dark', path: '/retirement', width: 1280, dark: true, charts: 1 },
  { name: 'settings-320-light', path: '/settings', width: 320, charts: 0 },
]

async function open(page: Page, { path, width, dark, charts }: Omit<Shot, 'name'>) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
  await page.clock.setFixedTime(FIXED_NOW)
  await seedFinanceRows(page)
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await chartsDrawn(page, charts)
}

for (const shot of PAGE_SHOTS) {
  test(shot.name, async ({ page }) => {
    await open(page, shot)
    await expect(page).toHaveScreenshot(`${shot.name}.png`, {
      fullPage: true,
      mask: copyrightYear(page),
      timeout: SHOT_TIMEOUT,
    })
  })
}

test('nav-more-sheet-320-light', async ({ page }) => {
  await open(page, { path: '/', width: 320, charts: 4 })
  await page.locator(MORE_SUMMARY).click()
  await expect(page.locator(MORE_PANEL)).toBeVisible()
  await expect(page).toHaveScreenshot('nav-more-sheet-320-light.png', {
    mask: copyrightYear(page),
    timeout: SHOT_TIMEOUT,
  })
})
