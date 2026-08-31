import { type Page, expect, test } from '@playwright/test'

/**
 * A column sort survives a reload and a navigation (Story 42.1, FR67).
 *
 * ⚠️ WHY THIS IS E2E AND NOT A UNIT TEST. The claim is "the sort is still there
 * when you come back". A unit test can only re-MOUNT a component, and a remount
 * is satisfied by state that never left the browser tab. Only a real
 * `page.reload()` — a fresh document, fresh JS context, storage the sole carrier
 * — can distinguish persistence from a component that simply was not unmounted.
 *
 * ⚠️ Runs at 1280px, and deliberately exercises the HEADER path only. The
 * `<thead>` is `max-sm:hidden`, so these clicks are unreachable below `sm`.
 *
 * ⚠️ This used to add that a sort "cannot be STARTED at 320px" and that
 * `deferred-work.md` recorded the gap as open. Story 48.1 (UX-DR53) closed it:
 * `TableSortControl` starts a sort below `sm`, and its persistence is proved at
 * a mobile viewport in `mobile-table-sort.spec.ts`. Both surfaces write the same
 * store slice, so this file still describes the desktop half of one claim.
 *
 * ⚠️ Seeded independently of `responsive-320.spec.ts` rather than by importing
 * its helper: importing a Playwright spec file re-registers every `test()` in it.
 */

const ROWS = {
  income: ['Aardvark Salary', 'Zebra Dividend'],
  expenses: ['Anchovies', 'Zucchini'],
} as const

/** Seed two rows per table via `addInitScript`, which re-runs on every document
 * — so the data survives the reload this suite is built around. */
async function seedRows(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // ⚠️ DISTINCT `createdAt` per row. These blobs are seeded at version 2, so
    // the income/expense store's v3 `migrate` backfills `sortOrder` using
    // `createdAt ASC -> id ASC`. Identical timestamps would leave the manual
    // order resting entirely on the id tiebreak — deterministic, but an accident
    // rather than a fixture, and exactly the shape 34.1a's M10 hid behind.
    const flowRow = (id: string, name: string, amount: number, minute: number) => ({
      id,
      userId: 0,
      name,
      amount,
      frequency: 'monthly',
      categoryId: null,
      createdAt: `2026-08-11T00:0${minute}:00.000Z`,
      updatedAt: `2026-08-11T00:0${minute}:00.000Z`,
    })

    // ⚠️ Manual order is Zebra-then-Aardvark on BOTH tables, so it differs from
    // ascending AND from descending by name. A seed whose manual order happens
    // to equal one of them cannot tell a working sort from a broken one.
    localStorage.setItem(
      'budget-planner-income-v1',
      JSON.stringify({
        state: {
          incomeSources: [
            flowRow('inc-1', 'Zebra Dividend', 500000, 1),
            flowRow('inc-2', 'Aardvark Salary', 900000, 2),
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
            flowRow('exp-1', 'Zucchini', 300000, 1),
            flowRow('exp-2', 'Anchovies', 700000, 2),
          ],
        },
        version: 2,
      })
    )
  })
}

/** The editable table's header — the one carrying the move controls. */
function sortHeader(page: Page, name: string) {
  return page
    .locator('div.overflow-x-auto table')
    .filter({ has: page.getByRole('button', { name: /^Move .+ up$/ }) })
    .getByRole('columnheader', { name })
}

/** Row order in the editable table, reported by whichever seeded name each row carries. */
function editableOrder(page: Page, names: readonly string[]) {
  return page
    .locator('div.overflow-x-auto table')
    .filter({ has: page.getByRole('button', { name: /^Move .+ up$/ }) })
    .locator('tbody tr')
    .evaluateAll(
      (rows, seeded) =>
        rows.map((row) => seeded.find((name) => (row.textContent ?? '').includes(name)) ?? ''),
      names as string[]
    )
}

async function openAt(page: Page, route: string): Promise<void> {
  await page.goto(route)
  await page.waitForLoadState('networkidle')
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await seedRows(page)
})

test('an Income sort survives a full page reload', async ({ page }) => {
  const names = ROWS.income
  const manual = ['Zebra Dividend', 'Aardvark Salary']
  const ascending = ['Aardvark Salary', 'Zebra Dividend']

  await openAt(page, '/income')
  await expect.poll(() => editableOrder(page, names)).toEqual(manual)

  await sortHeader(page, 'Name').getByRole('button', { name: 'Name' }).click()
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'ascending')
  await expect.poll(() => editableOrder(page, names)).toEqual(ascending)

  await page.reload()
  await page.waitForLoadState('networkidle')

  // Nothing was activated after the reload. The order and the `aria-sort` token
  // can only have come out of storage.
  await expect.poll(() => editableOrder(page, names)).toEqual(ascending)
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'ascending')
})

test('the DIRECTION survives a reload, not just the column', async ({ page }) => {
  const names = ROWS.income
  const descending = ['Zebra Dividend', 'Aardvark Salary']

  await openAt(page, '/income')
  const button = sortHeader(page, 'Name').getByRole('button', { name: 'Name' })
  await button.click()
  await button.click()
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'descending')

  await page.reload()
  await page.waitForLoadState('networkidle')

  // ⚠️ Descending happens to equal the manual order for this seed, which is why
  // the `aria-sort` token is asserted too — the row order alone cannot tell
  // "restored descending" from "restored nothing".
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'descending')
  await expect.poll(() => editableOrder(page, names)).toEqual(descending)
})

test('a sort survives navigating away and back', async ({ page }) => {
  const names = ROWS.income
  const ascending = ['Aardvark Salary', 'Zebra Dividend']

  await openAt(page, '/income')
  await sortHeader(page, 'Name').getByRole('button', { name: 'Name' }).click()
  await expect.poll(() => editableOrder(page, names)).toEqual(ascending)

  await openAt(page, '/expenses')
  await openAt(page, '/income')

  await expect.poll(() => editableOrder(page, names)).toEqual(ascending)
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'ascending')
})

test('clearing the sort also persists, and returns to manual order', async ({ page }) => {
  const names = ROWS.income
  const manual = ['Zebra Dividend', 'Aardvark Salary']

  await openAt(page, '/income')
  const button = sortHeader(page, 'Name').getByRole('button', { name: 'Name' })
  // none -> asc -> desc -> none. The third activation is the reset at this width.
  await button.click()
  await button.click()
  await button.click()
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'none')

  // ⚠️ A SECOND, STILL-SORTED TABLE is what makes this test falsifiable.
  // Measured: with `partialize` returning nothing — i.e. persistence entirely
  // broken — the Income half below stays GREEN, because "cleared" and "never
  // stored" are indistinguishable after a reload. Expenses carries the other
  // half of the claim: storage must be working for its sort to come back.
  await openAt(page, '/expenses')
  await sortHeader(page, 'Name').getByRole('button', { name: 'Name' }).click()
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'ascending')

  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'ascending')

  await openAt(page, '/income')

  // The other half of AC-3: a CLEARED sort must persist AS CLEARED, while a
  // sibling table's sort survives the same reload.
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'none')
  await expect.poll(() => editableOrder(page, names)).toEqual(manual)
})

test('a sort on Income does not follow the user to Expenses (AC-4)', async ({ page }) => {
  await openAt(page, '/income')
  await sortHeader(page, 'Name').getByRole('button', { name: 'Name' }).click()
  await expect
    .poll(() => editableOrder(page, ROWS.income))
    .toEqual(['Aardvark Salary', 'Zebra Dividend'])

  await openAt(page, '/expenses')

  // ⚠️ The scoping claim lives on the OTHER table. Expenses was never sorted, so
  // it must still be in manual order — Zucchini first.
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'none')
  await expect.poll(() => editableOrder(page, ROWS.expenses)).toEqual(['Zucchini', 'Anchovies'])

  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'none')
  await expect.poll(() => editableOrder(page, ROWS.expenses)).toEqual(['Zucchini', 'Anchovies'])
})

test('two tables carry two independent sorts across a reload', async ({ page }) => {
  await openAt(page, '/income')
  await sortHeader(page, 'Name').getByRole('button', { name: 'Name' }).click()
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'ascending')

  await openAt(page, '/expenses')
  const expensesName = sortHeader(page, 'Name').getByRole('button', { name: 'Name' })
  await expensesName.click()
  await expensesName.click()
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'descending')

  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'descending')
  await expect.poll(() => editableOrder(page, ROWS.expenses)).toEqual(['Zucchini', 'Anchovies'])

  await openAt(page, '/income')
  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'ascending')
  await expect
    .poll(() => editableOrder(page, ROWS.income))
    .toEqual(['Aardvark Salary', 'Zebra Dividend'])
})

test('a corrupt persisted payload opens in manual order instead of breaking the page', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'budget-planner-table-sort-v1',
      // Same version as the app writes, so `migrate` never sees it — this is the
      // path a real corrupt payload takes.
      JSON.stringify({ state: { sorts: { income: 'amount' } }, version: 1 })
    )
  })

  await openAt(page, '/income')

  await expect(sortHeader(page, 'Name')).toHaveAttribute('aria-sort', 'none')
  await expect
    .poll(() => editableOrder(page, ROWS.income))
    .toEqual(['Zebra Dividend', 'Aardvark Salary'])
  // The table is present and operable, not a blank void.
  await expect(page.getByRole('button', { name: /^Move .+ up$/ }).first()).toBeVisible()
})
