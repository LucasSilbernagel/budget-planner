import { type Page, expect, test } from '@playwright/test'

/**
 * A phone can sort a table (Story 48.1, UX-DR53).
 *
 * ⚠️ WHY THIS IS E2E AND NOT A UNIT TEST. The claim is "ordering is not
 * something only desktop users get", and it has two halves jsdom cannot reach:
 *
 *   1. **The `<thead>` is really hidden.** `RESPONSIVE_THEAD_CLASS` is
 *      `max-sm:hidden`, which is a media query. jsdom applies no stylesheet and
 *      computes no layout, so every unit test in the repo renders the desktop
 *      headers at every "viewport" — the state this control exists for cannot be
 *      constructed there at all.
 *   2. **The rows actually reorder.** The epic AC says so outright: a test that
 *      only asserts the control is PRESENT passes against a control wired to
 *      nothing. Story 47.1 shipped exactly that — a UI fix that was dead code
 *      with 76 green tests through it.
 *
 * ⚠️ Seeded FILE-LOCALLY rather than from `helpers/seed-finance-rows.ts`. That
 * fixture is the shared WIDTH fixture for `responsive-320.spec.ts` and
 * `table-scroll-affordance.spec.ts`, and its own docblock records why both must
 * measure the same rows — editing it to suit this suite would silently move two
 * other suites' measurements.
 *
 * ⚠️ Not added to `table-sort-persistence.spec.ts` either: that suite is pinned
 * to 1280px. It used to locate its tables through the `Move … up` buttons; story
 * 48.2 deleted those and re-keyed the locator onto the per-row `Edit …` button,
 * which is the surviving per-row control.
 */

const CONTROL_LABEL = {
  '/income': 'Sort income sources',
  '/expenses': 'Sort expenses',
  '/savings': 'Sort savings goals and accounts',
  '/balance': 'Sort balance entries',
} as const

type FlowRoute = keyof typeof CONTROL_LABEL

/**
 * ⚠️ MANUAL ORDER DIFFERS FROM BOTH ASCENDING AND DESCENDING.
 *
 * Seeded Zebra→Aardvark→Mango, so:
 *   manual     Zebra, Aardvark, Mango
 *   ascending  Aardvark, Mango, Zebra
 *   descending Zebra, Mango, Aardvark
 *
 * Three rows rather than two, deliberately: with two rows descending is always
 * the reverse of ascending AND one of them usually equals the manual order, so a
 * comparator that ignored its direction argument could still produce a passing
 * sequence. With this seed no two of the three orders coincide.
 */
const ORDERS = {
  manual: ['Zebra Dividend', 'Aardvark Salary', 'Mango Bonus'],
  ascending: ['Aardvark Salary', 'Mango Bonus', 'Zebra Dividend'],
  descending: ['Zebra Dividend', 'Mango Bonus', 'Aardvark Salary'],
  /** Amount descending — a FOURTH distinct order, used by the reload test.
   *
   * ⚠️ The amounts are chosen so this coincides with none of the three above.
   * They originally did not: `amount:desc` produced exactly `ascending`, so the
   * reload test's row-order assertion could not have distinguished a
   * persistence bug that restored `name:asc` instead of `amount:desc` — only its
   * `toHaveValue` check could. Found in code review; the docblock above already
   * claimed no two orders coincide, and it was the row that broke the claim. */
  amountDescending: ['Mango Bonus', 'Zebra Dividend', 'Aardvark Salary'],
} as const

const NAMES = ORDERS.manual

/** Seed three rows into both flow stores via `addInitScript`, so the data is
 * present before the first paint and survives a reload. */
async function seedRows(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // ⚠️ DISTINCT `createdAt` per row. These blobs are seeded at version 2, so
    // the store's v3 `migrate` backfills `sortOrder` from `createdAt ASC -> id
    // ASC`. Identical timestamps would leave the manual order resting on the id
    // tiebreak — deterministic, but an accident rather than a fixture, and
    // exactly the shape story 34.1a's M10 hid behind.
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

    localStorage.setItem(
      'budget-planner-income-v1',
      JSON.stringify({
        state: {
          incomeSources: [
            flowRow('inc-1', 'Zebra Dividend', 700000, 1),
            flowRow('inc-2', 'Aardvark Salary', 500000, 2),
            flowRow('inc-3', 'Mango Bonus', 900000, 3),
          ],
        },
        version: 2,
      })
    )
    const now = (minute: number) => `2026-08-11T00:0${minute}:00.000Z`

    // ⚠️ Savings and Balance seeded too, so the START path is proved on all four
    // routes. Code review flagged that `/savings` and `/balance` were exercised
    // only in the ESCAPE direction (`responsive-320.spec.ts` resets a
    // desktop-started sort) — and `/savings` is the route this story MEASURED at
    // zero width headroom, so it is the last one that should have been thin.
    localStorage.setItem(
      'budget-planner:savings-goals',
      JSON.stringify({
        state: {
          savingsGoals: [
            {
              id: 'sav-1',
              name: 'Zebra Dividend',
              targetAmount: 700000,
              currentBalance: 100000,
              allocationMode: 'manual',
              monthlyAllocation: 10000,
              createdAt: now(1),
              updatedAt: now(1),
            },
            {
              id: 'sav-2',
              name: 'Aardvark Salary',
              targetAmount: 500000,
              currentBalance: 200000,
              allocationMode: 'manual',
              monthlyAllocation: 20000,
              createdAt: now(2),
              updatedAt: now(2),
            },
            {
              id: 'sav-3',
              name: 'Mango Bonus',
              targetAmount: 900000,
              currentBalance: 300000,
              allocationMode: 'manual',
              monthlyAllocation: 30000,
              createdAt: now(3),
              updatedAt: now(3),
            },
          ],
        },
        version: 2,
      })
    )

    localStorage.setItem(
      'budget-planner:balance-tracking',
      JSON.stringify({
        state: {
          entries: [
            {
              id: 'bal-1',
              type: 'investment',
              name: 'Zebra Dividend',
              currentBalance: 700000,
              monthlyContribution: 10000,
              frequency: 'monthly',
              createdAt: now(1),
              updatedAt: now(1),
            },
            {
              id: 'bal-2',
              type: 'investment',
              name: 'Aardvark Salary',
              currentBalance: 500000,
              monthlyContribution: 20000,
              frequency: 'monthly',
              createdAt: now(2),
              updatedAt: now(2),
            },
            {
              id: 'bal-3',
              type: 'investment',
              name: 'Mango Bonus',
              currentBalance: 900000,
              monthlyContribution: 30000,
              frequency: 'monthly',
              createdAt: now(3),
              updatedAt: now(3),
            },
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
            flowRow('exp-1', 'Zebra Dividend', 700000, 1),
            flowRow('exp-2', 'Aardvark Salary', 500000, 2),
            flowRow('exp-3', 'Mango Bonus', 900000, 3),
          ],
        },
        version: 2,
      })
    )
  })
}

function sortControl(page: Page, route: FlowRoute) {
  return page.getByRole('combobox', { name: CONTROL_LABEL[route] })
}

/** Row order in the editable table, reported by whichever seeded name each row
 * carries. Reads the rendered DOM, not the store. */
function renderedOrder(page: Page) {
  return page
    .locator('div.overflow-x-auto table tbody tr')
    .evaluateAll(
      (rows, seeded) =>
        rows.map((row) => seeded.find((name) => (row.textContent ?? '').includes(name)) ?? ''),
      NAMES as unknown as string[]
    )
}

async function openNarrow(page: Page, route: FlowRoute): Promise<void> {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto(route)
  await page.waitForLoadState('networkidle')
}

test.beforeEach(async ({ page }) => {
  await seedRows(page)
})

for (const route of Object.keys(CONTROL_LABEL) as FlowRoute[]) {
  test(`${route} reorders rows from the mobile control at 320px (AC-16)`, async ({ page }) => {
    await openNarrow(page, route)

    // The precondition that makes this suite meaningful. If the header were
    // reachable here, everything below could be satisfied by the desktop path.
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeHidden()

    const control = sortControl(page, route)
    await expect(control).toBeVisible()
    await expect(control).toHaveValue('manual')
    await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.manual)

    await control.selectOption('name:asc')
    await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.ascending)

    // ⚠️ BOTH directions, and neither equals the manual order for this seed. A
    // comparator that ignored `direction` would pass an ascending-only check.
    await control.selectOption('name:desc')
    await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.descending)

    await control.selectOption('manual')
    await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.manual)
  })
}

test('a sort started on a phone survives a reload (AC-3)', async ({ page }) => {
  await openNarrow(page, '/income')

  await sortControl(page, '/income').selectOption('amount:desc')
  await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.amountDescending)

  await page.reload()
  await page.waitForLoadState('networkidle')

  // Nothing was activated after the reload: the order and the control's value
  // can only have come out of storage — the same slice a header click writes.
  await expect(sortControl(page, '/income')).toHaveValue('amount:desc')
  await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.amountDescending)
})

test('a sort chosen on a phone is the sort the desktop headers report (AC-2)', async ({ page }) => {
  // ⚠️ THE SINGLE-SOURCE-OF-TRUTH CLAIM, observed across a viewport change —
  // which is the only place it can be observed, because the two surfaces are
  // never visible at the same width.
  await openNarrow(page, '/income')
  await sortControl(page, '/income').selectOption('name:desc')
  await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.descending)

  await page.setViewportSize({ width: 1280, height: 720 })

  const nameHeader = page.getByRole('columnheader', { name: 'Name' })
  await expect(nameHeader).toBeVisible()
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
  await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.descending)

  // And back the other way. ⚠️ This is the FIRST header activation of the test —
  // the `desc` state came from the phone `<select>`, not from two prior clicks —
  // and it clears the sort precisely because the cycle resumes from the stored
  // state (`nextSortState(desc) -> null`). That continuity is the claim: the two
  // surfaces share one state machine, not just one value.
  await nameHeader.getByRole('button', { name: 'Name' }).click()
  await expect(nameHeader).toHaveAttribute('aria-sort', 'none')
  await page.setViewportSize({ width: 320, height: 720 })
  await expect(sortControl(page, '/income')).toHaveValue('manual')
})

test('a sort on Income does not follow the user to Expenses (AC-3)', async ({ page }) => {
  await openNarrow(page, '/income')
  await sortControl(page, '/income').selectOption('name:asc')
  await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.ascending)

  // ⚠️ The scoping claim lives on the OTHER table. Expenses was never sorted, so
  // it must still be in manual order — asserting Income alone stays green
  // against a control that writes every slice.
  await openNarrow(page, '/expenses')
  await expect(sortControl(page, '/expenses')).toHaveValue('manual')
  await expect.poll(() => renderedOrder(page)).toEqual(ORDERS.manual)
})

test('the control fits 320px and does not push the table into horizontal scroll (AC-8)', async ({
  page,
}) => {
  // ⚠️ THE WIDTH CLAIM, AND IT CANNOT BE MADE IN jsdom. A `<select>`'s intrinsic
  // width is set by its longest `<option>`; without the explicit `w-full` /
  // `min-w-0` constraint the box grows past the card. The control sits OUTSIDE
  // `div.overflow-x-auto`, so its overflow reaches `documentElement` rather than
  // being absorbed by the table's own scroll container.
  await openNarrow(page, '/income')
  await expect(sortControl(page, '/income')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement
    const wrapper = document.querySelector('div.overflow-x-auto')
    return {
      docScroll: doc.scrollWidth,
      docClient: doc.clientWidth,
      wrapperScroll: wrapper?.scrollWidth ?? 0,
      wrapperClient: wrapper?.clientWidth ?? 0,
    }
  })

  expect(metrics.docScroll, 'the document scrolls horizontally at 320px').toBeLessThanOrEqual(
    metrics.docClient
  )
  expect(
    metrics.wrapperScroll,
    'the table wrapper scrolls horizontally at 320px'
  ).toBeLessThanOrEqual(metrics.wrapperClient)

  // ⚠️ A RENDERED box. `assertHasMobileTapTarget` proves the `max-sm:` tokens are
  // declared; only a real layout proves they resolve on an element that is not
  // `display: none`.
  const box = await sortControl(page, '/income').boundingBox()
  expect(box, 'the mobile sort control has no layout box at 320px').not.toBeNull()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.width ?? 0, 'the control is wider than the viewport').toBeLessThanOrEqual(320)
})

test('the control is sized by its container, not by its longest option (AC-8)', async ({
  page,
}) => {
  /**
   * ⚠️ MEASURED, AND THE MEASUREMENT CORRECTED THE CLAIM THIS TEST WAS WRITTEN
   * FOR. The design note said the `w-full` constraint stops the control
   * OVERFLOWING 320px. It does not: with the constraint removed, nothing
   * overflows on any route. What actually happens is that the box stops tracking
   * the container and starts tracking the longest `<option>` — a `<select>`'s
   * intrinsic width in Chrome and Firefox.
   *
   * Measured at 320px with `* { font-family: "DejaVu Sans" }`, the face CI
   * resolves `system-ui` to (a dev box picks the narrower Noto Sans, so a local
   * run understates every figure here):
   *
   *   route      constrained   unconstrained
   *   /income        240            215
   *   /expenses      240            215
   *   /balance       240            263   ← see the 49.1 note below
   *   /savings       240            272   ← equals the card interior exactly
   *
   * ⚠️ Story 49.1 (FR75) changed `/balance`'s OPTION SET: it lost
   * "Max Contribution" and "Remaining Room" and its balance option grew to
   * "Current Balance/Value", so the longest option went from
   * "Max Contribution (descending)" (29 chars) to
   * "Current Balance/Value (descending)" (34). Re-measured at 320px under the CI
   * font: the control is still 240px in a 240px container, i.e. the constraint
   * absorbed the longer label exactly as this test claims it should. The
   * UNCONSTRAINED 263px figure above was NOT re-measured and is therefore stale
   * for `/balance` — it is left as the historical figure that motivated the
   * guard rather than silently updated to a number nobody checked.
   *
   * So the guard is real but FORWARD-LOOKING: `/savings` already sits on the
   * boundary with zero headroom, and one more character in any option label
   * would put it over. This test pins the mechanism — container-driven, not
   * content-driven — rather than an overflow that does not yet occur, because
   * an assertion for an overflow nothing produces could never fail.
   */
  // ⚠️ `/savings`, NOT `/income`. This is the route the measurements below name
  // as having ZERO headroom (272px unconstrained against a 272px card interior
  // under CI's font), so it is the one where the mechanism actually matters.
  // The pin originally ran on `/income`, the widest-margin route of the four.
  await openNarrow(page, '/savings')
  const control = sortControl(page, '/savings')
  await expect(control).toBeVisible()

  const widths = await control.evaluate((el) => {
    const parent = el.parentElement?.parentElement
    const parentStyle = parent === null || parent === undefined ? null : getComputedStyle(parent)
    return {
      control: el.getBoundingClientRect().width,
      containerContent:
        parent === null || parent === undefined || parentStyle === null
          ? 0
          : parent.getBoundingClientRect().width -
            Number.parseFloat(parentStyle.paddingLeft) -
            Number.parseFloat(parentStyle.paddingRight),
    }
  })

  expect(widths.containerContent, 'the control has no measurable container').toBeGreaterThan(0)
  // 1px tolerance for sub-pixel rounding. Under the mutation that drops the
  // width constraint this reads 215 against a 240 container.
  expect(
    Math.abs(widths.control - widths.containerContent),
    `the control is ${widths.control}px inside a ${widths.containerContent}px container — it is sized by its longest option, not by its box`
  ).toBeLessThanOrEqual(1)
})

test('the control is not reachable at 1280px (AC-1)', async ({ page }) => {
  // `sm:hidden` is the whole visibility rule. Asserting only that it APPEARS at
  // 320px would pass against a control with no breakpoint scoping at all, which
  // would add a redundant second sort surface to every desktop page.
  // (`test.beforeEach` already seeded — do not seed again.)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/income')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible()
  await expect(sortControl(page, '/income')).toBeHidden()
})
