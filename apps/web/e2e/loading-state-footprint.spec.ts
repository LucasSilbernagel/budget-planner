import { type Page, expect, test } from '@playwright/test'

/**
 * Skeleton footprints (story 38.2, AC-6).
 *
 * ## The measurement, and why it is host-independent
 *
 * Every assertion here compares the SAME element's box in the pending render
 * against its box in the resolved render. Nothing is compared against a pixel
 * constant.
 *
 * That distinction is the whole point. `budget-planner-ci-font-width-harness`
 * records how epic 34 shipped green with a broken width budget: GitHub's runner
 * resolves `system-ui` to DejaVu Sans, a dev box to the narrower Noto Sans, and
 * a hard-coded `expect(width).toBe(672)` certifies a property it cannot see. A
 * before/after comparison of one element cannot drift that way — whatever the
 * font does, it does to both readings. The story runs this file under the CI
 * font as well (mutation M8) and records that the numbers are identical.
 *
 * ## How the pending state is held still
 *
 * In a real browser the pending render lasts about one frame. Blocking every
 * SCRIPT REQUEST leaves the page exactly as the server sent it, forever, while
 * the two inline `<head>` bootstraps still run — they are markup, not requests —
 * which is what makes the dark-theme arm possible at all
 * (`setJavaScriptEnabled(false)` would kill those too, and with them the `.dark`
 * class).
 *
 * ⚠️ **This used to abort `**\/*client-entry*` and that was dev-only.** A
 * reviewer measured it: `client-entry` appears only in TanStack Start's dev
 * virtual module (`virtual:tanstack-start-dev-client-entry`); the production
 * client build emits `index-*.js`, and `dist/client/assets/` contains no file
 * matching the old glob. Pointed at a production preview, the abort would have
 * matched nothing, the page would have hydrated, and every "pending" box below
 * would have been a resolved box — with `pending == resolved` holding trivially
 * in all four arms. Filtering on `resourceType() === 'script'` is build-agnostic.
 *
 * ⚠️ And the guard now runs AFTER the measurements, not before. The first version
 * asserted the skeleton was attached once, up front — which cannot witness a page
 * that hydrates midway through the six reads. {@link assertStillPending} closes
 * that: if anything resolved, the arm fails instead of quietly measuring twice.
 */

/**
 * Block script REQUESTS; inline `<head>` bootstraps still run (they are markup,
 * not requests). Returns the live list of URLs actually aborted.
 *
 * ⚠️ The RETURN VALUE is the anti-vacuity mechanism. See
 * {@link assertStillPending}.
 */
function blockScripts(page: Page): string[] {
  const blocked: string[] = []
  void page.route('**/*', (route) => {
    if (route.request().resourceType() === 'script') {
      blocked.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  return blocked
}

/**
 * The anti-vacuity guard. Call AFTER the last measurement in a pending arm.
 *
 * A pending measurement is only evidence if the page was still pending when the
 * measurement finished — otherwise `pending == resolved` is true because both
 * readings came from the resolved page.
 */
async function assertStillPending(page: Page, blocked: string[]): Promise<void> {
  // ⚠️ THE FIRST CHECK IS THE LOAD-BEARING ONE, AND IT IS NOT A DOM CHECK.
  //
  // The previous version only re-read the DOM, and re-arming the fix as a
  // mutation (make the route handler a no-op) left this file passing 5/5: on a
  // warm local dev server all six reads and the guard completed inside the
  // pre-hydration window, so the DOM still LOOKED pending even though nothing
  // had been blocked. A timing-dependent guard against a timing bug is not a
  // guard.
  //
  // Counting what was actually aborted tests the MECHANISM instead of its
  // symptom: if the glob or the resourceType filter ever stops matching this
  // build's entry chunk, `blocked` is empty and the arm fails immediately —
  // which is precisely the production-build hazard a reviewer measured
  // (`dist/client/assets/` contains no `*client-entry*` file, so the old
  // URL-glob would have matched nothing there).
  expect(
    blocked.length,
    'no script request was blocked, so the page hydrated — every "pending" reading is a resolved reading'
  ).toBeGreaterThan(0)

  await expect(
    page.getByTestId('overview-net-worth-skeleton'),
    'the page hydrated during measurement — every "pending" reading above is a resolved reading'
  ).toBeAttached()
  await expect(page.getByTestId('page-loading-status')).toHaveCount(1)
  await expect(page.getByTestId('overview-net-worth')).toHaveText('')
}

function seedDarkTheme() {
  localStorage.setItem(
    'budget-planner-theme-prefs-v1',
    JSON.stringify({ state: { theme: 'dark' }, version: 0 })
  )
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`no bounding box for ${testId}`)
  return box
}

async function open(
  page: Page,
  { pending, width, dark }: { pending: boolean; width: number; dark: boolean }
): Promise<string[]> {
  await page.setViewportSize({ width, height: 900 })
  if (dark) await page.addInitScript(seedDarkTheme)
  const blocked = pending ? blockScripts(page) : []
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  if (pending) {
    await expect(page.getByTestId('overview-net-worth-skeleton')).toBeAttached()
  } else {
    await expect(page.getByTestId('overview-net-worth')).toHaveText('$0.00')
  }
  return blocked
}

const VIEWPORTS = [
  { name: '320px', width: 320 },
  { name: 'desktop', width: 1280 },
] as const
const THEMES = [
  { name: 'light', dark: false },
  { name: 'dark', dark: true },
] as const

test.describe('skeleton footprints', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`the three Overview figures keep their exact box at ${viewport.name} (${theme.name})`, async ({
        page,
      }) => {
        const ids = ['overview-total-income', 'overview-total-expenses', 'overview-net-worth']

        const blocked = await open(page, { pending: true, width: viewport.width, dark: theme.dark })
        const pending = [
          await boxOf(page, ids[0]),
          await boxOf(page, ids[1]),
          await boxOf(page, ids[2]),
        ]
        await assertStillPending(page, blocked)

        await page.unroute('**/*')
        await open(page, { pending: false, width: viewport.width, dark: theme.dark })
        const resolved = [
          await boxOf(page, ids[0]),
          await boxOf(page, ids[1]),
          await boxOf(page, ids[2]),
        ]

        for (const [i, id] of ids.entries()) {
          expect(
            pending[i],
            `${id} moved or resized between pending and resolved at ${viewport.name}/${theme.name}`
          ).toEqual(resolved[i])
        }
      })
    }
  }

  /**
   * The variable-height region. The pending block mirrors the resolved-EMPTY
   * onboarding card's box model, so for a user who genuinely has nothing the
   * footprint matches exactly. It cannot also match the resolved-WITH-DATA chart
   * stack — those two resolved states differ by roughly a thousand pixels — and
   * the story records that residual rather than pretending it is zero.
   */
  test('the sections block matches the resolved EMPTY card exactly', async ({ page }) => {
    const blocked = await open(page, { pending: true, width: 1280, dark: false })
    const pending = await boxOf(page, 'overview-sections-skeleton')
    await assertStillPending(page, blocked)

    await page.unroute('**/*')
    await open(page, { pending: false, width: 1280, dark: false })
    const resolved = await boxOf(page, 'overview-onboarding')

    expect(pending).toEqual(resolved)
  })
})
