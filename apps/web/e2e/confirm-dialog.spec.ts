import { type Page, expect, test } from '@playwright/test'

/**
 * Themed confirmation dialog guard E2E (Story 6.3 / UX-DR11).
 *
 * Destructive deletes now go through the themed ConfirmDialog (alertdialog)
 * instead of a browser `confirm()`. This proves the regression-prone criteria on
 * the Income page: dismissing (Cancel / Escape / backdrop) aborts the delete and
 * keeps the row, while Confirm actually removes it.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

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

/** Seed one income source through the real Add flow, then return to a clean page. */
async function addIncomeSource(page: Page, name: string) {
  const dialog = await clickUntilDialog(page, ADD_TRIGGER, ADD_DIALOG)
  await dialog.getByLabel('Name *').fill(name)
  await dialog.getByLabel('Amount *').fill('1000')
  await dialog.getByRole('button', { name: 'Add Income Source' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(name)).toBeVisible()
}

/**
 * Story 31.2 gave each row's Delete button a per-row accessible name
 * (`Delete <name>`), because N rows used to expose N identically named
 * "Delete" buttons. The full name is matched EXACTLY on purpose: Playwright's
 * `name` option is a case-insensitive SUBSTRING match by default, so a bare
 * "Delete" now also matches "Edit DeleteMe", and `ConfirmDialog`'s own confirm
 * button is likewise named "Delete".
 */
async function openDeleteConfirm(page: Page, rowName: string) {
  const confirm = page.getByRole('alertdialog', { name: 'Confirm Delete' })
  await expect(async () => {
    await page.getByRole('button', { name: `Delete ${rowName}`, exact: true }).click()
    await expect(confirm).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  return confirm
}

test.describe('Confirmation dialog (story 6-3)', () => {
  test('Escape aborts the delete — the row stays', async ({ page }) => {
    await page.goto('/income')
    await addIncomeSource(page, 'KeepMeEscape')

    const confirm = await openDeleteConfirm(page, 'KeepMeEscape')
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await expect(page.getByText('KeepMeEscape')).toBeVisible()
  })

  test('backdrop click aborts the delete — the row stays', async ({ page }) => {
    await page.goto('/income')
    await addIncomeSource(page, 'KeepMeBackdrop')

    const confirm = await openDeleteConfirm(page, 'KeepMeBackdrop')
    await page.mouse.click(8, 8)
    await expect(confirm).toBeHidden()
    await expect(page.getByText('KeepMeBackdrop')).toBeVisible()
  })

  test('Cancel aborts the delete — the row stays', async ({ page }) => {
    await page.goto('/income')
    await addIncomeSource(page, 'KeepMeCancel')

    const confirm = await openDeleteConfirm(page, 'KeepMeCancel')
    await confirm.getByTestId('delete-confirm-cancel').click()
    await expect(confirm).toBeHidden()
    await expect(page.getByText('KeepMeCancel')).toBeVisible()
  })

  test('Confirm performs the delete — the row is removed', async ({ page }) => {
    await page.goto('/income')
    await addIncomeSource(page, 'DeleteMe')

    const confirm = await openDeleteConfirm(page, 'DeleteMe')
    await confirm.getByTestId('delete-confirm-confirm').click()
    await expect(confirm).toBeHidden()
    await expect(page.getByText('DeleteMe')).toBeHidden()
    await expect(page.getByText('No income sources yet')).toBeVisible()
  })
})
