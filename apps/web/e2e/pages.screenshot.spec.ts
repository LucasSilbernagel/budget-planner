import { type Locator, type Page, expect, test } from '@playwright/test'
import { expectSignedInAs, openAccountMenu } from './helpers/account-menu'
import { mockSignedIn, openMore } from './helpers/nav-more'
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
 * `pnpm gates` does not run this project; CI's `ci.yml` e2e step runs it on
 * every PR to main and on every deploy (it has no plain push trigger).
 *
 * Determinism: fixed browser clock (the seed's own date; the footer's
 * server-rendered copyright year is MASKED instead, see `copyrightYear`), an
 * exact chart count before every shot (`chartsDrawn`),
 * `seedFinanceRows` (including its 138-character unbroken name, the fixture
 * the 320 px guards used), explicit light/dark via `emulateMedia`, and
 * `toHaveScreenshot`'s own wait for two identical frames, which is what lets
 * the Recharts JS animations settle (`animations: 'disabled'` only stops CSS).
 */

interface Shot {
  name: string
  path: string
  width: number
  /** Viewport height; 900 unless a shot is about a short screen. */
  height?: number
  dark?: boolean
  /** How many Recharts charts the page draws (see `chartsDrawn`). */
  charts: number
  /** `false` opens the page on EMPTY storage (the tallest-modal shot). */
  seed?: boolean
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

async function open(
  page: Page,
  { path, width, height = 900, dark, charts, seed = true }: Omit<Shot, 'name'>
) {
  await page.setViewportSize({ width, height })
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
  await page.clock.setFixedTime(FIXED_NOW)
  if (seed) await seedFinanceRows(page)
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
      mask: await copyrightYear(page),
      timeout: SHOT_TIMEOUT,
    })
  })
}

test('nav-more-sheet-320-light', async ({ page }) => {
  await open(page, { path: '/', width: 320, charts: 4 })
  await openMore(page)
  // Viewport, not full page (unlike D1's other shots): the sheet is a fixed
  // overlay, and what matters is how it sits over the first screen.
  await expect(page).toHaveScreenshot('nav-more-sheet-320-light.png', {
    mask: await copyrightYear(page),
    timeout: SHOT_TIMEOUT,
  })
})

/** Short and fixed, so the avatar initial never moves (as in the paid spec). */
const SIGNED_IN_EMAIL = 'free@example.test'

test('account-menu-320-open', async ({ page }) => {
  // ⚠️ This server's SSR seed is signed OUT: without the mock (and the gate on
  // the mocked identity) the "menu" would be the Sign in / Upgrade cluster.
  await mockSignedIn(page, { email: SIGNED_IN_EMAIL, subscriptionStatus: 'free' })
  await open(page, { path: '/', width: 320, height: 640, charts: 4 })
  await expectSignedInAs(page, SIGNED_IN_EMAIL)
  const panel = await openAccountMenu(page)
  // The OPEN state, asserted: a shot of the closed menu would be a vacuous baseline.
  await expect(panel.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Sign out' })).toBeVisible()
  // Viewport, not full page: the panel is an overlay hanging from the top strip.
  await expect(page).toHaveScreenshot('account-menu-320-open.png', {
    mask: await copyrightYear(page),
    timeout: SHOT_TIMEOUT,
  })
})

/**
 * Open `/balance`'s Add form (from the deleted `responsive-320.spec.ts`, story
 * 31.3). Checks BEFORE clicking: a retry after a first click that did open the
 * dialog would click a trigger now covered by the overlay.
 */
async function openBalanceAddModal(page: Page): Promise<Locator> {
  const trigger = page.getByTestId('balance-add-button')
  const dialog = page.getByRole('dialog', { name: 'Add Balance Entry' })
  await expect(async () => {
    // A bounded click: a trigger under the backdrop (the dialog opened between
    // the check and the click) fails THIS attempt, not the whole test (review).
    if (!(await dialog.isVisible())) await trigger.click({ timeout: 1000 })
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: SHOT_TIMEOUT })
  return dialog
}

test('modal-320x480', async ({ page }) => {
  // The tallest modal in the app: `/balance`'s Add form on EMPTY storage, where
  // the type defaults to `investment`, the arm that shows every field (31.3's
  // guard ran unseeded too). Asserted below, so a new default type fails here.
  await open(page, { path: '/balance', width: 320, height: 480, charts: 0, seed: false })
  const dialog = await openBalanceAddModal(page)
  await expect(dialog.getByLabel(/type/i)).toHaveValue('investment')
  // The investment-ONLY control (`BalancePage.tsx`, `type === 'investment'`):
  // a form that lost its tallest arm fails here with a name, not as a pixel diff.
  await expect(
    dialog.getByRole('checkbox', { name: 'Not taken from the money left over' })
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Add Balance Entry' })).toBeVisible()
  // Viewport: what matters is how the capped card sits on a short screen.
  await expect(page).toHaveScreenshot('modal-320x480.png', {
    mask: await copyrightYear(page),
    timeout: SHOT_TIMEOUT,
  })
})
