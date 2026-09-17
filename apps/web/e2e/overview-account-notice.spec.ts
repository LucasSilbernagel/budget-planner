import { type Page, expect, test } from '@playwright/test'

/**
 * Dismissable Overview "No account needed" box (story 55.1, FR82).
 *
 * ⚠️⚠️ THIS FILE IS THE ONLY PLACE THE FEATURE'S FIRST-FRAME HALF CAN BE SEEN.
 * jsdom applies no stylesheet, so the unit suite can assert the React effect
 * (which runs after mount), the bootstrap string's behaviour, and the presence
 * of the `data-account-notice` hook — but it is structurally incapable of
 * observing the pre-paint suppression. Asserting a class or attribute there
 * would be asserting a string, not a style.
 *
 * WHY A PRE-PAINT MECHANISM EXISTS AT ALL. The dismissal is per-browser
 * localStorage, so the SERVER cannot know it and must render the box present —
 * a constraint the SEO fence in `loading-state.spec.ts` independently REQUIRES.
 * The component's own read is therefore in an effect, i.e. after first paint.
 * "Apply the dismissal once React has mounted" is precisely what CAUSES the
 * flash it was meant to avoid: the box paints, then vanishes, on every page
 * load for a user who closed it. A synchronous `<head>` script plus a CSS rule
 * beats first paint; the React effect then removes the node for real.
 *
 * ⚠️⚠️ THE VACUITY HAZARD, AND HOW IT IS DEFENDED. If the dismissal were seeded
 * with `page.evaluate` AFTER a `goto`, or the assertion taken after hydration,
 * this suite would be measuring the React effect and would pass with the
 * bootstrap script and the CSS rule ENTIRELY ABSENT. Two defences: the seed goes
 * in via `addInitScript` (runs before any page script, before first paint), and
 * every first-frame assertion is taken from a `DOMContentLoaded` snapshot.
 *
 * The proof that this works: delete the `[data-dismiss-account-notice='1']` rule
 * from `styles/global.css` and the DCL assertion below goes red (verified during
 * implementation). If that mutation ever passes, this suite is measuring the
 * wrong frame and the test is wrong, not the mutation.
 */

const STORAGE_KEY = 'bp-overview-account-notice-dismissed'
const BOX = '[data-account-notice]'
/**
 * ⚠️ `exact: true` AT EVERY CALL SITE. Playwright's `name` option is a
 * case-insensitive SUBSTRING match by default (unlike Testing Library's
 * full-string match), so a bare "Dismiss" would also match
 * `components/pwa/InstallPrompt`'s "Dismiss install prompt" and trip strict
 * mode the moment that affordance renders. Caught in code review.
 */
const DISMISS = 'Dismiss privacy notice'

/**
 * Hydration-error detector, copied from the repo's proven helper
 * (`loading-state.spec.ts:35-43`, `hydration.spec.ts:64-72`).
 *
 * ⚠️ `pageerror`, NOT `console`. React 19 surfaces a hydration mismatch through
 * `onRecoverableError` -> `reportError`, i.e. a window error event, which
 * Playwright delivers on `pageerror`; nothing reaches the `console` channel.
 * An earlier version of this file listened on `console` and was proven VACUOUS
 * in code review — with a lazy-initializer mutation in place it passed, while a
 * `pageerror` sibling caught the real mismatch. Do not "simplify" it back.
 */
const HYDRATION_ERROR = /Hydration failed|Minified React error #(418|423|425)/

function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    if (HYDRATION_ERROR.test(error.message)) {
      errors.push(error.message)
    }
  })
  return errors
}

interface FirstFrame {
  /** Computed `display` of the box at DOMContentLoaded, or null if absent. */
  display: string | null
  /** Whether the <head> bootstrap marked <html> before DOMContentLoaded. */
  marked: boolean
  /** Width of the page header's box — the anti-vacuity control. */
  headerWidth: number
  /** Whether the box element existed in the DCL DOM at all. */
  present: boolean
}

/**
 * Seed the dismissal flag BEFORE the document's own scripts run, then snapshot
 * the box at DOMContentLoaded — i.e. the first frame, before React's effect
 * removes it for real.
 */
async function firstFrameWith(page: Page, dismissed: boolean): Promise<FirstFrame> {
  await page.addInitScript(
    ({ key, dismiss }) => {
      if (dismiss) {
        localStorage.setItem(key, '1')
      } else {
        localStorage.removeItem(key)
      }
    },
    { key: STORAGE_KEY, dismiss: dismissed }
  )

  await page.addInitScript(
    ({ boxSel }) => {
      document.addEventListener('DOMContentLoaded', () => {
        const box = document.querySelector(boxSel)
        const header = document.querySelector('header')
        ;(globalThis as unknown as { __noticeAtDCL?: unknown }).__noticeAtDCL = {
          display: box ? globalThis.getComputedStyle(box).display : null,
          marked: document.documentElement.getAttribute('data-dismiss-account-notice') === '1',
          headerWidth: header ? header.getBoundingClientRect().width : 0,
          present: box !== null,
        }
      })
    },
    { boxSel: BOX }
  )

  const response = await page.goto('/')
  expect(response?.ok(), 'expected / to load').toBeTruthy()

  const snapshot = (await page.evaluate(
    () => (globalThis as unknown as { __noticeAtDCL?: FirstFrame }).__noticeAtDCL ?? null
  )) as FirstFrame | null

  expect(
    snapshot,
    'no DOMContentLoaded snapshot was taken — the listener never fired'
  ).not.toBeNull()
  const frame = snapshot as FirstFrame
  // Anti-vacuity: a header that was not present/laid out at DCL would make
  // "the box is not displayed" true for the wrong reason.
  expect(frame.headerWidth, 'the page header had no box at DOMContentLoaded').toBeGreaterThan(0)
  return frame
}

test.describe('the dismissed account notice never paints (AC-4)', () => {
  test('is already suppressed on the first frame, before hydration', async ({ page }) => {
    const frame = await firstFrameWith(page, true)

    // (a) The pre-paint bootstrap ran and marked the document.
    expect(frame.marked, 'the <head> bootstrap did not mark <html> before DOMContentLoaded').toBe(
      true
    )

    // (b) The box — which IS in the server HTML, because the server cannot know
    // a per-browser dismissal (and the SEO fence requires it) — was already in
    // the DOM but not displayed.
    expect(
      frame.present,
      'the box was absent from the server HTML (the SEO fence forbids that)'
    ).toBe(true)
    expect(
      frame.display,
      'the box was painted on the first frame (the flash this story exists to prevent)'
    ).toBe('none')

    // (c) After hydration React removes the node outright.
    await page.waitForLoadState('networkidle')
    await expect(page.locator(BOX)).toHaveCount(0)
    await expect(page.getByRole('button', { name: DISMISS, exact: true })).toHaveCount(0)
  })

  /**
   * The positive control. Without it, "the box is not displayed" could be true
   * because the selector matches nothing, the header never rendered, or the
   * feature hid the box for everyone.
   */
  test('is displayed on the first frame when nothing was dismissed', async ({ page }) => {
    const frame = await firstFrameWith(page, false)

    expect(frame.marked, '<html> was marked despite no recorded dismissal').toBe(false)
    expect(frame.present, 'the box was missing from the first frame for a default user').toBe(true)
    expect(frame.display, 'the box was suppressed for a user who never dismissed it').not.toBe(
      'none'
    )

    await page.waitForLoadState('networkidle')
    // ⚠️ `toBeVisible()`, not `toHaveCount(1)`: count passes on an attached but
    // display:none element, which is exactly the state this test must reject.
    await expect(page.locator(BOX)).toBeVisible()
  })
})

test.describe('dismissing the account notice (AC-1, AC-2)', () => {
  test('the close button removes the box and the dismissal survives a reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator(BOX)).toBeVisible()
    await page.getByRole('button', { name: DISMISS, exact: true }).click()
    await expect(page.locator(BOX)).toHaveCount(0)

    await page.reload()
    await page.waitForLoadState('networkidle')

    // Still gone — this is what proves the write actually landed in
    // localStorage rather than only updating React state.
    await expect(page.locator(BOX)).toHaveCount(0)
  })

  /**
   * ⚠️ WCAG 2.2 SC 2.5.8, measured against a REAL bounding box. This is the only
   * place the size can be measured — jsdom computes no layout, so the unit suite
   * can only assert that the floor classes are declared. Story 51.2's review
   * found a desktop target-size defect that every unit gate passed.
   */
  test('the close button meets the 24px minimum target size', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const box = await page.getByRole('button', { name: DISMISS, exact: true }).boundingBox()
    expect(box, 'the close button had no bounding box').not.toBeNull()
    expect(
      box?.width ?? 0,
      'close button width is under the SC 2.5.8 floor'
    ).toBeGreaterThanOrEqual(24)
    expect(
      box?.height ?? 0,
      'close button height is under the SC 2.5.8 floor'
    ).toBeGreaterThanOrEqual(24)
  })

  test('the box still wraps inside a 320px viewport with the close button added', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const box = page.locator(BOX)
    await expect(box).toBeVisible()

    // No horizontal overflow: the box must not be wider than its container.
    const overflows = await box.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > 320
    )
    expect(overflows, 'the notice overflowed a 320px viewport').toBe(false)
  })
})

test.describe('hydration (AC-3)', () => {
  /**
   * The SSR/first-render agreement is the thing most likely to break silently
   * here: the server always emits the box, so a client render that read
   * localStorage during render would mismatch. React logs that, it does not
   * throw, so nothing else in this suite would notice.
   */
  test('a dismissed user gets no hydration error', async ({ page }) => {
    const hydrationErrors = collectHydrationErrors(page)

    await page.addInitScript(({ key }) => localStorage.setItem(key, '1'), { key: STORAGE_KEY })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    expect(hydrationErrors, `hydration errors: ${hydrationErrors.join(' | ')}`).toHaveLength(0)
  })
})

test.describe('in-session dismissal survives client-side navigation (AC-4)', () => {
  /**
   * ⚠️ THE REGRESSION TEST FOR A CODE-REVIEW HIGH. Every other test in this
   * file uses a full page load, which is exactly why they all passed while this
   * was broken.
   *
   * The `<head>` bootstrap runs once per DOCUMENT load, so it cannot know about
   * a dismissal that happens later in the same document. Before the fix,
   * `dismiss()` wrote localStorage and unmounted the node but left `<html>`
   * unmarked — so returning to `/` via an SPA navigation remounted the
   * component, rendered the box, and removed it only in a post-paint effect
   * (TanStack commits navigations inside `startTransition`). Measured with a
   * MutationObserver: the node re-attached with `display: "block"`.
   *
   * ⚠️ Assert on ATTACH, not on the final state. `toHaveCount(0)` after the
   * navigation settles passes for the flashing build too — the effect does
   * eventually remove the node. The MutationObserver is what makes this test
   * able to fail.
   */
  test('dismiss, navigate away, navigate back — the box never reaches a frame', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator(BOX)).toBeVisible()
    await page.getByRole('button', { name: DISMISS, exact: true }).click()
    await expect(page.locator(BOX)).toHaveCount(0)

    // The in-session marker must be set, which is what hands the rest of this
    // document's lifetime to the CSS rule.
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.getAttribute('data-dismiss-account-notice'))
      )
      .toBe('1')

    // Record every re-attach of the box and its computed display at that moment.
    await page.evaluate(() => {
      ;(globalThis as unknown as { __reattach?: unknown[] }).__reattach = []
      const rec = (globalThis as unknown as { __reattach: unknown[] }).__reattach
      new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of Array.from(m.addedNodes)) {
            if (!(node instanceof HTMLElement)) continue
            const box = node.matches('[data-account-notice]')
              ? node
              : node.querySelector('[data-account-notice]')
            if (box) {
              rec.push({ display: globalThis.getComputedStyle(box).display })
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true })
    })

    // SPA navigation — click the nav links; `goto` would be a full reload and
    // would re-run the bootstrap, hiding the defect.
    await page.locator('[data-nav-path="/income"] a').first().click()
    await expect(page).toHaveURL(/\/income/)
    await page.locator('[data-nav-path="/"] a').first().click()
    await expect(page).toHaveURL(/\/$/)
    await page.waitForLoadState('networkidle')

    const reattached = (await page.evaluate(
      () => (globalThis as unknown as { __reattach?: unknown[] }).__reattach ?? []
    )) as Array<{ display: string }>

    const painted = reattached.filter((r) => r.display !== 'none')
    expect(
      painted,
      `the box was re-attached in a DISPLAYED state ${painted.length}x after an SPA return — this is the AC-4 flash`
    ).toHaveLength(0)
  })
})
