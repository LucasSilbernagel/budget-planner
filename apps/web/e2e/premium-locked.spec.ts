import { expect, test } from '@playwright/test'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../src/lib/premium/benefits'

/**
 * Benefits with no page to open. Sync is the only one — it is an account-wide
 * capability with no `/sync` route (see `OVERVIEW_BENEFITS` in `HomePage.tsx`,
 * which is the authority).
 *
 * ⚠️ ROUTELESS NO LONGER MEANS INERT. Until story 41.1 sync was the one box that
 * was not a `PremiumFeatureGate`; UX-DR45 makes it one, so EVERY benefit is now
 * gated and only the "Open →" affordance still tracks this list. Two counts are
 * therefore needed where one used to do, and conflating them again is the exact
 * mistake the amendment was written to remove.
 *
 * The canonical SET is imported rather than hard-coded, deliberately: story 33.2
 * grew it from three benefits to five and had to hunt six stale literal 3s and 2s
 * out of four files. `OVERVIEW_BENEFITS` itself is not imported here because it
 * pulls React and Recharts into the Playwright process; these two facts are
 * restated instead, and the box-count assertions below fail loudly if they go wrong.
 */
const ROUTELESS_BENEFIT_IDS = ['sync'] as const satisfies readonly PremiumBenefitId[]

/** How many benefit boxes render as a `PremiumFeatureGate`. Since 41.1: all of them. */
const GATED_COUNT = PREMIUM_BENEFIT_IDS.length

// ⚠️ There is deliberately NO `ROUTED_COUNT` here, though `HomePage.test.tsx` has
// one. "Open →" and the href appear only in the ENTITLED state, and this suite runs
// unauthenticated with no session-seeding mechanism — so the routed count has no
// observable referent in a browser and a constant for it could only be checked
// against itself. The routed/routeless split is asserted in the unit suite, which
// can reach both tiers; what a browser CAN see is that no locked box exposes a page
// affordance, asserted below.

/**
 * Premium locked-state E2E (story 7-2, FR24).
 *
 * A first-time visitor has no session, so `usePremiumAccess` resolves to the
 * free tier on the client. This test drives the REAL hydration path (not a
 * mocked hook): after the client resolves the tier, the homepage must surface
 * Advanced Forecasting as a locked, discoverable control — with an upgrade
 * prompt on activation — rather than hiding it.
 *
 * This deliberately asserts the hydrated client DOM, the exact transition that
 * SSR-HTML smoke and mocked-only unit tests miss (project memory, 4-11).
 */
test('free visitor sees Advanced Forecasting locked and can open the upgrade prompt', async ({
  page,
}) => {
  await page.goto('/')

  // The gate renders a neutral skeleton during the in-flight tier check, then
  // resolves to the locked control for a free/unauthenticated user.
  //
  // ⚠️ This test's subject is ADVANCED FORECASTING and must stay that way. Story
  // 41.1 briefly retargeted this locator at sync to get AC-7 coverage, leaving the
  // title and the docblock above naming forecasting while the body asserted a
  // different feature — and, because the per-gate loop below identifies gates by
  // index, no e2e assertion named any routed gate's locked control at all. Sync's
  // own coverage belongs BESIDE this test, not on top of it: it has three homes —
  // the hover test's named check, the ROUTELESS loop in the alignment test, and
  // the gate-0 identity assertion in the overlay loop.
  const lockedFeature = page.getByRole('button', {
    name: /advanced forecasting — premium, locked/i,
  })
  await expect(lockedFeature).toBeVisible()

  // The lock badge is discoverable (FR24 — not hidden from the user).
  await expect(page.getByText('Premium', { exact: true }).first()).toBeVisible()

  // Activating the locked feature opens the upgrade prompt instead of navigating.
  // The resolved locked control now paints in the SSR HTML (story UX-1), so it is
  // clickable in the brief window before React hydrates and wires up its onClick.
  // Retry the click until the prompt opens (and stop clicking once it has) — the
  // Playwright-recommended way to act on a control that may not yet be hydrated.
  const goPremium = page.getByRole('heading', { name: /go premium/i })
  await expect(async () => {
    if (!(await goPremium.isVisible())) {
      await lockedFeature.click()
    }
    await expect(goPremium).toBeVisible({ timeout: 1000 })
  }).toPass()

  // Story 30-1: the dialog overlay must cover the whole viewport.
  //
  // `Modal` renders in normal flow — there is no `createPortal` in ui/Modal.tsx
  // — and `PremiumFeatureGate` returns a fragment of <button> PLUS the prompt.
  // So if the gate is placed directly inside the `space-y-3` stack instead of
  // its own wrapper <div>, the overlay becomes a spaced sibling, inherits
  // `margin-top: .75rem`, and (being fixed + inset-0 + height:auto) shrinks —
  // leaving a 12px undimmed strip across the top of the screen. The wrapper
  // divs in HomePage.tsx are the fix; without this assertion only a comment
  // protects them (mutation-verified during review: removing them kept the
  // whole suite green).
  const overlay = await page.locator('.fixed.inset-0').first().boundingBox()
  const viewport = page.viewportSize()
  expect(overlay, 'the upgrade dialog overlay must be measurable').not.toBeNull()
  expect(overlay?.y, 'overlay is offset from the top — a gate lost its wrapper div').toBe(0)
  expect(overlay?.height).toBe(viewport?.height)
})

const THEME_KEY = 'budget-planner-theme-prefs-v1'

/** Computed chassis styles of every premium benefit box, in DOM order. */
function readBoxes(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    // Every benefit box is a gate since story 41.1, so this is the whole set —
    // sync included, and no longer prepended separately.
    const nodes = [...document.querySelectorAll('[data-testid="premium-gate-locked"]')]
    return nodes.map((n) => {
      const s = getComputedStyle(n)
      return { bg: s.backgroundColor, border: s.borderTopColor, radius: s.borderTopLeftRadius }
    })
  })
}

/**
 * Load `/` with the theme preference SEEDED, and wait until it has painted.
 *
 * Seeding the persisted store is the only reliable way to reach dark mode here.
 * `ThemeProvider` re-applies the stored preference in its mount effect and calls
 * `classList.toggle('dark', false)`, so a hand-added `.dark` class survives only
 * ~530-600ms: a test that toggles it passes purely by finishing inside that
 * window, and fails on a machine ~40% slower with "box did not repaint in dark"
 * — a styling regression that does not exist. Seeding also removes the
 * transition-interpolation race, because the page paints the target theme from
 * its first frame rather than animating into it.
 */
async function gotoWithTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    THEME_KEY,
    JSON.stringify({ state: { theme }, version: 0 }),
  ] as const)
  await page.goto('/')
  await expect(page.getByTestId('premium-benefit-sync')).toBeVisible()
  await expect(page.getByTestId('premium-gate-locked')).toHaveCount(GATED_COUNT)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(theme === 'dark')
}

/**
 * Premium benefit boxes are theme-correct at 320px (story 30-1, AC-5/AC-6.3).
 *
 * This is the assertion that actually carries AC-5. `theme-page-coverage.spec.ts`
 * only asserts `.surface-sunken` / `.surface`, which on `/` resolve to the page
 * shell and a section wrapper — never a premium box — so it would stay green
 * whether or not this restyle is correct. Here we read the computed colours of
 * the three boxes themselves, in both themes.
 *
 * jsdom cannot do this: it computes no layout and no cascade, so the equivalent
 * unit assertion would pass vacuously.
 */
test('30-1: every premium benefit box is theme-correct and fits 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })

  await gotoWithTheme(page, 'light')
  const light = await readBoxes(page)
  expect(light).toHaveLength(PREMIUM_BENEFIT_IDS.length)

  // AC-1: one chassis — every box agrees on border colour and radius.
  for (const box of light) {
    expect(box.border).toBe(light[0].border)
    expect(box.radius).toBe(light[0].radius)
  }

  // Nothing overflows at 320px.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    scrollWidth,
    `overview overflows at 320px: ${scrollWidth} > ${clientWidth}`
  ).toBeLessThanOrEqual(clientWidth)

  // AC-5: the dark tokens actually engage — every box repaints, background AND
  // border. Asserted against the CARD the boxes sit on rather than against the
  // string 'rgb(255, 255, 255)': the dark token is `gray-700/40`, which
  // serialises as `rgba(..., 0.4)` and so could never equal that literal — an
  // assertion that cannot fail is worse than none.
  await gotoWithTheme(page, 'dark')
  const dark = await readBoxes(page)
  expect(dark).toHaveLength(PREMIUM_BENEFIT_IDS.length)
  for (const [i, box] of dark.entries()) {
    expect(box.bg, `box ${i} did not repaint in dark`).not.toBe(light[i].bg)
    expect(box.border, `box ${i} border did not repaint in dark`).not.toBe(light[i].border)
    expect(box.border).toBe(dark[0].border)
  }

  const cardBg = await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Premium Features' }) })
    .evaluate((n) => getComputedStyle(n).backgroundColor)
  expect(cardBg, 'the premium card must be dark, not a white card on a dark canvas').not.toBe(
    'rgb(255, 255, 255)'
  )
})

/**
 * The interactive affordance is real, not just present in the class list
 * (story 30-1, AC-4).
 *
 * This is the guard that catches the `hover:surface-inset` trap: that variant
 * compiles, survives lint and type-check, and satisfies any class-token
 * assertion — while resolving to the SAME colour `surface-inset` already sets,
 * so the hover does nothing. Only a real browser reading the computed colour
 * under an actual pointer hover can tell the two apart.
 */
test('41.1: EVERY locked benefit box responds to hover, sync included (AC-2)', async ({ page }) => {
  await page.goto('/')

  // ⚠️ REVERSED BY UX-DR45. Until story 41.1 this test asserted the opposite for
  // sync — five sampled reads proving its background NEVER moved on hover, because
  // it was a listed benefit with nothing to activate. It is a gate now, so the
  // guarantee flips: the box a user can activate must SAY so under a pointer.
  //
  // The `hover:surface-inset` trap the original was written for is unchanged and
  // is why this reads a computed colour rather than a class token.
  //
  // ⚠️ What this test can no longer cover: the ENTITLED sync box, which is still
  // inert and must stay so. The whole e2e suite runs unauthenticated with no
  // session-seeding mechanism, so that half lives in `HomePage.test.tsx`'s
  // entitled-tier chassis assertion. Recorded rather than silently dropped.
  await expect(page.getByTestId('premium-gate-locked')).toHaveCount(GATED_COUNT)

  const bgOf = (loc: ReturnType<typeof page.getByTestId>) =>
    loc.evaluate((n) => getComputedStyle(n).backgroundColor)

  for (let index = 0; index < GATED_COUNT; index++) {
    const box = page.getByTestId('premium-gate-locked').nth(index)
    const label = (await box.getAttribute('aria-label')) ?? `box ${index}`
    await expect(box).toBeVisible()

    // Re-hover inside the poll. The section sits low on the page, so `hover()`
    // scrolls first; under full-suite parallel load the charts above are still
    // settling and the box can shift out from under the cursor, leaving `:hover`
    // unapplied. A single hover outside the poll is flaky for that reason.
    const rest = await bgOf(box)
    await expect
      .poll(
        async () => {
          await box.hover()
          return bgOf(box)
        },
        { message: `${label}: background must actually change on hover` }
      )
      .not.toBe(rest)

    // Move the pointer off so the next iteration's resting colour is a real
    // resting colour rather than the previous box's hover state bleeding across.
    await page.mouse.move(0, 0)
  }

  // Named, not merely counted: a GATED_COUNT loop is satisfied by five boxes none
  // of which is sync, which is exactly the state this story changed.
  const syncBox = page.getByTestId('premium-benefit-sync').getByTestId('premium-gate-locked')
  await expect(syncBox).toHaveAttribute('aria-label', /multi-device sync — premium, locked/i)
})

/** Every width the badge alignment must hold at (story 33.1, UX-DR39). */
const ALIGNMENT_WIDTHS = [320, 375, 640, 768, 1024, 1280] as const

/**
 * How far apart the three badge left edges may sit, in px.
 *
 * 1.0 is chosen from measurement, not taste. The correct implementation — a
 * chevron spacer mirroring the real glyph — measures 0.00px across six widths
 * and six font stacks, with 0.00px run-to-run noise; a hard-coded px reserve
 * drifts up to 1.20px by font; and the defect this must catch is 25.06–27.20px.
 * So 1.0 is ~25x below the break (it cannot be accused of being unfalsifiable)
 * while surviving sub-pixel flex/gap rounding. Do NOT relax it toward 25 —
 * anything in the 2–20px range silently accepts a real half-fix.
 */
const BADGE_ALIGNMENT_TOLERANCE_PX = 1

/**
 * Same font pin as `responsive-320.spec.ts` (which owns the original and the
 * story behind it: a 320px guard passed locally and failed in CI purely on glyph
 * metrics, so every layout guard here forces the widest common Linux stack).
 * Deliberately re-declared rather than exported across specs — nothing depends on
 * these two strings matching; each spec pins its own measurement environment.
 */
const WIDE_FONT = '*,*::before,*::after{font-family:"DejaVu Sans"!important}'

/**
 * Every lock badge lines up (story 33.1, UX-DR39; extended to the full canonical
 * set by story 33.2).
 *
 * ⚠️ This CANNOT be a unit test. jsdom loads no CSS, so every rect reads 0,
 * `getClientRects().length` is 0, and `getComputedStyle(box).display` is `block`
 * rather than `flex` — `justify-between`, `mr-auto`, `gap-3` and `order-last`,
 * every class that produces the defect, are inert there. A jsdom version of this
 * assertion passes identically on broken and fixed code.
 *
 * ⚠️ It also cannot be an overflow check. Measured: `documentElement.scrollWidth`
 * equals `clientWidth` in EVERY broken variant at every width, so the existing
 * 320px sweep is structurally blind to misalignment.
 *
 * Asserted as a SPREAD across ALL badges (max − min), never `Math.abs` on one pair
 * and never at a single width. The half-fix that omits `mr-auto` from a label
 * measures 0.00px at 320/375 and −276.93px at 1280 — negative and wide-only, so a
 * narrow-only or single-direction check certifies it as correct.
 *
 * Story 33.2 grew the set from three boxes to five. Measured before writing the
 * story: the two added boxes land on EXACTLY the same badge x as the original three
 * (0.00px spread at all six widths), because `mr-auto` absorbs all label and
 * sub-text length — alignment here is label-length-invariant, so this assertion is
 * a regression guard rather than a risk the story took on.
 *
 * Relative deltas only, never an absolute x: absolute badge position swings
 * 10.61px on font alone at 320px, which is exactly the local-green/CI-red failure
 * the font pin exists to prevent.
 */
test('33.1: every premium lock badge aligns at every width (UX-DR39)', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('premium-benefit-sync')).toBeVisible()
  await expect(page.getByTestId('premium-gate-locked')).toHaveCount(GATED_COUNT)
  // Measure the RESOLVED free-tier state. The unresolved state renders the gate's
  // aria-hidden skeleton, which occupies layout, so measuring through it would
  // compare a placeholder against the real badges. (Until story 41.1 sync had its
  // own `premium-benefit-sync-badge-pending` placeholder for the same reason;
  // becoming a gate folded it into the shared skeleton.)
  await expect(page.getByTestId('premium-gate-skeleton')).toHaveCount(0)

  await page.addStyleTag({ content: WIDE_FONT })

  // The affordance rule, checked in a real cascade before any geometry.
  //
  // ⚠️ Nothing else in the suite can see this. The alignment assertion below is
  // INSENSITIVE to whether a chevron paints — its box is reserved either way, so a
  // hidden chevron yields the identical 0.00px spread. The unit test checks only
  // the class TOKEN `invisible`, in jsdom, where `visibility` is never computed.
  // So without this, a cascade regression (a later rule setting `visibility` on a
  // `.text-accent` descendant, a Tailwind layer-order change) would silently
  // remove the only touch affordance a locked box has, with every other test green.
  //
  // ⚠️ REVERSED FOR SYNC BY UX-DR45. Until story 41.1 this asserted `hidden` on the
  // sync chevron, because sync was not activatable and a painted chevron would have
  // read as "tap me" on a box that did nothing. Sync IS tappable now, so the same
  // reasoning demands the opposite value — the affordance and the behaviour have to
  // agree, and it is the behaviour that moved.
  const chevronVisibility = await page.evaluate(() => {
    const glyph = (node: Element | null) =>
      [...(node?.querySelectorAll('span') ?? [])].find((s) => s.textContent?.trim() === '›')
    const sync = glyph(
      document.querySelector(
        '[data-testid="premium-benefit-sync"] [data-testid="premium-gate-locked"]'
      )
    )
    const boxes = [...document.querySelectorAll('[data-testid="premium-gate-locked"]')].map((box) =>
      glyph(box)
    )
    return {
      sync: sync ? getComputedStyle(sync).visibility : 'MISSING',
      boxes: boxes.map((b) => (b ? getComputedStyle(b).visibility : 'MISSING')),
    }
  })
  expect(chevronVisibility.sync, 'the sync chevron must PAINT — it is activatable').toBe('visible')
  expect(chevronVisibility.boxes, 'every locked box must keep a VISIBLE chevron').toEqual(
    Array.from({ length: GATED_COUNT }, () => 'visible')
  )

  // The other half of the affordance rule, and the one claim UX-DR45 did NOT
  // change: a locked box is activatable but never a page. Sync additionally has no
  // page in any tier, which is why it is named here rather than only counted.
  const pageAffordances = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-testid="premium-gate-locked"]')]
    return {
      links: boxes.filter((b) => b.querySelector('a[href]') !== null).length,
      openArrows: boxes.filter((b) => (b.textContent ?? '').includes('Open →')).length,
    }
  })
  expect(pageAffordances.links, 'a locked box must never contain a link').toBe(0)
  expect(pageAffordances.openArrows, '"Open →" is an entitled-state affordance only').toBe(0)
  // ⚠️ Scoped honestly to the LOCKED tier. `"${id}" has no page in ANY tier` was
  // the first wording and it overclaimed: this suite runs unauthenticated, so an
  // entitled-tier `<a href>` on a routeless benefit would pass this forever. The
  // any-tier claim is the unit suite's, which can reach both.
  for (const id of ROUTELESS_BENEFIT_IDS) {
    await expect(
      page.getByTestId(`premium-benefit-${id}`).locator('a[href]'),
      `"${id}" has no page, so its LOCKED box must contain no link`
    ).toHaveCount(0)
  }

  for (const width of ALIGNMENT_WIDTHS) {
    await page.setViewportSize({ width, height: 720 })

    const boxes = await page.evaluate(() => {
      // Every benefit box is a gate since story 41.1, so this is the whole set.
      const nodes = [...document.querySelectorAll('[data-testid="premium-gate-locked"]')]
      return nodes.map((node) => {
        const badges = node.querySelectorAll('.rounded-full')
        return {
          // `aria-label`, not a testid: every box is a gate since story 41.1 and
          // only sync's wrapper carries a `premium-benefit-*` testid, so the
          // accessible name is the only per-box identifier available here.
          label: (node as HTMLElement).getAttribute('aria-label') ?? 'unknown',
          badgeCount: badges.length,
          x: badges.length === 1 ? badges[0].getBoundingClientRect().x : Number.NaN,
        }
      })
    })

    // Anti-vacuous: prove the fixture is what we think before believing the maths.
    expect(
      boxes,
      `expected ${PREMIUM_BENEFIT_IDS.length} benefit boxes at ${width}px`
    ).toHaveLength(PREMIUM_BENEFIT_IDS.length)
    for (const box of boxes) {
      expect(box.badgeCount, `${box.label} must carry exactly one lock badge at ${width}px`).toBe(1)
    }

    const xs = boxes.map((box) => box.x)
    const spread = Math.max(...xs) - Math.min(...xs)
    expect(
      spread,
      `badges misaligned at ${width}px — left edges ${xs.map((x) => x.toFixed(2)).join(', ')}`
    ).toBeLessThanOrEqual(BADGE_ALIGNMENT_TOLERANCE_PX)

    // The badge adds width to a box that had none, and the label reflows around
    // it. Cheap companion check that it never spills the page at any width.
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      scrollWidth,
      `overview overflows at ${width}px: ${scrollWidth} > ${clientWidth}`
    ).toBeLessThanOrEqual(clientWidth)
  }
})

/**
 * Two gate dialogs open at once do not wedge the page (story 41.1 code review).
 *
 * ⚠️ THE UNIT TESTS IN `Modal.test.tsx` CANNOT ESTABLISH THIS. They mount two
 * `Modal`s directly and prove the stack behaves; they say nothing about whether
 * the Overview can actually REACH a two-dialog state. That reachability is the
 * whole finding — story 41.1 took this section from four gates to five and made
 * sync the first tab stop, and `Modal` had carried "assumes a single modal is
 * open at a time" as an accepted limitation. Measured here in a real browser
 * before the fix: 2 dialogs, ONE Escape closed BOTH, `body.style.overflow` left
 * `'hidden'` with nothing on screen — scroll dead until reload.
 *
 * Focus is moved with `.focus()` rather than by pressing Tab: the dialog's Tab
 * trap wraps within the dialog, so Tab alone cannot reproduce it. What `.focus()`
 * stands in for is a browser-chrome round trip (address bar, devtools, tab
 * switch) returning focus to the page — which the trap does not intercept.
 */
test('41.1 review: two open gate dialogs close one at a time and release the scroll lock', async ({
  page,
}) => {
  await page.goto('/')
  const gates = page.getByTestId('premium-gate-locked')
  await expect(gates).toHaveCount(GATED_COUNT)

  const goPremium = page.getByRole('heading', { name: /go premium/i })
  await expect(async () => {
    if (!(await goPremium.isVisible())) {
      await gates.nth(0).click()
    }
    await expect(goPremium).toBeVisible({ timeout: 1000 })
  }).toPass()

  // Reach a second gate behind the overlay and activate it with a real keypress.
  await gates.nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('dialog'),
    'the two-dialog state must actually be reachable, or this test proves nothing'
  ).toHaveCount(2)

  const overflow = () => page.evaluate(() => document.body.style.overflow)

  // One Escape closes ONE dialog, and the lock holds while one remains.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog'), 'one Escape must not close both dialogs').toHaveCount(1)
  expect(await overflow(), 'the lock must hold while a dialog is still open').toBe('hidden')

  // The second Escape empties the stack and gives the page back.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await overflow(), 'the scroll lock must be released').toBe('')

  // Asserted as real scrolling, not just the style property: the style is the
  // mechanism, scrolling is the thing the user lost.
  const scrolled = await page.evaluate(() => {
    window.scrollTo(0, 300)
    return window.scrollY
  })
  expect(scrolled, 'the page must scroll again once every dialog has closed').toBeGreaterThan(0)
})

/**
 * EVERY gated benefit's upgrade overlay covers the whole viewport (story 33.2, AC-7).
 *
 * ⚠️ This exists because the guard at the top of this file — the one whose comment
 * explains the non-portalled-Modal hazard in detail — only ever opens the FIRST
 * gate. It has been protecting one wrapper `<div>` out of two since story 30-1, and
 * story 33.2 took that to four. A missing wrapper on any later box would have
 * shipped with the whole suite green: the defect is a 12px undimmed strip at the top
 * of a dialog nothing else opens.
 *
 * The mechanism, restated because it is not obvious from the markup: `ui/Modal.tsx`
 * has no `createPortal`, and `PremiumFeatureGate` returns a FRAGMENT of its
 * `<button>` plus a `<PremiumPrompt asDialog>`. Dropped straight into the
 * `space-y-3` stack, the overlay becomes a spaced sibling, inherits
 * `margin-top: .75rem`, and — being `fixed inset-0` with `height: auto` — shrinks by
 * exactly that margin.
 *
 * Measured at both extremes because the stack's spacing is width-independent but the
 * failure is a vertical offset: a wide viewport is where a 12px strip is least
 * visible to a human reviewer and most likely to be waved through.
 */
for (const width of [320, 1280] as const) {
  test(`33.2: every gated benefit's upgrade overlay covers the viewport at ${width}px (AC-7)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })

    for (let index = 0; index < GATED_COUNT; index++) {
      // Reload between gates: each gate owns its own `isPromptOpen` state and
      // `Modal` assumes a single modal is open at a time (deferred-work.md:477), so
      // opening a second prompt without closing the first would measure a state the
      // app does not actually reach.
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await expect(page.getByTestId('premium-gate-locked')).toHaveCount(GATED_COUNT)

      const gate = page.getByTestId('premium-gate-locked').nth(index)
      const label = (await gate.getAttribute('aria-label')) ?? `gate ${index}`

      // AC-7: the sync gate is genuinely one of the boxes this loop opens. An
      // index loop over GATED_COUNT would be satisfied by five gates none of
      // which is sync — the state this story changed.
      //
      // ⚠️ ORDERING IS LOAD-BEARING, and it was wrong on the first attempt. The
      // wrapper-testid assertion below used to sit HERE, before the measurement —
      // so deleting sync's wrapper `<div>` (the exact defect this test exists to
      // catch) failed on the missing testid at 5s timeout and the overlay was never
      // measured at all. An arm that goes red for the wrong reason certifies
      // nothing. This check reads `aria-label`, which survives a wrapper deletion,
      // so the overlay assertion is what fires first when the wrapper goes.
      if (index === 0) {
        expect(label, 'sync must lead the section and be gate 0').toMatch(
          /multi-device sync — premium, locked/i
        )
      }

      // Same hydration-tolerant click as the first test in this file: the resolved
      // locked control paints in the SSR HTML (story UX-1), so it is clickable
      // before React wires up its onClick.
      const goPremium = page.getByRole('heading', { name: /go premium/i })
      await expect(async () => {
        if (!(await goPremium.isVisible())) {
          await gate.click()
        }
        await expect(goPremium).toBeVisible({ timeout: 1000 })
      }).toPass()

      const overlay = await page.locator('.fixed.inset-0').first().boundingBox()
      const viewport = page.viewportSize()
      expect(overlay, `${label}: the upgrade dialog overlay must be measurable`).not.toBeNull()
      expect(
        overlay?.y,
        `${label}: overlay is offset from the top — this gate lost its wrapper div`
      ).toBe(0)
      expect(overlay?.height, `${label}: overlay does not span the viewport height`).toBe(
        viewport?.height
      )

      // Now that the geometry has been measured, pin the structure it depends on:
      // sync's own wrapper `<div>`, added by story 41.1. Deliberately AFTER the
      // measurement — see the ordering note above.
      if (index === 0) {
        await expect(
          page.getByTestId('premium-benefit-sync').getByTestId('premium-gate-locked'),
          'sync must be gated inside its own wrapper div'
        ).toHaveCount(1)
      }
    }
  })
}
