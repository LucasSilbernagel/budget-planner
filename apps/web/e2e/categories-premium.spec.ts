import { type Page, expect, test } from '@playwright/test'

/**
 * Custom categories E2E (story 30.4b, FR54 — AC-4, AC-5, AC-1).
 *
 * Three things jsdom cannot prove:
 *   1. The `/categories` route gate against the REAL hydration path, not a
 *      mocked hook (project memory 4-11: SSR/curl smoke misses post-hydration
 *      bugs, and a mocked gate tests the mock).
 *   2. That the LOCKED picker inside the Add/Edit modal opens no second dialog
 *      in a real browser (AC-5) — the default experience for every non-premium
 *      visitor, which is what this suite runs as.
 *   3. That the new Category column does not push the income/expense tables past
 *      320px. The `responsive-320.spec.ts` route sweep runs with EMPTY
 *      localStorage, so the tables render their empty state there and the new
 *      column is never exercised at the width the epic cares about.
 *
 * ⚠️ SCOPE LIMIT, stated rather than hidden: this suite is UNAUTHENTICATED — the
 * same constraint `premium-locked.spec.ts` and `report-print.spec.ts` work
 * under, since there is no session seeding available here. So the management
 * list itself cannot be rendered end to end; `CategoryManager.test.tsx` covers
 * its behaviour and this file covers the gate plus the always-rendered column.
 *
 * ⚠️ THE SAME LIMIT APPLIES TO THE 30.5 BREAKDOWN SECTION, and it is a limit,
 * not a defect to be reported: the section renders only in `CategoriesPage`'s
 * resolved-ENTITLED branch, which no unauthenticated run can reach. What IS
 * reachable, and is what this file adds, is the negative — that a free visitor
 * gets no breakdown against the REAL hydration path rather than a mocked hook.
 * Its populated behaviour lives in `CategoryBreakdown.test.tsx`, and its
 * per-branch gating in `CategoriesPage.test.tsx`.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const NARROW_WIDTH = 320

/**
 * Seed CATEGORIZED income and expense rows plus their categories.
 *
 * The rows carry real `categoryId`s so the Category column renders a pill, not
 * the "—" placeholder — otherwise the column would be measured empty and the
 * width it actually costs would go unverified.
 */
async function seedCategorizedRows(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const now = '2026-08-10T00:00:00.000Z'
    const category = (id: string, name: string, kind: 'income' | 'expense') => ({
      id,
      userId: 0,
      profileId: null,
      name,
      kind,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    })
    const row = (name: string, amount: number, categoryId: string | null) => ({
      id: crypto.randomUUID(),
      userId: 0,
      name,
      amount,
      frequency: 'monthly',
      categoryId,
      createdAt: now,
      updatedAt: now,
    })

    localStorage.setItem(
      'budget-planner-categories-v1',
      JSON.stringify({
        state: {
          categories: [
            category('cat-income-1', 'Employment Income', 'income'),
            category('cat-expense-1', 'Household & Utilities', 'expense'),
          ],
        },
        version: 1,
      })
    )
    localStorage.setItem(
      'budget-planner-income-v1',
      JSON.stringify({
        state: {
          incomeSources: [
            row('Primary Salary Long Name', 1234567890, 'cat-income-1'),
            row('Freelance & Consulting', 45678900, null),
          ],
        },
        version: 2,
      })
    )
    localStorage.setItem(
      'budget-planner-expenses-v1',
      JSON.stringify({
        state: {
          expenses: [
            row('Mortgage & Housing Costs', 987654321, 'cat-expense-1'),
            row('Groceries', 65432100, null),
          ],
        },
        version: 2,
      })
    )
    // Explicit-symbols mode renders the widest currency-formatted figures.
    localStorage.setItem(
      'budget-planner-currency-prefs-v1',
      JSON.stringify({ state: { mode: 'symbol', currency: 'USD', locale: 'en-US' }, version: 0 })
    )
  })
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    scrollWidth,
    `${label} overflows horizontally: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`
  ).toBeLessThanOrEqual(clientWidth)
}

test('a free visitor reaching /categories gets the upgrade surface, not the manager', async ({
  page,
}) => {
  await page.goto('/categories')

  await expect(page.getByRole('heading', { name: /go premium/i })).toBeVisible()
  // The manager's own controls must be absent entirely — not merely disabled.
  await expect(page.getByRole('heading', { name: /^categories$/i })).toHaveCount(0)
  await expect(page.getByTestId('category-add-expense')).toHaveCount(0)
  await expect(page.getByTestId('category-add-income')).toHaveCount(0)
  // The 30.5 breakdown is a SIBLING of the manager inside the same entitled
  // branch, so it needs its own negative — inheriting a gate is not evidence
  // the gate covers you. Absent from the DOM entirely, not merely hidden.
  await expect(page.getByTestId('category-breakdown')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /category breakdown/i })).toHaveCount(0)
})

test('a free visitor with seeded financial data still gets no breakdown at /categories', async ({
  page,
}) => {
  // Seeding matters: the breakdown reads the income/expense stores, so an
  // EMPTY-localStorage run would render nothing either way and the negative
  // above could pass for the wrong reason. With real categorized rows present,
  // the only thing keeping the section out of the DOM is the gate.
  await seedCategorizedRows(page)
  await page.goto('/categories')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: /go premium/i })).toBeVisible()
  await expect(page.getByTestId('category-breakdown')).toHaveCount(0)
  await expect(page.getByTestId('breakdown-income-table')).toHaveCount(0)
  await expect(page.getByTestId('breakdown-expense-table')).toHaveCount(0)
})

test('the /categories upgrade surface fits a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
  const response = await page.goto('/categories')
  expect(response?.ok(), 'expected /categories to load').toBeTruthy()
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading').first()).toBeVisible()
  await assertNoHorizontalOverflow(page, '/categories')
})

test('Settings surfaces categories as locked and does not link a free visitor through', async ({
  page,
}) => {
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')

  await expect(
    page.getByRole('button', { name: 'Custom Categories — premium, locked' })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /custom categories/i })).toHaveCount(0)
})

test('AC-5: the locked picker inside the Add Expense modal opens no second dialog', async ({
  page,
}) => {
  await page.goto('/expenses')
  const trigger = page.getByRole('button', { name: '+ Add Expense' })
  const dialog = page.getByRole('dialog', { name: 'Add Expense' })

  // Survive a pre-hydration click, as the other modal specs do.
  await expect(async () => {
    await trigger.click()
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })

  await expect(page.getByRole('dialog')).toHaveCount(1)

  const locked = page.getByTestId('expense-category-locked')
  await expect(locked).toBeVisible()
  await locked.click()

  // `Modal` assumes one open modal at a time; a nested one would break shared
  // Escape handling and restore the body scroll lock out of order.
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: /go premium/i })).toHaveCount(0)
  // And the first dialog must still be dismissible.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

for (const { path, prefix, categoryText } of [
  { path: '/income', prefix: 'income', categoryText: 'Employment Income' },
  { path: '/expenses', prefix: 'expense', categoryText: 'Household & Utilities' },
] as const) {
  test(`${path} with a populated Category column fits a 320px viewport`, async ({ page }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: 720 })
    await seedCategorizedRows(page)

    const response = await page.goto(path)
    expect(response?.ok(), `expected ${path} to load`).toBeTruthy()
    await page.waitForLoadState('networkidle')

    // Guard against a spurious pass: an empty table would trivially satisfy the
    // overflow check. Assert the column actually rendered BOTH states.
    //
    // Story 31.2 deliberately HIDES the column header row below `sm` and gives
    // each cell its own label instead, so the old
    // `getByRole('columnheader', { name: 'Category' })` assertion can no longer
    // hold at 320px. The equivalent proof on a card is the per-cell field
    // label; the two testid assertions below still carry the real work.
    // Scoped to the mobile field-label span inside the row that actually holds
    // the categorized cell — NOT a bare tbody text match, which any row a user
    // happened to name "Category" would satisfy. The <thead> <th> "Category" is
    // still in the DOM (it returns at >= 640px), merely display:none, and it
    // precedes the card labels in document order, so `.first()` alone resolved
    // to the hidden header.
    const categoryCell = page.getByTestId(`${prefix}-row-category`).locator('xpath=ancestor::td[1]')
    await expect(categoryCell.locator('span.sm\\:hidden', { hasText: /^Category$/ })).toBeVisible()
    await expect(page.getByTestId(`${prefix}-row-category`)).toHaveText(categoryText)
    await expect(page.getByTestId(`${prefix}-row-uncategorized`)).toBeVisible()

    await assertNoHorizontalOverflow(page, `${path} (categorized rows)`)
  })
}
