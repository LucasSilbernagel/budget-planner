import { type Page, expect, test } from '@playwright/test'

/**
 * Custom categories E2E (story 30.4b, FR54 — AC-4, AC-5, AC-1).
 *
 * Three things jsdom cannot prove:
 *   1. The `/categories` route gate against the REAL hydration path, not a
 *      mocked hook (project memory 4-11: SSR/curl smoke misses post-hydration
 *      bugs, and a mocked gate tests the mock).
 *   2. That the LOCKED picker inside the Add/Edit modal NAVIGATES to `/pricing`
 *      in a real browser (story 41.2, FR66) — the default experience for every
 *      non-premium visitor, which is what this suite runs as — leaving no second
 *      dialog behind it, no surviving modal, and no body scroll-lock. jsdom can
 *      prove none of that: it never navigates, and it never scrolls.
 *   3. That a free visitor's income/expense tables carry NO Category column at
 *      all (story 33.3, FR57), against the real hydration path. The
 *      `responsive-320.spec.ts` route sweep runs with EMPTY localStorage, so the
 *      tables render their empty state there and the column's absence is never
 *      exercised with rows present.
 *
 * ⚠️ SCOPE LIMIT, stated rather than hidden: this suite is UNAUTHENTICATED — the
 * same constraint `premium-locked.spec.ts` and `report-print.spec.ts` work
 * under, since there is no session seeding available here. So the management
 * list itself cannot be rendered end to end; `CategoryManager.test.tsx` covers
 * its behaviour and this file covers the gate plus the free tier's absent column.
 *
 * ⚠️ AND THE SAME LIMIT NOW BOUNDS FR57: since story 33.3 the Category column
 * renders ONLY for entitled users, and no unauthenticated run can reach that
 * branch — so the 5-column table is UNREACHABLE in e2e entirely. Every
 * assertion below is therefore a NEGATIVE. The entitled branch (and the
 * header/cell parity that stops a half-applied gate) is proved in
 * `category-assignment.test.tsx`, which is the only layer that can mock a tier.
 * Do not add a "premium sees the column" test here; it could only ever pass by
 * asserting nothing.
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
 * Just above the `sm` (640px) breakpoint, where story 31.2's card layout gives
 * way to a real table and the `<thead>` is displayed again.
 *
 * ⚠️ THIS IS THE WIDTH THAT MATTERS FOR OVERFLOW, and the reason it is in this
 * list (code review 33.3). The pre-33.3 five-column table overflowed its
 * `div.overflow-x-auto` wrapper by ~156px (`/income`) and ~153px (`/expenses`)
 * at exactly 768px — measured, and invisible to every documentElement check
 * because the scroll wrapper absorbs it. The first version of this test ran only
 * at 320px and 1280px, i.e. at the two widths where that failure mode CANNOT
 * occur: at 320px the rows are cards, and at 1280px there is slack. The wrapper
 * assertion below was therefore unable to fire. Do not drop this width.
 */
const OVERFLOW_WIDTH = 768
/**
 * A comfortable desktop width. Here the `<thead>` is displayed and the header
 * query is the load-bearing claim, whereas at 320px the header is `display:none`
 * and the per-cell field label carries it.
 *
 * ⚠️ Note what the extra widths do and do not buy. The gate is conditional JSX,
 * so the DOM is identical at every width and the count assertions below would
 * catch a half-applied gate at any one of them. What varies by width is the
 * anti-vacuity visibility guard and the overflow measurement — which is exactly
 * why 768px earns its place and why this comment no longer claims the widths
 * discriminate on the gate itself.
 */
const WIDE_WIDTH = 1280

/**
 * Slack allowed on the table-wrapper overflow assertion below, in CSS pixels.
 *
 * ⚠️ WHY IT IS NOT ZERO. The four-column table is content-sized (`min-w-full`
 * with auto layout), so its intrinsic width is a sum of GLYPH widths — and the
 * seed data deliberately maximises them (a 12-digit currency figure and a long
 * name). At 768px that lands within a couple of pixels of the 656px wrapper:
 * measured 656/656 exactly on a local Linux desktop, and 658/656 on the GitHub
 * runner, whose fontconfig resolves `system-ui` to a slightly wider face. Both
 * CI retries reported the identical 658, so this is a deterministic font-metric
 * difference between hosts, not a flake — and a 2px scroll inside a wrapper that
 * exists to scroll is not the failure this test is about.
 *
 * ⚠️ AND THAT HOST DIFFERENCE IS LARGER THAN "A COUPLE OF PIXELS" ONCE THE
 * TABLE STOPS FITTING. Story 34.1b added two move chevrons to the Actions
 * column, worth a host-independent 48px. On a dev box the text columns absorbed
 * 32px of that by compressing, so this guard measured 672 — under the 680 limit,
 * green. On the runner there was nothing left to compress and it measured 706
 * (`/income`) and 697 (`/expenses`), and CI went red three retries running.
 * The fix was to reclaim the 48px in `ResponsiveTable.tsx` (`max-lg:px-4`), NOT
 * to grow the tolerance; see the width-budget block there for the measurements.
 *
 * The lesson this file should carry: THIS ASSERTION IS THE ONE THING IN THE
 * SUITE A GREEN LOCAL RUN SAYS NOTHING ABOUT. Every other assertion here is a
 * DOM count, identical on every host. If you change anything that adds fixed
 * pixels to these tables, re-measure with `system-ui` forced to DejaVu Sans
 * (what the runner picks) before believing a local pass.
 *
 * ⚠️ WHY IT IS STILL SMALL. The regression being guarded is the pre-33.3
 * five-column table, which overflowed by ~156px (`/income`) and ~153px
 * (`/expenses`) at this width. The tolerance is roughly a sixth of that, so a
 * column leaking back in still fails loudly. Do not grow it to silence a
 * failure without first measuring WHICH column reappeared.
 */
const OVERFLOW_TOLERANCE_PX = 24

/**
 * Seed CATEGORIZED income and expense rows plus their categories.
 *
 * The rows carry real `categoryId`s deliberately. Since story 33.3 that is what
 * makes the absence assertions meaningful rather than vacuous: these rows WOULD
 * render a populated category pill if the tier gate were removed, so the test
 * fails if the gate regresses — instead of passing because there was nothing to
 * show in the first place.
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

/**
 * Story 41.2 (FR66) — the locked picker leads to Pricing.
 *
 * ⚠️ This test REPLACES the 30.4b assertion that clicking the locked picker did
 * nothing. That assertion was "no second dialog appears", which an `<a>`
 * satisfies trivially — it would have stayed GREEN against this change while
 * documenting the opposite rule. What makes it fail if the fix regresses is the
 * URL, plus the two things only a browser can check: that the entry modal is
 * really gone, and that the page really scrolls afterwards.
 */
for (const { path, prefix, addButton, dialogName } of [
  { path: '/expenses', prefix: 'expense', addButton: '+ Add Expense', dialogName: 'Add Expense' },
  {
    path: '/income',
    prefix: 'income',
    addButton: '+ Add Income Source',
    dialogName: 'Add Income Source',
  },
] as const) {
  test(`41.2 AC-1/AC-2: the locked picker in the ${dialogName} modal navigates to /pricing and releases the page`, async ({
    page,
  }) => {
    await page.goto(path)
    const trigger = page.getByRole('button', { name: addButton })
    const dialog = page.getByRole('dialog', { name: dialogName })

    // Survive a pre-hydration click, as the other modal specs do.
    await expect(async () => {
      await trigger.click()
      await expect(dialog).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15000 })

    await expect(page.getByRole('dialog')).toHaveCount(1)

    const locked = page.getByTestId(`${prefix}-category-locked`)
    await expect(locked).toBeVisible()
    const link = locked.getByRole('link')
    await expect(link).toHaveAttribute('href', '/pricing')

    await link.click()

    // Arrived, and the entry modal did not come along.
    await expect(page).toHaveURL(/\/pricing$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // No upgrade dialog either: the fix is a navigation, never a nested modal.
    await expect(page.getByRole('dialog', { name: /go premium/i })).toHaveCount(0)

    // ⚠️ The locked control is a plain `<a href>`, so this is a REAL document
    // load. Wait for it to commit before touching the new document: without this,
    // `page.evaluate` races the swap and the probe reads a document that is not
    // the one under test — either a `document.body` that is still null (the
    // evaluate THROWS on `document.body.style`) or a body that has not been laid
    // out yet (`scrollY` reads 0, which is indistinguishable from the scroll lock
    // this test exists to catch). Measured while writing this test: the two route
    // arms disagreed until the wait was added.
    await page.waitForLoadState('load')
    await page.setViewportSize({ width: 1280, height: 400 })

    // ⚠️ Assert REAL SCROLLING, not `body.style.overflow`. Story 41.1 measured
    // that the style property and the observable behaviour can disagree, and a
    // wedged page is the user-visible failure this guards. The precondition is
    // asserted separately so a short page can never make this vacuously green.
    const scroll = await page.evaluate(() => {
      window.scrollTo(0, 400)
      return {
        scrollY: window.scrollY,
        scrollable: document.documentElement.scrollHeight > window.innerHeight,
        overflow: document.body.style.overflow,
      }
    })
    expect(scroll.scrollable, '/pricing is not tall enough to prove scrolling works').toBe(true)
    expect(
      scroll.scrollY,
      `page is scroll-locked after leaving the entry modal (body.style.overflow=${scroll.overflow})`
    ).toBeGreaterThan(0)

    // ⚠️ Focus. The obvious assertion here —
    // `activeElement === body || activeElement.isConnected` — is a TAUTOLOGY:
    // `document.activeElement` only ever returns `body` or an in-document
    // element, so no arm can be false, and in the SPA-refactor regression it
    // would supposedly guard, focus drops to `body` and satisfies the first arm
    // anyway. It asserted nothing. What IS falsifiable is that focus did not stay
    // on a control belonging to the abandoned form: after this navigation nothing
    // from the entry modal may hold focus.
    const focus = await page.evaluate(() => {
      const el = document.activeElement
      return {
        tag: el?.tagName ?? null,
        inLockedPicker: el?.closest('[data-testid$="-category-locked"]') !== null && el !== null,
        inDialog: el?.closest('[role="dialog"]') !== null && el !== null,
      }
    })
    expect(focus.inLockedPicker, 'focus is still inside the abandoned picker').toBe(false)
    expect(focus.inDialog, 'focus is still inside a dialog after navigating away').toBe(false)
  })
}

for (const { path, prefix, seededRowName, categoryText } of [
  {
    path: '/income',
    prefix: 'income',
    seededRowName: 'Primary Salary Long Name',
    categoryText: 'Employment Income',
  },
  {
    path: '/expenses',
    prefix: 'expense',
    seededRowName: 'Mortgage & Housing Costs',
    categoryText: 'Household & Utilities',
  },
] as const) {
  for (const width of [NARROW_WIDTH, OVERFLOW_WIDTH, WIDE_WIDTH] as const) {
    test(`${path} renders no Category column for a free visitor at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 })
      await seedCategorizedRows(page)

      const response = await page.goto(path)
      expect(response?.ok(), `expected ${path} to load`).toBeTruthy()
      await page.waitForLoadState('networkidle')

      // ANTI-VACUITY GUARD, first. Every assertion below is a NEGATIVE, and a
      // page that failed to render its rows at all would satisfy all of them.
      // Prove the seeded rows really arrived before proving what is missing.
      await expect(page.getByText(seededRowName)).toBeVisible()

      // The category pill and the "—" placeholder are BOTH absent — asserting
      // only one leaves the other free to leak.
      //
      // ⚠️ `toHaveCount(0)`, never `toBeHidden()`. The gate is conditional JSX,
      // so the honest claim is DOM absence — and `toBeHidden()` would also pass
      // for a CSS-class implementation, which would still leak the column onto
      // PRINTED output (print resolves at ~700-816px paper width, above the
      // 640px `sm` breakpoint).
      await expect(page.getByTestId(`${prefix}-row-category`)).toHaveCount(0)
      await expect(page.getByTestId(`${prefix}-row-uncategorized`)).toHaveCount(0)
      // The category NAME must not reach the page by any other route either.
      await expect(page.getByText(categoryText)).toHaveCount(0)

      // The header, queried by DOM text rather than by role.
      //
      // ⚠️ `getByRole('columnheader', { name: 'Category' })` would be VACUOUS at
      // 320px: story 31.2 makes the <thead> `display:none` below `sm`, and
      // Chromium drops it from the accessibility tree regardless of tier — so
      // that assertion passes for free AND premium users and can never fail the
      // mobile case. A DOM text query sees the element whether or not it is
      // displayed, which is exactly what an absence claim needs.
      await expect(page.locator('thead th', { hasText: /^Category$/ })).toHaveCount(0)

      // And no card carries the mobile Category field label either (story 31.2
      // renders it from the same <td>, so this falls out — assert it anyway, so
      // a future split of the two cannot go unnoticed).
      await expect(
        page.locator('tbody span.sm\\:hidden').filter({ hasText: /^Category$/ })
      ).toHaveCount(0)

      await assertNoHorizontalOverflow(page, `${path} (free tier, ${width}px)`)

      // ⚠️ The document-level check above cannot fail on these pages — every
      // table sits inside a `div.overflow-x-auto`, and a scroll container
      // ABSORBS its content's overflow (see `responsive-320.spec.ts:285-303`).
      // The wrapper itself is where the overflow would show, and gating the
      // column is what removes it: at 768px the 5-column table overflowed its
      // wrapper by ~155px.
      const wrapperOverflow = await page.evaluate(() => {
        const wrapper = document.querySelector('div.overflow-x-auto')
        if (!wrapper) return null
        return { scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth }
      })
      expect(wrapperOverflow, `expected a table scroll wrapper on ${path}`).not.toBeNull()
      const scrollWidth = wrapperOverflow?.scrollWidth ?? 0
      const clientWidth = wrapperOverflow?.clientWidth ?? 0
      expect(
        scrollWidth,
        `${path} table wrapper overflows at ${width}px: scrollWidth ${scrollWidth} > clientWidth ${clientWidth} + ${OVERFLOW_TOLERANCE_PX}px tolerance`
      ).toBeLessThanOrEqual(clientWidth + OVERFLOW_TOLERANCE_PX)
    })
  }
}
