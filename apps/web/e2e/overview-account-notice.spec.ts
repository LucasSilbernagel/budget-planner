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

/**
 * The notice reads as its own block (story 60.1, FR91).
 *
 * ⚠️⚠️ THIS IS THE ONLY LAYER THAT CAN SEE THIS DEFECT AT ALL. The bug is a
 * COLOUR COLLISION: `surface-inset` is `bg-gray-50` and the page canvas
 * `surface-sunken` is also `bg-gray-50`, so in light mode the box had the same
 * background as the surface behind it and no border — visually there was no box,
 * only floating text. jsdom loads no stylesheet, so `getComputedStyle` there
 * returns the same empty value whatever the classes say: a colour assertion in
 * the unit suite CANNOT FAIL and would be a permanently green sentence
 * describing nothing (project memory, `jsdom-computed-style-vacuous`). The unit
 * test's class-token check is a rename fence; this is the proof.
 *
 * ⚠️ AND A CLASS-TOKEN CHECK CANNOT COVER FOR IT. `styles/global.css:88-91`
 * records that a class which resolves to values something else already set is a
 * silent no-op that "still passes lint, type-check and class-token assertions".
 * Only a rendered measurement distinguishes an applied border from a declared
 * one.
 *
 * WHY THE FILL IS NOT THE FIX (story 60.1, D1). The separation is carried by the
 * BORDER; the fill is deliberately unchanged in both themes. That is what keeps
 * the dark theme — which was never broken (`gray-700/40` on `gray-900` reads
 * correctly) — additive, and it is why the dismiss glyph's contrast pairs could
 * be recomputed against an unchanged background.
 *
 * ⚠️ THE COLOUR IS `border-gray-300`, NOT THE `border-default` TOKEN, and that
 * matters to the light arm below. `border-default` is gray-200, which measures
 * only 1.18:1 against this gray-50 canvas; gray-300 measures 1.41:1. Chosen by
 * Lucas during story 60.1's code review. There is a second reason the token was
 * wrong here: under Tailwind 3 (this project is on 3.4.19) preflight already
 * sets `border-color` to gray-200 on EVERY element, so a light-mode assertion of
 * gray-200 passes whether or not any colour class is present — it could not
 * distinguish `border-default` from preflight, and the original version of the
 * light arm below misattributed preflight's value to the token. gray-300 is not
 * a preflight default, so the light arm is now a real guard.
 *
 * WHAT PROVES THIS SUITE WORKS: run these two tests against a tree WITHOUT the
 * border classes and both go red on the width quartet. That was observed for
 * real at `c44068a`, before the fix was applied — the spec already existed and
 * was run: `0px` on all four sides in both themes
 * (`/tmp/claude-1000/60-1/red-at-c44068a.log`). The width quartet is the
 * palette-independent half; the colour assertions guard the specific choice.
 */
/** The page canvas the notice is rendered directly on (`HomePage.tsx:623`). */
const CANVAS = '.surface-sunken'

interface EdgeMeasurement {
  boxBackground: string
  canvasBackground: string
  borderWidths: string[]
  borderColors: string[]
}

async function measureEdge(page: Page, theme: 'light' | 'dark'): Promise<EdgeMeasurement> {
  // Story 61.1 (FR93): the theme follows the device, so this drives the media
  // query rather than seeding a deleted preference store.
  await page.emulateMedia({ colorScheme: theme })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // The theme must actually be the one under test before anything is measured,
  // or both arms would silently measure light mode.
  // ⚠️ Asserts the PAINTED canvas, not the lever. This used to check a `.dark`
  // class on <html>; story 61.1 removed that class entirely, and re-reading the
  // `colorScheme` we just emulated could not fail. `body` is bg-gray-50 light /
  // bg-gray-900 dark.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe(theme === 'dark' ? 'rgb(17, 24, 39)' : 'rgb(249, 250, 251)')

  const box = page.locator(BOX)
  await expect(box, 'the notice was not visible, so nothing could be measured').toBeVisible()

  return box.evaluate((el, canvasSel) => {
    const canvas = el.closest(canvasSel)
    if (!canvas) {
      throw new Error(`the notice has no ${canvasSel} ancestor — the canvas moved`)
    }
    // ⚠️ The canvas is only "what is behind the box" while nothing between them
    // paints its own background. Without this walk, a fill added to <header> (or
    // any wrapper) would leave every assertion below passing while the premise
    // "identically-coloured canvas" had quietly become false.
    for (let node = el.parentElement; node && node !== canvas; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        throw new Error(
          `an ancestor between the notice and ${canvasSel} paints ${bg}; the canvas measured below is not what is behind the box`
        )
      }
    }
    const boxStyle = getComputedStyle(el)
    return {
      boxBackground: boxStyle.backgroundColor,
      canvasBackground: getComputedStyle(canvas).backgroundColor,
      borderWidths: [
        boxStyle.borderTopWidth,
        boxStyle.borderRightWidth,
        boxStyle.borderBottomWidth,
        boxStyle.borderLeftWidth,
      ],
      borderColors: [
        boxStyle.borderTopColor,
        boxStyle.borderRightColor,
        boxStyle.borderBottomColor,
        boxStyle.borderLeftColor,
      ],
    }
  }, CANVAS)
}

test.describe('the notice reads as its own block (story 60.1, FR91)', () => {
  test('light mode: the box carries a visible edge against an identically-coloured canvas', async ({
    page,
  }) => {
    const edge = await measureEdge(page, 'light')

    // The premise of the defect, pinned so a later change to either token cannot
    // quietly remove the reason this border exists. If these two ever diverge,
    // re-read the component docblock rather than deleting the border.
    expect(
      edge.boxBackground,
      'the box fill moved — story 60.1 deliberately left it identical to the canvas'
    ).toBe('rgb(249, 250, 251)')
    expect(edge.canvasBackground, 'the page canvas is no longer gray-50').toBe('rgb(249, 250, 251)')

    // THE FIX, and the palette-independent half of it. At `c44068a` these were
    // `0px` on all four sides.
    expect(edge.borderWidths, 'the notice has no rendered border on some side').toEqual([
      '1px',
      '1px',
      '1px',
      '1px',
    ])

    // gray-300, NOT `border-default`'s gray-200. This assertion is only a real
    // guard because gray-300 is not a preflight default: Tailwind 3 sets every
    // element's `border-color` to gray-200, so the gray-200 version of this line
    // passed with every colour class deleted.
    expect(edge.borderColors, 'the light border is not gray-300').toEqual([
      'rgb(209, 213, 219)',
      'rgb(209, 213, 219)',
      'rgb(209, 213, 219)',
      'rgb(209, 213, 219)',
    ])
  })

  test('dark mode: the fill is unchanged and the edge is additive', async ({ page }) => {
    const edge = await measureEdge(page, 'dark')

    // Dark mode was never the defect and story 60.1 does not move it:
    // `gray-700/40` on `gray-900`, exactly as before.
    expect(edge.boxBackground, 'the dark fill changed — it was gray-700/40 before 60.1').toBe(
      'rgba(55, 65, 81, 0.4)'
    )
    expect(edge.canvasBackground, 'the dark canvas is no longer gray-900').toBe('rgb(17, 24, 39)')

    expect(edge.borderWidths, 'the notice has no rendered border on some side').toEqual([
      '1px',
      '1px',
      '1px',
      '1px',
    ])
    // Unchanged from `border-default`'s dark half — this is the whole reason the
    // dark theme is additive rather than altered.
    expect(edge.borderColors, 'the dark border is not gray-700').toEqual([
      'rgb(55, 65, 81)',
      'rgb(55, 65, 81)',
      'rgb(55, 65, 81)',
      'rgb(55, 65, 81)',
    ])
  })
})
