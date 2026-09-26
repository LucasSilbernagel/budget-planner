import { expect, test } from '@playwright/test'

/**
 * An expense marked as ending before retirement reaches the planner — free tier,
 * no server, no session (Story 65.2, FR101, AC-15).
 *
 * ⚠️ WHY THIS IS E2E AND NOT A UNIT TEST. The claim is that the whole loop works
 * for a signed-OUT user whose data never leaves the browser: the tick persists
 * through zustand-persist into localStorage on one route, and a DIFFERENT route
 * reads it back and derives a figure from it. A unit test shares a module
 * singleton across both components and would pass even if nothing were ever
 * written to storage. The retirement planner is a FREE-tier surface (currency,
 * dark mode and retirement are all free), so this path is the primary one, not
 * an edge case.
 *
 * ⚠️ DELIBERATELY NOT a `.paid.spec.ts`. On the paid server (:5174) `getProfiles`
 * throws `ReferenceError: Buffer is not defined` inside its dynamic import —
 * Vite bundles the `pg` driver into the client in dev — so profile-dependent
 * paid surfaces always land on their error arm. A paid arm here would be green
 * and VACUOUS, measuring a dev-only bundling artifact rather than this feature.
 * The sync half of this field is pinned by contract tests
 * (`src/lib/sync/__tests__/ends-before-retirement-gates.test.ts`) and by the
 * real-DB round trip recorded in the story.
 *
 * ⚠️ Drives the REAL form rather than seeding localStorage directly. Seeding
 * would skip `handleSubmit` and `toClientExpense` — the two places this field
 * can be dropped on the way in — and assert against a shape this spec wrote
 * itself.
 */

const LABEL = 'This expense ends before I retire'

/**
 * Wait until the client store has hydrated on the Expenses page.
 *
 * ⚠️ Every assertion after a `goto` or `reload` needs this. The server renders
 * the page without localStorage, so it emits the EMPTY state — and an assertion
 * that happens to match the server markup (or a `toHaveCount(0)` against it)
 * resolves on the first poll, before the client has read storage. Measured in the
 * second review round: on a cold Vite server with two parallel workers BOTH tests
 * failed here, on server markup ("No expenses recorded yet"), within the default
 * 5s. Waiting on a row — which only the hydrated store can render — is the signal.
 */
async function expensesHydrated(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByRole('button', { name: /^Edit / })).not.toHaveCount(0, { timeout: 20_000 })
}

/**
 * Wait until the retirement planner has hydrated.
 *
 * ⚠️ NOT the Income period `<select>`'s own value — that was the first attempt and
 * it does not work. Playwright's `selectOption` sets the DOM value natively, with
 * no React handler attached, so asserting `toHaveValue('monthly')` passes
 * pre-hydration and proves nothing. The derived figure is rendered only from the
 * client store, so its presence is a real hydration signal.
 */
async function plannerHydrated(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByLabel('Desired Retirement Income')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('retirement-savings-position')).toBeVisible({ timeout: 20_000 })
}

/**
 * Open the Add/Edit modal, surviving a PRE-HYDRATION click.
 *
 * ⚠️ MEASURED while writing this spec: a single `click()` right after `goto`
 * lands on server-rendered markup whose handler is not attached yet, and the
 * modal never opens — the failure presents 30s later as "waiting for
 * expense-name-input", which says nothing about hydration. The retry is the
 * convention the other modal specs already use (`categories-premium.spec.ts:284-288`).
 */
async function openModal(page: import('@playwright/test').Page, button: string, name: string) {
  const trigger = page.getByRole('button', { name: button })
  const dialog = page.getByRole('dialog', { name })
  await expect(async () => {
    await trigger.click()
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  return dialog
}

test.describe('an expense that ends before retirement (free tier)', () => {
  test('a marked expense reaches the retirement planner and can be adopted', async ({ page }) => {
    await page.goto('/expenses')

    // Two expenses: one marked (a mortgage that ends), one not (groceries).
    let dialog = await openModal(page, '+ Add Expense', 'Add Expense')
    await dialog.getByTestId('expense-name-input').fill('Mortgage')
    await dialog.getByTestId('expense-amount-input').fill('1800')
    await dialog.getByTestId('expense-ends-before-retirement').check()
    await dialog.getByRole('button', { name: 'Add Expense' }).click()
    await expect(dialog).toBeHidden()

    dialog = await openModal(page, '+ Add Expense', 'Add Expense')
    await dialog.getByTestId('expense-name-input').fill('Groceries')
    await dialog.getByTestId('expense-amount-input').fill('2400')
    await dialog.getByRole('button', { name: 'Add Expense' }).click()
    await expect(dialog).toBeHidden()

    // The list distinguishes the marked row without opening the form, in words.
    await expect(page.getByTestId('expense-row-ends-before-retirement')).toHaveCount(1)
    await expect(page.getByTestId('expense-row-ends-before-retirement')).toHaveText(
      'Ends before retirement'
    )

    // ⚠️ A RELOAD, not just a navigation: localStorage must be the carrier. A
    // route change alone is satisfied by a module singleton that never persisted.
    await page.reload()
    await expensesHydrated(page)
    await expect(page.getByTestId('expense-row-ends-before-retirement')).toHaveCount(1)

    // A different route, reading the flag back out of storage.
    await page.goto('/retirement')
    await plannerHydrated(page)

    // The DEFAULT basis is annual, so this arm needs no interaction at all and
    // cannot race hydration. $1,800/mo marked x 12 = $21,600/yr; $4,200 x 12.
    const hint = page.getByTestId('desired-income-ending-expenses')
    await expect(hint).toContainText("You've marked $21,600.00 a year as ending before retirement")
    await expect(hint).toContainText('Your expenses today are $50,400.00 a year')

    // ⚠️ Switching the basis needs the same pre-hydration guard as the modal
    // opens above — MEASURED: a bare `selectOption` right after `goto` returned
    // without error and left the figure in the annual basis, so the monthly
    // assertion failed against a correct page. The select is server-rendered; its
    // onChange is not attached yet.
    const basis = page.getByLabel('Income period')
    await expect(async () => {
      await basis.selectOption('monthly')
      await expect(hint).toContainText('a month', { timeout: 1000 })
    }).toPass({ timeout: 15000 })

    await expect(hint).toContainText("You've marked $1,800.00 a month as ending before retirement")
    await expect(hint).toContainText('Your expenses today are $4,200.00 a month')

    // ⚠️ SUGGEST, NEVER OVERWRITE — the field still holds whatever it held before
    // the control was offered. No income rows exist, so there is no prefill and
    // the field is empty until the user acts.
    const desired = page.getByLabel('Desired Retirement Income')
    await expect(desired).toHaveValue('')

    await page.getByRole('button', { name: 'Use this figure' }).click()
    await expect(desired).toHaveValue('2,400.00')

    // ⚠️ And the adopted value SURVIVES a reload — adopting marks the field
    // authored, so the seeding effect cannot reclaim it.
    await page.reload()
    await plannerHydrated(page)
    await expect(page.getByLabel('Desired Retirement Income')).toHaveValue('2,400.00')
  })

  test('unticking on the expense form withdraws the suggestion', async ({ page }) => {
    await page.goto('/expenses')

    const dialog = await openModal(page, '+ Add Expense', 'Add Expense')
    await dialog.getByTestId('expense-name-input').fill('Mortgage')
    await dialog.getByTestId('expense-amount-input').fill('1800')
    await dialog.getByTestId('expense-ends-before-retirement').check()
    await dialog.getByRole('button', { name: 'Add Expense' }).click()
    await expect(dialog).toBeHidden()

    await page.goto('/retirement')
    await plannerHydrated(page)
    await expect(page.getByTestId('desired-income-ending-expenses')).toBeVisible()

    // Back to the form: the box re-opens TICKED (the edit-seed path), and
    // unticking actually clears it rather than leaving a stale flag behind.
    await page.goto('/expenses')
    await expensesHydrated(page)
    const edit = await openModal(page, 'Edit Mortgage', 'Edit Expense')
    await expect(edit.getByLabel(LABEL)).toBeChecked()
    await edit.getByLabel(LABEL).uncheck()
    await edit.getByRole('button', { name: 'Save Changes' }).click()
    await expect(edit).toBeHidden()
    await expect(page.getByTestId('expense-row-ends-before-retirement')).toHaveCount(0)

    // ⚠️⚠️ A POSITIVE, genuinely hydration-dependent signal BEFORE the negative
    // assertion. `/retirement` is server-rendered and the server cannot read
    // localStorage, so the SSR HTML never contains this testid — a bare
    // `toHaveCount(0)` after `goto` resolves on its FIRST poll against
    // un-hydrated markup and would pass even if the untick had never cleared the
    // flag.
    //
    // ⚠️ The first attempt at this guard did NOT work, and the second review round
    // caught it: it drove `selectOption` and then asserted the `<select>`'s own
    // value. Playwright sets that natively with no React attached, so it passed
    // pre-hydration too — the vacuity was still there behind a guard that looked
    // like a fix. `plannerHydrated` waits on content only the client store can
    // render.
    await page.goto('/retirement')
    await plannerHydrated(page)
    // Positive control: the OTHER expense still drives a figure on this page, so
    // the suggestion block's absence below is about the flag, not about an empty
    // or un-hydrated page.
    await expect(page.getByText('Current Amount Saved')).toBeVisible()

    await expect(page.getByTestId('desired-income-ending-expenses')).toHaveCount(0)
  })
})

/**
 * Flip the Retirement planner switch on /settings through the REAL control.
 *
 * ⚠️ NOT `addInitScript`. An init script re-runs on EVERY navigation, so a
 * seeded "off" would be re-applied by the very `goto` that is meant to observe
 * the planner turned back on — the restore half of the round trip could never
 * be seen.
 *
 * ⚠️ Two hydration guards, because the server renders the switch at its
 * DEFAULT (`aria-checked="true"`) whatever the stored preference is:
 * 1. wait for the switch to show the stored state (`!on`) before acting — for
 *    the turn-ON case this is what proves the client has read storage; without
 *    it the server's "true" would satisfy the target and the click be skipped;
 * 2. retry the click until the target state holds, since a click that lands
 *    before the handler is attached is silently lost.
 *
 * ⚠️ Guard 1 proves hydration only for the turn-ON case. For turn-OFF it is met
 * by the server markup itself (`"true"`); there the retry in guard 2 is what
 * carries the weight.
 *
 * ⚠️ A FLIP, not an idempotent set: it asserts the OPPOSITE state first, so a
 * call whose target already holds times out after 20s. Every call here changes
 * the preference; keep it that way or add an early return.
 */
async function setPlannerVisible(page: import('@playwright/test').Page, on: boolean) {
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  const toggle = page.getByRole('switch', { name: /show retirement planner/i })
  await expect(toggle).toHaveAttribute('aria-checked', String(!on), { timeout: 20_000 })
  await expect(async () => {
    if ((await toggle.getAttribute('aria-checked')) !== String(on)) {
      await toggle.click()
    }
    await expect(toggle).toHaveAttribute('aria-checked', String(on), { timeout: 1000 })
  }).toPass({ timeout: 15_000 })
}

test.describe('the question follows the planner toggle (71.1, FR113, free tier)', () => {
  test('hidden while the planner is off, and every mark is kept for when it returns', async ({
    page,
  }) => {
    await page.goto('/expenses')
    let dialog = await openModal(page, '+ Add Expense', 'Add Expense')
    await dialog.getByTestId('expense-name-input').fill('Mortgage')
    await dialog.getByTestId('expense-amount-input').fill('1800')
    await dialog.getByTestId('expense-ends-before-retirement').check()
    await dialog.getByRole('button', { name: 'Add Expense' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('expense-row-ends-before-retirement')).toHaveCount(1)

    await setPlannerVisible(page, false)

    // A full navigation, so the preference and the row both come back out of
    // localStorage rather than a module singleton.
    await page.goto('/expenses')
    await expensesHydrated(page)
    await expect(page.getByTestId('expense-row-ends-before-retirement')).toHaveCount(0)

    // Edit an UNRELATED field with the question hidden.
    dialog = await openModal(page, 'Edit Mortgage', 'Edit Expense')
    await expect(dialog.getByTestId('expense-amount-input')).toBeVisible()
    await expect(dialog.getByTestId('expense-ends-before-retirement')).toHaveCount(0)
    await expect(dialog.getByText(/retire/i)).toHaveCount(0)
    await dialog.getByTestId('expense-amount-input').fill('1900')
    await dialog.getByRole('button', { name: 'Save Changes' }).click()
    await expect(dialog).toBeHidden()

    await setPlannerVisible(page, true)

    await page.goto('/expenses')
    await expensesHydrated(page)
    // The mark survived the hidden edit …
    await expect(page.getByTestId('expense-row-ends-before-retirement')).toHaveCount(1)
    // … and so did the edit itself (non-vacuity: the save really happened).
    await expect(page.locator('tr', { hasText: 'Mortgage' })).toContainText('$1,900.00')
    dialog = await openModal(page, 'Edit Mortgage', 'Edit Expense')
    await expect(dialog.getByTestId('expense-ends-before-retirement')).toBeChecked()
  })
})
