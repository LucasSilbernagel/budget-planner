import { expect, test } from '@playwright/test'
import { MORE_PANEL, MORE_SUMMARY, isMoreOpen, moreExpandedInAxTree } from './helpers/nav-more'

/**
 * Global navigation E2E (story 11-1).
 *
 * Proves the persistent primary nav on the real route tree and against the
 * hydrated client DOM (active state only resolves after hydration, so SSR HTML
 * alone would not show it — see project note "SSR smoke misses client render").
 *
 * Covers:
 *  - AC-1/AC-4: the nav is present on a deep sub-page (replacing the removed
 *    per-page footer link blocks).
 *  - AC-2: the current route is marked `aria-current="page"`.
 *  - The core promise: from a deep sub-page you can reach another section
 *    without routing back through Home. Since story 59.2 that is one click for
 *    the four bar tabs, and two (More, then the row) for everything else.
 *  - AC-3: the nav stays usable at a narrow (mobile/PWA) viewport.
 *  - Story 31.5: below `sm` only four destinations keep a bar cell; the other
 *    three are disclosed by a "More" trigger. Since story 59.2 the SAME is true
 *    at the default desktop viewport: `sm:contents` no longer dissolves the
 *    panel into the row, so the tests above open More before reaching a panel
 *    destination. The mobile half lives in the `describe` at the bottom; the
 *    desktop dismissal, focus and JS-off coverage is in
 *    `nav-more-disclosure.spec.ts`.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

test('reaches another section from a deep sub-page without a detour through Home', async ({
  page,
}) => {
  await page.goto('/savings')
  await page.waitForLoadState('networkidle')

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav).toBeVisible()

  // From Savings to the Balance Tracking page with no detour through the Home
  // dashboard: More, then the row. That was ONE click until story 59.2 put
  // Balances behind the More disclosure at every width. (The nav entry reads
  // "Balances" since 59.1; the PAGE keeps its longer name, deliberately — FR89.)
  await page.locator(MORE_SUMMARY).click()
  await nav.getByRole('link', { name: 'Balances', exact: true }).click()
  await expect(page).toHaveURL(/\/balance$/)

  // The destination is marked active in the hydrated DOM. Choosing the row
  // closed the panel, so reopen it to read the row.
  await expect.poll(() => isMoreOpen(page)).toBe(false)
  await page.locator(MORE_SUMMARY).click()
  await expect(nav.getByRole('link', { name: 'Balances', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  )
})

test('marks the current section active and leaves others inactive', async ({ page }) => {
  await page.goto('/income')
  await page.waitForLoadState('networkidle')

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link', { name: 'Income' })).toHaveAttribute('aria-current', 'page')
  // Overview matches "/" exactly, so it is not active on a sub-route.
  await expect(nav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
})

test('reaches the Retirement Planner from the nav', async ({ page }) => {
  await page.goto('/income')
  await page.waitForLoadState('networkidle')

  // Story 15-1: /retirement was a docs-only nav-orphan; it is now a first-class
  // nav destination, marked active on arrival. It was a SINGLE click until story
  // 59.2 moved it behind the More disclosure at every width.
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await page.locator(MORE_SUMMARY).click()
  await nav.getByRole('link', { name: 'Retirement' }).click()
  await expect(page).toHaveURL(/\/retirement$/)

  // Wait for the close to commit before reopening, or the reopening click can
  // land on a still-open panel and CLOSE it.
  await expect.poll(() => isMoreOpen(page)).toBe(false)
  await page.locator(MORE_SUMMARY).click()
  await expect(nav.getByRole('link', { name: 'Retirement' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  await expect(page.getByRole('heading', { name: /retirement planner/i })).toBeVisible()
})

test('reaches the consolidated settings surface from the account cluster', async ({ page }) => {
  await page.goto('/income')
  await page.waitForLoadState('networkidle')

  // Story 69.2 (FR109) moved Settings OUT of the nav (it was behind More from
  // story 59.2). A signed-out visitor reaches it from the gear link in the
  // account cluster; the signed-in route, the account menu, is covered in
  // `settings-route.spec.ts`.
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.locator('a[href="/settings"]')).toHaveCount(0)
  await page.locator('[data-auth-indicator]').getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)

  // The settings surface hosts the relocated display controls (story 11-6).
  await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible()
  await expect(page.getByRole('group', { name: /currency display/i })).toBeVisible()
})

test('stays usable at a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/expenses')
  await page.waitForLoadState('networkidle')

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav).toBeVisible()

  // AC-3 (story 15-1): the nav must not push the document wider than the 320px
  // viewport in the bottom-tab layout. Since 31.5 the bottom bar is a 5-column
  // grid (`max-sm:grid max-sm:grid-cols-5`, 64px tracks at 320px). NOTE this
  // check is 320px-only, and a document-level width comparison at that:
  // `e2e/nav-responsive-css.spec.ts` carries the >= 640px and element-level
  // counterparts. It is also blind to the sheet, which is `absolute` and
  // therefore contributes nothing to `documentElement` — the sheet's own
  // element-level overflow is asserted there.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  )
  expect(overflows).toBe(false)

  // Retirement moved behind "More" in 31.5 — it is no longer a bar cell. Its
  // reachability is proven by the sheet test below, not asserted here.
  await nav.getByRole('link', { name: 'Savings' }).click()
  await expect(page).toHaveURL(/\/savings$/)
})

/**
 * The "More" sheet (story 31.5, UX-DR35/38).
 *
 * The bar shows four destinations plus a More trigger; the other three live in a
 * disclosure sheet. These tests prove reachability by ACTING — tapping through
 * to the destination — rather than by `toBeVisible()`, which 31.3 found staying
 * green through a broken implementation at ten call sites, and which was
 * measured PASSING on a sheet rendered entirely off-screen at y=-279.
 *
 * ⚠️ Since story 59.2 the trigger is a native `<summary>`, which Playwright gives
 * NO role, so `getByRole('button', { name: 'More' })` matches nothing. Its state
 * is the `<details>`'s `open`, not `aria-expanded`. Both are read through
 * `helpers/nav-more.ts`; see its docblock for what was measured.
 */
test.describe('the More sheet at 320px (story 31.5)', () => {
  test.use({ viewport: { width: 320, height: 720 } })

  const navOf = (page: import('@playwright/test').Page) =>
    page.getByRole('navigation', { name: 'Primary' })
  const moreOf = (page: import('@playwright/test').Page) => page.locator(MORE_SUMMARY)
  const expectOpen = (page: import('@playwright/test').Page, open: boolean, message?: string) =>
    expect.poll(() => isMoreOpen(page), message).toBe(open)

  test('reaches the Retirement Planner through the sheet and marks it current', async ({
    page,
  }) => {
    await page.goto('/expenses')
    await page.waitForLoadState('networkidle')

    const nav = navOf(page)
    // Closed: role locators exclude the content of a closed `<details>` (story
    // 59.2), so the destination really is unreachable before the disclosure is
    // opened.
    await expect(nav.getByRole('link', { name: 'Retirement', exact: true })).toHaveCount(0)
    await expectOpen(page, false)

    await moreOf(page).click()
    await expectOpen(page, true)

    // Tap through — the claim is reachability, not visibility.
    await nav.getByRole('link', { name: 'Retirement', exact: true }).click()
    await expect(page).toHaveURL(/\/retirement$/)
    await expect(page.getByRole('heading', { name: /retirement planner/i })).toBeVisible()

    // The sheet closed on selection, and the More TAB now carries the active
    // treatment — `activeProps` cannot do this, because More is not a route.
    await expectOpen(page, false)
    await moreOf(page).click()
    await expect(nav.getByRole('link', { name: 'Retirement', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  /**
   * ⚠️⚠️ FOUND BY CODE REVIEW, AND THE SUITE WAS BLIND TO IT BY CONSTRUCTION.
   * Every other sheet test navigates THROUGH a sheet row, which closes the sheet
   * via its own `onClick`. Tapping a BAR tab is the path nothing covered: the
   * press starts and ends inside the nav, so the dismissal guard correctly does
   * not fire, and the bar tabs carry no handler. Measured on the unfixed build:
   * landing on `/income` with the sheet still `display: block` at y=463.25,
   * covering 201px of the new page.
   */
  test('closes when navigating via a BAR tab, not just via a sheet row', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await moreOf(page).click()
    await expectOpen(page, true)

    await navOf(page).getByRole('link', { name: 'Income', exact: true }).click()
    await expect(page).toHaveURL(/\/income$/)
    await page.waitForLoadState('networkidle')

    await expectOpen(
      page,
      false,
      'the sheet survived a bar-tab navigation and is covering the new page'
    )
    await expect(navOf(page).getByRole('link', { name: 'Retirement', exact: true })).toHaveCount(0)
  })

  /**
   * ⚠️ FOUND BY CODE REVIEW. `closeMore()` used to restore focus to the trigger
   * on EVERY path. The mouse order is `pointerdown -> mousedown (focuses the
   * pressed element) -> pointerup`, so light-dismiss ran after the browser had
   * already focused the click target and yanked focus back — measured, pressing
   * "Sign in" with the sheet open left `document.activeElement` on the More
   * trigger, so a mouse user could not focus a form control in one click while
   * the sheet was open. The existing dismissal test presses empty space, where
   * focus legitimately stays on the trigger, so it cannot see this.
   */
  test('an outside press on a FOCUSABLE element does not steal its focus', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await moreOf(page).click()

    // A real focusable outside the nav and above the open sheet.
    const target = await page.evaluate((PANEL) => {
      const nav = document.querySelector('nav[aria-label="Primary"]')
      const sheet = document.querySelector(PANEL)
      if (!nav || !sheet) return null
      const sheetTop = sheet.getBoundingClientRect().top
      const el = [...document.querySelectorAll('a[href], button, input')].find((candidate) => {
        if (nav.contains(candidate)) return false
        const r = candidate.getBoundingClientRect()
        return r.width > 5 && r.height > 5 && r.top > 0 && r.bottom < sheetTop
      })
      if (!el) return null
      el.setAttribute('data-focus-probe', '')
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, MORE_PANEL)
    expect(target, 'no focusable element outside the nav to press').not.toBeNull()
    const t = target as NonNullable<typeof target>

    await page.mouse.click(t.x, t.y)

    const after = await page.evaluate((SUMMARY) => {
      const summary = document.querySelector(SUMMARY)
      return {
        open: (summary?.parentElement as HTMLDetailsElement | null)?.open,
        // Anti-vacuity: before story 59.2 this compared against a `<button>`
        // lookup, and with no button it would have compared against `null`,
        // so the focus half could not fail. Assert the trigger exists first.
        triggerFound: summary !== null,
        focusIsTrigger: summary !== null && document.activeElement === summary,
        focusIsBody: document.activeElement === document.body,
      }
    }, MORE_SUMMARY)

    expect(after.triggerFound, 'the More <summary> is missing').toBe(true)
    // It still dismisses...
    expect(after.open, 'the outside press no longer dismisses the sheet').toBe(false)
    // ...but it does not steal focus back to the trigger.
    expect(after.focusIsTrigger, 'dismissal stole focus from the element the user pressed').toBe(
      false
    )
  })

  /**
   * Rewritten for story 59.2. This test used to assert `aria-controls` on a
   * `<button>`. The trigger is now a native `<summary>`, whose relationship to
   * its panel and its expanded state come from the platform, so the claim is
   * read from Chromium's REAL accessibility tree: `DisclosureTriangle "More"`,
   * flipping `expanded`. An attribute read would find nothing to read, and the
   * story forbids re-adding the ARIA by hand.
   */
  test('the platform exposes the trigger as a disclosure of its panel', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    expect(await moreExpandedInAxTree(page), 'no "More" disclosure in the AX tree').toBe(false)
    await moreOf(page).click()
    expect(await moreExpandedInAxTree(page)).toBe(true)
    // A disclosure, deliberately NOT a dialog: no `aria-modal`, no
    // `role="dialog"`, no focus trap, no scroll lock (see the GlobalNav
    // docblock for why `Modal` is not reusable here).
    const panel = page.locator(MORE_PANEL)
    await expect(panel).toHaveCount(1)
    await expect(panel).not.toHaveAttribute('role', 'dialog')
    await expect(panel).not.toHaveAttribute('aria-modal', 'true')
  })

  test('closes on Escape, on an outside press, and restores focus to the trigger', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Escape
    await moreOf(page).click()
    await expectOpen(page, true)
    await page.keyboard.press('Escape')
    await expectOpen(page, false)
    await expect(moreOf(page)).toBeFocused()

    // Outside press
    await moreOf(page).click()
    await expectOpen(page, true)
    await page.mouse.click(160, 100)
    await expectOpen(page, false)
    await expect(moreOf(page)).toBeFocused()
  })

  /**
   * Both halves of the pointer guard are independently load-bearing. A press
   * that STARTS outside and RELEASES inside the nav (a drag, or a scroll that
   * began on the page) must not dismiss the sheet — release-origin alone would
   * close it, and press-origin alone would let a press starting on a sheet row
   * and releasing on the page close it.
   */
  test('an outside press that releases INSIDE the nav does not dismiss the sheet', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await moreOf(page).click()

    // ⚠️ BOTH gesture endpoints are MEASURED against the live sheet box. The
    // release point was hard-coded at y=500, which sat inside the sheet only
    // while the sheet held four rows; story 43.3 removed one, the sheet's top
    // edge dropped below 500, and the release landed OUTSIDE — dismissing the
    // sheet and failing a test that is not about row count at all.
    //
    // ⚠️⚠️ 43.3's code review then found that the FIRST fix was half a fix: it
    // measured the release but left the ORIGIN at a constant (160, 100), and
    // guarded the release with `releaseY > sheet.y` — which is true for any box
    // taller than 0px and so could not fail. Both endpoints are now measured AND
    // bounds-checked in both axes, so this test states its own preconditions
    // instead of trusting a layout constant.
    const sheetBox = await page.locator(MORE_PANEL).boundingBox()
    expect(sheetBox, 'the open sheet has no box to release inside').not.toBeNull()
    const sheet = sheetBox as NonNullable<typeof sheetBox>

    const releaseX = Math.round(sheet.x + sheet.width / 2)
    const releaseY = Math.round(sheet.y + sheet.height / 2)
    // Strictly INSIDE, both axes — the assertion this replaces compared the
    // midpoint against the top edge alone and was a tautology.
    expect(releaseY, 'the release point is not inside the sheet vertically').toBeGreaterThan(
      sheet.y
    )
    expect(releaseY, 'the release point is below the sheet').toBeLessThan(sheet.y + sheet.height)
    expect(releaseX, 'the release point is not inside the sheet horizontally').toBeGreaterThan(
      sheet.x
    )
    expect(releaseX, 'the release point is right of the sheet').toBeLessThan(sheet.x + sheet.width)

    // The press must ORIGINATE outside the sheet or the gesture is not the one
    // under test. Derived from the sheet's own top edge, not assumed.
    const originY = Math.round(sheet.y / 2)
    expect(originY, 'the press origin is not above the sheet').toBeLessThan(sheet.y)

    await page.mouse.move(releaseX, originY)
    await page.mouse.down()
    await page.mouse.move(releaseX, releaseY)
    await page.mouse.up()

    await expectOpen(page, true)
  })

  /**
   * The press-origin half, in the direction the outside-press test cannot see.
   *
   * ⚠️ Found by mutation: replacing the press-origin READ with a constant `true`
   * left the whole suite green, because the only outside-press test drove the
   * gesture from outside in both directions. The distinguishing case is a press
   * that STARTS inside the sheet and releases on the page — it must not dismiss,
   * or a drag or a text selection begun inside closes the sheet under your
   * finger.
   *
   * ⚠️⚠️ AND THE OBVIOUS WAY TO WRITE IT IS VACUOUS. Pressing on a sheet ROW and
   * dragging out never produces a `pointerup` at all: an `<a>` is natively
   * draggable, so Chromium starts a link drag and emits `pointercancel` instead
   * — measured, the whole sequence was pointerdown -> pointercancel, and the
   * test passed against the mutation. The press has to land on the sheet's own
   * padding, which is not draggable, and the target is asserted below so this
   * cannot silently regress into the vacuous version.
   */
  test('a press that starts INSIDE the sheet and releases outside does not dismiss it', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await moreOf(page).click()

    const press = await page.evaluate((PANEL) => {
      const sheet = document.querySelector(PANEL)
      if (!sheet) return null
      const r = sheet.getBoundingClientRect()
      // The panel's own `max-sm:py-1` strip, above the first row.
      const y = r.top + 2
      const hit = document.elementFromPoint(160, y)
      return { y, landsOnSheetItself: hit === sheet }
    }, MORE_PANEL)
    expect(press, 'no sheet to press on').not.toBeNull()
    const p = press as NonNullable<typeof press>
    // Anti-vacuity: if this lands on a ROW the gesture becomes a link drag and
    // emits `pointercancel`, and the test stops exercising the press-origin half.
    expect(p.landsOnSheetItself, 'the press landed on a row, not the panel — see above').toBe(true)

    await page.mouse.move(160, p.y)
    await page.mouse.down()
    await page.mouse.move(160, 80)
    await page.mouse.up()

    await expectOpen(page, true)
  })

  /**
   * `pointercancel` resets the in-flight gesture.
   *
   * ⚠️ Also found by mutation: neutering the cancel handler left the suite
   * GREEN. A touch that becomes a scroll fires `pointercancel` and never a
   * `pointerup`, so without the reset the consumed "press began outside" flag
   * OUTLIVES the gesture and the NEXT stray `pointerup` dismisses the sheet —
   * 31.3's unreset `overlayGestureRef` in a new costume (`isOpen` gates the
   * render, not the mount, so refs persist).
   *
   * Driven by synthetic events deliberately: Playwright's mouse API cannot emit
   * `pointercancel`, and this is a claim about listener bookkeeping rather than
   * about hit-testing, so hand-dispatched events are the right instrument. The
   * limitation is recorded rather than papered over.
   */
  test('a cancelled outside gesture does not arm the next pointerup', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await moreOf(page).click()
    await expectOpen(page, true)

    await page.evaluate(() => {
      const opts = { bubbles: true, clientX: 160, clientY: 80 }
      const target = document.elementFromPoint(160, 80) ?? document.body
      // Gesture starts outside the nav...
      target.dispatchEvent(new PointerEvent('pointerdown', opts))
      // ...and is cancelled (a touch that turned into a scroll), with no pointerup.
      target.dispatchEvent(new PointerEvent('pointercancel', opts))
      // A later stray release must NOT be treated as the end of that gesture.
      target.dispatchEvent(new PointerEvent('pointerup', opts))
    })

    await expectOpen(page, true, 'a cancelled gesture left the outside-press flag armed')
  })

  test('is fully keyboard operable', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Tab to the trigger rather than focusing it programmatically, so this is
    // the traversal a real keyboard user gets.
    let reached = false
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      if (await moreOf(page).evaluate((el) => el === document.activeElement)) {
        reached = true
        break
      }
    }
    expect(reached, 'never reached the More trigger by tabbing').toBe(true)

    await page.keyboard.press('Enter')
    await expectOpen(page, true)
    // The rows become reachable in the same traversal once disclosed.
    await page.keyboard.press('Tab')
    await expect(navOf(page).getByRole('link', { name: 'Balances', exact: true })).toBeFocused()

    // Space toggles too (AC-8), at this width as well as at 1280px. Back on the
    // trigger, Space closes it.
    await moreOf(page).focus()
    await page.keyboard.press('Space')
    await expectOpen(page, false)
    await page.keyboard.press('Space')
    await expectOpen(page, true)
  })

  /**
   * ⚠️⚠️ OCCLUSION IS INVISIBLE TO EVERY GEOMETRY AND VISIBILITY ASSERTION —
   * only `elementFromPoint` can see one element painting over another. Measured
   * with the nav at its former `z-40`: the InstallPrompt banner (z-50) spanned
   * y 408-544, the open sheet spanned 383.25-584.25, and the centre of the
   * "Retirement" row resolved INSIDE THE BANNER — completely un-tappable, while
   * having a perfect rect and passing `toBeVisible()`. `max-sm:z-50` on the nav
   * breaks the tie in its favour (the nav renders after `<InstallPrompt/>`).
   */
  test('every sheet row stays tappable underneath the PWA install banner', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt') as Event & {
        prompt?: () => Promise<void>
        userChoice?: Promise<{ outcome: string; platform: string }>
      }
      event.prompt = async () => {}
      event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })
      globalThis.dispatchEvent(event)
    })
    const banner = page.getByRole('region', { name: /install/i })
    await expect(banner).toBeVisible()

    await moreOf(page).click()

    const probe = await page.evaluate((PANEL) => {
      const nav = document.querySelector('nav[aria-label="Primary"]')
      const sheet = document.querySelector(PANEL)
      const bannerEl = document.querySelector('section[aria-label*="Install"]')
      if (!nav || !sheet || !bannerEl) return null
      const b = bannerEl.getBoundingClientRect()
      const s = sheet.getBoundingClientRect()
      return {
        // Anti-vacuity: if the two do not actually overlap, this test proves
        // nothing and must be re-tuned rather than left passing.
        overlaps: s.top < b.bottom && b.top < s.bottom,
        rows: [...sheet.querySelectorAll('a')].map((a) => {
          const r = a.getBoundingClientRect()
          const el = document.elementFromPoint(
            Math.round(r.x + r.width / 2),
            Math.round(r.y + r.height / 2)
          )
          return { label: a.textContent?.trim() ?? '', hitsSelf: a.contains(el) || a === el }
        }),
      }
    }, MORE_PANEL)

    expect(probe, 'nav/sheet/banner not all present').not.toBeNull()
    const p = probe as NonNullable<typeof probe>
    expect(p.overlaps, 'the banner and the sheet do not overlap — this test is vacuous').toBe(true)
    for (const { label, hitsSelf } of p.rows) {
      expect(hitsSelf, `sheet row "${label}" is occluded by the install banner`).toBe(true)
    }
  })
})
