import { type Locator, type Page, expect, test } from '@playwright/test'
import { accountTrigger, expectSignedInAs, openAccountMenu } from './helpers/account-menu'
import { mockSignedIn, openMore } from './helpers/nav-more'
import {
  type Box,
  FIXED_NOW,
  SHOT_TIMEOUT,
  chartsDrawn,
  copyrightYear,
  expectBarCells,
  expectPhoneStrip,
  expectTarget,
} from './helpers/screenshot'
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
  // Story 91.1 (D2): `/balance`'s row cards at 320, seeded. Its cells differ from
  // Income's (Type badge, `CURRENT BALANCE/VALUE`, Contribution + cadence), and
  // no shot showed them below `sm` (`modal-320x480` is `/balance` UNseeded).
  { name: 'balance-320-light', path: '/balance', width: 320, charts: 0 },
  { name: 'retirement-320-light', path: '/retirement', width: 320, charts: 1 },
  { name: 'retirement-1280-dark', path: '/retirement', width: 1280, dark: true, charts: 1 },
  { name: 'settings-320-light', path: '/settings', width: 320, charts: 0 },
  // Story 88.4 (D3): the only width where /savings' `text-3xl` Total Savings
  // figure overran its card (264 px vs 240 under CI's font) before it became a
  // `GroupedAmount`. /savings draws no Recharts chart (none in `SavingsPage`).
  { name: 'savings-320-light', path: '/savings', width: 320, charts: 0 },
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

const FOOTER_LABELS = [
  'Pricing',
  'Documentation',
  'Terms of Service',
  'Privacy Policy',
  'Refund Policy',
  'Contact',
]

/**
 * Story 96.1 (FR156, D3 grid, D5 author link), in a real browser at 320px: the
 * six footer links are >= 44 x 44px cells of a two-column grid (three rows of
 * two, no two boxes overlapping), and the author link is >= 44px tall.
 */
async function expectPhoneFooter(page: Page) {
  const footer = page.getByRole('contentinfo')
  const boxes: Box[] = []
  for (const label of FOOTER_LABELS) {
    boxes.push(
      await expectTarget(
        footer.getByRole('link', { name: label, exact: true }),
        `footer "${label}"`
      )
    )
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]]
      const overlap =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      expect(overlap, `footer "${FOOTER_LABELS[i]}" overlaps "${FOOTER_LABELS[j]}"`).toBe(false)
    }
  }
  const perRow = new Map<number, number>()
  for (const b of boxes) perRow.set(Math.round(b.y), (perRow.get(Math.round(b.y)) ?? 0) + 1)
  expect([...perRow.values()], 'footer links are not three rows of two').toEqual([2, 2, 2])
  await expectTarget(
    footer.getByRole('link', { name: /Lucas Silbernagel/ }),
    'footer author link',
    {
      sides: 'height',
    }
  )
}

for (const shot of PAGE_SHOTS) {
  test(shot.name, async ({ page }) => {
    await open(page, shot)
    if (shot.name === 'income-768-light') {
      // Story 96.3: the header gear is hidden below 640px ONLY. At 768 it is
      // the signed-out route to Settings (positive control for the `max-sm:`
      // scope; the 320 shots assert it hidden).
      await expect(page.locator('[data-auth-indicator] a[href="/settings"]')).toBeVisible()
    }
    if (shot.name === 'income-320-light') await expectPhoneFooter(page)
    await expect(page).toHaveScreenshot(`${shot.name}.png`, {
      fullPage: true,
      mask: await copyrightYear(page),
      timeout: SHOT_TIMEOUT,
    })
  })
}

test('nav-more-sheet-320-light', async ({ page }) => {
  await open(page, { path: '/', width: 320, charts: 4 })
  // Story 96.3 (FR163), in a real browser (jsdom sees every route at once):
  // below 640px the header gear is hidden... `toHaveCount(1)` first: a
  // `toBeHidden()` on a locator that matches NOTHING passes, so without it a
  // deleted gear would read as a hidden one (story 96.3 review, measured).
  const gear = page.locator('[data-auth-indicator] a[href="/settings"]')
  await expect(gear).toHaveCount(1)
  await expect(gear).toBeHidden()
  // ...positive control that the signed-out cluster rendered at all.
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
  // Story 96.1 (FR156, D1 + D2), real-browser sizes: Upgrade and Sign in are
  // 44 x 44px targets, the strip is exactly 45px, nothing scrolls sideways,
  // and the bottom bar's five visible cells are >= 44 x 44px.
  await expectTarget(page.getByRole('link', { name: 'Upgrade', exact: true }), 'Upgrade')
  await expectTarget(page.getByRole('link', { name: 'Sign in', exact: true }), 'Sign in')
  await expectPhoneStrip(page, 320)
  await expectBarCells(page, 5)
  await openMore(page)
  // ...and the open sheet's LAST row is Settings, visible.
  const rows = page.locator('nav[aria-label="Primary"] details ul').getByRole('link')
  await expect(rows).toHaveCount(3)
  // Story 96.1: every sheet row is a >= 44 x 44px target.
  for (let i = 0; i < 3; i++) await expectTarget(rows.nth(i), `sheet row ${i + 1}`)
  await expect(rows.last()).toHaveAccessibleName('Settings')
  await expect(rows.last()).toBeVisible()
  // On SCREEN, not just rendered: `toBeVisible()` ignores clipping by the
  // sheet's `max-h` scroll box (story 96.3 review, measured).
  await expect(rows.last()).toBeInViewport({ ratio: 1 })
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
  // Story 96.1 (FR156): signed in free, the trigger is a 44 x 44px target and
  // the strip is exactly 45px, measured before opening.
  await expectTarget(accountTrigger(page), 'Account menu trigger')
  await expectPhoneStrip(page, 320)
  const panel = await openAccountMenu(page)
  // The OPEN state, asserted: a shot of the closed menu would be a vacuous
  // baseline. Sign out visible is the positive control that it is open.
  await expect(panel.getByRole('button', { name: 'Sign out' })).toBeVisible()
  // Story 96.1: Sign out, the one visible panel row on a phone, is >= 44px
  // tall (full width, so the height is the claim).
  await expectTarget(panel.getByRole('button', { name: 'Sign out' }), 'Sign out', {
    sides: 'height',
  })
  // Story 96.3 (FR163): below 640px the panel's Settings row and its separator
  // are hidden (the nav's More sheet is the phone route). Until 96.3 this
  // asserted the Settings row VISIBLE here.
  // CSS locators with `toHaveCount(1)` first, not `getByRole`: a role query
  // already skips a `display:none` element, and `toBeHidden()` passes on zero
  // matches, so the old form stayed green with the row and `<hr>` DELETED
  // (story 96.3 review, measured).
  const panelSettings = panel.locator('a[href="/settings"]')
  await expect(panelSettings).toHaveCount(1)
  await expect(panelSettings).toBeHidden()
  const separator = panel.locator('hr')
  await expect(separator).toHaveCount(1)
  await expect(separator).toBeHidden()
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
