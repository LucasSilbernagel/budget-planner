import { expect, test } from '@playwright/test'
import { LONG_UNBROKEN_NAME, seedFinanceRows } from './helpers/seed-finance-rows'

test.describe('finance tables fit a 320px viewport with real rows (story 31.2)', () => {
  /**
   * Column sorting (story 34.2, FR61).
   *
   * ⚠️ These run at 1280px, not 320px, and that is the point: the `<thead>` is
   * `max-sm:hidden`, so the HEADER affordance does not exist below `sm`.
   *
   * ⚠️ It is no longer true that "sorting is a >= 640px feature by ratified
   * decision" — story 48.1 (UX-DR53) added `TableSortControl`, which starts a
   * sort below `sm`. The test after this one covers it at 320px in both schemes,
   * including the case this suite has always cared about: a sort started on
   * desktop and carried into a narrow viewport.
   *
   * ⚠️ Expected sequences are written out as LITERALS per route. Deriving them
   * from the seed with a comparator would guard nothing — the comparator is the
   * thing under test. The seed has two rows per table, and on `/balance` the
   * ascending order deliberately EQUALS the manual order ('Longest…' < 'Mortgage'),
   * which is why both directions are pinned rather than just "the order changed".
   */
  const SORT_BY_NAME_EXPECTATIONS: Record<string, { asc: string[]; desc: string[] }> = {
    '/income': {
      asc: ['Freelance & Consulting', LONG_UNBROKEN_NAME],
      desc: [LONG_UNBROKEN_NAME, 'Freelance & Consulting'],
    },
    '/expenses': {
      asc: ['Groceries', LONG_UNBROKEN_NAME],
      desc: [LONG_UNBROKEN_NAME, 'Groceries'],
    },
    '/savings': {
      asc: ['Emergency Fund', LONG_UNBROKEN_NAME],
      desc: [LONG_UNBROKEN_NAME, 'Emergency Fund'],
    },
    '/balance': {
      asc: [LONG_UNBROKEN_NAME, 'Mortgage'],
      desc: ['Mortgage', LONG_UNBROKEN_NAME],
    },
  }

  for (const route of ['/income', '/expenses', '/savings', '/balance'] as const) {
    /** The EDITABLE table's `<thead>` — the one carrying the per-row Edit controls.
     *
     * ⚠️ Scoped on purpose, mirroring the BalancePage unit suite, even though
     * `/balance` now renders a single table. An unscoped
     * `getByRole('columnheader', {name})` would silently widen to any table a
     * future story adds to this page, and a duplicated column name there would
     * surface as a strict-mode violation rather than a caught regression. */
    function sortHeader(page: import('@playwright/test').Page, name: string) {
      return page
        .locator('div.overflow-x-auto table')
        .filter({ has: page.getByRole('button', { name: /^Edit .+$/ }) })
        .getByRole('columnheader', { name })
    }

    /** Row order in the EDITABLE table, by whichever seeded name each row carries.
     *
     * ⚠️⚠️ THE SCOPING IS REAL BUT ITS ENFORCEMENT IS NOT STRICT HERE (48.2 review):
     * `evaluateAll` does NOT apply Playwright strict mode, so if a second
     * Edit-carrying table ever appeared this would CONCATENATE both tables' rows
     * rather than fail. `/^Edit .+$/` is a likelier future collision than the
     * `/^Move .+ up$/` it replaced. The `sortHeader` helper above IS strict and
     * would redden first (proven by mutation arm M8: 7 failures), which is what
     * keeps this acceptable rather than silent.
     *
     * ⚠️ Scoped to the table holding the per-row Edit controls. Kept scoped even though
     * `/balance` now renders one table: an unscoped query would concatenate the
     * rows of any table later added to this page, silently corrupting every
     * ordering assertion below rather than failing. */
    function editableOrder(page: import('@playwright/test').Page, names: string[]) {
      return page
        .locator('div.overflow-x-auto table')
        .filter({ has: page.getByRole('button', { name: /^Edit .+$/ }) })
        .locator('tbody tr')
        .evaluateAll(
          (rows, seeded) =>
            rows.map((row) => seeded.find((name) => (row.textContent ?? '').includes(name)) ?? ''),
          names
        )
    }

    test(`${route} sorts by a column header at 1280px (34.2)`, async ({ page }) => {
      const expected = SORT_BY_NAME_EXPECTATIONS[route] as { asc: string[]; desc: string[] }
      const names = expected.asc
      await page.setViewportSize({ width: 1280, height: 720 })
      await seedFinanceRows(page)

      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

      const nameHeader = sortHeader(page, 'Name')
      await expect(nameHeader).toHaveAttribute('aria-sort', 'none')
      const manual = await editableOrder(page, names)
      expect(manual).toHaveLength(2)

      const sortButton = nameHeader.getByRole('button', { name: 'Name' })
      await sortButton.click()
      await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
      await expect.poll(() => editableOrder(page, names)).toEqual(expected.asc)

      await sortButton.click()
      await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
      await expect.poll(() => editableOrder(page, names)).toEqual(expected.desc)

      // The third activation is the return to manual order — there is no
      // separate reset control at this width.
      await sortButton.click()
      await expect(nameHeader).toHaveAttribute('aria-sort', 'none')
      await expect.poll(() => editableOrder(page, names)).toEqual(manual)
    })
  }
})
