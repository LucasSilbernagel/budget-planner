import { expect, test } from '@playwright/test'
import { PREMIUM_BENEFIT_IDS } from '../src/lib/premium/benefits'

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
  // the sync-presence assertion in the overlay loop. (That last was a gate-0
  // identity check until story 5-20 moved sync off index 0; it is now an
  // order-independent presence assertion, so it survives the next reorder.)
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
