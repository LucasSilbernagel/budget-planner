import { type Page, expect, test } from '@playwright/test'
import {
  ACTIVE_BG,
  LONG_EMAIL,
  MORE_DETAILS,
  MORE_PANEL,
  MORE_SUMMARY,
  NAV,
  isMoreOpen,
  mockSignedIn,
  moreBackground,
  moreExpandedInAxTree,
  openMore,
  panelLabels,
  readChevron,
  sweepHeaderRow,
} from './helpers/nav-more'

/**
 * The "More" disclosure at EVERY viewport (story 59.2, FR90). FREE tier.
 *
 * Until 59.2 the desktop nav dissolved the More panel into the row with
 * `sm:contents`, and hid the trigger with `sm:hidden`. That put a free user's
 * seven destinations in one flat row, and a paid user's eleven in TWO rows at
 * every desktop width, which was measured and could not be closed by shrinking.
 * From story 59.2 until 69.3 the row was Overview · Income · Expenses ·
 * Savings · More at every width, in both tiers; since 69.3 that is the row
 * below `lg` only (`nav-lg-row.spec.ts` covers `lg` and up). The paid-tier half of this file is
 * `nav-more-disclosure.paid.spec.ts`.
 *
 * The disclosure is a native `<details>`/`<summary>` (decision, Lucas
 * 2026-09-21), so every destination stays reachable with JavaScript off. The
 * `javaScriptEnabled: false` block below proves it for the free tier, and
 * `nav-more-disclosure.paid.spec.ts` carries the paid-tier twin.
 *
 * ⚠️ How to locate the trigger, and why `getByRole('button')` finds nothing:
 * see `helpers/nav-more.ts`.
 */

/**
 * ⚠️ 1000px, not 1280px, since story 69.3 (FR110, decision D1). At `lg`
 * (1024px) and up a FREE session has no More at all: Balances and Retirement
 * are on the row (`nav-lg-row.spec.ts`). This file is about the free More
 * DISCLOSURE, so its desktop arm runs at a width that still has one. (1000px,
 * not the widest such width: that is 1023px, which `nav-lg-row.spec.ts`
 * covers. A first draft of this note said 1000 was the widest; it is not.)
 * Playwright's default viewport (1280) is past that line, which is why every
 * desktop test here pins a width.
 */
const DESKTOP_WIDTHS = [640, 1000] as const
/** A free desktop width with a More disclosure: below `lg`, not its edge. */
const DISCLOSURE_WIDTH = 1000
const PRIMARY = ['Overview', 'Income', 'Expenses', 'Savings'] as const
const FREE_PANEL = ['Balances', 'Retirement'] as const

async function gotoSettled(page: Page, url = '/'): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  await expect(page.locator(NAV)).toBeVisible()
}

/**
 * The desktop row, read from its FLEX ITEMS (the outer `<li>`s), never from
 * `nav a`. The anchor query counts the hidden panel rows as well, and it skips
 * the `<summary>`, which is a real row item now.
 */
async function readRow(page: Page) {
  return page.evaluate((nav) => {
    const list = document.querySelector(`${nav} > ul`) as HTMLElement
    // RENDERED items only (story 69.3): the promoted row copies are in the DOM
    // at every width and `display:none` below `lg`.
    const items = ([...list.querySelectorAll(':scope > li')] as HTMLElement[]).filter(
      (li) => li.getClientRects().length > 0
    )
    return {
      labels: items.map((li) =>
        (
          li.querySelector(
            ':scope > a [data-nav-label], :scope > details > summary [data-nav-label]'
          )?.textContent ?? ''
        ).trim()
      ),
      tops: [...new Set(items.map((li) => Math.round(li.getBoundingClientRect().top)))],
      listHeight: list.getBoundingClientRect().height,
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  }, NAV)
}

for (const width of DESKTOP_WIDTHS) {
  test.describe(`the desktop row at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test('is exactly the four primary tabs plus More, on ONE row, closed', async ({ page }) => {
      await gotoSettled(page)
      const row = await readRow(page)

      expect(row.labels, 'the desktop row is not the five-item shape').toEqual([...PRIMARY, 'More'])
      expect(row.tops, `the ${width}px row wraps onto more than one line`).toHaveLength(1)
      expect(row.docOverflowX, 'the page scrolls horizontally').toBeLessThanOrEqual(0)

      // Closed by default. The rows are in the DOM (a CSS count still finds
      // them) but not REACHABLE until opened: role locators exclude them.
      expect(await isMoreOpen(page)).toBe(false)
      const nav = page.getByRole('navigation', { name: 'Primary' })
      await expect(nav.getByRole('link')).toHaveCount(PRIMARY.length)
      for (const label of FREE_PANEL) {
        await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0)
      }
      // Anti-vacuity for the line above: the hidden rows ARE in the DOM, so the
      // role-count of 4 is visibility, not absence.
      expect(await panelLabels(page)).toEqual([...FREE_PANEL])
    })

    test('opens as an overlay: on screen, opaque, unoccluded, and out of flow', async ({
      page,
    }) => {
      await gotoSettled(page)
      const before = await readRow(page)
      await openMore(page)

      const nav = page.getByRole('navigation', { name: 'Primary' })
      for (const label of FREE_PANEL) {
        await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
      }

      const after = await readRow(page)
      // Out of flow: opening the panel must not push the row (or the page) down.
      expect(after.listHeight, 'the open panel is in flow — it grew the bar').toBe(
        before.listHeight
      )
      expect(after.docOverflowX, 'the open panel overflows the page sideways').toBeLessThanOrEqual(
        0
      )

      const panel = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement
        const r = el.getBoundingClientRect()
        return {
          position: getComputedStyle(el).position,
          bg: getComputedStyle(el).backgroundColor,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          innerWidth: globalThis.innerWidth,
          innerHeight: globalThis.innerHeight,
          overflowX: el.scrollWidth - el.clientWidth,
        }
      }, MORE_PANEL)
      expect(panel.position).toBe('absolute')
      expect(panel.bg, 'the desktop panel is transparent — content shows through').toBe(
        'rgb(255, 255, 255)'
      )
      expect(panel.left).toBeGreaterThanOrEqual(0)
      expect(panel.right).toBeLessThanOrEqual(panel.innerWidth)
      expect(panel.top).toBeGreaterThan(0)
      expect(panel.bottom).toBeLessThanOrEqual(panel.innerHeight)
      // `overflow-y-auto` makes the panel a horizontal scroll container that
      // would silently absorb an overflowing label. Element-level on purpose.
      expect(panel.overflowX, 'a panel row overflows and is being absorbed').toBeLessThanOrEqual(0)

      // ⚠️ Occlusion is invisible to `toBeVisible()` and to every rect. Probe the
      // hit-test at each row's centre.
      const hits = await page.evaluate((sel) => {
        return [...document.querySelectorAll(`${sel} > li > a`)].map((a) => {
          const r = a.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return { label: a.textContent?.trim(), inside: hit !== null && a.contains(hit) }
        })
      }, MORE_PANEL)
      expect(
        hits.filter((h) => !h.inside),
        'a panel row is painted over'
      ).toEqual([])
    })
  })
}

test('the header row holds at every desktop width, signed out AND signed in (free)', async ({
  page,
}) => {
  // Signed out: the "Sign in" + "Upgrade" cluster every other test measures.
  await page.setViewportSize({ width: 640, height: 800 })
  await gotoSettled(page)
  expect(await sweepHeaderRow(page), 'the signed-out header row broke').toEqual([])

  // Signed in on the FREE tier: avatar only (no email since story 69.2), no
  // Premium pill. The announced email proves the mocked session landed. See the
  // paid twin for why this needs `/api/auth/me` mocked (story 59.2 review, D1).
  await mockSignedIn(page, { subscriptionStatus: 'free' })
  await page.setViewportSize({ width: 640, height: 800 })
  await gotoSettled(page)
  await expect(
    page.getByRole('status', { name: /account status/i }).getByText(LONG_EMAIL)
  ).toHaveCount(1)
  expect(await sweepHeaderRow(page), 'the signed-in (free) header row broke').toEqual([])
})

/**
 * The More trigger's disclosure chevron (story 69.1, FR108).
 *
 * Until 69.1 the desktop trigger was the bare word "More": `MoreIcon` is
 * `sm:hidden`, so nothing said it opens anything. The chevron must be VISIBLE
 * (a `display:none` from a stray `sm:hidden` is exactly what jsdom cannot see)
 * and must turn with the panel.
 *
 * ⚠️ It turns on the `<details>` `open` ATTRIBUTE (`group-open:`), not on React
 * state (decision D2, Lucas 2026-09-25). The attribute is what shows the panel,
 * so it is the only source the cue cannot disagree with. The JS-off block below
 * is the test a state-driven cue fails.
 */
for (const width of DESKTOP_WIDTHS) {
  test.describe(`the More chevron at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test('is visible, decorative, and turns with the panel through every close path', async ({
      page,
    }) => {
      await gotoSettled(page)
      const closed = await readChevron(page)
      expect(closed.count, 'the More trigger has no disclosure chevron').toBe(1)
      expect(closed.visible, `the chevron is hidden at ${width}px`).toBe(true)
      expect(closed.width, 'the chevron has no box').toBeGreaterThan(0)
      expect(closed.transform, 'the chevron is rotated while the panel is closed').toBe('none')
      // An inline 16px SVG can grow the 20px line box; the trigger stays 36px.
      expect(closed.triggerHeight, 'the chevron grew the trigger').toBe(36)
      // Still named "More" in the real AX tree: the chevron adds no text.
      expect(await moreExpandedInAxTree(page), 'the trigger is no longer "More"').toBe(false)

      const chevronA = async () => (await readChevron(page)).a

      // Opened by click, closed by Escape.
      await openMore(page)
      await expect.poll(chevronA, { message: 'the chevron did not turn when opened' }).toBe(-1)
      await page.keyboard.press('Escape')
      await expect.poll(() => isMoreOpen(page)).toBe(false)
      await expect.poll(chevronA, { message: 'the chevron stayed turned after Escape' }).toBe(1)

      // Closed by an outside press on inert content.
      await openMore(page)
      await expect.poll(chevronA).toBe(-1)
      await page.mouse.click(5, 780)
      await expect.poll(() => isMoreOpen(page)).toBe(false)
      await expect
        .poll(chevronA, { message: 'the chevron stayed turned after an outside press' })
        .toBe(1)

      // Closed by navigating from a panel row. (Settings until story 69.2 took
      // it out of the nav.)
      await openMore(page)
      await expect.poll(chevronA).toBe(-1)
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Balances', exact: true })
        .click()
      await expect(page).toHaveURL(/\/balance$/)
      await expect.poll(() => isMoreOpen(page)).toBe(false)
      await expect.poll(chevronA, { message: 'the chevron stayed turned after navigating' }).toBe(1)
    })
  })
}

test('the chevron is display:none on the mobile bar (decision D3)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await gotoSettled(page)
  const chevron = await readChevron(page)
  expect(chevron.count, 'the More trigger has no disclosure chevron').toBe(1)
  expect(chevron.visible, 'the desktop chevron leaked onto the mobile bar').toBe(false)
})

test.describe('the desktop panel in the dark theme', () => {
  test.use({ viewport: { width: DISCLOSURE_WIDTH, height: 800 } })

  test('paints its own opaque dark background', async ({ page }) => {
    // Story 61.1 (FR93): the theme follows the device, so emulate the media
    // query rather than seeding a preference store that no longer exists.
    await page.emulateMedia({ colorScheme: 'dark' })
    await gotoSettled(page)
    await openMore(page)
    const bg = await page.locator(MORE_PANEL).evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg, 'the dark desktop panel lost its background').toBe('rgb(31, 41, 55)')
  })
})

test.describe('the disclosure is a disclosure, at desktop width', () => {
  test.use({ viewport: { width: DISCLOSURE_WIDTH, height: 800 } })

  test('the platform reports its expanded state, and the panel is not a dialog', async ({
    page,
  }) => {
    await gotoSettled(page)
    // The REAL accessibility tree, not an attribute: the summary carries no
    // `aria-expanded`, by decision — Chromium derives it from `open`.
    expect(await moreExpandedInAxTree(page), 'no "More" disclosure in the AX tree').toBe(false)
    await openMore(page)
    expect(await moreExpandedInAxTree(page)).toBe(true)

    const panel = page.locator(MORE_PANEL)
    await expect(panel).not.toHaveAttribute('role', 'dialog')
    await expect(panel).not.toHaveAttribute('aria-modal', /.*/)
    // No hand-rolled ARIA on the trigger (AC-6).
    const summary = page.locator(MORE_SUMMARY)
    for (const attr of ['role', 'aria-expanded', 'aria-controls', 'aria-haspopup']) {
      await expect(summary, `the summary carries a hand-rolled ${attr}`).not.toHaveAttribute(
        attr,
        /.*/
      )
    }
  })

  test('Escape closes it and returns focus to the trigger', async ({ page }) => {
    await gotoSettled(page)
    await openMore(page)
    await page.keyboard.press('Escape')
    await expect.poll(() => isMoreOpen(page)).toBe(false)
    await expect(page.locator(MORE_SUMMARY)).toBeFocused()
  })

  test('an outside press on inert page content closes it and does not orphan focus', async ({
    page,
  }) => {
    await gotoSettled(page)
    await openMore(page)
    // Bottom-left of the page body, far from the header and the panel. The
    // point is CHECKED, not assumed: if a link, button or field ever lands there,
    // this test would be measuring a focusable press, which is the next test.
    const target = await page.evaluate(() => {
      const hit = document.elementFromPoint(5, 780)
      return {
        tag: hit?.tagName ?? null,
        interactive:
          hit?.closest(
            'a, button, input, select, textarea, summary, [tabindex], [role="button"]'
          ) != null,
      }
    })
    expect(target.tag, 'nothing at (5, 780) to press').not.toBeNull()
    expect(target.interactive, `(5, 780) is interactive (${target.tag}) — not an inert press`).toBe(
      false
    )
    await page.mouse.click(5, 780)
    await expect.poll(() => isMoreOpen(page)).toBe(false)
    // Pressing non-focusable content blurs to <body>; the nav restores focus to
    // the trigger rather than leaving it orphaned (`GlobalNav.tsx` closeMore).
    await expect(page.locator(MORE_SUMMARY)).toBeFocused()
  })

  test('an outside press on a FOCUSABLE element closes it without stealing its focus', async ({
    page,
  }) => {
    await gotoSettled(page)
    await openMore(page)
    // A real focusable OUTSIDE the nav and clear of the open panel. A BUTTON,
    // never a link: pressing a link navigates, and the focus check would then be
    // measuring the new page. Named explicitly, because the first button on `/`
    // is "Dismiss privacy notice", which removes ITSELF when pressed.
    const probe = page.getByRole('button', { name: 'More information about net worth' })
    await probe.evaluate((el) => el.setAttribute('data-focus-probe', ''))
    const box = await probe.boundingBox()
    const panelBox = await page.locator(MORE_PANEL).boundingBox()
    if (!box || !panelBox) throw new Error('the probe or the panel has no box')
    expect(
      box.y > panelBox.y + panelBox.height || box.x > panelBox.x + panelBox.width,
      'the probe sits under the open panel — the press would land on the panel'
    ).toBe(true)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => isMoreOpen(page)).toBe(false)
    await expect(
      page.locator('[data-focus-probe]'),
      'closing the panel stole focus from the pressed element'
    ).toBeFocused()
  })

  test('choosing a row navigates, closes the panel, and lights the trigger', async ({ page }) => {
    await gotoSettled(page)
    await openMore(page)
    // Balances, not Settings: story 69.2 moved Settings out of the nav.
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Balances', exact: true })
      .click()
    await expect(page).toHaveURL(/\/balance$/)
    await expect.poll(() => isMoreOpen(page)).toBe(false)
    // "You are here" survives the destination moving behind a disclosure.
    // COMPUTED, not the class list (story 69.3): on this route the treatment is
    // `max-lg:bg-green-50`, a different token, so a class probe would read the
    // cue as missing while it paints.
    await expect.poll(() => moreBackground(page)).toBe(ACTIVE_BG)
    await openMore(page)
    await expect(
      page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Balances', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  })

  test('a route change from outside the panel closes it', async ({ page }) => {
    await gotoSettled(page)
    await openMore(page)
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Income', exact: true })
      .click()
    await expect(page).toHaveURL(/\/income$/)
    await expect.poll(() => isMoreOpen(page)).toBe(false)
    // COMPUTED (story 69.3): a class probe for `bg-green-50` alone would pass
    // on a trigger still painted by `max-lg:bg-green-50`.
    expect(await moreBackground(page)).not.toBe(ACTIVE_BG)
  })

  /**
   * The race the controlled `onClick` exists to close, pinned DETERMINISTICALLY.
   *
   * Left to the native toggle, a click opens the DOM at once, but `isMoreOpen`
   * (and the Escape and outside-press listeners it gates) arrives only after the
   * async `toggle` event, which is a TASK. An outside press in that window is
   * ignored. The first full e2e run hit the window by chance, once. After that,
   * 32 timing-dependent tests stayed green with the `onClick` removed, so none
   * of them guards it.
   *
   * This test puts the click and the outside press in one task, separated only
   * by a microtask checkpoint, which is what a real user's click always gets
   * before their next input can arrive. Measured, 5 runs each:
   *   - controlled `onClick` + `useEffect` (shipped): 5/5 pass;
   *   - controlled `onClick` + `useLayoutEffect`:     5/5 pass (not needed);
   *   - native toggle only (no `onClick`):            5/5 FAIL.
   * ⚠️ WITHOUT the microtask checkpoint, all three variants fail. A press
   * dispatched in the same synchronous script as `.click()` arrives before
   * React's discrete-update microtask, which no user input can do. The first
   * draft of this test had exactly that, failed its own control, and carried a
   * false claim ("React flushes effects before the click returns") in this
   * docblock until the control run refuted it.
   */
  test('an outside press in the SAME task as the opening click still dismisses', async ({
    page,
  }) => {
    await gotoSettled(page)
    const openWhenPressed = await page.evaluate(async (summarySel) => {
      const summary = document.querySelector(summarySel) as HTMLElement
      summary.click()
      // One microtask checkpoint, and NO task boundary. A user's click always
      // gets the checkpoint before their next input can arrive, and React
      // flushes a discrete update in a microtask. The async `toggle` event is a
      // TASK, so it has still not fired when the press below arrives.
      await Promise.resolve()
      // Read BEFORE the press: the press must have an open panel to close.
      const open = (summary.parentElement as HTMLDetailsElement).open
      const outside = document.querySelector('main') ?? document.body
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      outside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      return open
    }, MORE_SUMMARY)
    // Anti-vacuity, at the moment it matters: the click had opened the panel
    // when the press arrived. (It used to be checked AFTERWARDS, by reopening
    // the panel, which proves nothing about the state the press saw.)
    expect(openWhenPressed, 'the panel was not open when the outside press arrived').toBe(true)
    await expect
      .poll(() => isMoreOpen(page), {
        message: 'an outside press right after opening was ignored — the listeners were not armed',
      })
      .toBe(false)
  })

  test('is keyboard operable: Enter opens, focus stays put, Tab walks the rows', async ({
    page,
  }) => {
    await gotoSettled(page)
    const summary = page.locator(MORE_SUMMARY)
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => isMoreOpen(page)).toBe(true)
    // Disclosure convention: opening does NOT move focus into the panel.
    await expect(summary).toBeFocused()
    const nav = page.getByRole('navigation', { name: 'Primary' })
    for (const label of FREE_PANEL) {
      await page.keyboard.press('Tab')
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeFocused()
    }
    // Space toggles it closed again from the trigger.
    await summary.focus()
    await page.keyboard.press('Space')
    await expect.poll(() => isMoreOpen(page)).toBe(false)
  })

  test('the trigger paints an OUTSET focus ring on desktop', async ({ page }) => {
    await gotoSettled(page)
    await page.locator(MORE_SUMMARY).focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const shadow = await page.locator(MORE_SUMMARY).evaluate((el) => getComputedStyle(el).boxShadow)
    expect(shadow, 'the desktop trigger shows no focus ring').not.toBe('none')
    expect(shadow, 'the desktop ring is inset — reserved for the mobile bar').not.toContain('inset')
  })
})

/**
 * Hydration can lose a toggle. Measured at context time: a user who opens the
 * panel BEFORE React hydrates leaves the DOM `open` while React state says
 * closed, so the open-gated Escape and outside-press listeners never arm. The
 * component adopts the DOM state on mount to close that gap. This test holds
 * back every script so the click lands on the server-rendered HTML.
 */
test('a panel opened BEFORE hydration is still dismissible after it', async ({ page }) => {
  await page.setViewportSize({ width: DISCLOSURE_WIDTH, height: 800 })
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') await released
    await route.continue()
  })

  // React attaches its fiber to a DOM node as an own `__reactFiber$…` key when
  // it hydrates it. Its absence at the click is what makes this a PRE-hydration
  // click and not an ordinary one (story 59.2 code review: without this check
  // the test passed identically if hydration won the race).
  const hydrated = () =>
    page
      .locator(MORE_DETAILS)
      .evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactFiber')))

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  expect(await hydrated(), 'React hydrated before the click — scripts were not held').toBe(false)
  await page.locator(MORE_SUMMARY).click()
  expect(await isMoreOpen(page), 'the native disclosure did not open pre-hydration').toBe(true)

  release()
  await page.waitForLoadState('networkidle')
  await expect.poll(hydrated, { message: 'the page never hydrated' }).toBe(true)
  // Still open AFTER hydration. If hydration snapped the panel shut, losing the
  // user's click, the Escape poll below would pass on its first try for the
  // wrong reason.
  expect(await isMoreOpen(page), 'hydration closed a panel the user had opened').toBe(true)
  // Escape does nothing to a <details> natively, so the panel can only close
  // here once the hydrated component's listener is armed. Retry until then.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Escape')
        return isMoreOpen(page)
      },
      { timeout: 15_000, message: 'Escape never closed a panel opened before hydration' }
    )
    .toBe(false)
})

/**
 * Fail-open (story 59.2, AC-4). With JavaScript DISABLED the whole nav is the
 * server-rendered HTML, and the only way into the panel is the native
 * `<details>` toggle. Before 59.2 a JS-off mobile user could not open the sheet
 * at all (the trigger was a React `<button>`). A JS-off desktop user reached
 * everything only because `sm:contents` never hid the panel.
 */
test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false })

  for (const width of [320, DISCLOSURE_WIDTH] as const) {
    test(`every More destination is reachable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      for (const [label, path] of [
        ['Balances', '/balance'],
        ['Retirement', '/retirement'],
      ] as const) {
        await page.goto('/')
        const nav = page.getByRole('navigation', { name: 'Primary' })
        await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0)
        await page.locator(MORE_SUMMARY).click()
        const link = nav.getByRole('link', { name: label, exact: true })
        await expect(link, `${label} is unreachable with JS off at ${width}px`).toBeVisible()
        await link.click()
        await expect(page).toHaveURL(new RegExp(`${path}$`))
      }
    })
  }

  // Story 69.3: at `lg` the free destinations are ROW anchors, and the row is
  // server-rendered CSS, so they are reachable with JS off by construction.
  // Proven rather than reasoned, because this is FR90's fail-open claim.
  test('at 1280px both free destinations are row anchors, reachable with JS off', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    for (const [label, path] of [
      ['Balances', '/balance'],
      ['Retirement', '/retirement'],
    ] as const) {
      await page.goto('/')
      // In the DOM and not rendered: `toBeHidden()` alone also passes on a nav
      // with no More at all (story 69.3 code review).
      await expect(page.locator(MORE_SUMMARY)).toHaveCount(1)
      await expect(page.locator(MORE_SUMMARY), 'a free More renders at lg').toBeHidden()
      const link = page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: label, exact: true })
      await expect(link, `${label} is not ONE visible row anchor with JS off`).toHaveCount(1)
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    }
  })

  // The case the epic's original AC-3 (drive the cue from `isMoreOpen`) gets
  // wrong: with JS off React never runs, so state would say "closed" forever
  // while the native toggle shows the panel.
  test(`the chevron turns with the NATIVE toggle at ${DISCLOSURE_WIDTH}px`, async ({ page }) => {
    await page.setViewportSize({ width: DISCLOSURE_WIDTH, height: 800 })
    await page.goto('/')
    const closed = await readChevron(page)
    expect(closed.count, 'the More trigger has no disclosure chevron').toBe(1)
    expect(closed.transform).toBe('none')
    await page.locator(MORE_SUMMARY).click()
    await expect.poll(() => isMoreOpen(page), 'the native toggle did not open').toBe(true)
    await expect
      .poll(async () => (await readChevron(page)).a, {
        message: 'the chevron points down over an OPEN panel with JavaScript off',
      })
      .toBe(-1)
    expect((await readChevron(page)).visible, 'the chevron is hidden with JavaScript off').toBe(
      true
    )
    // And back: the native toggle closes it, and the chevron follows.
    await page.locator(MORE_SUMMARY).click()
    await expect.poll(() => isMoreOpen(page), 'the native toggle did not close').toBe(false)
    await expect
      .poll(async () => (await readChevron(page)).a, {
        message: 'the chevron stayed turned after the native toggle closed the panel',
      })
      .toBe(1)
  })

  test('the server renders the disclosure closed', async ({ page }) => {
    await page.setViewportSize({ width: DISCLOSURE_WIDTH, height: 800 })
    await page.goto('/')
    await expect(page.locator(MORE_DETAILS)).not.toHaveAttribute('open', /.*/)
  })
})
