import { type Page, expect, test } from '@playwright/test'

/**
 * The retirement plan survives a reload and a navigation (Story 44.1, FR71).
 *
 * ⚠️ Since story 84.5 (FR137) this file holds ONE test: flow F3, "every entered
 * value survives a reload", in a real browser. The route-change, first-visit,
 * cleared-field, mirror-hint and corrupt-payload claims moved below the browser
 * (`src/components/__tests__/retirement-plan-persistence.dom.test.tsx`; list in
 * `_bmad-output/implementation-artifacts/84-5-evidence/inventory.md`).
 *
 * ⚠️ WHY THIS IS E2E AND NOT A UNIT TEST. The claim is "the numbers are still
 * there when you come back". A unit test can only re-MOUNT the component, and a
 * remount is satisfied by a zustand module singleton that never wrote to storage
 * at all. Only a real `page.reload()` — fresh document, fresh JS context,
 * storage the sole carrier — can tell persistence from a component that simply
 * was not unmounted. Before this story the plan was lost on BOTH a reload and a
 * route change, and the route change was the more common loss.
 *
 * ⚠️ EVERY ASSERTED VALUE DIFFERS FROM ITS DEFAULT. Age defaults to 35 and life
 * expectancy to 90 since this story, so a fixture using those cannot tell a
 * restored plan from a fresh one.
 *
 * ⚠️ `e2e/` is type-checked by NOTHING (`tsconfig.app.json` covers `src/**`
 * only), so nothing here is validated against the store's real shape at build
 * time. Story 42.3's review found a missing required argument that shipped for
 * exactly this reason. Keep the seeded payload in step with
 * `stores/retirementPlannerStore.ts` by hand.
 */

/** Income rows, so the desired-income PREFILL is live during these tests. */
async function seedIncome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'budget-planner-income-v1',
      JSON.stringify({
        state: {
          incomeSources: [
            {
              id: 'inc-1',
              userId: 0,
              name: 'Salary',
              amount: 200000,
              frequency: 'monthly',
              categoryId: null,
              createdAt: '2026-08-28T00:01:00.000Z',
              updatedAt: '2026-08-28T00:01:00.000Z',
            },
          ],
        },
        version: 3,
      })
    )
  })
}

const AGE = '#currentAge'
const LIFE = '#lifeExpectancy'
const INCOME = '#desiredIncome'
const RATE = '#annualReturn'
const POST_RATE = '#postRetirementReturn'

/**
 * Navigate to the planner and WAIT FOR HYDRATION before touching anything.
 *
 * ⚠️ THIS GATE IS LOAD-BEARING AND ITS ABSENCE LOOKS EXACTLY LIKE A BROKEN
 * FEATURE. Playwright waits for an element to be actionable, which the
 * server-rendered input already is — so without this, typing lands on markup
 * React has not claimed yet: the DOM value changes, React state does not, the
 * store is never written, and the reload assertion fails against a feature that
 * works perfectly in a real browser. Measured while writing this spec, twice,
 * with the same fixture passing or failing purely on how long the test happened
 * to spend before the first keystroke.
 *
 * `__reactEvents` is attached when React binds listeners to the hydrated node,
 * so it is a real interactivity signal rather than a sleep.
 */
async function gotoPlanner(page: Page): Promise<void> {
  await page.goto('/retirement')
  await page.waitForFunction(() => {
    const el = document.querySelector('#currentAge')
    return !!el && Object.keys(el).some((key) => key.startsWith('__reactEvents'))
  })
}

/**
 * Replace a field's contents with real keystrokes.
 *
 * ⚠️ `locator.fill(value)` DOES NOT REACH REACT on these `type="number"` inputs.
 * Measured while writing this spec: after `fill('42')` the DOM read `42` while
 * React's own props still read `35` and nothing was persisted — so a spec built
 * on `fill` fails against working code, and would have been "fixed" by weakening
 * the assertion. `pressSequentially` types for real and the state updates.
 * Clearing with `fill('')` is fine; it is only the typed value that is lost.
 */
async function setField(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).fill('')
  await page.locator(selector).pressSequentially(value, { delay: 20 })
}

test.describe('retirement plan persistence', () => {
  test('every entered value survives a reload', async ({ page }) => {
    await seedIncome(page)
    await gotoPlanner(page)

    await setField(page, AGE, '42')
    await setField(page, LIFE, '88')
    await setField(page, INCOME, '55000')
    await setField(page, RATE, '7.5')
    await setField(page, POST_RATE, '3.25')
    await page.getByRole('radio', { name: /perpetual/i }).click()

    await page.reload()

    await expect(page.locator(AGE)).toHaveValue('42')
    await expect(page.locator(LIFE)).toHaveValue('88')
    // ⚠️ Asserted with income rows seeded. The desired-income prefill recomputes
    // after the income store rehydrates, and without the `desiredIncomeTouched`
    // guard it overwrites this field with 12,000.00 on every load — while every
    // other assertion in this test still passes.
    await expect(page.locator(INCOME)).toHaveValue('55,000.00')
    await expect(page.locator(RATE)).toHaveValue('7.5')
    await expect(page.locator(POST_RATE)).toHaveValue('3.25')
    await expect(page.getByRole('radio', { name: /perpetual/i })).toBeChecked()
  })
})
