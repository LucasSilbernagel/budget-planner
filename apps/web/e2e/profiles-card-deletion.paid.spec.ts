import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Deleting a profile is confirmed first, and the default is deletable
 * (story 63.2, FR97) — in a real browser.
 *
 * ⚠️ `.paid.spec.ts` is load-bearing: only the `chromium-paid` project (:5174,
 * booted with an entitled `E2E_SESSION_SEED`) runs this file. `/profiles` is a
 * premium route, so under any other name this spec would run against the FREE
 * server and assert against the locked upgrade prompt. See
 * `playwright.config.ts:32-38`.
 *
 * ⚠️ With `PLAYWRIGHT_BASE_URL` set the `chromium-paid` project is DROPPED, not
 * redirected — a "green" run under that env var has not run this file at all.
 * Check the reported test count, not the exit code.
 *
 * ## What only this layer can prove
 *
 * The dialog is a real `Modal`: backdrop, Escape, focus handling and z-order
 * against story 63.1's stretched-link overlay. jsdom compiles no Tailwind and
 * models no stacking context, so "the confirm button is actually clickable where
 * it is painted" is not a question the unit suite can be asked.
 */

const PROFILES_KEY = 'budget-planner-profiles-v1'

async function seedProfiles(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const now = '2026-09-23T00:00:00.000Z'
    localStorage.setItem(
      'budget-planner-profiles-v1',
      JSON.stringify({
        state: {
          profiles: [
            {
              id: 'seed-main',
              userId: 'e2e-paid-user',
              name: 'Main Profile',
              description: 'Everyday money',
              isDefault: true,
              currency: 'NONE',
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 'seed-biz',
              userId: 'e2e-paid-user',
              name: 'Business',
              description: 'Consulting',
              isDefault: false,
              currency: 'EUR',
              createdAt: now,
              updatedAt: now,
            },
          ],
          activeProfileId: 'seed-biz',
        },
        version: 1,
      })
    )
  })
}

async function gotoProfiles(page: Page, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 800 })
  await seedProfiles(page)
  await page.goto('/profiles')
  await page.waitForLoadState('networkidle')
  // Positive control for every assertion in this file: the MANAGEMENT UI is on
  // screen, not the locked upgrade surface and not a spinner. Without it a
  // locator that matches nothing reads as a passing absence.
  await expect(page.getByRole('button', { name: '+ New Profile' })).toBeVisible()
}

/** The persisted profile ids, read from the store's own localStorage key. */
async function persistedProfileIds(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { state?: { profiles?: { id: string }[] } }
    return (parsed.state?.profiles ?? []).map((p) => p.id)
  }, PROFILES_KEY)
}

test('Delete asks first and destroys nothing while the dialog is open', async ({ page }) => {
  await gotoProfiles(page)

  await page.getByRole('button', { name: 'Delete Business' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Business')
  // The card is still there, and so is the persisted row: opening the dialog is
  // not the deletion.
  await expect(page.getByRole('button', { name: 'Edit Business' })).toBeVisible()
  expect(await persistedProfileIds(page)).toContain('seed-biz')
})

test('Escape aborts the deletion', async ({ page }) => {
  await gotoProfiles(page)

  await page.getByRole('button', { name: 'Delete Business' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit Business' })).toBeVisible()
  expect(await persistedProfileIds(page)).toContain('seed-biz')
})

test('confirming deletes the profile and persists it', async ({ page }) => {
  await gotoProfiles(page)

  await page.getByRole('button', { name: 'Delete Business' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit Business' })).toHaveCount(0)
  await expect.poll(() => persistedProfileIds(page)).toEqual(['seed-main'])
})

test('the DEFAULT profile can be deleted, and the survivor inherits the flag', async ({ page }) => {
  await gotoProfiles(page)

  // ⚠️ THE REVERSAL. Before 63.2 this button was not rendered at all for the
  // default profile, so this locator failing to resolve IS the pre-63.2
  // behaviour — which is what makes it a real baseline-red assertion.
  await page.getByRole('button', { name: 'Delete Main Profile' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()

  await expect(page.getByRole('button', { name: 'Edit Main Profile' })).toHaveCount(0)
  // The "Default" badge moves to the survivor: the account is never left without
  // one, which the `find(p => p.isDefault) ?? [0]` consumers depend on.
  await expect(page.getByText('Default', { exact: true })).toHaveCount(1)
  const survivorCard = page
    .locator('div.surface')
    .filter({ has: page.getByRole('button', { name: 'Edit Business' }) })
  await expect(survivorCard.getByText('Default', { exact: true })).toBeVisible()
})

test('the confirm dialog is operable by keyboard over the card overlay', async ({ page }) => {
  await gotoProfiles(page)

  // ⚠️ THIS TEST PROVES KEYBOARD OPERABILITY, NOT Z-ORDER — an earlier version of
  // this comment claimed the latter and was wrong (code review). A programmatic
  // `.focus()` followed by Enter activates a button regardless of what is
  // painted over it: an element under an overlay is still perfectly focusable.
  // What actually proves the confirm button is not buried is the POINTER
  // `.click()` in the "confirming deletes the profile" test above, because
  // Playwright's actionability check hit-tests the point it is about to click.
  // Keep both: they answer different questions.
  await page.getByRole('button', { name: 'Delete Business' }).focus()
  await page.keyboard.press('Enter')
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Delete' })
  await confirm.focus()
  await page.keyboard.press('Enter')

  await expect.poll(() => persistedProfileIds(page)).toEqual(['seed-main'])
  // ⚠️ Focus lands on the HEADING specifically, not merely "not body" (code
  // review). `finalFocusRef` exists because the confirming Delete button
  // unmounts with its card, so the assertion has to name the element it was
  // redirected to — `not.toBe('BODY')` passes for any stray focus target.
  const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null)
  expect(focusedText).toBe('Your Profiles')
})

test('a backdrop click aborts the deletion', async ({ page }) => {
  await gotoProfiles(page)

  await page.getByRole('button', { name: 'Delete Business' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()

  // ⚠️ The third dismissal route, and the only one no test covered (code
  // review): AC-1 names Cancel, Escape AND the backdrop, and the unit tests
  // loop over the first two only.
  //
  // ⚠️⚠️ THE CLICK POINT IS VERIFIED BEFORE IT IS USED, and that is not
  // ceremony: the first version of this test clicked (5, 5) and failed, which
  // read as "backdrop dismissal is broken". It was not — `elementFromPoint(5,5)`
  // is the page HEADER, which paints over the overlay's top strip, so the press
  // never landed on the backdrop at all. `Modal` requires a paired
  // pointerdown+pointerup on the overlay ITSELF (story 31.3's guard against a
  // scrollbar drag dismissing the dialog), so a click that misses it is
  // correctly ignored. Asserting what is under the cursor turns "the dialog
  // stayed open" into a statement about dismissal rather than about aim.
  const point = { x: 5, y: 700 }
  const hitIsOverlay = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return el === document.querySelector('[role="alertdialog"]')?.parentElement
  }, point)
  expect(hitIsOverlay, 'the chosen point must be the modal overlay').toBe(true)

  await page.mouse.click(point.x, point.y)

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit Business' })).toBeVisible()
  expect(await persistedProfileIds(page)).toContain('seed-biz')
})
