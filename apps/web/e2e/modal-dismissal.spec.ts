import { type Page, expect, test } from '@playwright/test'

/**
 * Modal dismissal guard E2E (Story 6.2 / UX-DR10).
 *
 * Proves that the shared Modal primitive closes on Escape and on outside
 * (backdrop) click, and that dismissing performs NO destructive action — the
 * two regression-prone acceptance criteria (AC-1, AC-2). Uses the Income page's
 * "Add Income Source" dialog as a representative modal; because every modal now
 * renders through the same primitive, this exercises the shared behavior.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const TRIGGER = '+ Add Income Source'
const DIALOG_NAME = 'Add Income Source'

/**
 * Open the Add Income dialog. The trigger's onClick only works once React has
 * hydrated the SSR markup; a click that lands before hydration is silently lost.
 * `toPass` retries the click until the dialog actually appears, then returns it.
 */
async function openAddIncomeModal(page: Page) {
  const trigger = page.getByRole('button', { name: TRIGGER })
  const dialog = page.getByRole('dialog', { name: DIALOG_NAME })
  await expect(async () => {
    await trigger.click()
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  return dialog
}

test.describe('Modal dismissal (story 6-2)', () => {
  test('closes on Escape with no income added', async ({ page }) => {
    await page.goto('/income')
    await expect(page.getByText('No income sources yet')).toBeVisible()

    const dialog = await openAddIncomeModal(page)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // Dismissing must not create a row — the empty state remains.
    await expect(page.getByText('No income sources yet')).toBeVisible()
  })

  test('closes on outside (backdrop) click with no income added', async ({ page }) => {
    await page.goto('/income')
    const dialog = await openAddIncomeModal(page)

    // Click the backdrop: a viewport corner is well outside the centered card.
    await page.mouse.click(8, 8)
    await expect(dialog).toBeHidden()

    await expect(page.getByText('No income sources yet')).toBeVisible()
  })

  test('does not close when clicking inside the modal content', async ({ page }) => {
    await page.goto('/income')
    const dialog = await openAddIncomeModal(page)

    // Clicking the heading (inside the content) must keep the modal open.
    await dialog.getByRole('heading', { name: DIALOG_NAME }).click()
    await expect(dialog).toBeVisible()
  })
})
