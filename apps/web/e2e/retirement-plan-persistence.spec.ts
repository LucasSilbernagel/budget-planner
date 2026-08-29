import { type Page, expect, test } from '@playwright/test'
// Imported rather than hard-coded: `e2e/` is type-checked by nothing, so a
// literal `version: 1` here would silently reroute the corrupt-payload test
// through `migrate` after a version bump — testing the seam instead of the guard.
import {
  RETIREMENT_PLANNER_STORAGE_KEY,
  RETIREMENT_PLANNER_VERSION,
} from '../src/stores/retirementPlannerStore'

/**
 * The retirement plan survives a reload and a navigation (Story 44.1, FR71).
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

const PLAN_KEY = RETIREMENT_PLANNER_STORAGE_KEY

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

  test('the plan survives a client-side route change and back', async ({ page }) => {
    // ⚠️ CLICKS THE REAL NAV, rather than `page.goto`. Two `goto`s are two full
    // document loads, which is the reload test again — and the SPA route change
    // is the loss mode this story was actually about (`/retirement` unmounts on
    // every nav, so the plan was lost far more often that way than by reloading).
    await gotoPlanner(page)
    await setField(page, AGE, '42')
    await setField(page, LIFE, '88')

    await page.getByRole('link', { name: 'Income', exact: true }).first().click()
    await expect(page.locator(AGE)).toHaveCount(0)
    await page.getByRole('link', { name: 'Retirement', exact: true }).first().click()

    await expect(page.locator(AGE)).toHaveValue('42')
    await expect(page.locator(LIFE)).toHaveValue('88')
  })

  test('a first visit opens on 35 and 90', async ({ page }) => {
    await gotoPlanner(page)
    await expect(page.locator(AGE)).toHaveValue('35')
    await expect(page.locator(LIFE)).toHaveValue('90')
  })

  test('a deliberately cleared field is still cleared after a reload', async ({ page }) => {
    await gotoPlanner(page)

    // Set a second field too, so this test cannot pass on a build that persists
    // NOTHING — after a reload "cleared" and "never stored" look identical on
    // the cleared field alone. Story 42.1's M9 caught exactly that weakness.
    await setField(page, LIFE, '88')
    await page.locator(AGE).fill('')

    await page.reload()

    await expect(page.locator(AGE)).toHaveValue('')
    await expect(page.locator(LIFE)).toHaveValue('88')
  })

  test('the mirror hint matches the restored plan', async ({ page }) => {
    const hint = page.getByText(/Follows the rate above until you change it/)

    await gotoPlanner(page)
    await expect(hint).toBeVisible()
    // Untouched, the field MIRRORS the accumulation rate.
    await setField(page, RATE, '7.5')
    await expect(page.locator(POST_RATE)).toHaveValue('7.5')

    await setField(page, POST_RATE, '3.25')
    await expect(hint).toHaveCount(0)

    await page.reload()

    // The flag round-trips with its value: a restored plan must not show a hint
    // claiming it still follows a rate it stopped following.
    await expect(page.locator(POST_RATE)).toHaveValue('3.25')
    await expect(hint).toHaveCount(0)
  })

  test('a corrupt stored plan opens on defaults instead of breaking the page', async ({ page }) => {
    await page.addInitScript(
      ({ key, version }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            state: { plan: { currentAgeInput: 42, model: 'preserve', lifeExpectancyInput: null } },
            version,
          })
        )
      },
      { key: PLAN_KEY, version: RETIREMENT_PLANNER_VERSION }
    )
    await gotoPlanner(page)

    await expect(page.locator(AGE)).toHaveValue('35')
    await expect(page.locator(LIFE)).toHaveValue('90')
    await expect(page.getByRole('heading', { name: /When Can You Retire/i })).toBeVisible()
  })
})
