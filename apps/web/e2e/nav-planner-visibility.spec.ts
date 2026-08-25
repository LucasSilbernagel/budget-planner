import { type Page, expect, test } from '@playwright/test'

/**
 * Retirement planner visibility (story 35.2, FR55).
 *
 * ⚠️⚠️ THIS FILE IS THE ONLY PLACE THE FEATURE'S FIRST-FRAME HALF CAN BE SEEN.
 * jsdom applies no stylesheet and computes no media queries, so the unit suite
 * can assert the React filter (which runs after mount) and the presence of the
 * `data-nav-path` hook, but it is structurally incapable of observing the
 * pre-paint suppression. Asserting a class or attribute there would be
 * asserting a string, not a style.
 *
 * WHY A PRE-PAINT MECHANISM EXISTS AT ALL. Every persisted store in this app is
 * `skipHydration: true` and rehydrated in a mount effect, so the server render
 * and the first client render MUST both paint the deterministic default
 * (planner visible). "Apply the preference after client rehydration" — the
 * discipline the epic prescribed for avoiding a flash — is therefore precisely
 * what CAUSES one: the entry paints, then vanishes, on every page load. A
 * synchronous `<head>` script plus a CSS rule beats first paint; the React
 * filter then removes the node for real.
 *
 * ⚠️⚠️ THE VACUITY HAZARD, AND HOW IT IS DEFENDED. If the preference were seeded
 * with `page.evaluate` AFTER a `goto`, or the assertion taken after hydration,
 * this suite would be measuring the React filter and would pass with the script
 * and the CSS rule ENTIRELY ABSENT. Two defences: the seed goes in via
 * `addInitScript` (runs before any page script, before first paint), and every
 * first-frame assertion is taken from a `DOMContentLoaded` snapshot. The proof
 * that this works is mutation M4 — delete the CSS rule and the DCL assertions
 * here go red. If M4 ever comes back green, this suite is measuring the wrong
 * frame and the test is wrong, not the mutation.
 *
 * ⚠️ BOTH WIDTHS ARE ASSERTED, DELIBERATELY, because the failure mode is
 * ASYMMETRIC: at >= 640px `sm:contents` dissolves the nested sheet list into the
 * desktop row, so a broken suppression rule could hide the entry at 320px and
 * reveal it at 1280px — and a narrow-only suite reports that as green.
 * (An earlier version of this note blamed cascade-layer ordering. That was
 * wrong and was corrected in review: this is Tailwind 3.4, whose layers resolve
 * at build time, so the rule's 0-2-0 specificity beats a 0-1-0 display utility.)
 */

const NAV = 'nav[aria-label="Primary"]'
const RETIREMENT_LI = `${NAV} li[data-nav-path="/retirement"]`
const STORAGE_KEY = 'budget-planner-planner-visibility-v1'

interface FirstFrame {
  /** `null` when the <li> is absent from the pre-hydration HTML entirely. */
  display: string | null
  /** Whether the pre-paint bootstrap marked <html>. */
  marked: boolean
  /** Anti-vacuity: the nav itself must have been present and laid out. */
  navWidth: number
}

/**
 * Seed the persisted preference BEFORE the document's own scripts run, then
 * snapshot the Retirement entry at DOMContentLoaded — i.e. the first frame,
 * before React hydrates and removes the node for real.
 */
async function firstFrameWith(page: Page, hidden: boolean, path: string): Promise<FirstFrame> {
  await page.addInitScript(
    ({ key, hide }) => {
      if (hide) {
        localStorage.setItem(
          key,
          JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
        )
      } else {
        localStorage.removeItem(key)
      }
    },
    { key: STORAGE_KEY, hide: hidden }
  )

  await page.addInitScript(
    ({ navSel, liSel }) => {
      document.addEventListener('DOMContentLoaded', () => {
        const nav = document.querySelector(navSel)
        const li = document.querySelector(liSel)
        ;(globalThis as unknown as { __plannerAtDCL?: unknown }).__plannerAtDCL = {
          display: li ? globalThis.getComputedStyle(li).display : null,
          marked: document.documentElement.getAttribute('data-hide-retirement') === '1',
          navWidth: nav ? nav.getBoundingClientRect().width : 0,
        }
      })
    },
    { navSel: NAV, liSel: RETIREMENT_LI }
  )

  const response = await page.goto(path)
  expect(response?.ok(), `expected ${path} to load`).toBeTruthy()

  const snapshot = (await page.evaluate(
    () => (globalThis as unknown as { __plannerAtDCL?: FirstFrame }).__plannerAtDCL ?? null
  )) as FirstFrame | null

  expect(
    snapshot,
    'no DOMContentLoaded snapshot was taken — the listener never fired'
  ).not.toBeNull()
  const frame = snapshot as FirstFrame
  // Anti-vacuity: a nav that was not present/laid out at DCL would make
  // "the entry is not displayed" true for the wrong reason.
  expect(frame.navWidth, 'the nav had no box at DOMContentLoaded').toBeGreaterThan(0)
  return frame
}

for (const { label, width, height } of [
  { label: '320px (mobile bar + More sheet)', width: 320, height: 720 },
  { label: '1280px (dissolved desktop row)', width: 1280, height: 800 },
]) {
  test.describe(`the hidden Retirement entry never paints — ${label}`, () => {
    test.use({ viewport: { width, height } })

    test('is already suppressed on the first frame, before hydration', async ({ page }) => {
      const frame = await firstFrameWith(page, true, '/')

      // (a) The pre-paint bootstrap ran and marked the document.
      expect(frame.marked, 'the <head> bootstrap did not mark <html> before DOMContentLoaded').toBe(
        true
      )

      // (b) The entry — which IS in the server HTML, because the server must
      // render the deterministic default — was already not displayed.
      expect(
        frame.display,
        'the Retirement entry was painted on the first frame (the flash this story exists to prevent)'
      ).toBe('none')

      // (c) After hydration React removes the node outright.
      await page.waitForLoadState('networkidle')
      await expect(page.locator(RETIREMENT_LI)).toHaveCount(0)
      await expect(
        page.locator(NAV).getByRole('link', { name: 'Retirement', exact: true })
      ).toHaveCount(0)
    })

    /**
     * The positive control. Without it, "the entry is not displayed" could be
     * true because the selector matches nothing, the nav never rendered, or the
     * feature hid the entry for everyone.
     */
    test('is displayed on the first frame when the preference is not set', async ({ page }) => {
      const frame = await firstFrameWith(page, false, '/')

      expect(frame.marked, '<html> was marked despite no persisted preference').toBe(false)
      expect(frame.display, 'the Retirement entry was suppressed for a default user').not.toBe(
        'none'
      )

      await page.waitForLoadState('networkidle')
      await expect(page.locator(RETIREMENT_LI)).toHaveCount(1)
    })
  })
}

test.describe('the mobile sheet with the planner hidden (AC-8)', () => {
  test.use({ viewport: { width: 320, height: 720 } })

  test('holds exactly its other three rows, each still a 44px target', async ({ page }) => {
    await page.addInitScript(
      (key) =>
        localStorage.setItem(
          key,
          JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
        ),
      STORAGE_KEY
    )
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const nav = page.locator(NAV)
    await nav.getByRole('button').click()

    const rows = nav.locator(':scope > ul > li > ul > li > a')
    await expect(rows).toHaveCount(3)
    expect(await rows.allTextContents()).toEqual(['Balance Tracking', 'Net Worth', 'Settings'])

    for (const row of await rows.all()) {
      const box = await row.boundingBox()
      expect(box, 'a sheet row has no box').not.toBeNull()
      expect(
        (box as { height: number }).height,
        'a sheet row is under the 44px tap target'
      ).toBeGreaterThanOrEqual(44)
      // ⚠️ The height check above is a FLOOR, so a label that wraps to two lines
      // makes the row TALLER and satisfies it — story 43.2 proved exactly that by
      // mutation (see `e2e/nav-responsive-css.spec.ts`'s sheet-row test). This
      // fixture renders the same rows in the planner-hidden (free-tier) shape, so
      // it needs the same line-count guard or it stays green for the wrong reason
      // on a wrapped label. Added by 43.2's code review.
      const lineCount = await row.evaluate((a) => {
        const label = a.querySelector('[data-nav-label]')
        const range = document.createRange()
        if (label) range.selectNodeContents(label)
        return label ? range.getClientRects().length : -1
      })
      const label = (await row.textContent())?.trim() ?? ''
      expect(lineCount, `sheet row "${label}" wraps to ${lineCount} lines at 320px`).toBe(1)
    }

    // The bar is unaffected: Retirement never lived there, so `grid-cols-5` and
    // the root's height reserve are untouched. Measured, not argued (§1.3).
    const barCells = nav.locator(':scope > ul > li')
    await expect(barCells).toHaveCount(5)

    /**
     * The document must not scroll sideways at 320px in EITHER theme.
     *
     * ⚠️ Dark mode here is driven by a `.dark` CLASS on `<html>`, not by a media
     * query: `tailwind.config.js` sets `darkMode: 'class'` and nothing in the
     * app reads `prefers-color-scheme`. An earlier version of this loop used
     * `page.emulateMedia({ colorScheme })`, which flips a media query the app
     * never consults — so both iterations measured the LIGHT theme and the
     * "and dark" half of AC-8 was proven by nothing. Toggle the real class, and
     * assert it actually took effect so this cannot silently regress to a no-op.
     */
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (t) => document.documentElement.classList.toggle('dark', t === 'dark'),
        theme
      )
      expect(
        await page.evaluate(() => document.documentElement.classList.contains('dark')),
        `the .dark class did not follow the ${theme} setting — the theme leg is a no-op`
      ).toBe(theme === 'dark')

      // Re-assert the geometry per theme, not just the overflow: dark styling
      // changes borders and backgrounds, which is what could move a box.
      await expect(rows).toHaveCount(3)
      for (const row of await rows.all()) {
        const box = await row.boundingBox()
        expect(
          (box as { height: number }).height,
          `a sheet row is under the 44px tap target in ${theme}`
        ).toBeGreaterThanOrEqual(44)
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow, `horizontal overflow at 320px in ${theme}`).toBeLessThanOrEqual(0)
    }
  })
})

test.describe('the /retirement route with the planner hidden (AC-5, AC-6, AC-9)', () => {
  test('renders an explanatory off-state instead of the planner', async ({ page }) => {
    await page.addInitScript(
      (key) =>
        localStorage.setItem(
          key,
          JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
        ),
      STORAGE_KEY
    )

    const response = await page.goto('/retirement')
    // The route still loads — no redirect, no 404 (AC-5). There is no
    // beforeLoad/redirect anywhere in this app and this story did not add one.
    expect(response?.ok(), 'the /retirement route did not load').toBeTruthy()
    await page.waitForLoadState('networkidle')
    expect(new URL(page.url()).pathname, 'the route redirected away').toBe('/retirement')

    await expect(
      page.getByRole('heading', { name: /retirement planner is turned off/i })
    ).toBeVisible()
    await expect(page.getByText(/nothing was deleted/i)).toBeVisible()
    // The planner itself is gone.
    await expect(page.getByRole('heading', { name: /when can you retire\?/i })).toHaveCount(0)
  })

  test('re-enables from the off-state and restores the nav entry', async ({ page }) => {
    await page.addInitScript(
      (key) =>
        localStorage.setItem(
          key,
          JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
        ),
      STORAGE_KEY
    )
    await page.goto('/retirement')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /turn the planner back on/i }).click()

    // The planner is back on this very page...
    await expect(page.getByRole('heading', { name: /when can you retire\?/i })).toBeVisible()
    // ...and so is the nav entry.
    //
    // ⚠️ `toBeVisible()`, NOT `toHaveCount(1)`. Count passes on an attached but
    // `display: none` element, so it cannot tell "restored" from "rendered and
    // still suppressed by a stale pre-paint attribute" — which is precisely the
    // defect this assertion now guards (found in review by two independent
    // layers). The count form certified the broken build green.
    await expect(page.locator(RETIREMENT_LI)).toBeVisible()
  })

  test('the preference survives a reload (AC-9)', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await page.getByRole('switch', { name: /show retirement planner/i }).click()
    await expect(page.locator(RETIREMENT_LI)).toHaveCount(0)

    await page.reload()
    await page.waitForLoadState('networkidle')

    // Still hidden, and the control still reflects it — this is what proves the
    // new store is actually registered for rehydration. Without that
    // registration the preference persists correctly and never loads back.
    await expect(page.locator(RETIREMENT_LI)).toHaveCount(0)
    await expect(page.getByRole('switch', { name: /show retirement planner/i })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })
})
