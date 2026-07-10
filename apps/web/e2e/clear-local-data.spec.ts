import { type Page, expect, test } from '@playwright/test'

/**
 * "Clear local data" Settings control E2E (Story 17-2).
 *
 * Proves the all-users local-reset end-to-end: seed real financial data through
 * the Income Add flow, wipe it from Settings → Clear local data (themed
 * ConfirmDialog, not a browser confirm()), and — following the Story 17-1 review
 * lesson — assert the cleared state is PERSISTED (the localStorage entry is gone
 * and stays gone across a reload), not merely hidden in the current view.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const INCOME_KEY = 'budget-planner-income-v1'
const ADD_TRIGGER = '+ Add Income Source'
const ADD_DIALOG = 'Add Income Source'

/** Click a trigger until its dialog appears (survives pre-hydration clicks). */
async function clickUntilDialog(page: Page, triggerName: string, dialogName: string) {
  const trigger = page.getByRole('button', { name: triggerName })
  const dialog = page.getByRole('dialog', { name: dialogName })
  await expect(async () => {
    await trigger.click()
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  return dialog
}

/** Seed one income source through the real Add flow. */
async function addIncomeSource(page: Page, name: string) {
  const dialog = await clickUntilDialog(page, ADD_TRIGGER, ADD_DIALOG)
  await dialog.getByLabel('Name *').fill(name)
  await dialog.getByLabel('Amount *').fill('1000')
  await dialog.getByRole('button', { name: 'Add Income Source' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(name)).toBeVisible()
}

// Returns '' when the key was removed (clearStorage deletes it), so the string
// `.toContain` checks below work whether the entry is gone or merely emptied.
const readIncomeStorage = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key) ?? '', INCOME_KEY)

test.describe('Clear local data (story 17-2)', () => {
  test('wipes seeded local data and the wipe persists across a reload', async ({ page }) => {
    // 1. Seed real financial data and confirm it landed in localStorage.
    await page.goto('/income')
    await addIncomeSource(page, 'ClearMeE2E')
    await expect.poll(() => readIncomeStorage(page)).toContain('ClearMeE2E')

    // 2. Clear it from the Settings control (available to this free user).
    await page.goto('/settings')
    const clearButton = page.getByRole('button', { name: 'Clear local data' })
    const confirm = page.getByRole('alertdialog', { name: 'Clear local data?' })
    await expect(async () => {
      await clearButton.click()
      await expect(confirm).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15000 })

    await confirm.getByRole('button', { name: 'Clear data' }).click()
    await expect(confirm).toBeHidden()
    // Feedback confirms the wipe (Settings shows no financial figures of its own).
    // Target by text: the persistent AuthIndicator strip is also a role="status".
    await expect(page.getByText(/your local data has been cleared/i)).toBeVisible()

    // 3. PERSISTED: the income entry is gone from storage (clearStorage removed it).
    await expect.poll(() => readIncomeStorage(page)).not.toContain('ClearMeE2E')

    // 4. And it stays gone after a full reload back on the Income page.
    await page.goto('/income')
    await page.reload()
    await expect(page.getByText('ClearMeE2E')).toHaveCount(0)
    expect(await readIncomeStorage(page)).not.toContain('ClearMeE2E')
  })
})
