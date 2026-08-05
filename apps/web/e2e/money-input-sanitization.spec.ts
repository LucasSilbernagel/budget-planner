import { type Page, expect, test } from '@playwright/test'

/**
 * Money-input sanitization E2E (story 28-1, FR46 / AC-1, AC-7).
 *
 * These cover the two failure modes jsdom cannot see, both of which are real
 * regressions this story hit:
 *
 * 1. CARET JUMP — a controlled input whose onChange returns the value already in
 *    state does not re-render, but React still restores the DOM value, which
 *    drops the cursor to the end. Value-only assertions pass while mid-string
 *    editing is broken. Needs a real browser selection to detect.
 * 2. INVISIBLE FOCUS RING — `focus:ring-<color>` without `focus:ring-2` is a ring
 *    of zero width. Only a computed style proves a ring actually paints.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const PAGES = [
  {
    path: '/income',
    trigger: '+ Add Income Source',
    dialog: 'Add Income Source',
    fields: ['income-name-input', 'income-amount-input'],
  },
  {
    path: '/expenses',
    trigger: '+ Add Expense',
    dialog: 'Add Expense',
    fields: ['expense-name-input', 'expense-amount-input'],
  },
  {
    path: '/savings',
    trigger: '+ Add Savings Goal',
    dialog: 'Add Savings Goal',
    fields: ['savings-name-input', 'savings-target-amount-input'],
  },
  {
    path: '/balance',
    trigger: '+ Add Balance Entry',
    dialog: 'Add Balance Entry',
    fields: ['balance-name-input', 'balance-current-balance-input'],
  },
] as const

/** Click a trigger until its dialog appears (survives pre-hydration clicks). */
async function openDialog(page: Page, trigger: string, dialogName: string) {
  const button = page.getByRole('button', { name: trigger })
  const dialog = page.getByRole('dialog', { name: dialogName })
  await expect(async () => {
    await button.click()
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  return dialog
}

test('rejecting a character mid-string does not move the caret or drop focus', async ({ page }) => {
  await page.goto('/income')
  const dialog = await openDialog(page, '+ Add Income Source', 'Add Income Source')
  const amount = dialog.getByTestId('income-amount-input')

  await amount.click()
  await page.keyboard.type('12abc34')
  await expect(amount).toHaveValue('1234')
  // Focus must survive every keystroke (the story 26.7 remount failure mode).
  await expect(amount).toBeFocused()

  await amount.fill('')
  await page.keyboard.type('1,234.56')
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 3))

  await page.keyboard.type('x')
  await expect(amount).toHaveValue('1,234.56')
  // The caret stays where the rejected character was — NOT at the end (8).
  expect(await amount.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3)

  // ...and a legal character still inserts at that same position.
  await page.keyboard.type('9')
  await expect(amount).toHaveValue('1,2934.56')
  expect(await amount.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(4)
})

/**
 * Magnitude-safety regressions (story 28-1 code review).
 *
 * Each was a silent corruption the first implementation shipped: the sanitizer
 * "tidied" a malformed value into a plausible, saveable, WRONG number instead of
 * leaving it for parseFromInput to reject. The end-state that matters is not just
 * the displayed string but that the submit validator still blocks it.
 */
test('a stray leading decimal separator cannot rescale the amount', async ({ page }) => {
  await page.goto('/income')
  const dialog = await openDialog(page, '+ Add Income Source', 'Add Income Source')
  const amount = dialog.getByTestId('income-amount-input')

  await amount.click()
  await page.keyboard.type('1000')
  await page.keyboard.press('Tab')
  await expect(amount).toHaveValue('1,000.00')

  // Caret to the very start, fumble a '.'. This used to yield ".1,00000" -> $0.10.
  await amount.click()
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0))
  await page.keyboard.type('.')
  await page.keyboard.press('Tab')
  await expect(amount).not.toHaveValue('0.10')

  // And it must be REJECTED, not saved as some other number.
  await dialog.getByTestId('income-name-input').fill('Salary')
  await dialog.getByRole('button', { name: 'Add Income Source' }).click()
  await expect(dialog.getByTestId('income-amount-error')).toHaveText(
    'Please enter a valid positive amount'
  )
})

test('a pasted scientific-notation value drops its exponent whole', async ({ page }) => {
  await page.goto('/income')
  const dialog = await openDialog(page, '+ Add Income Source', 'Add Income Source')
  const amount = dialog.getByTestId('income-amount-input')

  // What Excel/Sheets put on the clipboard for a large cell. fill() delivers the
  // whole string in one change event, exactly like a paste.
  await amount.fill('1.2E+09')
  // Previously "1.209" -> $1.20: the exponent digits spliced into the mantissa.
  await expect(amount).toHaveValue('1.2')
})

for (const { path, trigger, dialog: dialogName, fields } of PAGES) {
  test(`${path} money input rejects letters`, async ({ page }) => {
    await page.goto(path)
    const dialog = await openDialog(page, trigger, dialogName)
    const money = dialog.getByTestId(fields[1])

    await money.click()
    await page.keyboard.type('9abc9')

    await expect(money).toHaveValue('99')
    await expect(money).toBeFocused()
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`${path} modal controls show a visible focus ring (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(path)
      const dialog = await openDialog(page, trigger, dialogName)

      for (const testid of fields) {
        const field = dialog.getByTestId(testid)

        // These controls carry `shadow-sm`, so `boxShadow` is NEVER "none" —
        // asserting that alone passes with focus:ring-2 deleted. The ring is only
        // proven by the shadow CHANGING on focus, and by a non-zero ring width
        // appearing in the focused value.
        const blurred = await field.evaluate((el) => getComputedStyle(el).boxShadow)
        await field.focus()
        const focused = await field.evaluate((el) => getComputedStyle(el).boxShadow)

        expect(focused, `${testid}: focus paints nothing new in ${theme} mode`).not.toBe(blurred)
        // Tailwind's ring renders as a spread-only shadow: "<color> 0px 0px 0px 2px".
        expect(focused, `${testid}: no 2px ring in ${theme} mode`).toMatch(/0px 0px 0px 2px/)
      }
    })
  }
}
